#include "sensors.h"

#include <Adafruit_INA219.h>
#include <Adafruit_SHT31.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <Wire.h>

#include "config.h"
#include "filters.h"

namespace {
const Settings* cfg = nullptr;
Profile profile = Profile::Power;

Adafruit_INA219 inaLoad(0x40);
Adafruit_INA219 inaPv(0x41);  // optional second INA219 on the panel side (A0 bridged)
bool hasInaLoad = false, hasInaPv = false;
Adafruit_SHT31 sht31;
bool hasSht = false;
OneWire oneWire(pins::kOneWire);
DallasTemperature probes(&oneWire);

// One ring of 5 samples per quantity.
struct Samples {
  float v[5];
  int n = 0;
  void add(float x) {
    if (n < 5) v[n++] = x;
  }
  float median() {
    const float m = nabd::median5(v, n);
    n = 0;
    return m;
  }
};
Samples busV, loadW, pvW, airC, rh, soil, probeC;

// State of charge from bus voltage for a 16-cell LFP pack (48 V nominal). An estimate: it is only exact at
// rest, and is labelled as such in docs/hardware/README.md.
float socFromVoltage(float v) {
  static const float curve[][2] = {{48.0f, 0}, {50.4f, 10}, {51.2f, 20}, {51.6f, 40}, {52.0f, 60}, {52.8f, 80}, {53.6f, 95}, {54.4f, 100}};
  if (isnan(v)) return NAN;
  if (v <= curve[0][0]) return 0;
  for (size_t i = 1; i < sizeof(curve) / sizeof(curve[0]); i++) {
    if (v <= curve[i][0]) {
      const float t = (v - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]);
      return curve[i - 1][1] + t * (curve[i][1] - curve[i - 1][1]);
    }
  }
  return 100;
}

void push(Reading& r, const char* key, float v, uint8_t decimals) {
  if (r.count < sizeof(r.metrics) / sizeof(r.metrics[0])) r.metrics[r.count++] = {key, v, decimals};
}
void error(Reading& r, const char* code) {
  if (r.errorCount < sizeof(r.errors) / sizeof(r.errors[0])) r.errors[r.errorCount++] = code;
}
}  // namespace

namespace sensors {

void begin(const Settings& s) {
  cfg = &s;
  profile = s.profileKind();
  Wire.begin(pins::kI2cSda, pins::kI2cScl);
  switch (profile) {
    case Profile::Power:
      hasInaLoad = inaLoad.begin();
      hasInaPv = inaPv.begin();
      break;
    case Profile::Climate:
      hasSht = sht31.begin(0x44);
      analogReadResolution(12);
      break;
    case Profile::ColdChain:
      probes.begin();
      probes.setWaitForConversion(false);
      probes.requestTemperatures();
      pinMode(pins::kDoor, INPUT_PULLUP);
      break;
    case Profile::Relay:
      break;
  }
}

void sample() {
  switch (profile) {
    case Profile::Power:
      if (hasInaLoad) {
        busV.add(inaLoad.getBusVoltage_V() * cfg->busScale);
        loadW.add(inaLoad.getPower_mW() / 1000.0f * cfg->busScale);
      } else {
        busV.add(NAN);
        loadW.add(NAN);
      }
      pvW.add(hasInaPv ? inaPv.getPower_mW() / 1000.0f * cfg->busScale : NAN);
      break;
    case Profile::Climate: {
      airC.add(hasSht ? sht31.readTemperature() : NAN);
      rh.add(hasSht ? sht31.readHumidity() : NAN);
      // Capacitive probe: about 3000 counts dry, 1300 in water. Calibrate per probe for better accuracy.
      const int raw = analogRead(pins::kSoil);
      soil.add(raw <= 0 ? NAN : constrain((3000.0f - raw) / (3000.0f - 1300.0f) * 100.0f, 0.0f, 100.0f));
      break;
    }
    case Profile::ColdChain: {
      const float t = probes.getTempCByIndex(0);
      probeC.add(t == DEVICE_DISCONNECTED_C || t == 85.0f ? NAN : t);  // 85 °C is the DS18B20 power-on value
      probes.requestTemperatures();
      break;
    }
    case Profile::Relay:
      break;
  }
}

bool doorOpen() { return digitalRead(pins::kDoor) == HIGH; }

void collect(Reading& r, const bool relays[2]) {
  r.count = 0;
  r.errorCount = 0;
  switch (profile) {
    case Profile::Power: {
      const float v = busV.median();
      push(r, "bus_v", v, 1);
      push(r, "load_w", loadW.median(), 0);
      push(r, "soc", socFromVoltage(v), 0);
      if (hasInaPv) push(r, "pv_w", pvW.median(), 0);
      else pvW.median();
      if (!hasInaLoad || isnan(v)) error(r, "ina219:read");
      push(r, "relay1", relays[0] ? 1 : 0, 0);
      break;
    }
    case Profile::Climate: {
      const float t = airC.median();
      push(r, "air_c", t, 1);
      push(r, "rh", rh.median(), 0);
      push(r, "soil_pct", soil.median(), 0);
      if (!hasSht || isnan(t)) error(r, "sht31:read");
      push(r, "relay1", relays[0] ? 1 : 0, 0);
      break;
    }
    case Profile::ColdChain: {
      const float t = probeC.median();
      push(r, "probe_c", t, 1);
      push(r, "door", doorOpen() ? 1 : 0, 0);
      if (isnan(t)) error(r, "ds18b20:read");
      break;
    }
    case Profile::Relay:
      push(r, "relay1", relays[0] ? 1 : 0, 0);
      push(r, "relay2", relays[1] ? 1 : 0, 0);
      break;
  }
}

}  // namespace sensors
