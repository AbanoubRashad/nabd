# ADR 0002: EMQX as the MQTT broker

- Status: accepted (2026-10-16)

## Context

We need MQTT 5 over TLS, per-device credentials, topic ACLs keyed on the client, Last Will, retained status
and **shared subscriptions** so ingest can scale out (`$share/ingest/...`).

## Options

- **Mosquitto**: tiny and boring, but ACL patterns and auth plugins are limited, there is no built-in
  user database or HTTP management API, and no dashboard for debugging a live demo.
- **EMQX**: built-in user database with hashed passwords, ACL templates with `${clientid}`/`${username}`,
  shared subscriptions, rule engine, metrics and a management API.

## Decision

EMQX, pinned to `emqx/emqx:6.1.5`, one node.

## Licence note

Since 5.9.0 EMQX is released under the Business Source License 1.1. The Additional Use Grant allows free
production use of **a single node** (not offered to third parties as a hosted service). Nabd runs one node
on one VPS, so this is free. Clustering would need a commercial licence; if that ever matters, the
contract is plain MQTT 5 and Mosquitto or NanoMQ can replace the broker.
