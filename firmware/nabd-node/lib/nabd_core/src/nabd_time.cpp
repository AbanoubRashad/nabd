#include "nabd_time.h"

#include <stdio.h>
#include <string.h>

namespace nabd {

// Howard Hinnant's civil-date algorithms (public domain): days since 1970-01-01 <-> y/m/d.
static int64_t daysFromCivil(int64_t y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = static_cast<unsigned>(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + static_cast<int64_t>(doe) - 719468;
}

static void civilFromDays(int64_t z, int* y, unsigned* m, unsigned* d) {
  z += 719468;
  const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = static_cast<unsigned>(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  *d = doy - (153 * mp + 2) / 5 + 1;
  *m = mp < 10 ? mp + 3 : mp - 9;
  *y = static_cast<int>(static_cast<int64_t>(yoe) + era * 400 + (*m <= 2));
}

void formatIso(uint64_t epochMs, char* out, size_t cap) {
  const int64_t days = static_cast<int64_t>(epochMs / 86400000ULL);
  const uint32_t msOfDay = static_cast<uint32_t>(epochMs % 86400000ULL);
  int y;
  unsigned m, d;
  civilFromDays(days, &y, &m, &d);
  snprintf(out, cap, "%04d-%02u-%02uT%02u:%02u:%02u.%03uZ", y, m, d, msOfDay / 3600000U,
           (msOfDay / 60000U) % 60U, (msOfDay / 1000U) % 60U, msOfDay % 1000U);
}

static bool digits(const char* s, int n, int* out) {
  int v = 0;
  for (int i = 0; i < n; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
    v = v * 10 + (s[i] - '0');
  }
  *out = v;
  return true;
}

bool parseIso(const char* s, uint64_t* epochMs) {
  if (!s || strlen(s) < 20) return false;
  int y, mo, d, h, mi, se;
  if (!digits(s, 4, &y) || s[4] != '-' || !digits(s + 5, 2, &mo) || s[7] != '-' || !digits(s + 8, 2, &d) ||
      s[10] != 'T' || !digits(s + 11, 2, &h) || s[13] != ':' || !digits(s + 14, 2, &mi) || s[16] != ':' ||
      !digits(s + 17, 2, &se))
    return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return false;
  const char* p = s + 19;
  int ms = 0;
  if (*p == '.') {
    p++;
    int n = 0, frac = 0;
    while (*p >= '0' && *p <= '9') {
      if (n < 3) frac = frac * 10 + (*p - '0');
      n++;
      p++;
    }
    if (n == 0) return false;
    for (int i = n; i < 3; i++) frac *= 10;
    ms = frac;
  }
  int64_t offsetMin = 0;
  if (*p == 'Z') {
    p++;
  } else if (*p == '+' || *p == '-') {
    int oh, om;
    if (!digits(p + 1, 2, &oh) || p[3] != ':' || !digits(p + 4, 2, &om)) return false;
    offsetMin = (oh * 60 + om) * (*p == '-' ? -1 : 1);
    p += 6;
  } else {
    return false;
  }
  if (*p != '\0') return false;
  const int64_t days = daysFromCivil(y, static_cast<unsigned>(mo), static_cast<unsigned>(d));
  const int64_t total = ((days * 24 + h) * 60 + mi - offsetMin) * 60 + se;
  if (total < 0) return false;
  *epochMs = static_cast<uint64_t>(total) * 1000ULL + static_cast<uint64_t>(ms);
  return true;
}

}  // namespace nabd
