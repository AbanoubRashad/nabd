// nabd::Storage on a pre-allocated LittleFS file, for the offline ring buffer.
#pragma once
#include <LittleFS.h>

#include "ring_buffer.h"

class FileStorage : public nabd::Storage {
 public:
  /** Opens (creating and sizing if needed) the buffer file. Returns false if LittleFS is unusable. */
  bool begin(const char* path, size_t size) {
    if (!LittleFS.begin(true)) return false;
    if (!LittleFS.exists(path) || LittleFS.open(path, "r").size() != size) {
      File f = LittleFS.open(path, "w");
      if (!f) return false;
      uint8_t zero[256] = {0};
      for (size_t written = 0; written < size; written += sizeof(zero)) {
        f.write(zero, min(sizeof(zero), size - written));
      }
      f.close();
    }
    file_ = LittleFS.open(path, "r+");
    return static_cast<bool>(file_);
  }

  bool read(uint32_t offset, uint8_t* buf, size_t len) override {
    return file_.seek(offset) && file_.read(buf, len) == len;
  }

  bool write(uint32_t offset, const uint8_t* buf, size_t len) override {
    return file_.seek(offset) && file_.write(buf, len) == len;
  }

  void flush() override { file_.flush(); }

 private:
  File file_;
};
