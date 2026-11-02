---
title: Nabd live demo
emoji: 📈
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Live backend for the Nabd IoT dashboard demo
---

# Nabd live demo backend

The API, MQTT broker, 12 simulated devices, ingest and rules engine of
[Nabd](https://github.com/AbanoubRashad/nabd) in one process (`apps/demo`). The dashboard is at
https://nabd-iot.vercel.app/fleet; this Space only serves its API and WebSocket.

These two files are copied from `infra/huggingface/` in the GitHub repo.
