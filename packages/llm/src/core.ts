/**
 * Shared types and the transport seam. `callStructured` delegates to whichever
 * Caller is installed: the Node entry installs `nodeCaller` (cache, budget ledger,
 * subscription/API); the browser entry uses `browserCaller` on the host's own key.
 * No node:* imports here: this file is bundled into client code.
 */
import type { z } from 'zod';
import type { Pass } from './models';

export type Provider = 'subscription' | 'api' | 'cache' | 'browser';

export interface LlmCallLog {
  pass: Pass;
  promptVersion: string;
  model: string;
  effort: string;
  provider: Provider;
  cached: boolean;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  latencyMs: number;
  stopReason: string | null;
  /** Dollars billed to the API account (0 for subscription and cache hits). */
  billedUsd: number;
  sessionId?: string;
}

export type LlmResult<T> =
  | { ok: true; data: T; log: LlmCallLog }
  | { ok: false; reason: 'refusal' | 'parse_error' | 'max_tokens' | 'provider_error' | 'budget' | 'cache_miss'; detail: string; log: LlmCallLog };

export interface StructuredCall<S extends z.ZodType> {
  pass: Pass;
  promptVersion: string;
  /** Frozen per pass + prompt version. Must not contain timestamps or per-call data. */
  instructions: string;
  /** Session context (e.g. a bounded proposition index). Sent with the input. */
  sessionContext?: string;
  input: string;
  schema: S;
  sessionId?: string;
}

export type LogSink = (log: LlmCallLog) => void | Promise<void>;
let sink: LogSink = () => {};
export function setLlmLogSink(s: LogSink): void {
  sink = s;
}

export type Caller = (call: StructuredCall<z.ZodType>) => Promise<LlmResult<unknown>>;
let caller: Caller | null = null;
export function setCaller(c: Caller): void {
  caller = c;
}
export async function emitLog(l: LlmCallLog): Promise<void> {
  await sink(l);
}
export async function callStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<LlmResult<z.infer<S>>> {
  if (!caller) {
    const log = { pass: call.pass, promptVersion: call.promptVersion, model: '', effort: '', provider: 'browser', cached: false, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, latencyMs: 0, stopReason: null, billedUsd: 0 } as LlmCallLog;
    return { ok: false, reason: 'provider_error', detail: 'No Anthropic key is set on this device.', log };
  }
  const r = await caller(call as StructuredCall<z.ZodType>);
  if (!r.ok) return r;
  const parsed = call.schema.safeParse(r.data);
  return parsed.success ? { ok: true, data: parsed.data, log: r.log } : { ok: false, reason: 'parse_error', detail: parsed.error.message, log: r.log };
}
