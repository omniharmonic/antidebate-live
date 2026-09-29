import { describe, expect, it } from 'vitest';
import { checkKey, keyMessage, maskKey } from './anthropic-key';

const resp = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('keyMessage', () => {
  it('names each failure plainly', () => {
    expect(keyMessage(401, {})).toBe("That key wasn't accepted. Copy it again from console.anthropic.com → API keys.");
    expect(keyMessage(400, { error: { message: 'Your credit balance is too low to access the Anthropic API.' } })).toBe('The account has no credit yet. Add credits under Billing, then check again.');
    expect(keyMessage(429, {})).toBe('Anthropic is rate-limiting this key. New accounts start with low limits; wait a minute and check again.');
    expect(keyMessage(null, null)).toBe("The browser couldn't reach Anthropic. Check the internet connection and try again.");
  });
});

describe('checkKey', () => {
  it('passes on a 200', async () => {
    expect(await checkKey('sk-ant-x', resp(200, { content: [], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'max_tokens', model: 'claude-sonnet-5-5', role: 'assistant', type: 'message', id: 'm' }))).toEqual({ ok: true });
  });
  it('treats a network failure as unreachable, not as a bad key', async () => {
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const r = await checkKey('sk-ant-x', offline);
    expect(r).toEqual({ ok: false, message: "The browser couldn't reach Anthropic. Check the internet connection and try again." });
  });
  it('rejects text that is not an Anthropic key before any request', async () => {
    expect(await checkKey('hello', resp(200, {}))).toEqual({ ok: false, message: 'Anthropic keys start with sk-ant-. Check that the whole key was pasted.' });
  });
});

describe('maskKey', () => {
  it('shows only the last four characters', () => expect(maskKey('sk-ant-api03-abcdefWXYZ')).toBe('sk-ant-…WXYZ'));
});
