# ADR 0006: Signed OTA with ECDSA P-256 and automatic rollback

- Status: accepted (2026-10-16)

## Decision

- Each release binary is hashed (SHA-256) and the hash is signed with an **ECDSA P-256** private key by
  `scripts/sign-firmware.ts` (Node `crypto`). The private key lives only in an environment variable or a
  local file outside the repo; it never enters git or CI logs.
- The public key is compiled into the firmware. The device downloads over HTTPS, streams the image into the
  inactive OTA slot while hashing it, verifies hash and signature with mbedTLS, and only then sets the boot
  partition.
- After reboot the new image calls `esp_ota_mark_app_valid_cancel_rollback()` only after Wi-Fi, MQTT and
  one successful publish. Otherwise the bootloader rolls back to the previous slot
  (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`).

## Why P-256

It is supported by mbedTLS hardware acceleration on the ESP32-S3 and by Node `crypto` without extra
dependencies. Ed25519 would be fine too, but needs more firmware code.
