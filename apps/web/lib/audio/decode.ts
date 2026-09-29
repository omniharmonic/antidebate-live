/** Any browser-decodable file → 16 kHz Float32 per channel (at most 2) and a mono mix. */
export async function decodeToChannels(file: Blob): Promise<{ channels: Float32Array[]; mono: Float32Array; durationMs: number }> {
  const bytes = await file.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16_000 });
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch (err) {
    throw new Error('This browser could not read that file. Try an .mp4, .m4a, .mp3 or .wav export.', { cause: err });
  } finally {
    void ctx.close();
  }
  if (decoded.duration === 0) {
    throw new Error('That file has no audio we can read.');
  }
  const n = Math.min(2, decoded.numberOfChannels);
  const channels = Array.from({ length: n }, (_, i) => decoded.getChannelData(i).slice());
  const frames = decoded.length;
  const mono = new Float32Array(frames);
  for (const ch of channels) for (let i = 0; i < frames; i++) mono[i]! += ch[i]! / n;
  return { channels, mono, durationMs: Math.round(decoded.duration * 1000) };
}
