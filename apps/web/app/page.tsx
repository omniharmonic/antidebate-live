import Link from 'next/link';
import { getFormat } from '@adl/core';
import { isActive, listSessions, type SessionSummary } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

function when(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Row({ s, active }: { s: SessionSummary; active: boolean }) {
  const debaters = s.participants.filter((p) => p.role === 'debater').map((p) => p.displayName);
  const moderator = s.participants.find((p) => p.role === 'moderator')?.displayName;
  const base = `/s/${encodeURIComponent(s.id)}`;
  const link = 'rounded px-2.5 py-1 text-ink-2 hover:bg-field-deep hover:text-ink';
  return (
    <li className="grid gap-x-8 gap-y-2 py-5 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <Link href={`${base}/arc`} className="font-display text-[24px] leading-tight hover:underline hover:decoration-border-2 hover:underline-offset-4">
          {s.title}
        </Link>
        <p className="mt-1 text-sm text-ink-2">
          {debaters.join(' and ')}
          {moderator ? <span className="text-ink-3">, moderated by {moderator}</span> : null}
        </p>
        <p className="mt-1 text-xs text-ink-3">
          {getFormat(s.format).name}
          {s.source?.kind === 'live' ? ', live room' : s.source?.kind === 'recording' ? ', recording' : ''}
          {' · '}
          {active ? `updated ${when(s.lastActivityAt)}` : `started ${when(s.startedAt)}`}
          {s.eventCount !== undefined ? ` · ${s.eventCount.toLocaleString('en-US')} events` : ''}
          {s.ended ? ' · ended' : ''}
          <span className="ml-2 font-mono">{s.id}</span>
        </p>
      </div>
      <nav aria-label={`Open ${s.title}`} className="flex items-start gap-1 text-sm md:pt-1">
        <Link href={`${base}/cockpit`} className={link}>
          Cockpit
        </Link>
        <Link href={`${base}/arc`} className={link}>
          Arc
        </Link>
        <Link href={`${base}/console`} className={link}>
          Console
        </Link>
      </nav>
    </li>
  );
}

export default async function Home() {
  let sessions: SessionSummary[] = [];
  let failed = false;
  try {
    sessions = await listSessions();
  } catch (err) {
    console.error('[home] listSessions', err);
    failed = true;
  }
  const active = sessions.filter((s) => isActive(s));
  const past = sessions.filter((s) => !isActive(s));

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-[52px] leading-none">Anti-Debate Live</h1>
          <p className="mt-3 max-w-prose text-ink-2">Each session opens as a facilitator cockpit, an arc of the whole conversation, or the operator console.</p>
        </div>
        <Link href="/new" className="rounded border border-ink-3 px-4 py-2 text-sm hover:bg-field-deep">
          Start a session
        </Link>
      </div>

      {failed ? <p className="mt-10 text-sm text-ink-2">Could not read the session list. Check DATABASE_URL or the .data directory.</p> : null}

      <section className="mt-12" aria-labelledby="h-active">
        <h2 id="h-active" className="flex items-center gap-2 font-sans text-sm font-medium text-ink-2">
          {active.length ? <span aria-hidden className="live-dot inline-block size-2 rounded-full bg-ink-2" /> : null}
          In progress
        </h2>
        {active.length ? (
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {active.map((s) => (
              <Row key={s.id} s={s} active />
            ))}
          </ul>
        ) : (
          <p className="mt-2 border-y border-border py-5 text-sm text-ink-3">Nothing is running. A session shows here while its log is growing.</p>
        )}
      </section>

      <section className="mt-12" aria-labelledby="h-past">
        <h2 id="h-past" className="font-sans text-sm font-medium text-ink-2">
          Recorded and earlier
        </h2>
        {past.length ? (
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {past.map((s) => (
              <Row key={s.id} s={s} active={false} />
            ))}
          </ul>
        ) : (
          <p className="mt-2 border-y border-border py-5 text-sm text-ink-3">No sessions yet. Start one, or replay a recording with the worker.</p>
        )}
      </section>

      <p className="mt-16 text-xs text-ink-3">
        Also: <Link href="/stage/stage" className="underline decoration-border underline-offset-2 hover:text-ink">stage output</Link> (audience-filtered),{' '}
        <Link href="/play/dt" className="underline decoration-border underline-offset-2 hover:text-ink">playback skeleton</Link>.
      </p>
    </main>
  );
}
