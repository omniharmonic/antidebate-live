/** Any browser-decodable file → 16 kHz Float32 per channel (at most 2) and a mono mix. */
export async function decodeToChannels(file: Blob): Promise<{ channels: Float32Array[]; mono: Float32Array; durationMs: number }> {
  const bytes = await file.arrayBuffer();
  const probe = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(bytes);
  } catch {
    throw new Error('This browser could not read that file. Try an .mp4, .m4a, .mp3 or .wav export.');
  } finally {
    void probe.close();
  }
  const n = Math.min(2, decoded.numberOfChannels);
  const frames = Math.ceil(decoded.duration * 16_000);
  const off = new OfflineAudioContext(n, frames, 16_000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const r = await off.startRendering();
  const channels = Array.from({ length: n }, (_, i) => r.getChannelData(i).slice());
  const mono = new Float32Array(frames);
  for (const ch of channels) for (let i = 0; i < frames; i++) mono[i]! += ch[i]! / n;
  return { channels, mono, durationMs: Math.round(decoded.duration * 1000) };
}
