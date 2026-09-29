import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { callStructured, setCaller } from './core';

describe('callStructured seam', () => {
  it('delegates to the installed caller and validates with the schema', async () => {
    setCaller(async (c) => ({ ok: true, data: { n: 1 }, log: { pass: c.pass } as never }));
    const r = await callStructured({ pass: 'L1_extract', promptVersion: 'v', instructions: 'i', input: 'x', schema: z.object({ n: z.number() }) });
    expect(r).toMatchObject({ ok: true, data: { n: 1 } });
  });

  it('returns provider_error when no caller is installed', async () => {
    vi.resetModules();
    const fresh = await import('./core');
    const r = await fresh.callStructured({ pass: 'L1_extract', promptVersion: 'v', instructions: 'i', input: 'x', schema: z.object({ n: z.number() }) });
    expect(r).toMatchObject({ ok: false, reason: 'provider_error', detail: 'No Anthropic key is set on this device.' });
  });

  it('returns parse_error when the caller data fails the schema', async () => {
    setCaller(async (c) => ({ ok: true, data: { n: 'nope' }, log: { pass: c.pass } as never }));
    const r = await callStructured({ pass: 'L1_extract', promptVersion: 'v', instructions: 'i', input: 'x', schema: z.object({ n: z.number() }) });
    expect(r).toMatchObject({ ok: false, reason: 'parse_error' });
  });
});
