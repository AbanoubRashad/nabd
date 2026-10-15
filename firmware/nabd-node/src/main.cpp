// Phase 0 placeholder. Provisioning, sensors, TLS MQTT, offline buffer, commands and signed OTA
// are built in Phase 5 and 6 (see docs/PROGRESS.md).
#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    Serial.printf("nabd-node %s booting\n", NABD_FW_VERSION);
}

void loop() {
    delay(1000);
}
