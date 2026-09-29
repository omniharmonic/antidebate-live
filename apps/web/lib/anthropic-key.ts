/**
 * The host's Anthropic key (spec §4). Stored only in this browser; sent only to
 * api.anthropic.com. Never included in a request to our server or in a log.
 */
import Anthropic from '@anthropic-ai/sdk';
import { passConfig } from '@adl/llm/browser';

const STORAGE = 'adl.anthropicKey';
const UNREACHABLE = "The browser couldn't reach Anthropic. Check the internet connection and try again.";

export function getKey(): string | null {
  try { return window.localStorage.getItem(STORAGE); } catch { return null; }
}
export function setKey(k: string): void {
  try { window.localStorage.setItem(STORAGE, k.trim()); } catch { /* private mode: key lives for this page only */ }
}
export function forgetKey(): void {
  try { window.localStorage.removeItem(STORAGE); } catch { /* nothing stored */ }
}
export function maskKey(k: string): string {
  return `sk-ant-…${k.slice(-4)}`;
}

export function keyMessage(status: number | null, body: unknown): string {
  const text = JSON.stringify(body ?? '').toLowerCase();
  if (status === null) return UNREACHABLE;
  if (status === 401 || status === 403) return "That key wasn't accepted. Copy it again from console.anthropic.com → API keys.";
  if (status === 400 && text.includes('credit')) return 'The account has no credit yet. Add credits under Billing, then check again.';
  if (status === 429) return 'Anthropic is rate-limiting this key. New accounts start with low limits; wait a minute and check again.';
  if (status >= 500) return 'Anthropic is having trouble right now. Try again in a few minutes.';
  return `Anthropic refused the check (${status}).`;
}

/** One 1-token request to the default model: proves the key, the credit and browser access. */
export async function checkKey(key: string, f?: typeof fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  const k = key.trim();
  if (!k.startsWith('sk-ant-')) return { ok: false, message: 'Anthropic keys start with sk-ant-. Check that the whole key was pasted.' };
  const client = new Anthropic({ apiKey: k, dangerouslyAllowBrowser: true, maxRetries: 0, ...(f ? { fetch: f } : {}) });
  try {
    await client.messages.create({ model: passConfig('L1_extract').model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] });
    return { ok: true };
  } catch (e) {
    const err = e as { status?: number; error?: unknown };
    return { ok: false, message: keyMessage(typeof err.status === 'number' ? err.status : null, err.error) };
  }
}
