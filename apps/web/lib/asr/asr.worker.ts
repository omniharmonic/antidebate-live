import { fromHub } from 'parakeet.js';
import { classifyLoadError } from './load-error';
import { aggregateProgress, emptyProgress } from './progress';
import type { AsrVariant } from './variant';

type Req = { id: number; kind: 'load'; variant: AsrVariant } | { id: number; kind: 'transcribe'; pcm: Float32Array; offsetMs: number };

// The DOM lib is on for this package, so type the worker global by hand rather than pulling in the webworker lib.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage(msg: unknown): void;
};

let model: Awaited<ReturnType<typeof fromHub>> | null = null;

ctx.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.kind === 'load') {
      // Chosen on the page (variant.ts): int8 on WASM.
      const { backend, encoderQuant, decoderQuant } = m.variant;
      let progress = emptyProgress();
      model = await fromHub('parakeet-tdt-0.6b-v3', {
        backend,
        encoderQuant,
        decoderQuant,
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
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ id: m.id, ok: false, error: message, ...(m.kind === 'load' ? { errorKind: classifyLoadError(err) } : {}) });
  }
};
