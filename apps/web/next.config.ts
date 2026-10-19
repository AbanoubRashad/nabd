import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const ws = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws';
const dev = process.env.NODE_ENV !== 'production';

/**
 * Content Security Policy. The marketing pages are prerendered, so a per-request nonce is not possible;
 * scripts are limited to this origin plus Next's inline bootstrap, with no eval outside development.
 * Data can only be fetched from this origin and the Nabd API and WebSocket.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${api} ${ws}${dev ? ' ws://localhost:*' : ''}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Only when the API is on HTTPS too, or a local production run would have its API calls rewritten.
  ...(!dev && api.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@nabd/shared', '@nabd/notify'],
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(dev
            ? []
            : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
