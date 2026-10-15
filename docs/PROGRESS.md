# Nabd: progress and plan

Running log for the build described in the project brief. Each phase ends with: what was built, how it was
verified (commands and results), what is left, and decisions needed.

Status key: ✅ done · 🔶 in progress · ⏳ not started · ⛔ blocked (needs the owner)

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Monorepo, tooling, docker-compose, ADRs, this plan | 🔶 scaffold done; Docker and the GitHub repo still to confirm |
| 1 | Contract, simulator, ingest, database | ⏳ |
| 2 | API, WebSocket, `/fleet`, `/sites`, `/devices/[id]` | ⏳ |
| 3 | Commands (relay flow) | ⏳ |
| 4 | Rules engine and notifications | ⏳ |
| 5 | Real hardware (ESP32-S3 firmware) | ⏳ needs the board |
| 6 | Signed OTA with rollback | ⏳ needs the board |
| 7 | Landing, products, mega-menus, Arabic, mobile, polish | ⏳ |
| 8 | Hardening, load test, deploy | ⏳ needs accounts and a VPS |
| 9 | README, case study, portfolio card, launch post | ⏳ |

---

## Proposed changes to the brief (please confirm)

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

- ⛔ **Docker can't start on this PC.** Docker Desktop is installed but **WSL is not**, and the Linux
  engine needs it. Phase 1 needs Docker for TimescaleDB, EMQX and Testcontainers. Fix it with
  `wsl --install`: run it in an admin terminal, then reboot and start Docker Desktop. I can run it if you
  say so, but it needs admin rights and a reboot.
- ⛔ **GitHub repo `AbanoubRashad/nabd` (public, MIT).** It isn't created yet, because that touches your
  account. Until it exists, CI runs locally with the same commands as the workflow.
- **Hardware for Phases 5–6:** ESP32-S3 DevKitC-1, INA219, SHT31, DS18B20 (waterproof), a 1-channel
  opto-isolated relay module, and an SSD1306 0.96" I²C OLED. Do you have these on the desk?
- **PlatformIO** isn't installed here. I'll install it in Phase 5 with `pip install platformio`, which is
  free and local only.
- Later, each one asked for at the time:
  - Meta WhatsApp Business account plus approval of the `nabd_alert` template (Phase 4 uses the console
    provider until then)
  - Resend key
  - Sentry DSNs
  - VPS, domain and DNS
  - Vercel project

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
- [ ] `pnpm infra:up` healthy (blocked on Docker/WSL)
- [ ] CI green on GitHub (blocked on the repo)

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
