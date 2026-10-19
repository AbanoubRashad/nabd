#include "payload.h"

#include <ArduinoJson.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "nabd_time.h"

namespace nabd {

static const char* stateName(AckState s) {
  switch (s) {
    case AckState::Delivered:
      return "delivered";
    case AckState::Done:
      return "done";
    case AckState::Rejected:
      return "rejected";
  }
  return "rejected";
}

// Values are written with a fixed number of decimals so 51.6 never becomes 51.599998.
static size_t appendNumber(char* out, size_t cap, size_t pos, float v, uint8_t decimals) {
  if (pos >= cap) return cap;
  int n = isnan(v) ? snprintf(out + pos, cap - pos, "null") : snprintf(out + pos, cap - pos, "%.*f", decimals, v);
  return n < 0 ? cap : pos + static_cast<size_t>(n);
}

size_t encodeTelemetry(char* out, size_t cap, uint32_t seq, const char* tsIso, const Metric* metrics,
                       size_t count, const char* const* errors, size_t errorCount) {
  if (cap > kMaxPayload + 1) cap = kMaxPayload + 1;
  int n = snprintf(out, cap, "{\"seq\":%lu,\"ts\":\"%s\",\"m\":{", static_cast<unsigned long>(seq), tsIso);
  if (n < 0 || static_cast<size_t>(n) >= cap) return 0;
  size_t pos = static_cast<size_t>(n);
  for (size_t i = 0; i < count; i++) {
    n = snprintf(out + pos, cap - pos, "%s\"%s\":", i ? "," : "", metrics[i].key);
    if (n < 0 || pos + static_cast<size_t>(n) >= cap) return 0;
    pos += static_cast<size_t>(n);
    pos = appendNumber(out, cap, pos, metrics[i].value, metrics[i].decimals);
    if (pos >= cap) return 0;
  }
  n = snprintf(out + pos, cap - pos, "}");
  if (n < 0 || pos + 1 >= cap) return 0;
  pos += 1;
  if (errorCount) {
    n = snprintf(out + pos, cap - pos, ",\"errors\":[");
    if (n < 0 || pos + static_cast<size_t>(n) >= cap) return 0;
    pos += static_cast<size_t>(n);
    for (size_t i = 0; i < errorCount; i++) {
      n = snprintf(out + pos, cap - pos, "%s\"%s\"", i ? "," : "", errors[i]);
      if (n < 0 || pos + static_cast<size_t>(n) >= cap) return 0;
      pos += static_cast<size_t>(n);
    }
    if (pos + 1 >= cap) return 0;
    out[pos++] = ']';
  }
  if (pos + 1 >= cap) return 0;
  out[pos++] = '}';
  out[pos] = '\0';
  return pos;
}

size_t encodeAck(char* out, size_t cap, const char* id, AckState state, const char* reason, int ch, bool on) {
  JsonDocument doc;
  doc["id"] = id;
  doc["state"] = stateName(state);
  if (reason) doc["reason"] = reason;
  if (ch > 0) {
    doc["relay"]["ch"] = ch;
    doc["relay"]["on"] = on;
  }
  const size_t need = measureJson(doc);
  if (need + 1 > cap) return 0;
  return serializeJson(doc, out, cap);
}

size_t encodeStatus(char* out, size_t cap, const char* fw, int rssi, uint32_t uptimeS, const char* bootReason,
                    const char* profile) {
  JsonDocument doc;
  doc["online"] = true;
  doc["fw"] = fw;
  doc["rssi"] = rssi;
  doc["uptime_s"] = uptimeS;
  doc["boot_reason"] = bootReason;
  doc["profile"] = profile;
  const size_t need = measureJson(doc);
  if (need + 1 > cap) return 0;
  return serializeJson(doc, out, cap);
}

static bool validId(const char* id) {
  const size_t n = strlen(id);
  if (n < 3 || n > 42 || id[0] != 'c' || id[1] != '-') return false;
  for (size_t i = 2; i < n; i++) {
    const char c = id[i];
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-';
    if (!ok) return false;
  }
  return true;
}

ParseResult parseCommand(const char* json, size_t len, uint64_t nowMs, int relayCount, Command* cmd) {
  memset(cmd, 0, sizeof(*cmd));
  if (len > kMaxPayload) return ParseResult::Invalid;
  JsonDocument doc;
  if (deserializeJson(doc, json, len)) return ParseResult::Invalid;

  const char* id = doc["id"] | "";
  if (!validId(id)) return ParseResult::Invalid;
  strncpy(cmd->id, id, sizeof(cmd->id) - 1);

  // Expiry first: a stale command is refused whatever it asks for.
  uint64_t exp;
  const char* expStr = doc["exp"] | "";
  if (!parseIso(expStr, &exp)) return ParseResult::Invalid;
  if (exp < nowMs) return ParseResult::Expired;

  const char* op = doc["op"] | "";
  if (strcmp(op, "relay.set") == 0) {
    JsonVariantConst ch = doc["args"]["ch"];
    JsonVariantConst on = doc["args"]["on"];
    if (!ch.is<int>() || !on.is<bool>()) return ParseResult::Invalid;
    cmd->op = CommandOp::RelaySet;
    cmd->ch = ch.as<int>();
    cmd->on = on.as<bool>();
    if (cmd->ch < 1 || cmd->ch > 2) return ParseResult::Invalid;
    if (cmd->ch > relayCount) return ParseResult::NoSuchRelay;
    return ParseResult::Ok;
  }
  if (strcmp(op, "reboot") == 0) {
    cmd->op = CommandOp::Reboot;
    return ParseResult::Ok;
  }
  return ParseResult::Invalid;
}

const char* rejectReason(ParseResult r) {
  switch (r) {
    case ParseResult::Expired:
      return "expired";
    case ParseResult::NoSuchRelay:
      return "no_such_relay";
    default:
      return "invalid";
  }
}

bool parseOta(const char* json, size_t len, OtaOffer* offer) {
  memset(offer, 0, sizeof(*offer));
  JsonDocument doc;
  if (deserializeJson(doc, json, len)) return false;
  const char* version = doc["version"] | "";
  const char* url = doc["url"] | "";
  const char* sha = doc["sha256"] | "";
  const char* sig = doc["sig"] | "";
  if (strncmp(url, "https://", 8) != 0) return false;  // the image must come over TLS
  if (strlen(sha) != 64 || strlen(version) == 0 || strlen(sig) == 0) return false;
  if (strlen(version) >= sizeof(offer->version) || strlen(url) >= sizeof(offer->url) ||
      strlen(sig) >= sizeof(offer->sig))
    return false;
  for (const char* p = sha; *p; p++) {
    if (!((*p >= '0' && *p <= '9') || (*p >= 'a' && *p <= 'f'))) return false;
  }
  strcpy(offer->version, version);
  strcpy(offer->url, url);
  strcpy(offer->sha256, sha);
  strcpy(offer->sig, sig);
  return true;
}

int compareVersions(const char* a, const char* b) {
  unsigned x[3] = {0, 0, 0}, y[3] = {0, 0, 0};
  sscanf(a, "%u.%u.%u", &x[0], &x[1], &x[2]);
  sscanf(b, "%u.%u.%u", &y[0], &y[1], &y[2]);
  for (int i = 0; i < 3; i++) {
    if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

}  // namespace nabd
