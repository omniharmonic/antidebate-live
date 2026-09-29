'use client';

import Link from 'next/link';
import type { SessionMeta } from '@/lib/derive';
import { VOICE_VAR } from '@/lib/derive';
import type { StreamStatus } from '@/lib/use-session';

const VIEWS = [
  { id: 'cockpit', label: 'Cockpit' },
  { id: 'arc', label: 'Arc' },
  { id: 'console', label: 'Console' },
] as const;

export function StatusDot({ status, following }: { status: StreamStatus; following?: boolean }) {
  const label = status === 'open' ? (following ? 'Receiving' : 'Connected') : status === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <span className="inline-flex items-center gap-2 text-ink-3" role="status" aria-live="polite">
      <span
        aria-hidden
        className={`inline-block size-2 rounded-full ${status === 'open' ? 'live-dot' : ''}`}
        style={{ background: status === 'open' ? 'var(--ink-2)' : 'var(--ink-ghost)' }}
      />
      {label}
    </span>
  );
}

export function SessionBar({ meta, current, status, children }: { meta: SessionMeta; current: (typeof VIEWS)[number]['id']; status: StreamStatus; children?: React.ReactNode }) {
  const people = meta.people.filter((p) => p.role !== 'audience');
  return (
    <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-border px-6 py-3 text-sm">
      <Link href="/" className="text-ink-3 hover:text-ink" aria-label="All sessions">
        Sessions
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink" title={meta.title}>
          {meta.title}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-4 text-ink-2">
          {people.map((p) => (
            <span key={p.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: VOICE_VAR[p.voice] }} />
              {p.displayName}
            </span>
          ))}
        </p>
      </div>
      {children}
      <StatusDot status={status} />
      <nav aria-label="Views" className="flex gap-1">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={`/s/${encodeURIComponent(meta.sessionId)}/${v.id}`}
            aria-current={v.id === current ? 'page' : undefined}
            className={`rounded px-2.5 py-1 ${v.id === current ? 'bg-field-deep text-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
