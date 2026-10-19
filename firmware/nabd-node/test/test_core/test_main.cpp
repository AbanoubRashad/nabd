// Host-side tests for the pure firmware logic: `pio test -e native`.
#include <math.h>
#include <string.h>
#include <unity.h>

#include <vector>

#include "filters.h"
#include "nabd_time.h"
#include "payload.h"
#include "ring_buffer.h"

using namespace nabd;

void setUp() {}
void tearDown() {}

// ---- time -----------------------------------------------------------------------------------------------

static void test_iso_round_trip() {
  char buf[32];
  formatIso(1760441530412ULL, buf, sizeof(buf));
  TEST_ASSERT_EQUAL_STRING("2025-10-14T11:32:10.412Z", buf);
  uint64_t ms = 0;
  TEST_ASSERT_TRUE(parseIso(buf, &ms));
  TEST_ASSERT_EQUAL_UINT64(1760441530412ULL, ms);
}

static void test_iso_offsets_and_garbage() {
  uint64_t a = 0, b = 0;
  TEST_ASSERT_TRUE(parseIso("2026-10-14T14:32:20+03:00", &a));
  TEST_ASSERT_TRUE(parseIso("2026-10-14T11:32:20Z", &b));
  TEST_ASSERT_EQUAL_UINT64(b, a);
  TEST_ASSERT_FALSE(parseIso("2026-10-14 11:32:20Z", &a));
  TEST_ASSERT_FALSE(parseIso("2026-10-14T11:32:20", &a));  // no timezone
  TEST_ASSERT_FALSE(parseIso("not a time at all, no", &a));
}

// ---- telemetry ------------------------------------------------------------------------------------------

static void test_telemetry_matches_the_contract() {
  const Metric m[] = {{"pv_w", 3420.0f, 0}, {"bus_v", 51.6f, 1}, {"soc", 87.0f, 0}, {"load_w", 1180.0f, 0}};
  char out[256];
  const size_t n = encodeTelemetry(out, sizeof(out), 48210, "2026-10-14T11:32:10.412Z", m, 4, nullptr, 0);
  TEST_ASSERT_EQUAL_STRING(
      "{\"seq\":48210,\"ts\":\"2026-10-14T11:32:10.412Z\",\"m\":{\"pv_w\":3420,\"bus_v\":51.6,\"soc\":87,\"load_w\":1180}}",
      out);
  TEST_ASSERT_EQUAL(strlen(out), n);
}

static void test_failed_sensor_is_null_with_error() {
  const Metric m[] = {{"probe_c", NAN, 1}, {"door", 0.0f, 0}};
  const char* errors[] = {"ds18b20:crc"};
  char out[256];
  encodeTelemetry(out, sizeof(out), 7, "2026-10-14T11:32:10.000Z", m, 2, errors, 1);
  TEST_ASSERT_EQUAL_STRING(
      "{\"seq\":7,\"ts\":\"2026-10-14T11:32:10.000Z\",\"m\":{\"probe_c\":null,\"door\":0},\"errors\":[\"ds18b20:crc\"]}",
      out);
}

static void test_telemetry_refuses_to_overflow() {
  const Metric m[] = {{"pv_w", 1.0f, 0}};
  char tiny[20];
  TEST_ASSERT_EQUAL(0, encodeTelemetry(tiny, sizeof(tiny), 1, "2026-10-14T11:32:10.000Z", m, 1, nullptr, 0));
}

static void test_ack_and_status() {
  char out[160];
  encodeAck(out, sizeof(out), "c-2041", AckState::Done, nullptr, 1, true);
  TEST_ASSERT_EQUAL_STRING("{\"id\":\"c-2041\",\"state\":\"done\",\"relay\":{\"ch\":1,\"on\":true}}", out);
  encodeAck(out, sizeof(out), "c-1", AckState::Rejected, "expired", 0, false);
  TEST_ASSERT_EQUAL_STRING("{\"id\":\"c-1\",\"state\":\"rejected\",\"reason\":\"expired\"}", out);
  encodeStatus(out, sizeof(out), "1.4.2", -61, 30, "power_on", "power");
  TEST_ASSERT_EQUAL_STRING(
      "{\"online\":true,\"fw\":\"1.4.2\",\"rssi\":-61,\"uptime_s\":30,\"boot_reason\":\"power_on\",\"profile\":\"power\"}",
      out);
}

// ---- commands -------------------------------------------------------------------------------------------

static const uint64_t kNow = 1791977540000ULL;  // 2026-10-14T11:32:20Z

static ParseResult parse(const char* json, Command* c, int relays = 1) {
  return parseCommand(json, strlen(json), kNow, relays, c);
}

static void test_command_relay_set() {
  Command c;
  TEST_ASSERT_EQUAL(ParseResult::Ok,
                    parse("{\"id\":\"c-2041\",\"op\":\"relay.set\",\"args\":{\"ch\":1,\"on\":true},\"exp\":\"2026-10-14T11:32:30Z\"}", &c));
  TEST_ASSERT_EQUAL_STRING("c-2041", c.id);
  TEST_ASSERT_TRUE(c.op == CommandOp::RelaySet);
  TEST_ASSERT_EQUAL(1, c.ch);
  TEST_ASSERT_TRUE(c.on);
}

static void test_command_rejections_keep_the_id() {
  Command c;
  TEST_ASSERT_EQUAL(ParseResult::Expired,
                    parse("{\"id\":\"c-9\",\"op\":\"relay.set\",\"args\":{\"ch\":1,\"on\":true},\"exp\":\"2026-10-14T11:32:19Z\"}", &c));
  TEST_ASSERT_EQUAL_STRING("c-9", c.id);
  TEST_ASSERT_EQUAL_STRING("expired", rejectReason(ParseResult::Expired));

  TEST_ASSERT_EQUAL(ParseResult::NoSuchRelay,
                    parse("{\"id\":\"c-10\",\"op\":\"relay.set\",\"args\":{\"ch\":2,\"on\":true},\"exp\":\"2026-10-14T11:33:00Z\"}", &c));
  TEST_ASSERT_EQUAL(ParseResult::Invalid,
                    parse("{\"id\":\"c-11\",\"op\":\"format.disk\",\"args\":{},\"exp\":\"2026-10-14T11:33:00Z\"}", &c));
  TEST_ASSERT_EQUAL(ParseResult::Invalid,
                    parse("{\"id\":\"c-12\",\"op\":\"relay.set\",\"args\":{\"ch\":\"1\",\"on\":true},\"exp\":\"2026-10-14T11:33:00Z\"}", &c));
  TEST_ASSERT_EQUAL(ParseResult::Invalid, parse("{\"id\":\"c-13\",\"op\":\"reboot\",\"args\":{},\"exp\":\"tomorrow\"}", &c));
}

static void test_command_without_a_valid_id_is_not_answered() {
  Command c;
  TEST_ASSERT_EQUAL(ParseResult::Invalid, parse("{\"id\":\"x; drop\",\"op\":\"reboot\"}", &c));
  TEST_ASSERT_EQUAL_STRING("", c.id);
  TEST_ASSERT_EQUAL(ParseResult::Invalid, parse("{not json", &c));
}

static void test_ota_offer() {
  OtaOffer o;
  char sha[65];
  memset(sha, 'a', 64);
  sha[64] = 0;
  char json[400];
  snprintf(json, sizeof(json), "{\"version\":\"1.5.0\",\"url\":\"https://fw.example.com/n.bin\",\"sha256\":\"%s\",\"sig\":\"MEUC\"}", sha);
  TEST_ASSERT_TRUE(parseOta(json, strlen(json), &o));
  TEST_ASSERT_EQUAL_STRING("1.5.0", o.version);
  snprintf(json, sizeof(json), "{\"version\":\"1.5.0\",\"url\":\"http://fw.example.com/n.bin\",\"sha256\":\"%s\",\"sig\":\"MEUC\"}", sha);
  TEST_ASSERT_FALSE(parseOta(json, strlen(json), &o));
  TEST_ASSERT_TRUE(compareVersions("1.5.0", "1.4.2") > 0);
  TEST_ASSERT_TRUE(compareVersions("1.4.10", "1.4.9") > 0);
  TEST_ASSERT_EQUAL(0, compareVersions("1.4.2", "1.4.2"));
}

// ---- ring buffer ----------------------------------------------------------------------------------------

class MemStorage : public Storage {
 public:
  explicit MemStorage(size_t size) : bytes(size, 0) {}
  bool read(uint32_t off, uint8_t* buf, size_t len) override {
    if (off + len > bytes.size()) return false;
    memcpy(buf, bytes.data() + off, len);
    return true;
  }
  bool write(uint32_t off, const uint8_t* buf, size_t len) override {
    if (off + len > bytes.size()) return false;
    memcpy(bytes.data() + off, buf, len);
    return true;
  }
  std::vector<uint8_t> bytes;
};

static void test_ring_buffer_fifo_and_persistence() {
  MemStorage mem(RingBuffer::bytesFor(5000));
  {
    RingBuffer rb(mem, 5000);
    rb.begin();
    char p[32];
    for (int i = 0; i < 3; i++) {
      snprintf(p, sizeof(p), "{\"seq\":%d}", i);
      TEST_ASSERT_TRUE(rb.push(p, strlen(p)));
    }
    TEST_ASSERT_EQUAL_UINT32(3, rb.size());
  }
  // A reboot: a new buffer over the same storage finds the readings, oldest first.
  RingBuffer rb(mem, 5000);
  rb.begin();
  TEST_ASSERT_EQUAL_UINT32(3, rb.size());
  char out[64];
  TEST_ASSERT_EQUAL(9, rb.peek(out, sizeof(out)));
  TEST_ASSERT_EQUAL_STRING("{\"seq\":0}", out);
  rb.pop();
  rb.peek(out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("{\"seq\":1}", out);
}

static void test_ring_buffer_holds_5000_and_drops_the_oldest() {
  MemStorage mem(RingBuffer::bytesFor(5000));
  RingBuffer rb(mem, 5000);
  rb.begin();
  char p[32];
  for (int i = 0; i < 5003; i++) {
    snprintf(p, sizeof(p), "r%d", i);
    rb.push(p, strlen(p));
  }
  TEST_ASSERT_EQUAL_UINT32(5000, rb.size());
  TEST_ASSERT_EQUAL_UINT32(3, rb.dropped());
  char out[32];
  rb.peek(out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("r3", out);
}

static void test_ring_buffer_recovers_from_a_corrupt_header() {
  MemStorage mem(RingBuffer::bytesFor(10));
  RingBuffer rb(mem, 10);
  rb.begin();
  rb.push("a", 1);
  mem.bytes[8] ^= 0xFF;  // flip a header byte: the CRC no longer matches
  RingBuffer again(mem, 10);
  again.begin();
  TEST_ASSERT_EQUAL_UINT32(0, again.size());
  TEST_ASSERT_FALSE(again.push("", 0));
}

static uint32_t persisted = 0;
static void persist(uint32_t v, void*) { persisted = v; }

static void test_seq_never_reused_after_a_crash() {
  persisted = 0;
  SeqCounter a(0, 500, persist, nullptr);
  uint32_t last = 0;
  for (int i = 0; i < 520; i++) last = a.take();
  TEST_ASSERT_EQUAL_UINT32(519, last);
  SeqCounter b(persisted, 500, persist, nullptr);  // reboot without a clean shutdown
  TEST_ASSERT_TRUE(b.take() > last);
}

// ---- filters --------------------------------------------------------------------------------------------

static void test_median_ignores_spikes_and_failures() {
  const float spiky[] = {51.6f, 51.5f, 99.0f, 51.7f, 51.6f};
  TEST_ASSERT_EQUAL_FLOAT(51.6f, median5(spiky, 5));
  const float failing[] = {NAN, 5.0f, NAN, 5.2f, NAN};
  TEST_ASSERT_TRUE(isnan(median5(failing, 5)));
  const float mostly[] = {NAN, 5.0f, 5.1f, 5.2f, 5.3f};
  TEST_ASSERT_EQUAL_FLOAT(5.15f, median5(mostly, 5));
}

static void test_backoff_grows_and_caps() {
  Backoff b(1000, 30000);
  TEST_ASSERT_EQUAL_UINT32(1000, b.next(0.5f));
  TEST_ASSERT_EQUAL_UINT32(2000, b.next(0.5f));
  TEST_ASSERT_EQUAL_UINT32(4000, b.next(0.5f));
  for (int i = 0; i < 10; i++) b.next(0.5f);
  TEST_ASSERT_EQUAL_UINT32(30000, b.next(0.5f));
  TEST_ASSERT_EQUAL_UINT32(22500, b.next(0.0f));  // jitter −25 %
  b.reset();
  TEST_ASSERT_EQUAL_UINT32(1000, b.next(0.5f));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_iso_round_trip);
  RUN_TEST(test_iso_offsets_and_garbage);
  RUN_TEST(test_telemetry_matches_the_contract);
  RUN_TEST(test_failed_sensor_is_null_with_error);
  RUN_TEST(test_telemetry_refuses_to_overflow);
  RUN_TEST(test_ack_and_status);
  RUN_TEST(test_command_relay_set);
  RUN_TEST(test_command_rejections_keep_the_id);
  RUN_TEST(test_command_without_a_valid_id_is_not_answered);
  RUN_TEST(test_ota_offer);
  RUN_TEST(test_ring_buffer_fifo_and_persistence);
  RUN_TEST(test_ring_buffer_holds_5000_and_drops_the_oldest);
  RUN_TEST(test_ring_buffer_recovers_from_a_corrupt_header);
  RUN_TEST(test_seq_never_reused_after_a_crash);
  RUN_TEST(test_median_ignores_spikes_and_failures);
  RUN_TEST(test_backoff_grows_and_caps);
  return UNITY_END();
}
