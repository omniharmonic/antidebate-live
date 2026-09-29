import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { browserCaller } from './browser';

/** The client streams (`.stream().finalMessage()`), so a 200 must be a server-sent event stream. */
function sse(m: ReturnType<typeof msg>): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const text = m.content[0]!.text;
  return [
    ev('message_start', { message: { ...m, content: [] } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: m.usage }),
    ev('message_stop', {}),
  ].join('');
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (status !== 200) return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    return new Response(sse(body as ReturnType<typeof msg>), { status, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const msg = (text: string) => ({
  id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

describe('browserCaller', () => {
  it('calls Anthropic directly with the browser header and the pass model', async () => {
    const { f, calls } = fakeFetch(200, msg('{"n":2}'));
    const r = await browserCaller('sk-ant-test', { fetch: f })({ pass: 'L2_critic', promptVersion: 'v', instructions: 'sys', input: 'in', schema: z.object({ n: z.number() }) });
    expect(r).toMatchObject({ ok: true, data: { n: 2 }, log: { provider: 'browser', model: 'claude-sonnet-5-5' } });
    expect(calls[0]!.url).toContain('api.anthropic.com/v1/messages');
    const h = new Headers(calls[0]!.init.headers);
    expect(h.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(h.get('x-api-key')).toBe('sk-ant-test');
  });
  it('maps a 401 to provider_error without echoing the key', async () => {
    const { f } = fakeFetch(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const r = await browserCaller('sk-ant-secret', { fetch: f })({ pass: 'L1_extract', promptVersion: 'v', instructions: 's', input: 'i', schema: z.object({}) });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('sk-ant-secret');
  });
});
