import { describe, expect, it } from 'vitest';
import { ASR_VARIANT, isCached, sizeLabel } from './variant';

describe('ASR_VARIANT', () => {
  it('is int8 on WASM on every laptop (fp16/WebGPU crashed on session create)', () => {
    expect(ASR_VARIANT).toMatchObject({ backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8' });
  });
  it('counts the bytes of the files it downloads (measured from the model repo)', () => {
    expect(ASR_VARIANT.bytes).toBe(652_183_999 + 18_202_004 + 102_132);
    expect(sizeLabel(ASR_VARIANT.bytes)).toBe('about 670 MB');
  });
});

describe('sizeLabel', () => {
  it('rounds to what a host needs to know', () => {
    expect(sizeLabel(1_257_264_588)).toBe('about 1.3 GB');
    expect(sizeLabel(670_488_135)).toBe('about 670 MB');
  });
});

describe('isCached', () => {
  const key = (f: string) => `hf-ysdede/parakeet-tdt-0.6b-v3-onnx-main--${f}`;
  it('needs every file of the variant', () => {
    expect(isCached(ASR_VARIANT, ASR_VARIANT.files.map(key))).toBe(true);
    expect(isCached(ASR_VARIANT, ASR_VARIANT.files.slice(1).map(key))).toBe(false);
    expect(isCached(ASR_VARIANT, ['encoder-model.onnx', 'encoder-model.onnx.data', 'decoder_joint-model.int8.onnx', 'vocab.txt'].map(key))).toBe(false);
  });
});
