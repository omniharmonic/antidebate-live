/**
 * Browser transport (spec §7): the host's own key, straight from their tab to
 * api.anthropic.com. Same models, effort, output format and log shape as the API path.
 * The key is never logged or included in an error.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { emitLog, type Caller, type LlmCallLog, type StructuredCall } from './core';
import { costUsd, passConfig } from './models';

export function browserCaller(apiKey: string, opts: { fetch?: typeof fetch } = {}): Caller {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  return async (call: StructuredCall<z.ZodType>) => {
    const cfg = passConfig(call.pass);
    const started = Date.now();
    const base: LlmCallLog = { pass: call.pass, promptVersion: call.promptVersion, model: cfg.model, effort: cfg.effort, provider: 'browser', cached: false, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, latencyMs: 0, stopReason: null, billedUsd: 0, ...(call.sessionId ? { sessionId: call.sessionId } : {}) };
    try {
      const r = await client.beta.messages
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
      const u = { input: r.usage.input_tokens, cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0, output: r.usage.output_tokens };
      const log: LlmCallLog = { ...base, model: r.model, inputTokens: u.input, cacheReadTokens: u.cacheRead, cacheCreationTokens: u.cacheWrite, outputTokens: u.output, latencyMs: Date.now() - started, stopReason: r.stop_reason, billedUsd: costUsd(r.model, u) };
      await emitLog(log);
      if (r.stop_reason === 'refusal') return { ok: false, reason: 'refusal', detail: 'The model declined this input.', log };
      if (r.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', detail: 'Output truncated', log };
      const text = r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      try {
        return { ok: true, data: JSON.parse(text) as unknown, log };
      } catch (e) {
        return { ok: false, reason: 'parse_error', detail: `Invalid JSON: ${(e as Error).message}`, log };
      }
    } catch (e) {
      const log = { ...base, latencyMs: Date.now() - started };
      await emitLog(log);
      const status = (e as { status?: number }).status;
      const detail = status ? `Anthropic returned ${status}` : 'The browser could not reach Anthropic';
      return { ok: false, reason: 'provider_error', detail, log };
    }
  };
}
