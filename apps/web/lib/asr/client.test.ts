import { afterEach, describe, expect, it } from 'vitest';
import { AsrClient } from './client';

type Msg = { id: number; kind: string; pcm?: Float32Array; variant?: unknown };

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  posted: Msg[] = [];
  constructor() { FakeWorker.last = this; }
  postMessage(msg: Msg) {
    this.posted.push(msg);
    const reply = msg.kind === 'load' ? { id: msg.id, ok: true, backend: 'wasm' } : { id: msg.id, ok: true, words: [] };
    queueMicrotask(() => this.onmessage?.({ data: reply }));
  }
  terminate() {}
}

afterEach(() => { delete (globalThis as { Worker?: unknown }).Worker; });

describe('AsrClient', () => {
  it('loads the variant chosen for this laptop', async () => {
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    await AsrClient.load();
    expect(FakeWorker.last.posted[0]).toMatchObject({ kind: 'load', variant: { backend: 'wasm', encoderQuant: 'int8' } });
  });
  it('the speed test warms up on 5 s, untimed, before timing 30 s', async () => {
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    const c = await AsrClient.load();
    const r = await c.benchmark();
    const lengths = FakeWorker.last.posted.filter((m) => m.kind === 'transcribe').map((m) => m.pcm!.length);
    expect(lengths).toEqual([16_000 * 5, 16_000 * 30]);
    expect(r.realtimeFactor).toBeGreaterThan(0);
  });
});
