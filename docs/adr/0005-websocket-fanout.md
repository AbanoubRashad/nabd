# ADR 0005: Live fan-out straight from MQTT, back-fill from the database

- Status: accepted (2026-10-16)

## Context

"Device → screen" latency is a headline metric. If the API waited for ingest to write a row and then read
it, every live point would pay the batch delay (up to 250 ms) and a database round trip.

## Decision

The API holds its own (non-shared) MQTT subscription to telemetry, status and acks and pushes events to
WebSocket clients immediately. Ingest stays the **only writer**. Every event carries the device `seq`; on
reconnect the client sends its last `seq` per device and the API back-fills the gap from `readings`.

## Consequences

- Live updates never wait for the database.
- A reading can be on screen a few hundred ms before it is stored; the back-fill path covers any gap.
- With several API replicas each holds its own subscription (fan-out, not load-balancing), which is what
  we want for WebSockets.
