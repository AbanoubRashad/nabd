# ADR 0008: The public demo runs as one process with in-memory storage

- Status: accepted (2026-11-01)

## Context

The production design (ADR 0002, `docs/DEPLOY.md`) runs EMQX, TimescaleDB, the API, ingest and the
simulator in Docker on a VPS, about $5–7 a month. The portfolio needs the live dashboard to be reachable at
no cost, and free hosts offer one small web process (Render free: 512 MB, about 0.1 CPU, sleeps after
15 idle minutes) with no Docker Compose and no database that TimescaleDB extensions run on.

## Decision

- **`apps/demo` runs the real parts in one Node process:** an aedes broker on loopback with per-device
  passwords and the same topic ACL as EMQX, the simulator's 12 `SimDevice`s speaking MQTT to it, ingest's
  `route()` and `RulesEngine`, and the API's `buildServer`, bridge, hub and command service. Nothing is
  re-implemented except storage.
- **Storage is `DemoStore`, in memory:** the API's `Store` and the engine's `RulesStore` together, with
  the same answers as the Postgres stores. It keeps one hour of raw readings and 25 hours of one-minute
  roll-ups (min/max/sum/count, like `readings_1m`); hour and day series are built from those.
- **Back-fill on boot:** the fleet is ticked through the last 24 hours at the real 2-second step, through
  the real rules engine on simulated time (`RulesEngine` takes an optional clock). Charts and the alert
  history are full from the first page view, and every past alert is genuine engine output.
- **Honest labels:** every device is marked simulated unless `NABD_REAL_DEVICE` names a board that is
  actually reporting. Notifications go to the console only. The demo has no accounts.
- **Sleeping host:** with `NEXT_PUBLIC_API_SLEEPS=1` the web app says the demo is starting and reloads
  itself when `/healthz` answers.

## Consequences

- The public dashboard is live for $0, and CI runs the 4 live Playwright tests against the same process on
  every push.
- A restart forgets everything, including visitors' rule edits; the back-fill rebuilds the last day.
- It does not demonstrate TimescaleDB, EMQX's TLS listener, or the load test; those stay with the full
  stack (`pnpm infra:up`, integration tests, `docs/PERFORMANCE.md`).
- The first visit after an idle spell waits about a minute while the free instance wakes.
