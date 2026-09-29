/**
 * The one Parakeet build every laptop downloads and runs (Ruling R13): int8 encoder and decoder
 * on WASM. The fp32 encoder is about 2.4 GB, and the fp16/WebGPU build crashed at session
 * creation (std::bad_alloc), so neither is used. With cross-origin isolation (next.config.ts)
 * ORT's WASM backend runs multi-threaded.
 */
export const MODEL_REPO = 'ysdede/parakeet-tdt-0.6b-v3-onnx';

/** File sizes in bytes, from the Hugging Face file list of MODEL_REPO (main, 2026-09-29). */
const SIZES = {
  'encoder-model.int8.onnx': 652_183_999,
  'decoder_joint-model.int8.onnx': 18_202_004,
  'vocab.txt': 102_132,
} as const;

export type AsrVariant = {
  backend: 'wasm';
  encoderQuant: 'int8';
  decoderQuant: 'int8';
  /** What parakeet.js downloads for it (the JS preprocessor needs no file). */
  files: (keyof typeof SIZES)[];
  bytes: number;
};

const FILES: AsrVariant['files'] = ['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx', 'vocab.txt'];

export const ASR_VARIANT: AsrVariant = {
  backend: 'wasm',
  encoderQuant: 'int8',
  decoderQuant: 'int8',
  files: FILES,
  bytes: FILES.reduce((n, f) => n + SIZES[f], 0),
};

export function sizeLabel(bytes: number): string {
  return bytes >= 1e9 ? `about ${(bytes / 1e9).toFixed(1)} GB` : `about ${Math.round(bytes / 1e7) * 10} MB`;
}

/** Whether parakeet.js's IndexedDB cache (keys `hf-<repo>-main--<file>`) holds every file of this variant. */
export function isCached(v: AsrVariant, keys: readonly string[]): boolean {
  const have = new Set(keys);
  return v.files.every((f) => have.has(`hf-${MODEL_REPO}-main--${f}`));
}
