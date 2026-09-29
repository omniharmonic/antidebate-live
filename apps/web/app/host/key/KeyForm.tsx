'use client';

import { useState } from 'react';
import { checkKey, setKey } from '@/lib/anthropic-key';

export function KeyForm() {
  const [value, setValue] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'checking' | 'ok' | 'saved-live' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ kind: 'checking' });
        const r = await checkKey(value);
        if (!r.ok) return setState({ kind: 'error', message: r.message });
        setKey(value);
        const params = new URL(window.location.href).searchParams;
        // Opened in a new tab from a live session: that tab picks up the key; this one stays put.
        if (params.get('from') === 'live') return setState({ kind: 'saved-live' });
        setState({ kind: 'ok' });
        const next = params.get('next');
        window.location.assign(next && next.startsWith('/host') ? next : '/host');
      }}
    >
      <label className="block text-sm text-ink-2" htmlFor="key">Anthropic API key</label>
      <input id="key" type="password" autoComplete="off" spellCheck={false} required value={value} onChange={(e) => setValue(e.target.value)} placeholder="sk-ant-…"
        className="min-h-11 w-full rounded-[3px] border border-border bg-surface px-3 py-2 font-mono text-[15px] focus:border-focus" />
      {state.kind === 'error' && <p role="alert" className="text-sm text-ink">{state.message}</p>}
      {state.kind === 'ok' && <p className="text-sm text-ink-2">Key works. Taking you to your sessions.</p>}
      {state.kind === 'saved-live' && <p role="status" className="text-sm text-ink">Key saved. Return to your session tab.</p>}
      <button type="submit" disabled={state.kind === 'checking'} className="min-h-11 rounded border border-border-2 px-4 text-[15px] hover:bg-field-deep disabled:opacity-50">
        {state.kind === 'checking' ? 'Checking with Anthropic…' : 'Check and save'}
      </button>
    </form>
  );
}
