# Nabd (نبض)

Real-time IoT monitoring with real hardware: ESP32-S3 firmware, MQTT over TLS, TimescaleDB, a live
dashboard in English and Arabic, WhatsApp alerts, remote relay control and signed over-the-air updates.

> Work in progress. See [docs/PROGRESS.md](docs/PROGRESS.md) for the plan and status.

## Quick start

Requires Node 24, pnpm 10 and Docker.

```bash
cp .env.example .env      # fill in the passwords
pnpm install
pnpm infra:up             # EMQX + TimescaleDB
pnpm dev                  # web :3000, api :4000, ingest :4100, simulator :4200
```

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js marketing site and live dashboard |
| `apps/api` | Fastify REST + WebSocket gateway |
| `apps/ingest` | MQTT → TimescaleDB writer and rules engine |
| `apps/simulator` | 12 virtual devices on 4 sites |
| `packages/shared` | MQTT contract, schemas, metric registry, rules state machine |
| `packages/db` | SQL migrations and query helpers |
| `firmware/nabd-node` | PlatformIO firmware for the ESP32-S3 node |
| `infra` | Docker Compose, EMQX and Caddy config |
| `docs` | Architecture, ADRs, hardware, progress |

Licence: MIT.
