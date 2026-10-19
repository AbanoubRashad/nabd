/**
 * Authentication and request identity.
 *
 * - Email + password (argon2id). A short-lived JWT goes in an httpOnly, SameSite=Lax cookie; a random
 *   refresh token (only its SHA-256 is stored) in a second cookie scoped to /auth, rotated on every use.
 * - No cookie means an anonymous demo visitor: read-only, plus relay commands on simulated devices.
 * - CSRF: every state-changing request must carry the `x-nabd-csrf` header. Browsers cannot add a custom
 *   header to a cross-site request without a CORS preflight, and CORS allows only the web app's origin.
 */
import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Store } from './store.js';

export type Role = 'admin' | 'viewer' | 'anon';

export interface Identity {
  role: Role;
  userId: number | null;
  /** Shown as `requested_by` on commands and `acknowledged_by` on alerts. */
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number; role: 'admin' | 'viewer'; name: string };
    user: { sub: number; role: 'admin' | 'viewer'; name: string };
  }
}

export const ACCESS_COOKIE = 'nabd_at';
export const REFRESH_COOKIE = 'nabd_rt';
export const CSRF_HEADER = 'x-nabd-csrf';
const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 30 * 86_400;

export interface AuthOptions {
  store: Store;
  jwtSecret: string;
  /** false only for plain-HTTP local development. */
  secureCookies: boolean;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const ANONYMOUS: Identity = { role: 'anon', userId: null, name: 'demo visitor' };

/** A dummy hash, so a login for an unknown email costs the same time as a wrong password. */
let dummyHash: Promise<string> | null = null;

export const authPlugin = fp(async (app: FastifyInstance, o: AuthOptions) => {
  await app.register(cookie);
  await app.register(jwt, { secret: o.jwtSecret, cookie: { cookieName: ACCESS_COOKIE, signed: false } });

  app.decorateRequest('identity', null as unknown as Identity);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    req.identity = ANONYMOUS;
    if (req.cookies[ACCESS_COOKIE]) {
      try {
        const user = await req.jwtVerify<{ sub: number; role: 'admin' | 'viewer'; name: string }>();
        req.identity = { role: user.role, userId: user.sub, name: user.name };
      } catch {
        // Expired or tampered: carry on as anonymous; the client refreshes and retries.
      }
    }
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutating && !req.url.startsWith('/webhooks/') && req.headers[CSRF_HEADER] === undefined) {
      return reply.code(403).send({ error: 'csrf', message: `missing ${CSRF_HEADER} header` });
    }
  });

  const cookieBase = { httpOnly: true, sameSite: 'lax' as const, secure: o.secureCookies };

  async function issue(reply: FastifyReply, user: { id: number; role: 'admin' | 'viewer'; name: string }) {
    const access = await reply.jwtSign(
      { sub: user.id, role: user.role, name: user.name },
      { expiresIn: ACCESS_TTL_S },
    );
    const refresh = randomBytes(32).toString('base64url');
    await o.store.saveRefreshToken(sha256(refresh), user.id, new Date(Date.now() + REFRESH_TTL_S * 1000));
    reply
      .setCookie(ACCESS_COOKIE, access, { ...cookieBase, path: '/', maxAge: ACCESS_TTL_S })
      .setCookie(REFRESH_COOKIE, refresh, { ...cookieBase, path: '/auth', maxAge: REFRESH_TTL_S });
  }

  app.decorate('auth', {
    async login(email: string, password: string, reply: FastifyReply) {
      const user = await o.store.findUserByEmail(email);
      dummyHash ??= argon2.hash('not-a-real-password', { type: argon2.argon2id });
      const ok = await argon2.verify(user?.passwordHash ?? (await dummyHash), password).catch(() => false);
      if (!user || !ok) return null;
      await issue(reply, user);
      return user;
    },
    async refresh(req: FastifyRequest, reply: FastifyReply) {
      const token = req.cookies[REFRESH_COOKIE];
      if (!token) return null;
      const userId = await o.store.consumeRefreshToken(sha256(token));
      const user = userId === null ? null : await o.store.getUser(userId);
      if (!user) return null;
      await issue(reply, user);
      return user;
    },
    async logout(req: FastifyRequest, reply: FastifyReply) {
      const token = req.cookies[REFRESH_COOKIE];
      if (token) await o.store.revokeRefreshToken(sha256(token));
      reply.clearCookie(ACCESS_COOKIE, { path: '/' }).clearCookie(REFRESH_COOKIE, { path: '/auth' });
    },
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    auth: {
      login(
        email: string,
        password: string,
        reply: FastifyReply,
      ): Promise<{ id: number; email: string; name: string; role: 'admin' | 'viewer' } | null>;
      refresh(
        req: FastifyRequest,
        reply: FastifyReply,
      ): Promise<{ id: number; email: string; name: string; role: 'admin' | 'viewer' } | null>;
      logout(req: FastifyRequest, reply: FastifyReply): Promise<void>;
    };
  }
}

/** preHandler that allows only the given roles. */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.identity.role)) {
      return reply
        .code(req.identity.role === 'anon' ? 401 : 403)
        .send({ error: 'forbidden', message: `requires ${roles.join(' or ')}` });
    }
  };
}
