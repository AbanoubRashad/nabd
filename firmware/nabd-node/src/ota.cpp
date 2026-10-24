#include "ota.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <Update.h>
#include <WiFiClientSecure.h>
#include <esp_ota_ops.h>
#include <esp_task_wdt.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

#include "ota_pubkey.h"
#include "root_ca.h"
#include "settings.h"

namespace ota {

static bool verifySignature(const uint8_t hash[32], const char* sigB64) {
  uint8_t sig[96];
  size_t sigLen = 0;
  if (mbedtls_base64_decode(sig, sizeof(sig), &sigLen, reinterpret_cast<const uint8_t*>(sigB64), strlen(sigB64)) != 0)
    return false;
  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);
  bool ok = mbedtls_pk_parse_public_key(&pk, reinterpret_cast<const uint8_t*>(kOtaPublicKey), sizeof(kOtaPublicKey)) == 0 &&
            mbedtls_pk_can_do(&pk, MBEDTLS_PK_ECKEY) &&
            mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, hash, 32, sig, sigLen) == 0;
  mbedtls_pk_free(&pk);
  return ok;
}

const char* apply(const nabd::OtaOffer& offer, const char* currentVersion) {
  if (nabd::compareVersions(offer.version, currentVersion) <= 0) return "not_newer";

  WiFiClientSecure tls;
  tls.setCACert(kRootCa);
  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(tls, offer.url)) return "bad_url";
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    return "download_failed";
  }
  const int total = http.getSize();
  if (total <= 0 || !Update.begin(static_cast<size_t>(total), U_FLASH)) {
    http.end();
    return "no_space";
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);
  auto* stream = http.getStreamPtr();  // NetworkClient in Arduino core 3
  uint8_t buf[2048];
  int remaining = total;
  uint32_t lastData = millis();
  while (remaining > 0 && http.connected()) {
    esp_task_wdt_reset();
    const size_t avail = stream->available();
    if (!avail) {
      if (millis() - lastData > 20000) break;  // stalled download
      delay(5);
      continue;
    }
    const int n = stream->readBytes(buf, min(avail, sizeof(buf)));
    mbedtls_sha256_update(&sha, buf, n);
    if (Update.write(buf, n) != static_cast<size_t>(n)) break;
    remaining -= n;
    lastData = millis();
  }
  http.end();
  uint8_t hash[32];
  mbedtls_sha256_finish(&sha, hash);
  mbedtls_sha256_free(&sha);
  if (remaining != 0) {
    Update.abort();
    return "download_incomplete";
  }

  char hex[65];
  for (int i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", hash[i]);
  if (strcmp(hex, offer.sha256) != 0) {
    Update.abort();
    return "sha256_mismatch";
  }
  if (!verifySignature(hash, offer.sig)) {
    Update.abort();
    return "bad_signature";
  }
  if (!Update.end(true)) return "install_failed";  // sets the new slot as the boot partition

  settings::setNextBootReason("ota");
  delay(200);
  ESP.restart();
  return "restarting";
}

bool pendingVerify() {
  esp_ota_img_states_t state;
  return esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK &&
         state == ESP_OTA_IMG_PENDING_VERIFY;
}

void markValid() { esp_ota_mark_app_valid_cancel_rollback(); }

void rollback() {
  settings::setNextBootReason("rollback");
  esp_ota_mark_app_invalid_rollback_and_reboot();
  ESP.restart();  // if rollback is not possible, at least restart
  while (true) {
  }
}

}  // namespace ota
