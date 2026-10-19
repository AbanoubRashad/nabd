// ISO 8601 time for the MQTT contract: "2026-10-14T11:32:10.412Z". Pure, so it is unit tested on the host.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace nabd {

/** Formats Unix milliseconds as UTC ISO 8601 with milliseconds. Needs 25 bytes. */
void formatIso(uint64_t epochMs, char* out, size_t cap);

/**
 * Parses "YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)" into Unix milliseconds. Returns false on anything else.
 * Used for command expiry, so a malformed expiry is treated as invalid rather than as "never expires".
 */
bool parseIso(const char* s, uint64_t* epochMs);

}  // namespace nabd
