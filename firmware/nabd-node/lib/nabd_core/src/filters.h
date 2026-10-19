// Small numeric helpers: median-of-5 sampling and reconnect backoff. Header-only and pure.
#pragma once
#include <math.h>
#include <stdint.h>

namespace nabd {

/**
 * Median of up to 5 samples, ignoring NaN (a failed read). Returns NaN if fewer than 3 samples are valid,
 * so a flaky sensor reports null with an error instead of a made-up value.
 */
inline float median5(const float* samples, int n) {
  float v[5];
  int k = 0;
  for (int i = 0; i < n && i < 5; i++) {
    if (!isnan(samples[i])) v[k++] = samples[i];
  }
  if (k < 3) return NAN;
  for (int i = 1; i < k; i++) {  // insertion sort, k <= 5
    const float x = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > x) {
      v[j + 1] = v[j];
      j--;
    }
    v[j + 1] = x;
  }
  return (k % 2) ? v[k / 2] : (v[k / 2 - 1] + v[k / 2]) / 2.0f;
}

/** Exponential backoff with ±25 % jitter: 1 s, 2 s, 4 s … capped. `rand01` is a value in [0, 1). */
class Backoff {
 public:
  Backoff(uint32_t baseMs, uint32_t maxMs) : base_(baseMs), max_(maxMs) {}
  uint32_t next(float rand01) {
    uint32_t d = base_;
    for (uint8_t i = 0; i < attempt_ && d < max_; i++) d *= 2;
    if (d > max_) d = max_;
    if (attempt_ < 31) attempt_++;
    const float jitter = 0.75f + 0.5f * rand01;
    return static_cast<uint32_t>(d * jitter);
  }
  void reset() { attempt_ = 0; }
  uint8_t attempts() const { return attempt_; }

 private:
  uint32_t base_, max_;
  uint8_t attempt_ = 0;
};

}  // namespace nabd
