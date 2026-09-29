import { describe, expect, it } from 'vitest';
import { unansweredRequest } from './unanswered';

describe('unansweredRequest', () => {
  it('counts per-turn passes that got no answer from Anthropic', () => {
    expect(unansweredRequest('L1 s:t0003: provider_error: Anthropic returned 529')).toBe(true);
    expect(unansweredRequest('L2 s:t0003: provider_error: The browser could not reach Anthropic')).toBe(true);
  });
  it('ignores answers the pipeline rejected and progress lines', () => {
    expect(unansweredRequest('L1 s:t0003: parse_error: Invalid JSON')).toBe(false);
    expect(unansweredRequest('L1 s:t0003: refusal: The model declined this input.')).toBe(false);
    expect(unansweredRequest('L4: provider_error: Anthropic returned 529')).toBe(false);
    expect(unansweredRequest('s:t0003 A 1.2m · L1+L2 4.1s · +2 approved, 0 rejected')).toBe(false);
  });
});
