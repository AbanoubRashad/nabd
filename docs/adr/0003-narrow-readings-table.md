# ADR 0003: Narrow readings table

- Status: accepted (2026-10-16)

## Context

Devices publish different metric sets depending on their profile (power, climate, cold chain, relay) and
the registry will grow.

## Decision

One narrow TimescaleDB hypertable `readings (device_id, ts, seq, metric, value double precision)` with a
unique `(device_id, seq, metric)` constraint, plus continuous aggregates `readings_1m/1h/1d`.

## Consequences

- New metrics need no migration, only a registry entry.
- Idempotent ingest: replaying a `seq` adds nothing (`ON CONFLICT DO NOTHING`).
- More rows than a wide table; TimescaleDB compression (segment by `device_id, metric`) keeps storage small.
- Queries always filter by `device_id` and `metric`, which match the index and compression segments.
