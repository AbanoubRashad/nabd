# W1 Pump Controller: 4–20 mA design note (planned)

W1 is planned, not built. This note fixes the design so the firmware profile (`pump`) can be written
against it.

## Pressure input

Industrial pressure transmitters output a current from 4 mA (0 bar) to 20 mA (full scale). The current is
turned into a voltage with a precision shunt and read with an external ADC. The ESP32-S3's own ADC is too
noisy and non-linear for this.

```
24 V ── transmitter (+) ── transmitter (−) ──┬── 150 Ω 0.1 % shunt ── GND
                                              └── ADS1115 A0 (via 1 kΩ, 3.3 V TVS clamp)
```

- 4 mA × 150 Ω = 0.6 V and 20 mA × 150 Ω = 3.0 V. That stays under the ADS1115 ±4.096 V range, with
  headroom for a fault current.
- **Below 3.6 mA** means an open loop (a cut wire or a dead sensor), reported as `null` with
  `errors: ["pressure:open_loop"]`. **Above 21 mA** is a short or an over-range fault.
- Pressure = (I − 4 mA) / 16 mA × full scale, as the new metric `pressure_bar` in the registry.

## Dry-run protection

The pump relay goes off if pressure stays below a threshold (default 0.3 bar) for 10 s while the pump is
on. The node then refuses `relay.set on` until a human acknowledges, which is a new command,
`pump.reset`. The rule runs on the node, not only in the cloud, so it works offline.

## Run hours

Seconds with the relay on are accumulated in NVS every minute and published as `run_h`.

## Safety

The relay drives a contactor sized for the motor. The 24 V loop supply and the logic side are isolated by
the relay module's opto-coupler.
