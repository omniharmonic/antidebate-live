import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callStructured } from './client';

const schema = z.object({ answer: z.string() });
const call = (input: string) => ({ pass: 'round_detect' as const, promptVersion: `test-${Date.now()}-${Math.random()}`, instructions: 'Return JSON.', input, schema });

/** A fake `claude` CLI: fails if it can see an API key, else returns structured output. */
function fakeClaude(): string {
  const dir = mkdtempSync(`${tmpdir()}/fake-claude-`);
  const bin = `${dir}/claude`;
  writeFileSync(
    bin,
    `#!/usr/bin/env node
if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) { console.error('API KEY LEAKED'); process.exit(3); }
let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'result', is_error: false, structured_output: { answer: 'ok:' + input.length }, usage: { input_tokens: 5, output_tokens: 3 }, modelUsage: { 'claude-sonnet-5-5': {} } }));
});`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

describe('LLM providers', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-never-reach-the-child';
    delete process.env.LLM_API_BUDGET_USD;
  });

  it('subscription: strips the API key from the child and bills nothing', async () => {
    process.env.LLM_PROVIDER = 'subscription';
    process.env.CLAUDE_BIN = fakeClaude();
    const r = await callStructured(call('hello'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.answer).toBe('ok:5');
    expect(r.log.billedUsd).toBe(0);
    expect(r.log.provider).toBe('subscription');
  });

  it('caches: the same request is served without calling any provider', async () => {
    process.env.LLM_PROVIDER = 'subscription';
    process.env.CLAUDE_BIN = fakeClaude();
    const c = call('same input');
    await callStructured(c);
    process.env.CLAUDE_BIN = '/nonexistent/claude'; // would fail if called
    const again = await callStructured(c);
    expect(again.ok).toBe(true);
    expect(again.log.cached).toBe(true);
  });

  it('cache provider: a miss is an error, never a call', async () => {
    process.env.LLM_PROVIDER = 'cache';
    const r = await callStructured(call('never seen'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cache_miss');
  });

  it('api provider: refuses to run without a budget', async () => {
    process.env.LLM_PROVIDER = 'api';
    await expect(callStructured(call('x'))).rejects.toThrow(/LLM_API_BUDGET_USD/);
  });
});
