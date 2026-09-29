/**
 * Structured calls to Claude for every pipeline pass.
 *
 * Providers (env LLM_PROVIDER):
 *   subscription (default) — headless Claude Code (`claude -p`) on the operator's
 *       Claude subscription. ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are removed from
 *       the child's environment so it can never fall back to billing the API.
 *   api — the Anthropic API. Refuses to run without LLM_API_BUDGET_USD, and stops
 *       once the persistent spend ledger reaches it.
 *   cache — replay only: a cache miss is an error. Free, deterministic.
 * Every successful response is cached by a hash of the full request, so rerunning
 * the same inputs costs nothing on any provider.
 *
 * API layout for prompt caching (prefix match: tools → system → messages):
 *   system[0] frozen pass instructions ← cached;  messages: the new input.
 * Refusals: server-side fallback in "default" mode (beta server-side-fallback-2026-07-01).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { emitLog, type Caller, type LlmCallLog, type LlmResult, type Provider, type StructuredCall } from './core';
import { costUsd, passConfig } from './models';

const CACHE_DIR = fileURLToPath(new URL('../../../.cache/llm/', import.meta.url));
const LEDGER = `${CACHE_DIR}api-spend.json`;

export function provider(): Provider {
  const p = (process.env.LLM_PROVIDER ?? 'subscription').toLowerCase();
  if (p === 'api' || p === 'cache' || p === 'subscription') return p;
  throw new Error(`LLM_PROVIDER must be subscription, api or cache (got ${p})`);
}

/** JSON Schema for a zod schema, without the `$schema` draft header (the CLI validator rejects it). */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

// ---------- cache ----------

function cacheKey(call: StructuredCall<z.ZodType>, model: string, effort: string): string {
  const schema = JSON.stringify(jsonSchema(call.schema));
  return createHash('sha256')
    .update(JSON.stringify([model, effort, call.pass, call.promptVersion, call.instructions, call.sessionContext ?? '', call.input, schema]))
    .digest('hex');
}

function readCache(key: string): unknown | undefined {
  const f = `${CACHE_DIR}${key}.json`;
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { data: unknown }).data : undefined;
}

function writeCache(key: string, data: unknown, meta: object) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(`${CACHE_DIR}${key}.json`, JSON.stringify({ ...meta, data }));
}

// ---------- API budget ----------

export function apiSpentUsd(): number {
  return existsSync(LEDGER) ? (JSON.parse(readFileSync(LEDGER, 'utf8')) as { usd: number }).usd : 0;
}

function addApiSpend(usd: number) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(LEDGER, JSON.stringify({ usd: apiSpentUsd() + usd, updated: new Date().toISOString() }));
}

// ---------- providers ----------

let client: Anthropic | null = null;

interface Raw {
  data?: unknown;
  error?: { reason: 'refusal' | 'max_tokens' | 'parse_error' | 'provider_error'; detail: string };
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number };
  stopReason: string | null;
  model: string;
}

async function viaApi(call: StructuredCall<z.ZodType>, cfg: ReturnType<typeof passConfig>): Promise<Raw> {
  client ??= new Anthropic();
  const response = await client.beta.messages
    .stream({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: cfg.effort, format: zodOutputFormat(call.schema) },
      system: [{ type: 'text', text: call.instructions, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: call.sessionContext ? `${call.sessionContext}\n\n${call.input}` : call.input }],
    })
    .finalMessage();
  const u = response.usage;
  const usage = { input: u.input_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens };
  const base = { usage, stopReason: response.stop_reason, model: response.model };
  if (response.stop_reason === 'refusal') return { ...base, error: { reason: 'refusal', detail: JSON.stringify(response.stop_details ?? null) } };
  if (response.stop_reason === 'max_tokens') return { ...base, error: { reason: 'max_tokens', detail: 'Output truncated' } };
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  try {
    return { ...base, data: JSON.parse(text) };
  } catch (e) {
    return { ...base, error: { reason: 'parse_error', detail: `Invalid JSON: ${(e as Error).message}` } };
  }
}

/** Claude Code CLI aliases; full ids also work. */
const CLI_MODEL: Record<string, string> = { 'claude-sonnet-5-5': 'sonnet', 'claude-opus-5-5': 'opus' };
const CLI_WORKDIR = `${tmpdir()}/adl-llm`;
let running = 0;
const waiters: Array<() => void> = [];
const CLI_CONCURRENCY = Number(process.env.LLM_SUBSCRIPTION_CONCURRENCY ?? 2);

async function viaSubscription(call: StructuredCall<z.ZodType>, cfg: ReturnType<typeof passConfig>): Promise<Raw> {
  while (running >= CLI_CONCURRENCY) await new Promise<void>((r) => waiters.push(r));
  running += 1;
  try {
    mkdirSync(CLI_WORKDIR, { recursive: true });
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // never bill the API from the subscription path
    delete env.ANTHROPIC_AUTH_TOKEN;
    const args = [
      '-p',
      '--output-format', 'json',
      '--model', CLI_MODEL[cfg.model] ?? cfg.model,
      '--effort', cfg.effort,
      '--tools', '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--system-prompt', call.instructions,
      '--json-schema', JSON.stringify(jsonSchema(call.schema)),
    ];
    const prompt = call.sessionContext ? `${call.sessionContext}\n\n${call.input}` : call.input;
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { cwd: CLI_WORKDIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), Number(process.env.LLM_SUBSCRIPTION_TIMEOUT_MS ?? 300_000));
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`claude -p exited ${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`));
      });
      child.stdin.end(prompt);
    });
    const res = JSON.parse(out) as {
      is_error?: boolean;
      result?: string;
      structured_output?: unknown;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      modelUsage?: Record<string, unknown>;
    };
    const usage = {
      input: res.usage?.input_tokens ?? 0,
      cacheRead: res.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: res.usage?.cache_creation_input_tokens ?? 0,
      output: res.usage?.output_tokens ?? 0,
    };
    const model = Object.keys(res.modelUsage ?? {})[0] ?? cfg.model;
    if (res.is_error) return { usage, stopReason: res.stop_reason ?? null, model, error: { reason: 'provider_error', detail: (res.result ?? '').slice(0, 500) } };
    if (res.structured_output !== undefined) return { usage, stopReason: res.stop_reason ?? null, model, data: res.structured_output };
    try {
      return { usage, stopReason: res.stop_reason ?? null, model, data: JSON.parse(res.result ?? '') };
    } catch (e) {
      return { usage, stopReason: res.stop_reason ?? null, model, error: { reason: 'parse_error', detail: `No structured output: ${(e as Error).message}` } };
    }
  } finally {
    running -= 1;
    waiters.shift()?.();
  }
}

export const nodeCaller: Caller = async (call) => {
  const cfg = passConfig(call.pass);
  const prov = provider();
  const key = cacheKey(call, cfg.model, cfg.effort);
  const started = Date.now();
  const log = (over: Partial<LlmCallLog>): LlmCallLog => ({
    pass: call.pass,
    promptVersion: call.promptVersion,
    model: cfg.model,
    effort: cfg.effort,
    provider: prov,
    cached: false,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    latencyMs: Date.now() - started,
    stopReason: null,
    billedUsd: 0,
    ...(call.sessionId ? { sessionId: call.sessionId } : {}),
    ...over,
  });

  const hit = readCache(key);
  if (hit !== undefined) {
    const parsed = call.schema.safeParse(hit);
    if (parsed.success) {
      const l = log({ cached: true });
      await emitLog(l);
      return { ok: true, data: parsed.data, log: l };
    }
  }
  if (prov === 'cache') {
    const l = log({});
    await emitLog(l);
    return { ok: false, reason: 'cache_miss', detail: `No cached response for ${call.pass} (LLM_PROVIDER=cache)`, log: l };
  }
  if (prov === 'api') {
    const budget = Number(process.env.LLM_API_BUDGET_USD);
    if (!Number.isFinite(budget) || budget <= 0) throw new Error('LLM_PROVIDER=api requires LLM_API_BUDGET_USD (a hard cap in dollars)');
    if (apiSpentUsd() >= budget) {
      const l = log({});
      await emitLog(l);
      return { ok: false, reason: 'budget', detail: `API budget $${budget} reached ($${apiSpentUsd().toFixed(2)} spent); see .cache/llm/api-spend.json`, log: l };
    }
  }

  let raw: Raw;
  try {
    raw = prov === 'api' ? await viaApi(call, cfg) : await viaSubscription(call, cfg);
  } catch (e) {
    const l = log({});
    await emitLog(l);
    return { ok: false, reason: 'provider_error', detail: (e as Error).message, log: l };
  }
  const billedUsd = prov === 'api' ? costUsd(cfg.model, raw.usage) : 0;
  if (billedUsd) addApiSpend(billedUsd);
  const l = log({
    model: raw.model,
    inputTokens: raw.usage.input,
    cacheReadTokens: raw.usage.cacheRead,
    cacheCreationTokens: raw.usage.cacheWrite,
    outputTokens: raw.usage.output,
    stopReason: raw.stopReason,
    billedUsd,
  });
  await emitLog(l);
  if (raw.error) return { ok: false, reason: raw.error.reason, detail: raw.error.detail, log: l };
  const parsed = call.schema.safeParse(raw.data);
  if (!parsed.success) return { ok: false, reason: 'parse_error', detail: parsed.error.message, log: l };
  writeCache(key, parsed.data, { pass: call.pass, promptVersion: call.promptVersion, model: raw.model, provider: prov, at: new Date().toISOString() });
  return { ok: true, data: parsed.data, log: l };
};
