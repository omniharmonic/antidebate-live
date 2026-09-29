import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callStructured, setCaller } from './core';

describe('callStructured seam', () => {
  it('delegates to the installed caller and validates with the schema', async () => {
    setCaller(async (c) => ({ ok: true, data: { n: 1 }, log: { pass: c.pass } as never }));
    const r = await callStructured({ pass: 'L1_extract', promptVersion: 'v', instructions: 'i', input: 'x', schema: z.object({ n: z.number() }) });
    expect(r).toMatchObject({ ok: true, data: { n: 1 } });
  });
});
