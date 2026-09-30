import { afterEach, expect, it, vi } from 'vitest';
import { AsrClient } from './client';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.last = this; }
}
afterEach(() => vi.unstubAllGlobals());
async function loaded() {
  vi.stubGlobal('Worker', FakeWorker);
  const pending = AsrClient.load();
  const worker = FakeWorker.last;
  worker.onmessage!({ data: { id: 1, ok: true, backend: 'wasm' } });
  return { client: await pending, worker };
}
it('rejects both queued and future transcription after a worker crash', async () => {
  const { client, worker } = await loaded();
  const pending = client.transcribe(new Float32Array(320), 0);
  worker.onerror!({ message: 'worker crashed' });
  await expect(pending).rejects.toThrow('worker crashed');
  await expect(client.transcribe(new Float32Array(320), 0)).rejects.toThrow('worker crashed');
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
});
it('settles pending requests on termination so stopping capture cannot hang', async () => {
  const { client } = await loaded();
  const pending = client.transcribe(new Float32Array(320), 0);
  client.terminate();
  await expect(pending).rejects.toThrow('Transcription stopped');
  await expect(client.transcribe(new Float32Array(320), 0)).rejects.toThrow('Transcription stopped');
});
