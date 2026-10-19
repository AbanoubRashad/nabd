// Device settings in NVS, entered once in the captive portal (WiFiManager). Nothing secret is compiled in.
#pragma once
#include <Arduino.h>

enum class Profile { Power, Climate, ColdChain, Relay };

struct Settings {
  char deviceId[32] = "";
  char siteSlug[64] = "";
  char profile[16] = "power";
  char mqttHost[96] = "";
  uint16_t mqttPort = 8883;
  char mqttUser[32] = "";
  char mqttPass[64] = "";
  uint32_t failsafeS = 60;
  bool relayActiveLow = false;
  /** Voltage divider ratio in front of the INA219 (its bus input tops out at 26 V). */
  float busScale = 1.0f;

  Profile profileKind() const;
  int relayCount() const;
  bool complete() const { return deviceId[0] && siteSlug[0] && mqttHost[0] && mqttUser[0] && mqttPass[0]; }
};

namespace settings {
/** Loads from NVS; returns false if the device was never provisioned. */
bool load(Settings& s);
void save(const Settings& s);
/**
 * Joins Wi-Fi, opening the "Nabd-Setup-XXXX" captive portal for Wi-Fi and the fields above if there is no
 * saved network or the settings are incomplete. Restarts the device after a successful setup.
 */
void connectOrProvision(Settings& s);
/** Erases Wi-Fi, settings, the seq reservation and the offline buffer, then restarts. */
[[noreturn]] void factoryReset();

uint32_t loadSeqReservation();
void saveSeqReservation(uint32_t reserved, void*);

/** A reason stored before a deliberate restart (low heap, OTA), reported as boot_reason once. */
void setNextBootReason(const char* reason);
String takeBootReason();
}  // namespace settings
