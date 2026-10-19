// Pins and defaults for the ESP32-S3 DevKitC-1 (docs/hardware/wiring.svg has the same table).
//
// Note: the brief put the relay on GPIO 26. On the ESP32-S3, GPIO 26–32 are wired to the module's SPI flash
// and cannot be used, so relay 1 is on GPIO 4 and relay 2 on GPIO 5.
#pragma once
#include <stdint.h>

namespace pins {
constexpr int kI2cSda = 8;      // INA219 (0x40, optional second at 0x41 for PV), SHT31 (0x44), SSD1306 (0x3C)
constexpr int kI2cScl = 9;
constexpr int kOneWire = 10;    // DS18B20 waterproof probe, 4.7 kΩ pull-up to 3V3
constexpr int kDoor = 11;       // reed switch to GND, internal pull-up; closed door = LOW
constexpr int kOverride = 12;   // R1 manual override button to GND
constexpr int kSoil = 1;        // capacitive soil-moisture sensor, ADC1 channel 0
constexpr int kRelay1 = 4;      // opto-isolated relay module input
constexpr int kRelay2 = 5;
constexpr int kBoot = 0;        // BOOT button: hold 5 s for a factory reset
}  // namespace pins

namespace defaults {
constexpr uint32_t kSampleMs = 2000;          // one reading every 2 s
constexpr uint8_t kSamplesPerReading = 5;     // median of 5
constexpr uint32_t kFailsafeS = 60;           // relays OFF after this long without the broker
constexpr uint32_t kReplayIntervalMs = 50;    // 20 replayed messages per second at most
constexpr uint32_t kBufferCapacity = 5000;    // offline readings kept in LittleFS
constexpr uint32_t kSeqBlock = 500;           // seq reservation block (see SeqCounter)
constexpr uint32_t kStatusEveryMs = 60000;    // retained status refresh
constexpr uint32_t kRollbackDeadlineMs = 120000;  // a new image must check in within 2 minutes
constexpr uint32_t kLowHeapBytes = 24 * 1024;
constexpr uint32_t kFactoryResetHoldMs = 5000;
constexpr uint16_t kMqttTlsPort = 8883;
}  // namespace defaults
