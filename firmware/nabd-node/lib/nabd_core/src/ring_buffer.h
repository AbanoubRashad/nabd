// Offline buffer: telemetry payloads kept while the broker is unreachable, replayed oldest first.
//
// Fixed-size slots in one pre-allocated file (LittleFS on the device, memory in tests). The header with
// head/count is rewritten after every change and carries a magic and a CRC, so a power cut mid-write loses
// at most the record being written, never the whole buffer. When full, the oldest reading is dropped: the
// newest data is the most useful, and the drop count is reported.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace nabd {

class Storage {
 public:
  virtual ~Storage() = default;
  virtual bool read(uint32_t offset, uint8_t* buf, size_t len) = 0;
  virtual bool write(uint32_t offset, const uint8_t* buf, size_t len) = 0;
  virtual void flush() {}
};

class RingBuffer {
 public:
  /** Each slot stores a 2-byte length plus up to kSlotPayload bytes. */
  static constexpr size_t kSlotSize = 256;
  static constexpr size_t kSlotPayload = kSlotSize - 2;
  static constexpr size_t kHeaderSize = 32;

  RingBuffer(Storage& storage, uint32_t capacity) : s_(storage), capacity_(capacity) {}

  /** Loads the header, or formats an empty buffer if it is missing or corrupt. */
  void begin();

  /** Appends a payload. Returns false if it is too long. Drops (and counts) the oldest when full. */
  bool push(const char* payload, size_t len);

  /** Copies the oldest payload into `out` (NUL-terminated). Returns its length, or 0 if empty. */
  size_t peek(char* out, size_t cap);

  /** Removes the oldest payload, after it has been published. */
  void pop();

  uint32_t size() const { return count_; }
  uint32_t capacity() const { return capacity_; }
  uint32_t dropped() const { return dropped_; }

  static size_t bytesFor(uint32_t capacity) { return kHeaderSize + static_cast<size_t>(capacity) * kSlotSize; }

 private:
  void saveHeader();
  uint32_t slotOffset(uint32_t index) const { return kHeaderSize + index * kSlotSize; }

  Storage& s_;
  uint32_t capacity_;
  uint32_t head_ = 0;  // index of the oldest record
  uint32_t count_ = 0;
  uint32_t dropped_ = 0;
};

/**
 * Per-device `seq` that survives reboots without wearing out flash: the persisted value is a reservation
 * `block` ahead of the counter. After a crash the device resumes at the reservation, skipping at most one
 * block, so a seq is never reused (the simulator does the same, apps/simulator/src/seq-store.ts).
 */
class SeqCounter {
 public:
  using Persist = void (*)(uint32_t reserved, void* ctx);
  SeqCounter(uint32_t persisted, uint32_t block, Persist persist, void* ctx)
      : next_(persisted), reserved_(persisted), block_(block), persist_(persist), ctx_(ctx) {}

  uint32_t take() {
    const uint32_t seq = next_++;
    if (next_ > reserved_) {
      reserved_ = seq + block_;
      persist_(reserved_, ctx_);
    }
    return seq;
  }

 private:
  uint32_t next_, reserved_, block_;
  Persist persist_;
  void* ctx_;
};

}  // namespace nabd
