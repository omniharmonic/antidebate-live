import { describe, expect, it } from 'vitest';
import { toIso } from './index';

describe('toIso', () => {
  it('normalizes Postgres timestamptz text to ISO 8601', () => {
    expect(toIso('2026-09-29 02:12:40.603+00')).toBe('2026-09-29T02:12:40.603Z');
    expect(toIso('2026-09-29 02:12:40+05:30')).toBe('2026-09-28T20:42:40.000Z');
  });
  it('passes ISO through', () => {
    expect(toIso('2026-09-29T02:12:40.603Z')).toBe('2026-09-29T02:12:40.603Z');
  });
});
