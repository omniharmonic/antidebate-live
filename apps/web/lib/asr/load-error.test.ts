import { describe, expect, it } from 'vitest';
import { classifyLoadError } from './load-error';

describe('classifyLoadError', () => {
  it('treats fetch and network failures as a download problem', () => {
    expect(classifyLoadError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyLoadError(new Error('NetworkError when attempting to fetch resource.'))).toBe('network');
    expect(classifyLoadError(new Error('Failed to download encoder-model.int8.onnx: 503'))).toBe('network');
    expect(classifyLoadError(new Error('network connection was lost'))).toBe('network');
  });
  it('treats session creation and compile failures as the model not starting', () => {
    expect(classifyLoadError(new Error('std::bad_alloc'))).toBe('load');
    expect(classifyLoadError(new Error('Can\'t create a session. ERROR_CODE: 6'))).toBe('load');
    expect(classifyLoadError('something odd')).toBe('load');
  });
});
