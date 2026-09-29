import { fromHub } from 'parakeet.js';
import { aggregateProgress, emptyProgress } from './progress';

type Req = { id: number; kind: 'load' } | { id: number; kind: 'transcribe'; pcm: Float32Array; offsetMs: number };
type Gpu = { requestAdapter(): Promise<unknown> };

// The DOM lib is on for this package, so type the worker global by hand rather than pulling in the webworker lib.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage(msg: unknown): void;
  navigator: { gpu?: Gpu };
};

let model: Awaited<ReturnType<typeof fromHub>> | null = null;

ctx.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.kind === 'load') {
      const hasGpu = Boolean(ctx.navigator.gpu && (await ctx.navigator.gpu.requestAdapter()));
      const backend = hasGpu ? 'webgpu' : 'wasm';
      let progress = emptyProgress();
      model = await fromHub('parakeet-tdt-0.6b-v3', {
        backend,
        encoderQuant: hasGpu ? 'fp32' : 'int8',
        decoderQuant: 'int8',
        progress: (p) => {
          const r = aggregateProgress(progress, p);
          progress = r.state;
          ctx.postMessage({ id: m.id, progress: r.report });
        },
      });
      ctx.postMessage({ id: m.id, ok: true, backend });
      return;
    }
    if (!model) throw new Error('model not loaded');
    const r = await model.transcribe(m.pcm, 16000, { returnTimestamps: true, returnConfidences: true, timeOffset: m.offsetMs / 1000 });
    const words = r.words.map((w) => ({
      text: w.text,
      startMs: Math.round(w.start_time * 1000),
      endMs: Math.round(w.end_time * 1000),
      ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
    }));
    ctx.postMessage({ id: m.id, ok: true, words });
  } catch (err) {
    ctx.postMessage({ id: m.id, ok: false, error: (err as Error).message });
  }
};
