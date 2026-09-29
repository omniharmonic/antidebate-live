import Link from 'next/link';
import { getFormat } from '@adl/core';
import { isActive, listSessions, type SessionSummary } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

function when(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const COLS = 'md:grid-cols-[minmax(0,1fr)_110px_140px_320px]';

function Row({ s, active }: { s: SessionSummary; active: boolean }) {
  const debaters = s.participants.filter((p) => p.role === 'debater').map((p) => p.displayName);
  const moderators = s.participants.filter((p) => p.role === 'moderator').map((p) => p.displayName);
  const base = `/s/${encodeURIComponent(s.id)}`;
  const role = 'inline-flex h-9 items-center px-2.5 text-[13px] text-ink-3 hover:text-ink';
  const state = active ? 'Live' : s.ended ? (s.source?.kind === 'live' ? 'Ended' : 'Recorded') : s.source?.kind === 'recording' ? 'Recording' : 'Not running';
  return (
    <li className={`grid grid-cols-1 items-center gap-x-8 gap-y-3 border-b border-border py-5 ${COLS}`}>
      <div className="min-w-0">
        <Link href={`${base}/spatial`} className="block text-[17px] font-medium leading-snug text-ink hover:underline hover:decoration-border-2 hover:underline-offset-4">
          {s.title}
        </Link>
        <p className="mt-1.5 text-[14px] text-ink-2">
          {debaters.join(' and ') || 'No debaters listed'}
          {moderators.length ? <span className="text-ink-3"> · moderated by {moderators.join(' and ')}</span> : null}
        </p>
        <p className="mt-1 text-[12px] text-ink-3">
          {getFormat(s.format).name}
          <span className="ml-3 font-mono">{s.id}</span>
        </p>
      </div>
      <p className="text-[13px]">
        <span className={`inline-flex items-center gap-2 ${active ? 'text-ink' : 'text-ink-2'}`}>
          <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: active ? 'var(--voice-a)' : 'var(--ink-ghost)' }} />
          {state}
        </span>
      </p>
      <p className="font-mono text-[12px] text-ink-3 tabular">{when(s.lastActivityAt ?? s.startedAt)}</p>
      <nav aria-label={`Open ${s.title}`} className="flex items-center gap-1">
        <Link href={`${base}/spatial`} className="mr-2 inline-flex h-9 items-center rounded-[3px] border border-border-2 px-4 text-[13px] text-ink hover:bg-field-deep">
          Explore
        </Link>
        <Link href={`${base}/arc`} className={role}>
          Timeline
        </Link>
        <Link href={`${base}/cockpit`} className={role}>
          Facilitate
        </Link>
        <Link href={`${base}/console`} className={role}>
          Operate
        </Link>
      </nav>
    </li>
  );
}

function Head() {
  return (
    <div className={`hidden gap-x-8 border-b border-border pb-2 text-[12px] text-ink-3 md:grid ${COLS}`} aria-hidden>
      <span>Conversation</span>
      <span>State</span>
      <span>Last activity</span>
      <span />
    </div>
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
    <main className="min-h-dvh bg-field">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <span className="label-caps !text-[13px] !tracking-[0.24em] text-ink">Anti-Debate</span>
        <Link href="/new" className="inline-flex h-9 items-center rounded-[3px] border border-border-2 px-4 text-[13px] text-ink hover:bg-field-deep">
          Start a session
        </Link>
      </header>

      <div className="mx-auto max-w-6xl px-6 pb-20 pt-12">
        <h1 className="text-[30px] leading-tight text-ink">Sessions</h1>
        <p className="mt-2 max-w-[62ch] text-[15px] text-ink-2">Explore a conversation in space and time, facilitate from the cockpit, or operate the review console.</p>

        {failed ? <p className="mt-10 text-[14px] text-ink-2">Sessions could not be loaded. Try again.</p> : null}

        <section className="mt-12" aria-labelledby="h-active">
          <h2 id="h-active" className="label-caps mb-4 text-ink-3">
            In progress
          </h2>
          {active.length ? (
            <>
              <Head />
              <ul>
                {active.map((s) => (
                  <Row key={s.id} s={s} active />
                ))}
              </ul>
            </>
          ) : (
            <p className="border-y border-border py-5 text-[14px] text-ink-3">Nothing is running. A session shows here while its log is growing.</p>
          )}
        </section>

        <section className="mt-14" aria-labelledby="h-past">
          <h2 id="h-past" className="label-caps mb-4 text-ink-3">
            Recorded and earlier
          </h2>
          {past.length ? (
            <>
              <Head />
              <ul>
                {past.map((s) => (
                  <Row key={s.id} s={s} active={false} />
                ))}
              </ul>
            </>
          ) : (
            <p className="border-y border-border py-5 text-[14px] text-ink-3">No sessions yet. Start one, or replay a recording with the worker.</p>
          )}
        </section>

        <p className="mt-16 text-[12px] text-ink-3">
          Also:{' '}
          <Link href="/stage/stage" className="underline decoration-border-2 underline-offset-2 hover:text-ink">
            stage output
          </Link>{' '}
          (audience-filtered).
        </p>
      </div>
    </main>
  );
}
