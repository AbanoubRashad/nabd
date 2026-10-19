import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEQ_BLOCK, SeqStore } from './seq-store.js';

describe('SeqStore', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'nabd-seq-')), 'seq.json');

  it('counts up per device and writes only once per block', () => {
    const path = file();
    const store = new SeqStore(path);
    expect([store.take('nabd-01'), store.take('nabd-01'), store.take('nabd-02')]).toEqual([0, 1, 0]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ 'nabd-01': SEQ_BLOCK, 'nabd-02': SEQ_BLOCK });
  });

  it('never reuses a seq after a restart, even without a clean shutdown', () => {
    const path = file();
    const first = new SeqStore(path);
    let last = 0;
    for (let i = 0; i < SEQ_BLOCK + 20; i++) last = first.take('nabd-07');

    // Simulate a crash: no flush, just a new store on the same file.
    const second = new SeqStore(path);
    expect(second.take('nabd-07')).toBeGreaterThan(last);
  });
});
