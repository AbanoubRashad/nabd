# Bill of materials: K1 Starter Kit

Everything for one P1 node that also covers the climate and cold-chain profiles. Prices are not listed:
they change too often to be useful, and every part is a common breakout.

| Qty | Part | Used for | Notes |
| --- | --- | --- | --- |
| 1 | ESP32-S3 DevKitC-1 (N8 or N8R8) | the node | any ESP32-S3 board with 8 MB flash works; adjust pins if it is not a DevKitC-1 |
| 1 | INA219 breakout (0x40) | bus voltage, load power | 26 V max on the bus input; see the divider note in [README.md](README.md) |
| 1 | INA219 breakout, A0 bridged (0x41) | panel power | optional; without it `pv_w` is not published |
| 1 | SHT31 breakout (0x44) | air temperature and humidity | climate profile |
| 1 | Capacitive soil-moisture probe v1.2 | soil moisture | climate profile; analog, 3V3 |
| 1 | DS18B20 waterproof probe + 4.7 kΩ resistor | fridge or freezer temperature | cold-chain profile |
| 1 | Magnetic reed switch (normally open) | door | cold-chain profile |
| 1 | 1-channel opto-isolated relay module, 3V3 logic | water heater, pump or fan | two for the R1 profile |
| 1 | SSD1306 0.96" I²C OLED (0x3C) | on-box readings | optional |
| 1 | Push button | R1 manual override | relay profile |
| 1 | 5 V USB-C supply, 2 A | power | |
| — | Jumper wires, breadboard or perfboard, enclosure | | the pictured enclosures are concept renders |

**Mains safety:** the relay module only switches a low-voltage control line in the demo. Switching mains
loads such as a water heater needs a contactor rated for the load, installed by an electrician.
