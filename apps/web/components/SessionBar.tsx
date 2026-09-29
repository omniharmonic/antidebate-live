'use client';

/**
 * Session shell (DIRECTION §6). Role navigation: Explore / Facilitate / Operate.
 * Inside Explore, one lens bar: Spatial / Timeline / Positions. Lens links carry
 * the playhead and selection so the reader keeps their place.
 */
import Link from 'next/link';
import { usePlayhead } from '@/lib/session-context';
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
  const ph = usePlayhead();
  const lensQuery = query || ph.query;
  const base = `/s/${encodeURIComponent(meta.sessionId)}`;
  const role = roleOf(current);
  const debaters = meta.sides.filter(Boolean);
  return (
    <header className="shrink-0 border-b border-border bg-field">
      <div className="session-heading">
        <Wordmark />

        <div className="session-identity">
          <p className="truncate text-[15px] font-medium text-ink" title={meta.title}>
            {meta.title}
          </p>
          <p className="hidden shrink-0 items-center gap-4 text-[13px] text-ink-2 2xl:flex">
            {debaters.map((p) => (
              <span key={p!.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: VOICE_VAR[p!.voice] }} />
                {p!.displayName}
              </span>
            ))}
          </p>
        </div>
        <span className="session-status hidden text-[12px] xl:inline">
          <StatusDot status={status} />
        </span>
        <nav aria-label="Role" className="session-roles">
          {ROLES.map((r) => {
            const on = r.id === role;
            return (
              <Link
                key={r.id}
                href={`${base}/${r.id === 'explore' && role === 'explore' ? current : r.href}${r.id === 'explore' ? lensQuery : ''}`}
                onClick={() => { if (r.id !== role) ph.pause(); }}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center justify-center border-b-2 px-2 text-[12px] sm:px-3 sm:text-[14px] ${on ? 'border-voice-a text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
              >
                {r.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {status !== 'open' ? <div className="border-t border-border px-4 py-2 text-[12px] xl:hidden"><StatusDot status={status} /></div> : null}
      {role === 'explore' ? (
        <div className="flex min-h-11 items-stretch gap-3 border-t border-border px-4 md:px-6">
          <nav aria-label="Lens" className="flex shrink-0 items-stretch gap-5">
            {LENSES.map((l) => {
              const on = l.id === current;
              return (
                <Link
                  key={l.id}
                  href={`${base}/${l.id}${lensQuery}`}
                  aria-current={on ? 'page' : undefined}
                  className={`-mb-px flex items-center border-b-2 text-[14px] ${on ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="lens-context ml-auto flex min-w-0 items-center gap-4 text-[12px] sm:text-[13px]">{children}</div>
        </div>
      ) : null}
    </header>
  );
}
