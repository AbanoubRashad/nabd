# Nabd: progress and plan

Running log for the build described in the project brief. Each phase ends with: what was built, how it was
verified (commands and results), what is left, and decisions needed.

Status key: ✅ done · 🔶 in progress · ⏳ not started · ⛔ blocked (needs the owner)

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Monorepo, tooling, docker-compose, ADRs, this plan | ✅ done; CI green on GitHub (all 5 jobs) |
| 1 | Contract, simulator, ingest, database | ✅ done; integration tests pass on CI against a real TimescaleDB |
| 2 | API, WebSocket, `/fleet`, `/sites`, `/devices/[id]` | ✅ done; live Playwright tests pass on CI against the demo |
| 3 | Commands (relay flow) | ✅ done; "Device confirmed" and keyboard tests pass on CI |
| 4 | Rules engine and notifications | ✅ done; alerts fire in the demo (console provider); real WhatsApp needs your Meta account |
| 5 | Real hardware (ESP32-S3 firmware) | ⛔ builds for the ESP32-S3, native tests pass; needs the board |
| 6 | Signed OTA with rollback | ⛔ code and signing done; needs the board |
| 7 | Landing, products, mega-menus, Arabic, mobile, polish | ✅ done; Lighthouse a11y/best practices/SEO 100 |
| 8 | Hardening, load test, deploy | 🔶 web on Vercel; free demo backend ready for Render (one sign-in by the owner); 500-device load test needs the VPS |
| 9 | README, case study, portfolio card, launch post | ✅ done; portfolio card live at abanoub--rashad.web.app |
---

## Proposed changes to the brief (confirmed by the owner, 2026-10-19)

1. **Next.js 16 instead of 15.** 16.4 is the current stable release. Same App Router, plus Cache Components
   and `proxy.ts`. Baytak is already on 16, so the two portfolio projects match.
2. **TypeScript 6.0, not 7.0.** typescript-eslint supports only `<6.1` so far. I'll move to 7 when it
   does.
3. **EMQX licence.** Since 5.9, EMQX is BSL 1.1. One production node is free, which is all Nabd needs.
   This is recorded in ADR 0002. A cluster would need a paid licence, and Mosquitto or NanoMQ can replace
   it then.
4. **`pnpm dev` runs the Node services and the web app. `pnpm infra:up` starts EMQX + TimescaleDB in
   Docker.** I kept them separate so `pnpm dev` restarts in seconds and doesn't restart the databases.
5. **Landing "design v3".** Section 12 says v3, but section 2 and the files say v2. I'll build from
   `docs/design-reference/Main.dc.html`, the newest file in the repo.
6. **Lighthouse ≥ 95 performance.** I'll measure it on the deployed Vercel URL with PageSpeed Insights.
   Local runs on this machine are too noisy to trust (Baytak scored anywhere from 57 to 83 locally).
7. **The load test (500 devices).** It will run against the Docker stack on the VPS once it exists, so
   `docs/PERFORMANCE.md` reports server numbers, not laptop numbers. A local run is a smoke test only.

## Decisions and blockers for the owner

- ✅ WSL2 and Docker work (2026-10-31), and the GitHub repo `AbanoubRashad/nabd` is public with CI green.
- ⛔ **The ESP32-S3 board and sensors** for Phases 5–6 ([BOM](hardware/BOM.md)).
- 🔑 **Render sign-in for the free demo backend** ([DEPLOY.md § 0](DEPLOY.md)): apply `render.yaml` from your
  GitHub account, then send me the service URL to connect the Vercel site.
- 💳 **Optional: a VPS for the full stack** (about $5–7/month, [DEPLOY.md](DEPLOY.md)), for TimescaleDB, EMQX
  with TLS and the 500-device load test.
- 🔑 **Back up the OTA signing key** at `%LOCALAPPDATA%\nabd-tools\ota-signing-key.pem`. It is outside the
  repo on purpose. Nodes only accept firmware signed with it.
- Deployment accounts, each step marked in [DEPLOY.md](DEPLOY.md): domain, VPS, Vercel, Meta WhatsApp,
  Resend, Sentry, object storage for backups.

## Plan by phase

### Phase 0: Setup

- [x] pnpm + Turborepo monorepo: `apps/{web,api,ingest,simulator}`, `packages/{shared,db}`
- [x] TypeScript strict base config, ESLint 9 flat config (Next config for web), Prettier, EditorConfig
- [x] `infra/docker-compose.yml`:
  - TimescaleDB 2.30.2-pg16 and EMQX 6.1.5, with health checks; plain MQTT bound to localhost only
  - `stack` profile for api / ingest / simulator / Caddy, plus `infra/node.Dockerfile`
- [x] Firmware skeleton: PlatformIO (pioarduino, Arduino core 3.x), two OTA slots plus LittleFS
  partition table, native test env
- [x] GitHub Actions:
  - format, lint, typecheck, test, build
  - firmware native tests, build and `.bin` artifact
  - gitleaks
- [x] ADRs 0001–0006:
  - monorepo
  - EMQX vs Mosquitto
  - narrow readings table
  - node-pg-migrate with SQL
  - WebSocket fan-out path
  - OTA signing
- [x] 15 design images copied to `apps/web/public/images/`
- [x] `pnpm infra:up` healthy
- [x] CI green on GitHub

### Phase 1: Contract, simulator, ingest, database

- `@nabd/shared`:
  - zod schemas for telemetry / status / cmd / ack / OTA, with the 2 KB limit and the 5-minute future-skew
    check
  - metric registry with unit, range, precision and EN/AR labels
  - product catalogue (`products.ts`) and the seed constants for sites and devices
- `@nabd/db` migrations:
  - all tables from section 5
  - `readings` hypertable, compression after 7 days, 90-day retention
  - `readings_1m/1h/1d` with refresh policies
  - `dead_letters`
  - seed for 4 sites, 12 devices, 4 rules and one demo contact (no real number)
- EMQX:
  - built-in auth with hashed per-device passwords
  - ACL `nabd/v1/+/${clientid}/#`
  - least-privilege service accounts
- Simulator:
  - 12 devices with their own credentials and the behaviours from section 9
  - Cairo diurnal solar curve, a fridge "door ajar" event every 20 min, `nabd-11` offline 15 min every
    hour
  - NVS-like persisted `seq`
  - command replies with realistic delays and 2 % optional timeouts
- Ingest:
  - shared subscription with zod validation
  - batch insert every 250 ms or 500 rows via `unnest`, `ON CONFLICT DO NOTHING`
  - dead letters, status → devices table
  - `/healthz` and Prometheus `/metrics`, graceful drain
- Tests:
  - unit tests for schemas and topics
  - Testcontainers integration test: publish → row; duplicate `seq` → one row; dead letter recorded;
    aggregates refresh

### Phase 2: API, WebSocket and live pages

- Fastify with `fastify-type-provider-zod`, generated OpenAPI in `docs/api/` and a Postman collection
- Auth: argon2id, short-lived JWT in an httpOnly cookie, refresh token, admin/viewer roles, read-only demo
  mode
- REST endpoints from section 7; readings pick raw/1m/1h/1d automatically (max 2,000 points)
- `/ws`:
  - subscribe to sites or devices
  - `reading` / `status` / `command` / `alert` events with `seq`
  - back-fill on reconnect, 15 s heartbeat
- Latency: `received_at − ts` and `pushed_at − ts`, p95 shown on `/fleet`
- Web (dark app theme):
  - sidebar shell
  - `/fleet` (KPIs, live uPlot chart with a 15-minute ring buffer, events, devices table)
  - `/sites` (SVG map with pins whose shape and colour follow the site's status, site panel, 24 h strip)
  - `/devices/[id]` (tiles, 24 h min/avg/max band, raw MQTT stream)
  - WS client with backoff and a connection pill

### Phase 3: Commands

- Command rows, publish to `…/cmd` with an expiry, states updated from `…/cmd/ack`, 10 s timeout, every
  change pushed over WS
- Relay control as designed: `aria-pressed`, 3-step progress with real timings, timeout restores the real
  state
- Demo rules: anonymous users can command simulated devices only, at most 1 command / 3 s per IP; the real
  board needs an admin

### Phase 4: Rules and notifications

- Pure state machine in `@nabd/shared`:
  - ok → pending → firing → resolved, plus acknowledged and muted
  - `for_seconds`, hysteresis, cooldown, quiet hours (critical bypasses them), 15-min escalation
  - table-driven Vitest tests
- Rules run in ingest on every reading; an offline checker runs every 30 s
- Provider interface:
  - WhatsApp Cloud API (`nabd_alert` EN/AR) and Resend email, plus a console provider for dev
  - retries with backoff; every attempt logged in `notifications`; never blocks ingest
- `/alerts/rules` builder with WhatsApp preview, `/alerts/[id]` timeline, rule backtest, test message
- WhatsApp webhook: Meta signature check; reply "1" acknowledges, "2" mutes for 1 h

### Phase 5: Real hardware

- Firmware:
  - WiFiManager provisioning into NVS; 5 s BOOT long-press resets to factory settings
  - device profiles; sampling every 2 s with a median-of-5 filter; `null` plus `errors` on sensor failure
  - TLS MQTT 8883 with the CA pinned, LWT, retained status
  - LittleFS ring buffer (≥ 5,000 readings), replay at 20 msg/s interleaved with live readings
  - commands; relay OFF on boot and after a configurable disconnect time
  - OLED, watchdog, backoff with jitter, low-heap guard, `boot_reason`
- `pio test -e native` for the encoder, ring buffer and command parser
- `docs/hardware/`: wiring SVG with pin tables, `BOM.md`, `FLASHING.md` (flash and provision in under 10
  minutes), the 4–20 mA design note for W1, and an ADR on the G1 BLE gateway

### Phase 6: Signed OTA

- `scripts/sign-firmware.ts`; private key from env only
- Device-side SHA-256 and ECDSA check, mark-valid only after a successful publish, rollback otherwise
- Risk: the Arduino core's prebuilt bootloader may not have `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` set. If
  so, I'll enable it through pioarduino's `custom_sdkconfig` (hybrid compile).
- Tests on the board:
  - 1.4.2 → 1.5.0 works
  - a broken build rolls back
  - a wrongly signed build is refused

### Phase 7: Landing, products, Arabic, mobile

- Marketing header:
  - announcement bar
  - Products / Solutions / Platform mega-menus, keyboard-accessible; drawer on mobile
- Landing sections as in `Main.dc.html`:
  - Platform tabs with tablist roles and arrow keys
  - live numbers from the API with a static fallback
  - `[MEASURED]` placeholders filled only with real data
  - footer disclosure that the photos are AI-generated and the data is simulated
- Products:
  - `/products` with category and status filters synced to the URL, plus the FAQ
  - `/products/[code]` pages from `products.ts`
- next-intl for EN and AR (`/ar`, RTL, readings in `dir="ltr"` spans); mobile bottom tab bar down to
  360 px
- SEO:
  - metadata, `next/og` image, sitemap, robots
  - Sentry wired with empty DSNs by default

### Phase 8: Hardening and launch

- Tick every item in `docs/SECURITY.md`:
  - CSP, CSRF, rate limits, TLS everywhere
- Playwright end-to-end tests:
  - live updates arrive within 3 s
  - the relay reaches "Device confirmed"
  - Arabic RTL page has no horizontal scroll at 390 px
  - keyboard-only toggle, plus axe checks
- Screenshots compared with the design
- Load test of 500 devices → `docs/PERFORMANCE.md`, measured numbers only
- `docs/DEPLOY.md`: Vercel (web) and VPS (compose, Caddy, EMQX TLS on 8883, nightly `pg_dump`). Every
  step that costs money or touches your accounts is listed for you to approve.

### Phase 9: Portfolio

- README with the pitch, a GIF of the relay flow and live chart recorded with Playwright, a diagram, quick
  start and links
- `docs/CASE_STUDY.md`, `docs/launch-post.md`
- Portfolio repo: a Nabd card added first in `lib/data.ts`, and the "Off-Grid Energy Monitoring Interface"
  code links replaced with Nabd's. Not deployed; I'll give you the command.

---

## Log

### 2026-10-16: Phase 0 scaffold

**Built:**

- monorepo, tooling, compose file, firmware skeleton, CI workflow, ADRs 0001–0006, this plan

**Verified on Windows 11, Node 24.21, pnpm 10.34.6:**

- `pnpm install` ✓
- `pnpm build`: 6/6 tasks ✓; Next 16.4.2 prerenders `/`
- `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm format:check` ✓
- `pnpm test`: shared 3 tests ✓, api 1 test ✓
- `pnpm dev`: web :3000, api :4000/healthz, ingest :4100/healthz and simulator :4200/healthz all return
  200

**Not verified yet:**

- `pnpm infra:up` (Docker needs WSL)
- CI on GitHub (no repo yet)
- firmware build (PlatformIO not installed)

### 2026-10-19: Phase 1, code complete (Docker still blocked)

**Built:**

- `@nabd/shared`:
  - zod schemas for telemetry, status, cmd, ack and OTA (2 KB limit, registry-only metric keys,
    plausibility ranges, 5-minute future-skew check)
  - metric registry with EN/AR labels, `products.ts` (copy from the Products artboard), and the seed
    constants (4 sites, 12 devices, 4 rules, 1 contact with no phone number)
- `@nabd/db`:
  - schema migration: every table from section 5, the `readings` hypertable, columnstore after 7 days,
    90-day retention, `readings_1m/1h/1d` (min/max/sum/count) with refresh policies, `dead_letters`
  - `unnest` batch insert and status helpers, `pnpm db:seed`, and `pnpm credentials` (per-device and
    service MQTT passwords in the gitignored `secrets/`, argon2id hashes in the database)
- EMQX: built-in-database auth (PBKDF2) and an ACL that confines each device to its own subtree;
  least-privilege `svc-ingest` and `svc-api` accounts
- Simulator: 12 devices with the section 9 behaviours, persisted `seq`, Last Will, two-step acks with the
  brief's timings, optional 2 % timeouts, nabd-11 offline 15 min every hour
- Ingest: shared subscription, validation, dead letters, 250 ms / 500-row batches in one transaction,
  retry with backoff, `/healthz`, Prometheus `/metrics`, graceful drain

**Verified on this PC:**

- `pnpm format:check` ✓ · `pnpm lint` ✓ (8/8) · `pnpm typecheck` ✓ (8/8) · `pnpm build` ✓ (6/6)
- `pnpm test`: 56 tests pass (shared 27, simulator 14, ingest 14, api 1)
  - the fridge scenario stays above 8 °C for 6–8 min once per 20 min, then recovers below 7.5 °C
  - simulator protocol against an in-process broker (aedes): retained status, valid telemetry with a
    counting `seq`, delivered → done in ≥ 800 ms, expired and unknown-relay rejections, Last Will
  - in 1 of 4 full runs the api health test failed under parallel load; it passed alone and in the other
    3 runs. Watching it.

**Not verified yet (needs Docker):**

- the migration on a real TimescaleDB, the seed, the EMQX config and ACL, and the end-to-end path
  simulator → EMQX → ingest → rows. `pnpm test:int` (Testcontainers) is written; it currently fails only
  with "Could not find a working container runtime".

**Decisions made:**

- MQTT 3.1.1 for devices and services. The contract needs nothing from MQTT 5, ESP32 libraries speak
  3.1.1, and it lets the protocol tests run on aedes.
- TimescaleDB requires the partitioning column in every unique index, so the idempotency key is
  `(device_id, seq, metric, ts)`. A replay carries the same `ts`, so duplicates are still dropped.
- The design gives full values only for the fridge rule. The other rules' clear thresholds, cooldowns and
  severities are my choices, marked in `packages/shared/src/seed.ts`.

**Next:** once WSL and Docker work, run `pnpm credentials`, `pnpm infra:up`, `pnpm db:migrate`,
`pnpm db:seed`, `pnpm dev` and `pnpm test:int`, fix whatever the real database and broker disagree with,
then start Phase 2.

### 2026-10-19: Phases 2–9, code complete

**Built:**

- Phase 4 core: rules state machine, series source selection and command lifecycle in `@nabd/shared`
- `@nabd/notify`: WhatsApp Cloud API, Resend and console providers, with retries
- API (Phases 2–3):
  - REST endpoints with OpenAPI and Postman, plus argon2id login, JWT cookie and rotating refresh tokens
  - CSRF header, rate limits, WebSocket hub with seq back-fill
  - command service with a 10 s timeout, WhatsApp webhook, `/fleet/summary`
- Ingest (Phase 4): rules engine on live readings and a 30 s clock, persisted rule state, alert timeline,
  notifications, ack and mute by LISTEN/NOTIFY
- Web:
  - dashboard: `/fleet`, `/sites`, `/devices/[id]`, `/alerts`, `/alerts/[id]`, `/alerts/rules`, `/firmware`
  - marketing: landing page, `/products`, `/products/[code]`
  - English and Arabic RTL, mobile tab bar, sitemap, robots, OG image, CSP
- Firmware (Phases 5–6): `nabd_core` library and device code (provisioning, profiles, TLS MQTT, buffer,
  commands, fail-safe, OLED, watchdog, signed OTA with rollback), `scripts/sign-firmware.ts`, hardware docs
- Phase 8: SECURITY.md checklist, production compose override (MQTT TLS, closed ports, migrations,
  backups), Caddy, DEPLOY.md, load test, Sentry (off without a DSN), Playwright tests
- Phase 9: README, CASE_STUDY, launch post, portfolio card

**Verified on this PC:**

- unit tests:
  - shared 60, API 20, ingest 18, simulator 14, notify 7, web 3
  - firmware core 16 (built with Zig's C++ compiler, since this PC has no gcc; CI uses gcc)
- Playwright against the production build: 11 pass, run twice
  - landing, tabs keyboard, mega-menu keyboard, filters in the URL
  - Arabic RTL with no horizontal scroll at 390 px
  - axe on 4 pages
  - the 4 live tests skip without the API
- screenshots checked in English and Arabic, desktop and 390 px
- `sign-firmware.ts`: keygen refuses a key inside the repo; a signed image verifies; a 1-byte change fails

**Bugs found and fixed while checking:**

- unprefixed routes such as `/fleet` returned 404 (the proxy matcher lost its escaped dot)
- the demo button text was invisible (unlayered link colour beat the utilities)
- the product filters lost a selection on quick clicks
- `upgrade-insecure-requests` would break a local production run against an HTTP API
- the brief's GPIO 26 does not exist on the ESP32-S3 (SPI flash), so relays moved to GPIO 4 and 5

**Not verified yet:**

- anything against the real TimescaleDB and EMQX: migrations, the ACL, the end-to-end pipeline, the 4
  live Playwright tests, the load test
- every on-board acceptance test (the firmware itself builds; see the next entry)
- Lighthouse, the 24-hour unattended run, and Sentry receiving an error (all after deploy)

### 2026-10-24: firmware builds for the ESP32-S3

- `pio run -e esp32s3` succeeds: RAM 17.4 % (56,920 of 327,680 bytes), flash 43.3 % (1,363,529 of
  3,145,728 bytes in one OTA slot), so a new image fits the spare slot with room to grow.
- Fixed on the way:
  - the partition table overlapped the coredump partition by 4 KB
  - two missing includes
  - `WiFiClient` is `NetworkClient` in Arduino core 3
- `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y` in core 3.3.12, so automatic rollback works without a custom
  sdkconfig. That removes the Phase 6 risk noted in the plan.
- Windows notes (now in FLASHING.md): build from PowerShell (Espressif's installer refuses Git Bash), and
  use a short PlatformIO home (`I:\pio` here) because of the 260-character path limit.
- WSL: the PC has not restarted since the install (last boot 2026-10-16), so Docker still cannot start.

### 2026-10-31: real Docker stack, website deployed

- WSL2 and Docker started after the reboot. Running against real containers found three bugs, all fixed:
  - the EMQX healthcheck could not reach the node until the container got its node hostname
  - migrations ran from a glob that matched nothing; they now run from the directory
  - the web app served on 3000 while `WEB_ORIGIN`, Playwright and CI expected 3001
- The live Playwright specs now run serially and wait out the 3 s demo command limit.
- Website-only mode: an empty `NEXT_PUBLIC_API_URL` turns off every API call and the WebSocket, and the
  dashboard pages say the live backend is offline (EN + AR).
- Deployed to Vercel at https://nabd-iot.vercel.app (Hobby plan, redeploys on every push to `main`).
  Canonical URL, sitemap and Open Graph image use that domain; no `localhost` reaches visitors.
- Portfolio card committed, pushed and deployed to Firebase Hosting.

### 2026-11-01: CI green

The first runs on GitHub failed. Fixed:

- `pio test -e native` did not compile on Linux: the test used `snprintf` without `<stdio.h>`. Zig's
  clang pulled it in through other headers; gcc's libstdc++ does not. Reproduced with PlatformIO on WSL
  Ubuntu, then fixed.
- `format:check` flagged two files (whitespace only).
- The e2e job passed `-- --port 3001` on top of the start script's own `--port 3001`, so `next start`
  read `--port` as a project directory and never came up.

**Verified:** all five CI jobs pass on `d4cb7ea`: lint/typecheck/test/build, firmware native tests and
ESP32-S3 build, secret scan, integration against TimescaleDB, and Playwright (11 pass, 4 live tests skip
without the API).

**Lighthouse on https://nabd-iot.vercel.app (mobile, run from this PC; PageSpeed Insights' free quota was
used up):**

- Accessibility 100, Best Practices 100 (was 96), SEO 100 in every run.
- Performance 59–66 over three runs, LCP 3.9–4.3 s. Blocking time swings with this PC's CPU (550–1,740 ms
  before the fixes), so this is not the score to report; re-measure on PageSpeed Insights.
- Fixed from the audit:
  - ~25 KiB of zod shipped on every page and its `Function("")` probe tripped the CSP. No client code
    validates, so `@nabd/shared` is now `"sideEffects": false` and zod is out of every client chunk.
  - the hero photo (the LCP element) now has `fetchpriority="high"`
  - the logo link's `aria-label` hid its visible text (WCAG 2.5.3); the visible "Nabd نبض" is now its name
- Left: `NextIntlClientProvider` sends all messages (≈27 KB EN, 35 KB AR) inline. Picking client namespaces
  would save a few KB but breaks silently when a client component uses a new namespace.

**Next:** PageSpeed Insights for the reportable score, then the backend VPS (needs the owner's approval for
the cost), the 4 live Playwright tests and the 500-device load test. Phases 5–6 wait for the board.

### 2026-11-01: free live demo backend

**Built:**

- `apps/demo` ([ADR 0008](adr/0008-one-process-demo.md)): the real broker rules (aedes with per-device
  passwords and EMQX's ACL), the simulator's 12 devices, ingest's router and rules engine and the API in one
  process, on an in-memory store with the Postgres stores' semantics. On boot it back-fills 24 hours
  through the rules engine on simulated time (507,600 messages in about 2–4 s).
- `render.yaml` for Render's free plan; the web app says "Starting the live demo…" while it wakes and
  reloads itself (EN + AR).
- CI's e2e job now starts the demo, so the 4 live Playwright tests run on every push.
- README GIF of the relay flow, recorded with Playwright against the demo.

**Bugs found on the way:**

- nabd-05's page charted air temperature, which it does not measure, so the chart was empty
- the message age could read "-0.1 s ago"
- the soil model hit its 60 % clamp within minutes with the pump on and drew a flat line; it now levels
  off below saturation and follows the sun
- the live tests timed the 3 s command window from before the click, so a test could hit a 429
- a denied MQTT subscribe should answer SUBACK 0x80 and keep the client connected, as EMQX does

**Verified:**

- 136 unit tests (14 new in the demo); Playwright 15/15 twice locally against the demo, then on CI
- Render's build and start commands from `render.yaml`, run on clean Linux (Node 24): build 57 s, ready
  in about 8 s, 171 MB RSS (the free plan allows 512 MB)

**Next:** the owner applies the Render Blueprint; then point Vercel at it (`NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_API_SLEEPS=1`) and check the public dashboard.
