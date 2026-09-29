'use client';

import { useState } from 'react';
import { checkKey, setKey } from '@/lib/anthropic-key';

export function KeyForm() {
  const [value, setValue] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'checking' | 'ok' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ kind: 'checking' });
        const r = await checkKey(value);
        if (!r.ok) return setState({ kind: 'error', message: r.message });
        setKey(value);
        setState({ kind: 'ok' });
        const next = new URL(window.location.href).searchParams.get('next');
        window.location.assign(next && next.startsWith('/host') ? next : '/host');
      }}
    >
      <label className="block text-sm text-ink-2" htmlFor="key">Anthropic API key</label>
      <input id="key" type="password" autoComplete="off" spellCheck={false} required value={value} onChange={(e) => setValue(e.target.value)} placeholder="sk-ant-…"
        className="min-h-11 w-full rounded-[3px] border border-border bg-surface px-3 py-2 font-mono text-[15px] focus:border-focus" />
      {state.kind === 'error' && <p role="alert" className="text-sm text-ink">{state.message}</p>}
      {state.kind === 'ok' && <p className="text-sm text-ink-2">Key works. Taking you to your sessions.</p>}
      <button type="submit" disabled={state.kind === 'checking'} className="min-h-11 rounded border border-border-2 px-4 text-[15px] hover:bg-field-deep disabled:opacity-50">
        {state.kind === 'checking' ? 'Checking with Anthropic…' : 'Check and save'}
      </button>
    </form>
  );
}
