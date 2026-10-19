#include "display.h"

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>
#include <math.h>

namespace {
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
bool present = false;
}  // namespace

namespace display {

void begin() {
  present = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!present) return;
  oled.setTextColor(SSD1306_WHITE);
  message("Nabd", "booting");
}

void message(const char* line1, const char* line2) {
  if (!present) return;
  oled.clearDisplay();
  oled.setTextSize(2);
  oled.setCursor(0, 8);
  oled.print(line1);
  oled.setTextSize(1);
  oled.setCursor(0, 36);
  oled.print(line2);
  oled.display();
}

void show(const char* deviceId, bool wifi, bool mqtt, uint32_t buffered, const Reading& r, const char* lastCommand) {
  if (!present) return;
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print(deviceId);
  // Connection state as text, readable without knowing any icons.
  oled.setCursor(74, 0);
  oled.print(wifi ? "W+" : "W-");
  oled.print(mqtt ? " M+" : " M-");
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);
  int y = 14;
  for (size_t i = 0; i < r.count && y <= 44; i++, y += 10) {
    oled.setCursor(0, y);
    oled.print(r.metrics[i].key);
    oled.setCursor(64, y);
    if (isnan(r.metrics[i].value)) oled.print("--");
    else oled.print(r.metrics[i].value, r.metrics[i].decimals);
  }
  oled.setCursor(0, 56);
  if (buffered) {
    oled.print("buffered ");
    oled.print(buffered);
  } else {
    oled.print(lastCommand);
  }
  oled.display();
}

}  // namespace display
