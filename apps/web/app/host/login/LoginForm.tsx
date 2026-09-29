'use client';

import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await fetch('/api/host/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password, next }) });
          const body = (await res.json()) as { next?: string; error?: string };
          if (!res.ok) return setError(body.error ?? 'Sign-in failed.');
          window.location.assign(body.next ?? '/host');
        } catch {
          setError('Could not reach the server. Check the connection and try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm text-ink-2" htmlFor="pw">Host password</label>
      <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
        className="min-h-11 w-full rounded-[3px] border border-border bg-surface px-3 py-2 text-[16px] focus:border-focus" />
      {error && <p role="alert" className="text-sm text-ink">{error}</p>}
      <button type="submit" disabled={busy} className="min-h-11 rounded border border-border-2 px-4 text-[15px] hover:bg-field-deep disabled:opacity-50">
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  );
}
