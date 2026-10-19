// The MQTT contract on the device side (packages/shared/src/schemas.ts is the other side).
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace nabd {

/** Payloads larger than this are rejected by ingest; the encoder refuses to produce one. */
constexpr size_t kMaxPayload = 2048;

struct Metric {
  const char* key;  // registry key, e.g. "bus_v"
  float value;      // NaN = sensor failed this sample: encoded as null
  uint8_t decimals;
};

/**
 * {"seq":48210,"ts":"…","m":{"pv_w":3420,"bus_v":51.6},"errors":["ina219:read"]}
 * Returns the length written, or 0 if it would not fit in `cap` (or in kMaxPayload).
 */
size_t encodeTelemetry(char* out, size_t cap, uint32_t seq, const char* tsIso, const Metric* metrics,
                       size_t count, const char* const* errors, size_t errorCount);

enum class AckState { Delivered, Done, Rejected };

/** {"id":"c-2041","state":"done","relay":{"ch":1,"on":true}} — relay included when ch > 0. */
size_t encodeAck(char* out, size_t cap, const char* id, AckState state, const char* reason, int ch, bool on);

/** Retained status: {"online":true,"fw":"1.4.2","rssi":-61,"uptime_s":12,"boot_reason":"power_on","profile":"power"} */
size_t encodeStatus(char* out, size_t cap, const char* fw, int rssi, uint32_t uptimeS, const char* bootReason,
                    const char* profile);

// ---- commands -----------------------------------------------------------------------------------------

enum class CommandOp { RelaySet, Reboot };

enum class ParseResult {
  Ok,
  Invalid,      // not JSON, unknown op, bad arguments; answered only if an id could be read
  Expired,      // exp is in the past
  NoSuchRelay,  // channel the profile does not have
};

struct Command {
  char id[48];
  CommandOp op;
  int ch;
  bool on;
};

/**
 * Validates a `…/cmd` payload. `relayCount` is how many channels this profile drives. On anything but Ok,
 * `cmd->id` still holds the id when one was readable, so the device can answer "rejected" with a reason.
 */
ParseResult parseCommand(const char* json, size_t len, uint64_t nowMs, int relayCount, Command* cmd);

/** The reason string sent in a "rejected" ack. */
const char* rejectReason(ParseResult r);

// ---- OTA offer ----------------------------------------------------------------------------------------

struct OtaOffer {
  char version[16];
  char url[200];
  char sha256[65];
  char sig[160];  // base64 DER ECDSA P-256 signature
};

bool parseOta(const char* json, size_t len, OtaOffer* offer);

/** Semantic version compare: <0, 0, >0. */
int compareVersions(const char* a, const char* b);

}  // namespace nabd
