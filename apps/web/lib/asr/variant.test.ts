import { describe, expect, it } from 'vitest';
import { chooseVariant, isCached, sizeLabel } from './variant';

const gpu = (features: string[] | null) => ({ requestAdapter: async () => (features ? { features: new Set(features) } : null) });

describe('chooseVariant', () => {
  it('uses the fp16 encoder on WebGPU when the adapter has shader-f16', async () => {
    expect(await chooseVariant(gpu(['shader-f16']))).toMatchObject({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'int8' });
  });
  it('falls back to int8 on WASM without shader-f16, without an adapter, or without WebGPU', async () => {
    for (const g of [gpu([]), gpu(null), undefined, { requestAdapter: async () => { throw new Error('blocked'); } }]) {
      expect(await chooseVariant(g)).toMatchObject({ backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8' });
    }
  });
  it('counts the bytes of the files that variant downloads (measured from the model repo)', async () => {
    expect((await chooseVariant(gpu(['shader-f16']))).bytes).toBe(1_238_960_452 + 18_202_004 + 102_132);
    expect((await chooseVariant(undefined)).bytes).toBe(652_183_999 + 18_202_004 + 102_132);
  });
});

describe('sizeLabel', () => {
  it('rounds to what a host needs to know', () => {
    expect(sizeLabel(1_257_264_588)).toBe('about 1.3 GB');
    expect(sizeLabel(670_488_135)).toBe('about 670 MB');
  });
});

describe('isCached', () => {
  it('needs every file of this variant in the parakeet.js cache', async () => {
    const v = await chooseVariant(gpu(['shader-f16']));
    const key = (f: string) => `hf-ysdede/parakeet-tdt-0.6b-v3-onnx-main--${f}`;
    expect(isCached(v, v.files.map(key))).toBe(true);
    // An earlier fp32 download does not count as this variant.
    expect(isCached(v, ['encoder-model.onnx', 'encoder-model.onnx.data', 'decoder_joint-model.int8.onnx', 'vocab.txt'].map(key))).toBe(false);
  });
});
