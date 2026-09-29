/* Classic worker: the emscripten bundle expects importScripts and a global Module.
 * Committed (with cluster-swap.js) via .gitignore exceptions; the rest of public/sherpa is fetched by scripts/fetch-sherpa.mjs. */
/* global importScripts, createOfflineSpeakerDiarization, withClustering */
// sherpa-onnx returns {start, end, speaker} with no per-segment confidence. Use one fixed
// value below the 0.95 cap in utterances.ts; boundary and unnamed-voice holds do the real gating.
const SEGMENT_CONFIDENCE = 0.9;
// The bundle's defaults, except windowShiftRatio 0.5 (default 0.1): about 5x fewer embedding
// extractions, which were ~90% of the run time. Clustering is by threshold (0.8, chosen by the diarization sweep), never a forced count,
// so a voice nobody expected (a questioner, an announcement) surfaces and can be marked "Someone else".
const CONFIG = {
  segmentation: { pyannote: { model: './segmentation.onnx', windowShiftRatio: 0.5 } },
  embedding: { model: './embedding.onnx' },
  clustering: { numClusters: -1, threshold: 0.8 },
  minDurationOn: 0.3,
  minDurationOff: 0.5,
};
let sd = null;
self.Module = {
  locateFile: (p) => `/sherpa/${p}`,
  onRuntimeInitialized: () => {
    sd = createOfflineSpeakerDiarization(self.Module, CONFIG);
    self.postMessage({ ready: true, sampleRate: sd.sampleRate });
  },
};
importScripts('/sherpa/cluster-swap.js', '/sherpa/sherpa-onnx-speaker-diarization.js', '/sherpa/sherpa-onnx-wasm-main-speaker-diarization.js');
const toSegments = (segs) => segs.map((s) => ({ startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), label: `S${s.speaker}`, confidence: SEGMENT_CONFIDENCE }));
self.onmessage = (e) => {
  const { id, samples, type, numClusters } = e.data;
  try {
    // Voice matching: anchors + one extra cluster so an unknown voice can stand apart. Segments are
    // captured, the recording clustering restored, and only then is the single reply posted.
    const segs = type === 'match'
      ? withClustering(sd, { numClusters, threshold: CONFIG.clustering.threshold }, CONFIG.clustering, () => toSegments(sd.process(samples)))
      : toSegments(sd.process(samples));
    self.postMessage({ id, ok: true, segments: segs });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
