// Nabd node: sample, publish, buffer offline, obey commands, update itself safely.
#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <esp_task_wdt.h>
#include <freertos/queue.h>
#include <mqtt_client.h>
#include <time.h>

#include "config.h"
#include "display.h"
#include "filters.h"
#include "fs_storage.h"
#include "nabd_time.h"
#include "ota.h"
#include "payload.h"
#include "ring_buffer.h"
#include "root_ca.h"
#include "sensors.h"
#include "settings.h"

#ifndef NABD_FW_VERSION
#define NABD_FW_VERSION "0.0.0"
#endif

namespace {

Settings cfg;
String bootReason;
FileStorage storage;
nabd::RingBuffer buffer(storage, defaults::kBufferCapacity);
nabd::SeqCounter* seq = nullptr;
nabd::Backoff wifiBackoff(1000, 60000);

esp_mqtt_client_handle_t mqtt = nullptr;
volatile bool mqttConnected = false;
QueueHandle_t inbox = nullptr;  // messages from the MQTT task to the loop

struct Inbound {
  bool isOta;
  uint16_t len;
  char data[nabd::kMaxPayload + 1];
};

char tTelemetry[128], tStatus[128], tCmd[128], tAck[128], tOta[128];

bool relays[2] = {false, false};
char lastCommand[24] = "";
uint32_t lastConnectedMs = 0;
bool failsafeTripped = false;
bool ownPublishOk = false;  // one successful publish since boot (for OTA validation)
uint32_t lowHeapSince = 0;

// ---- relays ---------------------------------------------------------------------------------------------

void writeRelay(int ch, bool on) {
  relays[ch - 1] = on;
  const int pin = ch == 1 ? pins::kRelay1 : pins::kRelay2;
  digitalWrite(pin, on != cfg.relayActiveLow ? HIGH : LOW);
}

void allRelaysOff() {
  for (int ch = 1; ch <= cfg.relayCount(); ch++) writeRelay(ch, false);
}

// ---- MQTT -----------------------------------------------------------------------------------------------

bool publish(const char* topic, const char* payload, bool retain) {
  if (!mqtt || !mqttConnected) return false;
  // QoS 1. A non-negative id means esp-mqtt accepted it; its outbox resends until the broker acknowledges.
  return esp_mqtt_client_publish(mqtt, topic, payload, 0, 1, retain ? 1 : 0) >= 0;
}

void publishStatus() {
  char buf[200];
  if (nabd::encodeStatus(buf, sizeof(buf), NABD_FW_VERSION, WiFi.RSSI(), millis() / 1000, bootReason.c_str(), cfg.profile))
    publish(tStatus, buf, true);
}

void onMqttEvent(void*, esp_event_base_t, int32_t id, void* data) {
  auto* e = static_cast<esp_mqtt_event_handle_t>(data);
  switch (static_cast<esp_mqtt_event_id_t>(id)) {
    case MQTT_EVENT_CONNECTED:
      mqttConnected = true;
      esp_mqtt_client_subscribe(mqtt, tCmd, 1);
      esp_mqtt_client_subscribe(mqtt, tOta, 1);
      break;
    case MQTT_EVENT_DISCONNECTED:
      mqttConnected = false;
      break;
    case MQTT_EVENT_DATA: {
      // Whole messages only (the 4 KB broker cap keeps them in one chunk).
      if (e->current_data_offset != 0 || e->data_len != e->total_data_len || e->data_len > static_cast<int>(nabd::kMaxPayload))
        break;
      static Inbound msg;  // the MQTT task is the only writer
      msg.isOta = e->topic_len == static_cast<int>(strlen(tOta)) && strncmp(e->topic, tOta, e->topic_len) == 0;
      msg.len = static_cast<uint16_t>(e->data_len);
      memcpy(msg.data, e->data, e->data_len);
      msg.data[e->data_len] = '\0';
      xQueueSend(inbox, &msg, 0);  // drop if the loop is far behind; the API times the command out
      break;
    }
    default:
      break;
  }
}

void startMqtt() {
  char uri[140];
  const bool tls = cfg.mqttPort == defaults::kMqttTlsPort;
  snprintf(uri, sizeof(uri), "%s://%s:%u", tls ? "mqtts" : "mqtt", cfg.mqttHost, cfg.mqttPort);
  esp_mqtt_client_config_t c = {};
  c.broker.address.uri = uri;
  // Plain MQTT (port 1883) only exists inside a development network; production uses 8883 with this CA.
  if (tls) c.broker.verification.certificate = kRootCa;
  c.credentials.username = cfg.mqttUser;
  c.credentials.client_id = cfg.deviceId;
  c.credentials.authentication.password = cfg.mqttPass;
  c.session.keepalive = 30;
  c.session.protocol_ver = MQTT_PROTOCOL_V_3_1_1;
  c.session.last_will.topic = tStatus;
  c.session.last_will.msg = "{\"online\":false}";
  c.session.last_will.qos = 1;
  c.session.last_will.retain = 1;
  c.network.reconnect_timeout_ms = 5000;
  c.buffer.size = 2560;
  mqtt = esp_mqtt_client_init(&c);
  esp_mqtt_client_register_event(mqtt, MQTT_EVENT_ANY, onMqttEvent, nullptr);
  esp_mqtt_client_start(mqtt);
}

// ---- commands -------------------------------------------------------------------------------------------

uint64_t nowMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return static_cast<uint64_t>(tv.tv_sec) * 1000ULL + tv.tv_usec / 1000;
}

bool clockValid() { return time(nullptr) > 1700000000; }  // SNTP has set the clock

void sendAck(const char* id, nabd::AckState state, const char* reason, int ch, bool on) {
  char buf[160];
  if (nabd::encodeAck(buf, sizeof(buf), id, state, reason, ch, on)) publish(tAck, buf, false);
}

void publishReadingNow();

void handleCommand(const char* json, size_t len) {
  nabd::Command cmd;
  const nabd::ParseResult r = nabd::parseCommand(json, len, nowMs(), cfg.relayCount(), &cmd);
  if (r != nabd::ParseResult::Ok) {
    if (cmd.id[0]) sendAck(cmd.id, nabd::AckState::Rejected, nabd::rejectReason(r), 0, false);
    snprintf(lastCommand, sizeof(lastCommand), "rejected %s", nabd::rejectReason(r));
    return;
  }
  sendAck(cmd.id, nabd::AckState::Delivered, nullptr, 0, false);
  if (cmd.op == nabd::CommandOp::RelaySet) {
    writeRelay(cmd.ch, cmd.on);
    failsafeTripped = false;
    // "done" carries the state the relay pin is actually in now.
    sendAck(cmd.id, nabd::AckState::Done, nullptr, cmd.ch, relays[cmd.ch - 1]);
    snprintf(lastCommand, sizeof(lastCommand), "relay %d %s", cmd.ch, relays[cmd.ch - 1] ? "ON" : "OFF");
    publishReadingNow();  // the dashboard sees the new state without waiting for the next sample
  } else {
    sendAck(cmd.id, nabd::AckState::Done, nullptr, 0, false);
    settings::setNextBootReason("command");
    delay(300);
    ESP.restart();
  }
}

// ---- readings -------------------------------------------------------------------------------------------

Reading latest;
uint32_t lastSampleMs = 0, lastReadingMs = 0, lastReplayMs = 0, lastStatusMs = 0, lastDisplayMs = 0;
uint8_t samplesTaken = 0;

void emit(const Reading& r) {
  if (!clockValid()) return;  // no trustworthy timestamp yet: never invent one
  char ts[32], payload[nabd::kMaxPayload + 1];
  nabd::formatIso(nowMs(), ts, sizeof(ts));
  const size_t n = nabd::encodeTelemetry(payload, sizeof(payload), seq->take(), ts, r.metrics, r.count, r.errors, r.errorCount);
  if (!n) return;
  // Live first. If it cannot go out now it joins the buffer, oldest-first, with its original timestamp.
  if (publish(tTelemetry, payload, false)) {
    if (!ownPublishOk) {
      ownPublishOk = true;
      if (ota::pendingVerify()) {
        ota::markValid();
        Serial.println("ota: new image confirmed");
      }
    }
  } else {
    buffer.push(payload, n);
  }
}

void publishReadingNow() {
  Reading r = latest;
  sensors::collect(r, relays);  // reuses the samples taken so far this period
  latest = r;
  emit(r);
}

/** Replays one buffered reading, at most every 50 ms, between live readings. */
void replayOne() {
  if (!mqttConnected || buffer.size() == 0 || millis() - lastReplayMs < defaults::kReplayIntervalMs) return;
  lastReplayMs = millis();
  char payload[nabd::RingBuffer::kSlotPayload + 1];
  if (buffer.peek(payload, sizeof(payload)) && publish(tTelemetry, payload, false)) buffer.pop();
}

// ---- housekeeping ---------------------------------------------------------------------------------------

void checkFactoryReset() {
  static uint32_t pressedSince = 0;
  if (digitalRead(pins::kBoot) == LOW) {
    if (!pressedSince) pressedSince = millis();
    if (millis() - pressedSince > defaults::kFactoryResetHoldMs) {
      display::message("Reset", "factory settings");
      settings::factoryReset();
    }
  } else {
    pressedSince = 0;
  }
}

void checkOverrideButton() {
  if (cfg.profileKind() != Profile::Relay) return;
  static bool last = HIGH;
  static uint32_t changedAt = 0;
  const bool now = digitalRead(pins::kOverride);
  if (now != last && millis() - changedAt > 40) {  // debounce
    changedAt = millis();
    last = now;
    if (now == LOW) {
      writeRelay(1, !relays[0]);
      snprintf(lastCommand, sizeof(lastCommand), "manual %s", relays[0] ? "ON" : "OFF");
      publishReadingNow();
    }
  }
}

void checkFailsafe() {
  if (mqttConnected) {
    lastConnectedMs = millis();
    return;
  }
  // Fail-safe: equipment never stays switched on by a dashboard nobody can reach.
  if (!failsafeTripped && millis() - lastConnectedMs > cfg.failsafeS * 1000UL) {
    allRelaysOff();
    failsafeTripped = true;
    snprintf(lastCommand, sizeof(lastCommand), "failsafe OFF");
  }
}

void checkHeap() {
  if (ESP.getFreeHeap() >= defaults::kLowHeapBytes) {
    lowHeapSince = 0;
    return;
  }
  if (!lowHeapSince) lowHeapSince = millis();
  if (millis() - lowHeapSince > 10000) {
    settings::setNextBootReason("low_heap");
    ESP.restart();
  }
}

void ensureWifi() {
  static uint32_t retryAt = 0;
  if (WiFi.status() == WL_CONNECTED) {
    wifiBackoff.reset();
    return;
  }
  if (millis() < retryAt) return;
  WiFi.reconnect();
  retryAt = millis() + wifiBackoff.next(static_cast<float>(esp_random() % 1000) / 1000.0f);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.printf("nabd-node %s\n", NABD_FW_VERSION);

  // Relays OFF before anything else: a reboot must never switch equipment on.
  pinMode(pins::kRelay1, OUTPUT);
  pinMode(pins::kRelay2, OUTPUT);
  pinMode(pins::kBoot, INPUT_PULLUP);
  pinMode(pins::kOverride, INPUT_PULLUP);
  settings::load(cfg);
  allRelaysOff();

  bootReason = settings::takeBootReason();
  esp_task_wdt_config_t wdt = {.timeout_ms = 30000, .idle_core_mask = 0, .trigger_panic = true};
  esp_task_wdt_reconfigure(&wdt);
  esp_task_wdt_add(nullptr);

  Wire.begin(pins::kI2cSda, pins::kI2cScl);
  display::begin();
  display::message("Nabd", "Wi-Fi setup");
  settings::connectOrProvision(cfg);  // opens the captive portal on first boot

  snprintf(tTelemetry, sizeof(tTelemetry), "nabd/v1/%s/%s/telemetry", cfg.siteSlug, cfg.deviceId);
  snprintf(tStatus, sizeof(tStatus), "nabd/v1/%s/%s/status", cfg.siteSlug, cfg.deviceId);
  snprintf(tCmd, sizeof(tCmd), "nabd/v1/%s/%s/cmd", cfg.siteSlug, cfg.deviceId);
  snprintf(tAck, sizeof(tAck), "nabd/v1/%s/%s/cmd/ack", cfg.siteSlug, cfg.deviceId);
  snprintf(tOta, sizeof(tOta), "nabd/v1/%s/%s/ota", cfg.siteSlug, cfg.deviceId);

  configTime(0, 0, "pool.ntp.org", "time.google.com");  // UTC; the dashboard shows local time
  if (storage.begin("/buffer.bin", nabd::RingBuffer::bytesFor(defaults::kBufferCapacity))) buffer.begin();
  else Serial.println("LittleFS unavailable: running without the offline buffer");

  static nabd::SeqCounter counter(settings::loadSeqReservation(), defaults::kSeqBlock, settings::saveSeqReservation, nullptr);
  seq = &counter;

  sensors::begin(cfg);
  inbox = xQueueCreate(4, sizeof(Inbound));
  startMqtt();
  lastConnectedMs = millis();
  Serial.printf("%s %s profile=%s boot=%s buffered=%lu\n", cfg.deviceId, cfg.siteSlug, cfg.profile, bootReason.c_str(),
                static_cast<unsigned long>(buffer.size()));
}

void loop() {
  esp_task_wdt_reset();
  const uint32_t now = millis();

  ensureWifi();
  checkFactoryReset();
  checkOverrideButton();
  checkFailsafe();
  checkHeap();

  // A new image must prove itself (Wi-Fi, MQTT, one publish) within 2 minutes, or it is rolled back.
  if (!ownPublishOk && ota::pendingVerify() && now > defaults::kRollbackDeadlineMs) ota::rollback();

  static Inbound msg;
  while (xQueueReceive(inbox, &msg, 0) == pdTRUE) {
    if (msg.isOta) {
      nabd::OtaOffer offer;
      if (nabd::parseOta(msg.data, msg.len, &offer)) {
        display::message("Update", offer.version);
        const char* err = ota::apply(offer, NABD_FW_VERSION);  // restarts on success
        Serial.printf("ota refused: %s\n", err);
        snprintf(lastCommand, sizeof(lastCommand), "ota %s", err);
      }
    } else {
      handleCommand(msg.data, msg.len);
    }
  }

  // Five samples evenly across each 2 s period, then one reading.
  const uint32_t step = defaults::kSampleMs / defaults::kSamplesPerReading;
  if (now - lastSampleMs >= step && samplesTaken < defaults::kSamplesPerReading) {
    lastSampleMs = now;
    sensors::sample();
    samplesTaken++;
  }
  if (now - lastReadingMs >= defaults::kSampleMs) {
    lastReadingMs = now;
    samplesTaken = 0;
    sensors::collect(latest, relays);
    emit(latest);
  }

  replayOne();

  // Every (re)connect publishes the retained online status again: the Last Will marked us offline meanwhile.
  static bool wasConnected = false;
  if (mqttConnected && !wasConnected) lastStatusMs = 0;
  wasConnected = mqttConnected;
  if (mqttConnected && (now - lastStatusMs >= defaults::kStatusEveryMs || lastStatusMs == 0)) {
    lastStatusMs = now;
    publishStatus();
  }
  if (now - lastDisplayMs >= 1000) {
    lastDisplayMs = now;
    display::show(cfg.deviceId, WiFi.status() == WL_CONNECTED, mqttConnected, buffer.size(), latest, lastCommand);
  }
  delay(5);
}
