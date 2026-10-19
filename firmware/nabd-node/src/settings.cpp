#include "settings.h"

#include <LittleFS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <esp_system.h>

static Preferences prefs;
static const char* kNs = "nabd";

Profile Settings::profileKind() const {
  if (strcmp(profile, "climate") == 0) return Profile::Climate;
  if (strcmp(profile, "coldchain") == 0) return Profile::ColdChain;
  if (strcmp(profile, "relay") == 0) return Profile::Relay;
  return Profile::Power;
}

int Settings::relayCount() const {
  switch (profileKind()) {
    case Profile::Relay:
      return 2;
    case Profile::ColdChain:
      return 0;
    default:
      return 1;
  }
}

namespace settings {

bool load(Settings& s) {
  prefs.begin(kNs, true);
  prefs.getString("dev_id", s.deviceId, sizeof(s.deviceId));
  prefs.getString("site", s.siteSlug, sizeof(s.siteSlug));
  prefs.getString("profile", s.profile, sizeof(s.profile));
  prefs.getString("mqtt_host", s.mqttHost, sizeof(s.mqttHost));
  s.mqttPort = prefs.getUShort("mqtt_port", 8883);
  prefs.getString("mqtt_user", s.mqttUser, sizeof(s.mqttUser));
  prefs.getString("mqtt_pass", s.mqttPass, sizeof(s.mqttPass));
  s.failsafeS = prefs.getUInt("failsafe_s", 60);
  s.relayActiveLow = prefs.getBool("relay_low", false);
  s.busScale = prefs.getFloat("bus_scale", 1.0f);
  prefs.end();
  if (!s.profile[0]) strcpy(s.profile, "power");
  return s.complete();
}

void save(const Settings& s) {
  prefs.begin(kNs, false);
  prefs.putString("dev_id", s.deviceId);
  prefs.putString("site", s.siteSlug);
  prefs.putString("profile", s.profile);
  prefs.putString("mqtt_host", s.mqttHost);
  prefs.putUShort("mqtt_port", s.mqttPort);
  prefs.putString("mqtt_user", s.mqttUser);
  prefs.putString("mqtt_pass", s.mqttPass);
  prefs.putUInt("failsafe_s", s.failsafeS);
  prefs.putBool("relay_low", s.relayActiveLow);
  prefs.putFloat("bus_scale", s.busScale);
  prefs.end();
}

void connectOrProvision(Settings& s) {
  WiFi.mode(WIFI_STA);
  WiFiManager wm;
  wm.setConfigPortalTimeout(600);  // give up after 10 minutes and retry, rather than hang forever
  wm.setConnectTimeout(20);

  char port[6];
  snprintf(port, sizeof(port), "%u", s.mqttPort);
  WiFiManagerParameter pId("dev_id", "Device ID (e.g. nabd-01)", s.deviceId, sizeof(s.deviceId) - 1);
  WiFiManagerParameter pSite("site", "Site slug (e.g. wadi-natrun)", s.siteSlug, sizeof(s.siteSlug) - 1);
  WiFiManagerParameter pProfile("profile", "Profile: power, climate, coldchain or relay", s.profile, sizeof(s.profile) - 1);
  WiFiManagerParameter pHost("mqtt_host", "MQTT broker host", s.mqttHost, sizeof(s.mqttHost) - 1);
  WiFiManagerParameter pPort("mqtt_port", "MQTT port (8883 = TLS)", port, 5);
  WiFiManagerParameter pUser("mqtt_user", "MQTT username (= device ID)", s.mqttUser, sizeof(s.mqttUser) - 1);
  WiFiManagerParameter pPass("mqtt_pass", "MQTT password (shown once at provisioning)", "", sizeof(s.mqttPass) - 1,
                             "type='password'");
  for (WiFiManagerParameter* p : {&pId, &pSite, &pProfile, &pHost, &pPort, &pUser, &pPass}) wm.addParameter(p);

  bool saved = false;
  wm.setSaveParamsCallback([&]() { saved = true; });
  wm.setSaveConfigCallback([&]() { saved = true; });

  char ap[24];
  snprintf(ap, sizeof(ap), "Nabd-Setup-%04X", static_cast<unsigned>(ESP.getEfuseMac() & 0xFFFF));
  const bool ok = s.complete() ? wm.autoConnect(ap) : wm.startConfigPortal(ap);

  if (saved) {
    strlcpy(s.deviceId, pId.getValue(), sizeof(s.deviceId));
    strlcpy(s.siteSlug, pSite.getValue(), sizeof(s.siteSlug));
    strlcpy(s.profile, pProfile.getValue(), sizeof(s.profile));
    strlcpy(s.mqttHost, pHost.getValue(), sizeof(s.mqttHost));
    s.mqttPort = static_cast<uint16_t>(atoi(pPort.getValue()));
    strlcpy(s.mqttUser, pUser.getValue(), sizeof(s.mqttUser));
    if (strlen(pPass.getValue())) strlcpy(s.mqttPass, pPass.getValue(), sizeof(s.mqttPass));
    save(s);
    Serial.println("settings saved, restarting");
    delay(500);
    ESP.restart();
  }
  if (!ok) {
    Serial.println("no Wi-Fi after the portal timeout; restarting to try again");
    setNextBootReason("wifi_timeout");
    ESP.restart();
  }
}

void factoryReset() {
  Serial.println("factory reset");
  prefs.begin(kNs, false);
  prefs.clear();
  prefs.end();
  WiFiManager wm;
  wm.resetSettings();
  LittleFS.format();
  delay(300);
  ESP.restart();
  while (true) {
  }
}

uint32_t loadSeqReservation() {
  prefs.begin(kNs, true);
  const uint32_t v = prefs.getUInt("seq_res", 0);
  prefs.end();
  return v;
}

void saveSeqReservation(uint32_t reserved, void*) {
  prefs.begin(kNs, false);
  prefs.putUInt("seq_res", reserved);
  prefs.end();
}

void setNextBootReason(const char* reason) {
  prefs.begin(kNs, false);
  prefs.putString("next_boot", reason);
  prefs.end();
}

String takeBootReason() {
  prefs.begin(kNs, false);
  String stored = prefs.getString("next_boot", "");
  if (stored.length()) prefs.remove("next_boot");
  prefs.end();
  if (stored.length()) return stored;
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:
      return "power_on";
    case ESP_RST_SW:
      return "software";
    case ESP_RST_PANIC:
      return "panic";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:
      return "watchdog";
    case ESP_RST_BROWNOUT:
      return "brownout";
    case ESP_RST_DEEPSLEEP:
      return "deep_sleep";
    default:
      return "other";
  }
}

}  // namespace settings
