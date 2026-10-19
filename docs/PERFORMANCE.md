# Performance

**Status: not measured yet.** This page reports measured numbers only. The load test is written and
ready, but it needs the Docker stack, which could not run on the development PC (WSL was not installed).
The table below is filled in from `scripts/load/results/*.json` after the first run on the VPS.

## Method

`scripts/load/load-test.ts` (run with `pnpm load`):

1. `provision --devices 500` creates `nabd-1001` … `nabd-1500` in a `load-test` site, with database
   rows and EMQX users that are held to the same ACL as real devices. Wait 30 seconds for ingest and
   the API to pick up the new devices.
2. `run --devices 500 --minutes 10` connects the devices at 50 per second, then each publishes one QoS 1
   reading per second, spread evenly across the second. It runs alongside the normal 12-device demo.
   - One WebSocket client subscribes to the load-test site, as a dashboard would, and records
     **device → screen latency**: the time it received each reading minus the reading's device
     timestamp. Publisher and listener share one clock, so no clock skew is involved.
   - Ingest's Prometheus `/metrics` is read before and after for **messages per second**, **mean batch
     insert time**, dropped rows and dead letters.
   - `docker stats` is sampled every minute for **CPU and RAM** per container.
3. `cleanup` removes the test devices, their readings and their broker users.

## Results

| Date | Host | Devices | Duration | Published/s | Ingested/s | Mean insert | Device → screen p95 | Dropped | CPU / RAM |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _pending_ | | 500 | 10 min | | | | | | |

A run on a laptop is a smoke test only and is not entered here. Only a run against the VPS stack counts.

## Landing page (Lighthouse)

Measured on the deployed site with PageSpeed Insights (mobile and desktop). _Pending deployment._ Local
Lighthouse runs on this PC are too noisy to report.
