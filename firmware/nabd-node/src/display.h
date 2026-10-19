// SSD1306 128×64: current readings, Wi-Fi and MQTT state, and the last command result. Optional: the node
// runs the same without a screen.
#pragma once
#include "sensors.h"

namespace display {
void begin();
void show(const char* deviceId, bool wifi, bool mqtt, uint32_t buffered, const Reading& r, const char* lastCommand);
void message(const char* line1, const char* line2);
}  // namespace display
