'use client';

/**
 * Session shell (DIRECTION §6). Role navigation: Explore / Facilitate / Operate.
 * Inside Explore, one lens bar: Spatial / Timeline / Positions. Lens links carry
 * the playhead and selection so the reader keeps their place.
 */
import Link from 'next/link';
import type { SessionMeta } from '@/lib/derive';
import { VOICE_VAR } from '@/lib/derive';
import type { StreamStatus } from '@/lib/use-session';

export type SurfaceId = 'spatial' | 'arc' | 'positions' | 'cockpit' | 'console';

const LENSES = [
  { id: 'spatial', label: 'Spatial' },
  { id: 'arc', label: 'Timeline' },
  { id: 'positions', label: 'Positions' },
] as const;

const ROLES = [
  { id: 'explore', label: 'Explore', href: 'spatial' },
  { id: 'facilitate', label: 'Facilitate', href: 'cockpit' },
  { id: 'operate', label: 'Operate', href: 'console' },
] as const;

const roleOf = (s: SurfaceId) => (s === 'cockpit' ? 'facilitate' : s === 'console' ? 'operate' : 'explore');

export function StatusDot({ status, following }: { status: StreamStatus; following?: boolean }) {
  const label =
    status === 'open' ? (following ? 'Receiving' : 'Connected') : status === 'connecting' ? 'Connecting' : status === 'catching-up' ? 'Catching up. Not yet current.' : 'Reconnecting. Showing the last received state.';
  return (
    <span className="inline-flex items-center gap-2 text-ink-3" role="status" aria-live="polite">
      <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: status === 'open' ? 'var(--ink-2)' : 'var(--insight)' }} />
      {label}
    </span>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="label-caps shrink-0 !text-[13px] !tracking-[0.24em] text-ink hover:text-ink-2" aria-label="Anti-Debate: all sessions">
      Anti-Debate
    </Link>
  );
}

export function SessionBar({
  meta,
  current,
  status,
  query = '',
  children,
}: {
  meta: SessionMeta;
  current: SurfaceId;
  status: StreamStatus;
  /** Carried on lens links (?t=…&sel=…). */
  query?: string;
  /** Right side of the lens bar (time readout, lens controls). */
  children?: React.ReactNode;
}) {
  const base = `/s/${encodeURIComponent(meta.sessionId)}`;
  const role = roleOf(current);
  const debaters = meta.sides.filter(Boolean);
  return (
    <header className="shrink-0 border-b border-border bg-field">
      <div className="flex h-14 items-center gap-5 px-5 md:px-6">
        <Wordmark />
        <span aria-hidden className="h-5 w-px bg-border" />
        <div className="flex min-w-0 flex-1 items-baseline gap-4">
          <p className="truncate text-[15px] font-medium text-ink" title={meta.title}>
            {meta.title}
          </p>
          <p className="hidden shrink-0 items-center gap-4 text-[13px] text-ink-2 lg:flex">
            {debaters.map((p) => (
              <span key={p!.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: VOICE_VAR[p!.voice] }} />
                {p!.displayName}
              </span>
            ))}
          </p>
        </div>
        <span className="hidden text-[13px] md:inline">
          <StatusDot status={status} />
        </span>
        <nav aria-label="Role" className="flex h-full items-stretch gap-1">
          {ROLES.map((r) => {
            const on = r.id === role;
            return (
              <Link
                key={r.id}
                href={`${base}/${r.href}${r.id === 'explore' ? query : ''}`}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center border-b-2 px-3 text-[14px] ${on ? 'border-voice-a text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
              >
                {r.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {role === 'explore' ? (
        <div className="flex h-11 items-stretch gap-6 border-t border-border px-5 md:px-6">
          <nav aria-label="Lens" className="flex items-stretch gap-5">
            {LENSES.map((l) => {
              const on = l.id === current;
              return (
                <Link
                  key={l.id}
                  href={`${base}/${l.id}${query}`}
                  aria-current={on ? 'page' : undefined}
                  className={`-mb-px flex items-center border-b-2 text-[14px] ${on ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-4 text-[13px]">{children}</div>
        </div>
      ) : null}
    </header>
  );
}
