# ADR 0004: node-pg-migrate with plain SQL files

- Status: accepted (2026-10-16)

## Context

The schema leans on TimescaleDB features (hypertables, compression, retention and continuous-aggregate
policies) that ORMs do not model. The prompt allows node-pg-migrate or Drizzle.

## Decision

node-pg-migrate with **`.sql` migrations** (`-- Up Migration` / `-- Down Migration`), and `pg` with
hand-written parameterised queries in `@nabd/db`.

## Why not Drizzle

Drizzle Kit would generate the plain tables but every TimescaleDB call would be a hand-written custom
migration anyway, and continuous aggregates cannot be expressed in its schema. Two sources of truth for one
schema is worse than one SQL file. node-pg-migrate is small, mature, transactional, and records applied
migrations in a table.
