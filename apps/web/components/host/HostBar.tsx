'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { forgetKey, getKey, maskKey } from '@/lib/anthropic-key';

/** Top bar for every /host page: who pays (masked key) and how to leave. */
export function HostBar({ children }: { children?: React.ReactNode }) {
  const [key, setKeyState] = useState<string | null>(null);
  useEffect(() => setKeyState(getKey()), []);
  return (
    <header className="flex h-14 items-center gap-5 border-b border-border px-6 text-[14px]">
      <Link href="/host" className="label-caps !text-[13px] !tracking-[0.24em] text-ink">Anti-Debate · Host</Link>
      <div className="flex-1">{children}</div>
      {key ? (
        <span className="text-ink-3">
          Key {maskKey(key)} ·{' '}
          <button className="underline" onClick={() => { forgetKey(); window.location.assign('/host/key'); }}>Forget key</button>
        </span>
      ) : (
        <Link className="underline" href="/host/key">Add your key</Link>
      )}
      <button className="text-ink-3 underline" onClick={async () => { await fetch('/api/host/logout', { method: 'POST' }); window.location.assign('/'); }}>Sign out</button>
    </header>
  );
}
