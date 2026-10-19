import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Per-device `seq` counters that survive restarts, like the firmware's counter in NVS.
 *
 * Flash wear rules out writing on every reading, so the store reserves a block: it persists `next + BLOCK`
 * and hands out numbers until the block runs out. After a crash the device resumes at the reserved mark,
 * skipping at most one block, so a `seq` is never reused. The firmware does the same.
 */
export const SEQ_BLOCK = 500;

export class SeqStore {
  private readonly next = new Map<string, number>();
  private readonly reserved = new Map<string, number>();

  constructor(private readonly file: string) {
    let saved: Record<string, number> = {};
    try {
      saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>;
    } catch {
      // First run: every device starts at 0.
    }
    for (const [id, mark] of Object.entries(saved)) {
      this.next.set(id, mark);
      this.reserved.set(id, mark);
    }
  }

  /** Returns the next `seq` for a device, reserving a new block on disk when the current one is used up. */
  take(deviceId: string): number {
    const seq = this.next.get(deviceId) ?? 0;
    this.next.set(deviceId, seq + 1);
    if (seq + 1 > (this.reserved.get(deviceId) ?? 0)) {
      this.reserved.set(deviceId, seq + SEQ_BLOCK);
      this.persist();
    }
    return seq;
  }

  /** Writes the reservations atomically (temp file + rename), so a crash mid-write cannot corrupt them. */
  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.reserved)));
    renameSync(tmp, this.file);
  }
}
