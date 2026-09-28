/**
 * Structured calls to Claude for every pipeline pass.
 *
 * Layout for prompt caching (prefix match: tools → system → messages):
 *   system[0]  frozen pass instructions (ontology rules, schema notes)   ← cached
 *   system[1]  append-only session context (proposition index, stores)  ← cached
 *   messages   the new input for this call (turn text, items to judge)
 *
 * Refusals: server-side fallback in "default" mode (beta
 * `server-side-fallback-2026-07-01`). If the whole chain refuses, the item goes
 * to the operator as "needs manual".
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { PASS_CONFIG, type Pass } from './models';

export interface LlmCallLog {
  pass: Pass;
  promptVersion: string;
  model: string;
  effort: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  latencyMs: number;
  stopReason: string | null;
  sessionId?: string;
}

export type LlmResult<T> =
  | { ok: true; data: T; log: LlmCallLog }
  | { ok: false; reason: 'refusal' | 'parse_error' | 'max_tokens'; detail: string; log: LlmCallLog };

export interface StructuredCall<S extends z.ZodType> {
  pass: Pass;
  promptVersion: string;
  /** Frozen per pass + prompt version. Must not contain timestamps or per-call data. */
  instructions: string;
  /** Append-only session context; grows monotonically so the cache prefix survives. */
  sessionContext?: string;
  input: string;
  schema: S;
  sessionId?: string;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY (or an `ant auth login` profile)
  return client;
}

export type LogSink = (log: LlmCallLog) => void | Promise<void>;
let sink: LogSink = () => {};
export function setLlmLogSink(s: LogSink): void {
  sink = s;
}

export async function callStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<LlmResult<z.infer<S>>> {
  const cfg = PASS_CONFIG[call.pass];
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: call.instructions, cache_control: { type: 'ephemeral' } },
  ];
  if (call.sessionContext) system.push({ type: 'text', text: call.sessionContext, cache_control: { type: 'ephemeral' } });

  const started = Date.now();
  const response = await getClient().beta.messages.create({
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: cfg.effort, format: zodOutputFormat(call.schema) },
    system,
    messages: [{ role: 'user', content: call.input }],
  });

  const usage = response.usage;
  const log: LlmCallLog = {
    pass: call.pass,
    promptVersion: call.promptVersion,
    model: response.model,
    effort: cfg.effort,
    inputTokens: usage.input_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
    latencyMs: Date.now() - started,
    stopReason: response.stop_reason,
    ...(call.sessionId ? { sessionId: call.sessionId } : {}),
  };
  await sink(log);

  if (response.stop_reason === 'refusal') {
    return { ok: false, reason: 'refusal', detail: JSON.stringify(response.stop_details ?? null), log };
  }
  if (response.stop_reason === 'max_tokens') {
    return { ok: false, reason: 'max_tokens', detail: 'Output truncated', log };
  }
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: 'parse_error', detail: `Invalid JSON: ${(e as Error).message}`, log };
  }
  const parsed = call.schema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'parse_error', detail: parsed.error.message, log };
  return { ok: true, data: parsed.data, log };
}
