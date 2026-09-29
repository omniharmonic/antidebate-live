/* Classic worker: the emscripten bundle expects importScripts and a global Module.
 * Committed via a .gitignore exception; the rest of public/sherpa is fetched by scripts/fetch-sherpa.mjs. */
/* global importScripts, createOfflineSpeakerDiarization */
// sherpa-onnx returns {start, end, speaker} with no per-segment confidence. Use one fixed
// value below the 0.95 cap in utterances.ts; boundary and unnamed-voice holds do the real gating.
const SEGMENT_CONFIDENCE = 0.9;
let sd = null;
self.Module = {
  locateFile: (p) => `/sherpa/${p}`,
  onRuntimeInitialized: () => {
    sd = createOfflineSpeakerDiarization(self.Module);
    self.postMessage({ ready: true, sampleRate: sd.sampleRate });
  },
};
importScripts('/sherpa/sherpa-onnx-speaker-diarization.js', '/sherpa/sherpa-onnx-wasm-main-speaker-diarization.js');
self.onmessage = (e) => {
  const { id, samples, numSpeakers } = e.data;
  try {
    sd.setConfig({ ...sd.config, clustering: { numClusters: numSpeakers ? numSpeakers : -1, threshold: 0.5 } });
    const segs = sd.process(samples);
    self.postMessage({ id, ok: true, segments: segs.map((s) => ({ startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), label: `S${s.speaker}`, confidence: SEGMENT_CONFIDENCE })) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
