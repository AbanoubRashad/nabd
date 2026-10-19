# Security checklist

An item is ticked only when something verifies it, and the note says what. "On the VPS" items can only be
checked on the deployed stack and stay open until then.

## Transport

- [ ] **TLS everywhere: MQTT 8883, HTTPS, WSS.** Configured: Caddy terminates HTTPS and WSS
      (`infra/caddy/Caddyfile`); EMQX listens on 8883 with Caddy's Let's Encrypt certificate
      (`infra/docker-compose.prod.yml`); the firmware pins ISRG Root X1 (`include/root_ca.h`).
      _To verify on the VPS:_ `openssl s_client -connect mqtt.<domain>:8883` shows the chain;
      `curl -I https://api.<domain>/healthz` returns 200 with HSTS.
- [ ] **No plaintext 1883 outside the Docker network.** The production override publishes only 8883
      (`ports: !override`). _To verify on the VPS:_ `nc -z <vps-ip> 1883` fails from outside.

## Broker

- [x] **Per-device credentials.** `pnpm credentials` makes one random 192-bit password per device and
      service; EMQX imports them hashed with PBKDF2-SHA256 (`infra/emqx/base.hocon`).
- [x] **ACL: a device publishes and subscribes only under its own subtree.** `infra/emqx/acl.conf` keys
      every rule on the authenticated `${username}`; anything unmatched is denied and the client
      disconnected. The simulator connects as each device with that device's credentials, so it is held
      to the same rules. _Still to run against the real broker:_ the Testcontainers suite.
- [x] **Least-privilege service accounts.** `svc-ingest` can only subscribe (shared subscription to
      telemetry and status); `svc-api` subscribes to telemetry, status and acks and publishes only `cmd`
      and `ota`.
- [x] **The API and ingest re-check the topic.** A message is ignored unless its device is registered
      under the site in the topic (`apps/ingest/src/route.ts`, `apps/api/src/live/bridge.ts`; tested in
      `route.test.ts`).

## Secrets

- [x] **Device secrets hashed in the database, shown once.** The seed stores argon2id hashes in
      `devices.mqtt_password_hash`; the plain password lives only in the gitignored `secrets/` file and
      in the device's NVS.
- [x] **Secrets only from environment variables; `.env.example` shipped, `.env` never.** `.gitignore`
      excludes `.env*`, `secrets/`, `*.pem`, `*.key`. A scan of every staged file for private keys runs
      before each commit in this project's history, and gitleaks runs in CI (`.github/workflows/ci.yml`).
- [x] **The OTA signing key never touches the repo or CI.** `scripts/sign-firmware.ts keygen` refuses
      to write a private key inside the repository (tested); `sign` reads it only from
      `NABD_OTA_PRIVATE_KEY` or `NABD_OTA_KEY_FILE`. CI builds firmware but never signs it. Only the
      public key is committed (`firmware/nabd-node/include/ota_pubkey.h`).

## Application

- [x] **Every input validated with zod at the edge.** Every API route has a zod schema for params, query
      and body (`fastify-type-provider-zod`); MQTT payloads go through `parseTelemetry`/`parseStatus`/
      `parseAck` with a 2 KB limit, registry-only metric keys, range checks and a future-skew check
      (`packages/shared/src/schemas.test.ts`).
- [x] **Parameterised SQL only.** Every query uses `$n` parameters. The two places that pick a table or
      column name choose from fixed constants, never from input (`apps/api/src/pg-store.ts`
      `SOURCE_TABLE`, `minuteSeries`).
- [x] **Rate limits on auth, commands and webhooks.** 300 requests/min per IP overall, 5/min on
      `/auth/login`, 30/min on refresh, 3/min on test messages, 120/min on the WhatsApp webhook, and
      one command every 3 s per IP for anonymous visitors (`server.test.ts`: "limits anonymous visitors").
- [x] **CSRF protection for cookie mutations.** Every POST/PATCH/DELETE (except the signed webhook)
      needs the `x-nabd-csrf` header, which a cross-site form cannot send and a cross-site `fetch` cannot
      add without a CORS preflight that only the web origin passes. Cookies are `SameSite=Lax`,
      `HttpOnly`, and `Secure` in production (`server.test.ts`: "rejects a mutation without the CSRF header").
- [x] **Webhook authenticity.** The WhatsApp webhook checks Meta's `X-Hub-Signature-256` HMAC over the
      raw body in constant time (`server.test.ts`: "refuses an unsigned or badly signed request").
- [x] **Passwords.** argon2id; unknown emails cost the same time as wrong passwords; refresh tokens are
      random, stored as SHA-256, and rotated on every use (`server.test.ts`: "rotates refresh tokens").
- [x] **Strict CSP and security headers on the web app** (`apps/web/next.config.ts`): `default-src
      'self'`, no `eval` in production, `connect-src` limited to this origin, the API and the WebSocket,
      `frame-ancestors 'none'`, `object-src 'none'`, plus HSTS, `nosniff`, `Referrer-Policy` and
      `Permissions-Policy`. Checked on the production build with `curl -I`.
      **Known trade-off:** `script-src` includes `'unsafe-inline'`, because the marketing pages are
      prerendered and static HTML cannot carry a per-request nonce for Next's inline bootstrap. Moving
      those pages to dynamic rendering with nonces would remove it at the cost of the static speed.

## Demo isolation

- [x] **Anonymous users can never command the real board.** The command service refuses any command to a
      device that is not simulated unless the caller is an admin (`server.test.ts`: "never lets an
      anonymous visitor command the real board"). Production marks the board real with `NABD_REAL_DEVICE`.
- [x] **Anonymous users cannot change rules.** Creating, editing and deleting rules and sending test
      messages require the admin role (`server.test.ts`: "keeps rule edits admin-only").
- [x] **Commands cannot be forged by another device.** An ack only updates a command sent to that same
      device (`server.test.ts`: "ignores an ack from a device the command was not sent to").

## Device

- [x] **Relays fail safe.** OFF at boot and after `failsafe_s` without the broker (`src/main.cpp`).
- [x] **Commands expire.** The device refuses a command past its `exp` with reason `expired`
      (firmware native test `test_command_rejections_keep_the_id`, simulator `device.test.ts`).
- [x] **Signed firmware only.** The device checks SHA-256 and the ECDSA P-256 signature before switching
      slots; the signing script's own verify step rejects a tampered image (checked by hand: a 1-byte
      change fails with `sha256 mismatch`). _On the board:_ a wrongly signed build is refused (Phase 6
      acceptance, needs the hardware).
