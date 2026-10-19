# LinkedIn launch post (draft)

> Post once the demo is deployed. Replace `[DEMO_URL]` and attach the relay-flow GIF.

---

Every device has a pulse. I built **Nabd** (نبض) to hear it.

I studied mechatronics, then moved into software. Nabd is the project where both halves meet: an ESP32-S3
node on a solar-powered villa's roof, a medicine fridge in a clinic, a greenhouse in Fayoum. Each one
reports every 2 seconds to a live dashboard in Arabic and English.

What I'm proudest of is what happens when things go wrong:

🔌 **Wi-Fi drops?** The node keeps 5,000 readings in flash and replays them with their original
timestamps. No gaps in the chart.

🔁 **Press a switch?** You see "sent", "delivered" and "confirmed by the device", with real timings. If
the device doesn't answer in 10 seconds, the switch goes back to its true state. No button that pretends.

🧊 **Fridge warming up?** One WhatsApp message after 5 minutes, not twenty. Reply "1" to acknowledge.
The rule waits out short spikes, clears with a margin, and respects quiet hours.

📦 **Bad firmware?** Updates are signed, installed to a spare slot, and kept only if the node checks in.
Otherwise it rolls back by itself.

Under the hood: C++ on the ESP32-S3, MQTT over TLS with EMQX, TimescaleDB, Fastify, WebSockets, and
Next.js with full right-to-left support.

The live demo runs a simulated fleet of 12 devices on 4 sites next to one real board. Flip a relay and
watch it answer: [DEMO_URL]

Code, architecture decisions and the case study: https://github.com/AbanoubRashad/nabd

#IoT #ESP32 #EmbeddedSystems #MQTT #NextJS #TypeScript #Mechatronics #Egypt
