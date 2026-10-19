# Flash and provision a node (under 10 minutes)

You need the board on USB, this repository, and Python 3.10 or newer.

## 1. Install PlatformIO (once, about 3 minutes)

```bash
python -m venv ~/.nabd-pio && ~/.nabd-pio/bin/pip install platformio    # Windows: ~/.nabd-pio/Scripts/pip
```

The first build downloads the ESP32-S3 toolchain (about 600 MB).

## 2. Create the device's MQTT password (30 seconds)

```bash
pnpm credentials                         # adds any missing device in packages/shared/src/seed.ts
cat secrets/dev-credentials.json         # the password for your device id, e.g. nabd-01
```

On the VPS, add the same user to EMQX (see [DEPLOY.md](../DEPLOY.md#device-accounts)). The password is
shown here once. Only its hash is stored in the database.

## 3. Build and flash (about 2 minutes)

```bash
cd firmware/nabd-node
pio run -e esp32s3 -t upload             # hold BOOT while it connects if the board does not enter download mode
pio run -e esp32s3 -t uploadfs           # optional: an empty LittleFS image; the firmware formats it anyway
pio device monitor                       # 115200 baud
```

## 4. Provision (about 2 minutes)

1. The node opens a Wi-Fi network called **Nabd-Setup-XXXX**. Join it from your phone; the portal opens.
2. Choose your Wi-Fi and fill in:
   - **Device ID:** `nabd-01`
   - **Site slug:** `wadi-natrun`
   - **Profile:** `power`, `climate`, `coldchain` or `relay`
   - **MQTT broker host:** your broker's name, for example `mqtt.example.com`
   - **Port:** `8883`
   - **Username:** the device ID
   - **Password:** from step 2
3. Save. The node restarts, syncs its clock, connects over TLS and shows `W+ M+` on the screen.
4. Open `/devices/nabd-01`. A reading appears every 2 seconds.

To start over, hold **BOOT for 5 seconds**. That erases Wi-Fi, settings, the offline buffer and the seq
reservation.

## 5. Check the offline buffer (optional, 3 minutes)

Unplug the router for 2 minutes. The screen shows `buffered N`. When Wi-Fi returns, the readings replay at
up to 20 per second, between live ones, with their original timestamps. The chart has no gap.

## Firmware updates

```bash
pio run -e esp32s3                                                  # builds .pio/build/esp32s3/firmware.bin
NABD_OTA_KEY_FILE=/path/outside/repo/ota-signing-key.pem \
  node scripts/sign-firmware.ts sign .pio/build/esp32s3/firmware.bin --version 1.5.0 \
  --url https://fw.example.com/nabd-node-1.5.0.bin
```

Upload the `.bin` to that URL, run the printed `INSERT`, and press **Update** on the device page. The node
checks the SHA-256 and the ECDSA signature, installs the image to the spare slot, and keeps it only after
it has Wi-Fi, MQTT and one successful publish. Otherwise it rolls back within 2 minutes.

A new signing key: `node scripts/sign-firmware.ts keygen --out /path/outside/repo/key.pem`. The public key
lands in `include/ota_pubkey.h`; rebuild and flash once by USB. Nodes only accept images signed by the key
they were built with.

### Rollback

Automatic rollback needs the bootloader option `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`. To check a build:

```bash
grep ROLLBACK ~/.platformio/packages/framework-arduinoespressif32-libs/esp32s3/sdkconfig
```

If it is off, enable it with pioarduino's hybrid compile by adding to `[env:esp32s3]`:

```ini
custom_sdkconfig = CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y
```

Without it, the firmware still refuses unsigned or corrupted images. Only the automatic return after a
build that installs but then fails is lost.
