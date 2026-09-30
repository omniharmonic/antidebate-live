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
    const pending = client.diarize(new Float32Array(4));
    worker.onerror!({ message: 'boom' });
    await expect(pending).rejects.toThrow('Speaker separation stopped unexpectedly. Reload the page and try again.');
  });

  it('rejects pending calls on terminate', async () => {
    const { client } = await loaded();
    const pending = client.diarize(new Float32Array(4));
    client.terminate();
    await expect(pending).rejects.toThrow('Speaker separation stopped unexpectedly. Reload the page and try again.');
  });

  it('rejects new calls immediately after the worker has stopped', async () => {
    const { client, worker } = await loaded();
    client.terminate();
    await expect(client.diarize(new Float32Array(4))).rejects.toThrow('Speaker separation stopped unexpectedly. Reload the page and try again.');
    expect(worker.posted).toHaveLength(0);
  });

  it('rejects new calls after a worker error', async () => {
    const { client } = await loaded();
    FakeWorker.last.onerror!({ message: 'boom' });
    await expect(client.diarize(new Float32Array(4))).rejects.toThrow('Speaker separation stopped unexpectedly.');
  });

  it('sends a transferred copy and leaves the caller array intact', async () => {
    const { client, worker } = await loaded();
    const mono = new Float32Array([1, 2, 3]);
    void client.diarize(mono);
    const sent = worker.posted[0]!;
    // No speaker count: the worker clusters by threshold, so an extra voice shows up to be named.
    expect(Object.keys(sent.msg).sort()).toEqual(['id', 'samples']);
    expect(sent.msg.samples).not.toBe(mono);
    expect(sent.transfer).toEqual([sent.msg.samples.buffer]);
    expect(mono.length).toBe(3);
  });

  it('matchVoices asks the worker for anchors + 1 clusters and scores the reply', async () => {
    const { client, worker } = await loaded();
    const p = client.matchVoices([{ key: 'A', pcm: new Float32Array(32_000) }, { key: 'B', pcm: new Float32Array(32_000) }], new Float32Array(16_000));
    const sent = worker.posted[0]!.msg as unknown as { id: number; type?: string; numClusters?: number };
    expect(sent.type).toBe('match');
    expect(sent.numClusters).toBe(3);
    const segments = [{ startMs: 0, endMs: 2000, label: 'S0', confidence: 1 }, { startMs: 2500, endMs: 4500, label: 'S1', confidence: 1 }, { startMs: 5000, endMs: 6000, label: 'S1', confidence: 1 }];
    worker.onmessage!({ data: { id: sent.id, ok: true, segments } });
    expect(await p).toEqual({ A: 0, B: 1 });
  });
});

it('keeps separate enrolled voices and clip-relative boundaries in one mixed clip', async () => {
  const { client, worker } = await loaded();
  const p = client.matchTurns([{ key: 'A', pcm: new Float32Array(32000) }, { key: 'B', pcm: new Float32Array(32000) }], new Float32Array(64000));
  const sent = worker.posted[0]!.msg as unknown as { id: number };
  worker.onmessage!({ data: { id: sent.id, ok: true, segments: [
    { startMs: 0, endMs: 2000, label: 'S0', confidence: 1 },
    { startMs: 2500, endMs: 4500, label: 'S1', confidence: 1 },
    { startMs: 5000, endMs: 7000, label: 'S0', confidence: 1 },
    { startMs: 7000, endMs: 9000, label: 'S1', confidence: 1 },
  ] } });
  expect(await p).toEqual([
    { startMs: 0, endMs: 2000, label: 'S0', voice: { A: 1, B: 0 } },
    { startMs: 2000, endMs: 4000, label: 'S1', voice: { A: 0, B: 1 } },
  ]);
});
