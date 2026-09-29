/**
 * Which Parakeet build this laptop downloads (Ruling R12). The fp32 encoder is about 2.4 GB,
 * so it is never used: WebGPU with 16-bit shaders (`shader-f16`) runs the fp16 encoder;
 * anything else runs the int8 encoder on WASM. The decoder is int8 either way.
 */
export const MODEL_REPO = 'ysdede/parakeet-tdt-0.6b-v3-onnx';

/** File sizes in bytes, from the Hugging Face file list of MODEL_REPO (main, 2026-09-29). */
const SIZES = {
  'encoder-model.fp16.onnx': 1_238_960_452,
  'encoder-model.int8.onnx': 652_183_999,
  'decoder_joint-model.int8.onnx': 18_202_004,
  'vocab.txt': 102_132,
} as const;

export type AsrVariant = {
  backend: 'webgpu' | 'wasm';
  encoderQuant: 'fp16' | 'int8';
  decoderQuant: 'int8';
  /** What parakeet.js downloads for it (the JS preprocessor needs no file). */
  files: (keyof typeof SIZES)[];
  bytes: number;
};

type Gpu = { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> };

function variant(backend: AsrVariant['backend'], encoderQuant: AsrVariant['encoderQuant']): AsrVariant {
  const files: AsrVariant['files'] = [`encoder-model.${encoderQuant}.onnx`, 'decoder_joint-model.int8.onnx', 'vocab.txt'];
  return { backend, encoderQuant, decoderQuant: 'int8', files, bytes: files.reduce((n, f) => n + SIZES[f], 0) };
}

/** `gpu` is `navigator.gpu` (window or worker), absent without WebGPU. */
export async function chooseVariant(gpu: Gpu | undefined): Promise<AsrVariant> {
  try {
    const adapter = await gpu?.requestAdapter();
    if (adapter?.features.has('shader-f16')) return variant('webgpu', 'fp16');
  } catch {
    // WebGPU present but refused: WASM still works
  }
  return variant('wasm', 'int8');
}

export function sizeLabel(bytes: number): string {
  return bytes >= 1e9 ? `about ${(bytes / 1e9).toFixed(1)} GB` : `about ${Math.round(bytes / 1e7) * 10} MB`;
}

/** Whether parakeet.js's IndexedDB cache (keys `hf-<repo>-main--<file>`) holds every file of this variant. */
export function isCached(v: AsrVariant, keys: readonly string[]): boolean {
  const have = new Set(keys);
  return v.files.every((f) => have.has(`hf-${MODEL_REPO}-main--${f}`));
}
