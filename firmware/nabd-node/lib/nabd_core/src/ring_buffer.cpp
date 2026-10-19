#include "ring_buffer.h"

#include <string.h>

namespace nabd {

static const uint32_t kMagic = 0x4E414244;  // "NABD"

struct Header {
  uint32_t magic;
  uint32_t capacity;
  uint32_t head;
  uint32_t count;
  uint32_t dropped;
  uint32_t crc;
};

// CRC-32 (IEEE), bitwise: small and fast enough for a 20-byte header.
static uint32_t crc32(const uint8_t* data, size_t len) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}

void RingBuffer::begin() {
  Header h{};
  if (s_.read(0, reinterpret_cast<uint8_t*>(&h), sizeof(h)) && h.magic == kMagic && h.capacity == capacity_ &&
      h.crc == crc32(reinterpret_cast<const uint8_t*>(&h), offsetof(Header, crc)) && h.head < capacity_ &&
      h.count <= capacity_) {
    head_ = h.head;
    count_ = h.count;
    dropped_ = h.dropped;
    return;
  }
  head_ = count_ = dropped_ = 0;
  saveHeader();
}

void RingBuffer::saveHeader() {
  Header h{kMagic, capacity_, head_, count_, dropped_, 0};
  h.crc = crc32(reinterpret_cast<const uint8_t*>(&h), offsetof(Header, crc));
  s_.write(0, reinterpret_cast<const uint8_t*>(&h), sizeof(h));
  s_.flush();
}

bool RingBuffer::push(const char* payload, size_t len) {
  if (len == 0 || len > kSlotPayload) return false;
  if (count_ == capacity_) {  // full: drop the oldest
    head_ = (head_ + 1) % capacity_;
    count_--;
    dropped_++;
  }
  const uint32_t tail = (head_ + count_) % capacity_;
  uint8_t slot[kSlotSize];
  slot[0] = static_cast<uint8_t>(len & 0xFF);
  slot[1] = static_cast<uint8_t>(len >> 8);
  memcpy(slot + 2, payload, len);
  // Write the record first, then the header: a crash in between leaves the old, consistent header.
  if (!s_.write(slotOffset(tail), slot, len + 2)) return false;
  count_++;
  saveHeader();
  return true;
}

size_t RingBuffer::peek(char* out, size_t cap) {
  if (count_ == 0 || cap == 0) return 0;
  uint8_t lenBytes[2];
  if (!s_.read(slotOffset(head_), lenBytes, 2)) return 0;
  const size_t len = static_cast<size_t>(lenBytes[0]) | (static_cast<size_t>(lenBytes[1]) << 8);
  if (len == 0 || len > kSlotPayload || len + 1 > cap) {
    pop();  // a corrupt slot is skipped rather than blocking every newer reading behind it
    return 0;
  }
  if (!s_.read(slotOffset(head_) + 2, reinterpret_cast<uint8_t*>(out), len)) return 0;
  out[len] = '\0';
  return len;
}

void RingBuffer::pop() {
  if (count_ == 0) return;
  head_ = (head_ + 1) % capacity_;
  count_--;
  saveHeader();
}

}  // namespace nabd
