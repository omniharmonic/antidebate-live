import { afterEach, describe, expect, it } from 'vitest';
import { decodeToChannels } from './decode';

function fakeAudioContext(sampleRate: number) {
  return class {
    async decodeAudioData() {
      const data = new Float32Array(sampleRate);
      return { sampleRate, duration: 1, numberOfChannels: 1, length: data.length, getChannelData: () => data };
    }
    async close() {}
  };
}

afterEach(() => { delete (globalThis as { AudioContext?: unknown }).AudioContext; });

describe('decodeToChannels', () => {
  it('returns 16 kHz mono', async () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = fakeAudioContext(16_000);
    const r = await decodeToChannels(new Blob([new Uint8Array(4)]));
    expect(r).toMatchObject({ durationMs: 1000 });
    expect(r.mono).toHaveLength(16_000);
  });
  it('refuses audio the browser did not resample to 16 kHz', async () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = fakeAudioContext(48_000);
    await expect(decodeToChannels(new Blob([new Uint8Array(4)]))).rejects.toThrow('This browser decoded the audio at 48000 Hz, not 16000 Hz. Use Google Chrome or Microsoft Edge.');
  });
});
