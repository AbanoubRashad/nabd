# ADR 0007: G1 BLE gateway bridges iBeacon and Eddystone tags to MQTT

- Status: proposed (2026-10-19); G1 and T1 are planned products

## Context

Battery sensor tags (T1, and third-party tags) cannot run Wi-Fi and TLS on a coin cell. They broadcast
BLE advertisements instead. Something with mains power must listen and forward.

## Decision

- **G1 runs the same Nabd firmware on an ESP32-S3** with a `gateway` profile. It scans passively
  (no connections, so tags never pair and battery life is unaffected).
- It understands two standard formats:
  - **Eddystone-TLM** (temperature, battery voltage, uptime)
  - **iBeacon with sensor data in major/minor**, as several commercial tags do (documented per vendor)
- **Each tag is a Nabd device of its own** (`tag-<mac>`), registered in `devices` with `kind = 'ble-tag'`.
  The gateway publishes on the tag's behalf to `nabd/v1/{site}/{tag-id}/telemetry`, with the gateway's id
  in the payload (`"via": "nabd-g1-01"`).
- **The ACL changes for gateways only:** a gateway may publish under the tags assigned to it (an EMQX ACL
  generated from the `devices` table), never under other devices.
- **seq for tags** is kept per tag by the gateway (NVS, the same block reservation), because tags have no
  counter of their own.
- Readings are buffered in the gateway's LittleFS exactly like a node's.

## Consequences

- No new protocol: ingest, rules and the dashboard treat a tag like any other device.
- A gateway is a trusted relay for its tags. If it is compromised, it can lie about its tags but not about
  anyone else's devices.
- BLE advertisements are not authenticated. A nearby attacker can spoof a tag. That is acceptable for
  temperature logging, not for control, so tags are read-only (no commands).
