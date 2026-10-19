// Signed over-the-air updates with automatic rollback (ADR 0006).
#pragma once
#include "payload.h"

namespace ota {
/**
 * Downloads the image over HTTPS into the inactive slot while hashing it, then checks the SHA-256 against the
 * offer and the ECDSA P-256 signature against the public key compiled into this firmware. Only then does it
 * switch the boot partition and restart. Any failure aborts and leaves the running image untouched.
 * Returns an error code ("sha256_mismatch", "bad_signature", …) if it did not restart.
 */
const char* apply(const nabd::OtaOffer& offer, const char* currentVersion);

/** True if this boot is a freshly installed image that has not proven itself yet. */
bool pendingVerify();
/** Called after Wi-Fi, MQTT and one successful publish: keeps the new image. */
void markValid();
/** Rolls back to the previous image (the bootloader would also do it on the next reset). */
[[noreturn]] void rollback();
}  // namespace ota
