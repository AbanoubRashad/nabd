# ADR 0001: One pnpm + Turborepo monorepo

- Status: accepted (2026-10-16)

## Context

Nabd has a web app, three Node services, shared contract code and firmware. The MQTT contract (topics,
payload schemas, metric registry) must be identical in the simulator, ingest, API and web app, or devices
and dashboards drift apart.

## Decision

One repository, pnpm workspaces + Turborepo: `apps/{web,api,ingest,simulator}`, `packages/{shared,db}`,
`firmware/nabd-node` (PlatformIO, outside the JS workspace), `infra/`, `docs/`. `@nabd/shared` is the single
source of truth for the contract and is compiled once (`tsc`) and consumed by every app.

## Consequences

- A contract change is one commit that type-checks every consumer.
- Turborepo caches builds and runs `dev` for all services with one command.
- The firmware duplicates the contract in C++; native unit tests check its encoder against JSON fixtures
  generated from `@nabd/shared`.
