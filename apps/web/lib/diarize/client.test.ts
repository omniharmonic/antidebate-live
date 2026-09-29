import { afterEach, describe, expect, it } from 'vitest';
import { DiarizeClient } from './client';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  posted: { msg: { samples: Float32Array }; transfer?: Transferable[] }[] = [];
  terminated = false;
  constructor() { FakeWorker.last = this; }
  postMessage(msg: { samples: Float32Array }, transfer?: Transferable[]) { this.posted.push({ msg, transfer }); }
  terminate() { this.terminated = true; }
}

afterEach(() => { delete (globalThis as { Worker?: unknown }).Worker; });

async function loaded() {
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  const p = DiarizeClient.load();
  FakeWorker.last.onmessage!({ data: { ready: true } });
  return { client: await p, worker: FakeWorker.last };
}

describe('DiarizeClient', () => {
  it('rejects pending calls when the worker errors after loading', async () => {
    const { client, worker } = await loaded();
    const pending = client.diarize(new Float32Array(4), null);
    worker.onerror!({ message: 'boom' });
    await expect(pending).rejects.toThrow('Speaker separation stopped unexpectedly. Reload the page and try again.');
  });

  it('rejects pending calls on terminate', async () => {
    const { client } = await loaded();
    const pending = client.diarize(new Float32Array(4), null);
    client.terminate();
    await expect(pending).rejects.toThrow('Speaker separation stopped unexpectedly. Reload the page and try again.');
  });

  it('sends a transferred copy and leaves the caller array intact', async () => {
    const { client, worker } = await loaded();
    const mono = new Float32Array([1, 2, 3]);
    void client.diarize(mono, 2);
    const sent = worker.posted[0]!;
    expect(sent.msg.samples).not.toBe(mono);
    expect(sent.transfer).toEqual([sent.msg.samples.buffer]);
    expect(mono.length).toBe(3);
  });
});
