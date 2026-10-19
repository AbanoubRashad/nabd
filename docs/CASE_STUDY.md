# Case study: Nabd

## The problem

A villa in Wadi El Natrun runs on solar panels and a battery bank, with no grid. The owner lives in Cairo,
two hours away. He wanted to know, from his phone, whether tonight's battery would last, and to switch the
water heater off when it would not. The same need comes up in a clinic with a vaccine fridge, a greenhouse
in Fayoum and a frozen-goods cold room: equipment that must not fail quietly, in places nobody watches.

## Constraints

- **Real hardware, unreliable networks.** Rural Wi-Fi drops for minutes at a time. Losing those readings
  would make the history lie.
- **Switching real equipment.** A relay that says "ON" when it is off is worse than no relay.
- **People will ignore a noisy alert.** A fridge hovering at 8.0 °C must not send twenty messages.
- **No ladder trips.** Firmware has to update remotely, and a bad build cannot leave a box dead on a
  roof.
- **A public demo.** Anyone can open it and press buttons, without being able to touch the real board.

## Architecture

ESP32-S3 nodes publish over MQTT with TLS to EMQX. An ingest worker, the only writer, validates every
message against one shared schema and batch-inserts it into a TimescaleDB hypertable with hourly and daily
roll-ups. The API holds its own MQTT subscription and pushes readings to browsers over WebSocket, so the
screen never waits for the database. A rules engine runs inside ingest on every reading. The web app is
Next.js with Arabic right-to-left support throughout. See [architecture.md](architecture.md) and the
[ADRs](adr).

## The four hard problems

### 1. No reading is lost

Every reading carries a per-device sequence number, persisted on the device in reserved blocks so that a
reboot never reuses one. While offline, readings go to a 5,000-slot ring buffer in flash, with a CRC on its
header so a power cut cannot corrupt it. After reconnecting, the node replays the buffer at 20 messages a
second, interleaved with live readings so the dashboard stays live. Ingest inserts with
`ON CONFLICT DO NOTHING` on `(device, seq, metric, ts)`, so a replay that overlaps what already arrived adds
nothing. On reconnect the browser sends the last sequence number it has per device, and the API back-fills
the gap.

### 2. Commands you can trust

A command is a database row with an id and an expiry. The API publishes it, and the device answers twice:
`delivered` when it parses the command, and `done` with the relay state it actually set. The UI shows the
three steps with real timings. With no answer in 10 seconds the command times out and the switch shows the
device's reported state again. A late confirmation is still accepted, because the device really did
switch. Relays are OFF at boot and turn OFF if the broker has been unreachable for a minute. Anonymous
visitors can only command simulated devices, at most once every 3 seconds.

### 3. Alerts without spam

The rule logic is a pure state machine (`ok → pending → firing → resolved`, plus acknowledged and muted) in
the shared package, covered by table-driven tests:

- **Wait time:** an alert fires only after the condition has held for the configured time.
- **Hysteresis:** it clears only past a separate threshold, so a value hovering at the limit cannot flap.
- **Cool-down:** at most one message per window, even across separate alerts on the same rule.
- **Quiet hours:** they hold back warnings, but never critical alerts.
- **Persistence:** rule state is saved, so a restart does not forget a pending timer.

A WhatsApp reply of "1" acknowledges the alert and "2" mutes it for an hour. The rule builder can backtest
a rule against the last 7 days before saving it.

### 4. Updates can't brick a box

Builds are signed with an ECDSA P-256 key that never enters the repository. The device streams the image
into the spare OTA slot while hashing it, verifies the SHA-256 and the signature with mbedTLS, and only
then switches the boot partition. The new image is marked valid only after Wi-Fi, MQTT and one successful
publish. Otherwise it rolls back within 2 minutes.

## Results

Measured numbers only. The rows marked pending fill in as the hardware and the deployment come online.

| What | Result |
| --- | --- |
| Automated tests | 153: shared 60, API 20, ingest 18, simulator 14, notify 7, web 3, firmware core 16, Playwright 15 (4 of those need the full stack) |
| Fridge scenario | Unit-tested: above 8 °C for 6–8 min every 20 min; one alert after 5 min, one message per channel, acknowledged, resolved below 7.5 °C |
| p95 device → screen latency | _pending: measured on the deployed stack_ |
| 500-device load test | _pending: [PERFORMANCE.md](PERFORMANCE.md)_ |
| Real-board uptime over 30 days | _pending: the landing page fills this from the board_ |
| Readings replayed after outages | _pending_ |

## What I would do next

- Run the full stack in Docker and the Testcontainers suite, then the load test on the VPS.
- Wire the real board, then test the offline buffer and the rollback with deliberately broken builds.
- An INA226 driver, so 48 V banks can be measured without a divider.
- Per-request CSP nonces on the dashboard routes, which render dynamically anyway.
- Multi-tenancy: the schema is keyed so an `org_id` column can be added without reshaping it.
