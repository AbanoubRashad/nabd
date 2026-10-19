// Sensor drivers per device profile. Each reading is the median of 5 samples taken across the 2 s period;
// a sensor that fails reports NaN (null in the payload) plus an error code, never a guessed value.
#pragma once
#include "payload.h"
#include "settings.h"

struct Reading {
  nabd::Metric metrics[8];
  size_t count = 0;
  const char* errors[4];
  size_t errorCount = 0;
};

namespace sensors {
/** Starts the drivers the profile needs. Missing hardware is reported per reading, not here. */
void begin(const Settings& s);
/** Takes one of the 5 samples. Call evenly across the sample period. */
void sample();
/** Medians of the samples since the last call, plus relay states, as registry metrics. */
void collect(Reading& out, const bool relays[2]);
/** True while the door reed switch reads open (cold-chain profile). */
bool doorOpen();
}  // namespace sensors
