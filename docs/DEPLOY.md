# Deploying Nabd

The web app goes to **Vercel**. Everything else (API, ingest, simulator, EMQX, TimescaleDB, Caddy and
backups) runs on **one small Linux VPS** with Docker Compose.

Steps marked 💳 cost money and steps marked 🔑 touch one of your accounts. They are yours to do, or to
approve one by one.

```
browser ──HTTPS──► Vercel (Next.js)
browser ──HTTPS/WSS──► api.<domain> ─┐
ESP32 ────MQTTS 8883──► mqtt.<domain> ├── VPS: Caddy → api · EMQX · ingest · simulator · TimescaleDB
ESP32 ────HTTPS──► fw.<domain> ──────┘
```

## 0. Free live demo (no VPS)

The public demo can run without the VPS: `apps/demo` is the broker, the 12 simulated devices, ingest, rules
and the API in one Node process with in-memory storage ([ADR 0008](adr/0008-one-process-demo.md)). It is
what https://nabd-iot.vercel.app talks to.

1. 🔑 **Render:** sign in at https://render.com with GitHub, then open
   https://render.com/deploy?repo=https://github.com/AbanoubRashad/nabd and apply the Blueprint
   (`render.yaml`). It creates the free web service `nabd-demo`; note its URL, for example
   `https://nabd-demo.onrender.com`.
2. **Vercel** (project `nabd`): set `NEXT_PUBLIC_API_URL` to that URL, `NEXT_PUBLIC_WS_URL` to the same
   host with `wss://` and `/ws`, and `NEXT_PUBLIC_API_SLEEPS=1`; the build command is
   `cd ../.. && pnpm turbo run build --filter=@nabd/web`. Redeploy.
3. Check: `/fleet` shows "Starting the live demo…" for about a minute after an idle spell, then live data.

The free instance sleeps after 15 idle minutes and forgets everything on restart; the back-fill rebuilds
the last 24 hours in a few seconds. The steps below are the full production stack.

## 1. Domain 💳🔑

Buy or choose a domain, say `nabd.example.com`. Create three A records pointing at the VPS IP:

- `api.nabd.example.com`
- `mqtt.nabd.example.com`
- `fw.nabd.example.com`

The web app gets its own record from Vercel in step 7.

## 2. VPS 💳🔑

2 vCPU, 4 GB RAM, 40 GB SSD, Ubuntu 24.04 LTS is enough for the demo plus the 500-device load test. Then:

```bash
ssh root@<vps-ip>
adduser nabd && usermod -aG sudo nabd
curl -fsSL https://get.docker.com | sh && usermod -aG docker nabd
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 8883/tcp && ufw enable
```

Only 22, 80, 443 and 8883 are open. Postgres, the EMQX dashboard and plain MQTT are not reachable from
outside; use `ssh -L 18083:localhost:18083` when you need the dashboard.

## 3. Code and secrets

```bash
su - nabd
git clone https://github.com/AbanoubRashad/nabd.git && cd nabd
cp .env.example .env
```

Edit `.env`:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD`, `EMQX_DASHBOARD_PASSWORD` | long random strings (`openssl rand -base64 32`) |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `NABD_DOMAIN` | `nabd.example.com` |
| `ACME_EMAIL` | your email, for Let's Encrypt expiry notices |
| `WEB_ORIGIN` | `https://nabd.example.com` (the Vercel domain) |
| `NABD_REAL_DEVICE` | `nabd-01` once the board is installed; empty until then |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | your login for the dashboard (password at least 12 characters) |
| `NABD_CREDENTIALS_FILE` | `secrets/nabd-credentials.json` |

Generate the MQTT credentials **on the VPS**. They never leave it, apart from each device's own password:

```bash
corepack enable && pnpm install --frozen-lockfile
NABD_CREDENTIALS_FILE=secrets/nabd-credentials.json pnpm credentials
```

## 4. Start the stack

```bash
COMPOSE="docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml"
$COMPOSE --profile stack up -d caddy        # obtains the certificates first
$COMPOSE --profile stack up -d timescaledb emqx
$COMPOSE --profile tools run --rm migrate   # migrations + demo fleet + your admin account
$COMPOSE --profile stack up -d              # api, ingest, simulator, backup
```

Check:

```bash
curl -s https://api.nabd.example.com/healthz          # {"ok":true,…}
openssl s_client -connect mqtt.nabd.example.com:8883 -brief </dev/null   # Let's Encrypt chain
$COMPOSE logs -f ingest                               # batches being written
```

Certificates renew automatically. EMQX reads the certificate at start, so restart it monthly:
`0 4 1 * * cd ~/nabd && $COMPOSE restart emqx` in the nabd user's crontab.

## 5. Device accounts

New devices: add them to `packages/shared/src/seed.ts`, then:

```bash
NABD_CREDENTIALS_FILE=secrets/nabd-credentials.json pnpm credentials
$COMPOSE restart emqx && $COMPOSE --profile tools run --rm migrate
```

The password for the device is in `secrets/nabd-credentials.json`. Type it into the device's captive
portal ([hardware/FLASHING.md](hardware/FLASHING.md)) and nowhere else.

## 6. WhatsApp alerts 🔑

1. Create a Meta Business app with WhatsApp, a phone number, and a permanent system-user token.
2. Submit the `nabd_alert` template in English and Arabic, with the body text from
   `packages/notify/src/index.ts`, category "Utility".
3. Set the webhook URL to `https://api.nabd.example.com/webhooks/whatsapp`, with a verify token you
   choose, subscribed to `messages`.
4. In `.env`, set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` and
   `WHATSAPP_VERIFY_TOKEN`, then put a real number on a contact (in E.164 format, for example
   `+2010…`). The demo contact never has one.
5. Email: create a Resend API key and a verified sender, then set `RESEND_API_KEY` and
   `ALERT_EMAIL_FROM`.

Until then, every alert goes to the console log, which is what the public demo uses.

## 7. Web on Vercel 💳🔑

1. Import the GitHub repo into Vercel with root directory `apps/web` and framework Next.js. Vercel
   detects pnpm from the lockfile.
2. Environment variables:
   - `NEXT_PUBLIC_API_URL=https://api.nabd.example.com`
   - `NEXT_PUBLIC_WS_URL=wss://api.nabd.example.com/ws`
   - `NEXT_PUBLIC_SITE_URL=https://nabd.example.com`
   - optionally `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN`
3. Add the domain `nabd.example.com` and follow Vercel's DNS instructions.

The API must be a subdomain of the web domain, so the login cookie counts as same-site.

## 8. Firmware releases

```bash
mkdir -p infra/firmware
# on your PC: build, sign (the key stays on your PC), then copy the .bin to the VPS
scp firmware/nabd-node/.pio/build/esp32s3/firmware.bin nabd@<vps-ip>:nabd/infra/firmware/nabd-node-1.5.0.bin
```

Run the `INSERT` printed by `scripts/sign-firmware.ts sign` with `$COMPOSE exec timescaledb psql -U nabd nabd`.

## 9. Backups 💳

The `backup` service writes `infra/backups/nabd-YYYY-MM-DD.dump` every night and keeps 14 days. To copy
the dumps off the server, use object storage (for example Backblaze B2 or S3) with `rclone`:

```bash
0 5 * * * rclone copy ~/nabd/infra/backups remote:nabd-backups --max-age 48h
```

Restore: `pg_restore -h localhost -U nabd -d nabd --clean nabd-YYYY-MM-DD.dump`, run inside the
timescaledb container after `SELECT timescaledb_pre_restore();`, and `SELECT timescaledb_post_restore();`
afterwards.

## 10. After launch

- Run the load test ([PERFORMANCE.md](PERFORMANCE.md)) and record the numbers.
- Send a test error to Sentry (`throw` in a scratch route) and see it arrive.
- Leave the demo running unattended for 24 hours, then check `$COMPOSE ps` and the ingest
  `nabd_ingest_dropped_rows_total` counter.
- Tick the "on the VPS" items in [SECURITY.md](SECURITY.md).
