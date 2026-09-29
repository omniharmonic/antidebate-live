import Link from 'next/link';
import { getFormat } from '@adl/core';
import { isActive, listSessions, publicSessions, type SessionSummary } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

function when(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const COLS = 'xl:grid-cols-[minmax(0,1fr)_88px_120px_290px]';

function Row({ s, active }: { s: SessionSummary; active: boolean }) {
  const debaters = s.participants.filter((p) => p.role === 'debater').map((p) => p.displayName);
  const moderators = s.participants.filter((p) => p.role === 'moderator').map((p) => p.displayName);
  const base = `/s/${encodeURIComponent(s.id)}`;
  const role = 'inline-flex h-11 items-center px-2.5 text-[13px] text-ink-3 hover:text-ink';
  const state = active ? 'Live' : s.ended ? (s.source?.kind === 'live' ? 'Ended' : 'Recorded') : s.source?.kind === 'recording' ? 'Recording' : 'Not running';
  return (
    <li className={`grid grid-cols-1 items-center gap-x-5 gap-y-3 border-b border-border py-5 ${COLS}`}>
      <div className="min-w-0">
        <Link href={`${base}/spatial`} className="block text-[17px] font-medium leading-snug text-ink hover:underline hover:decoration-border-2 hover:underline-offset-4">
          {s.title}
        </Link>
        <p className="mt-1.5 text-[14px] text-ink-2">
          {debaters.join(' and ') || 'No debaters listed'}
          {moderators.length ? <span className="text-ink-3"> · moderated by {moderators.join(' and ')}</span> : null}
        </p>
        <p className="mt-1 break-words text-[12px] text-ink-3">
          {getFormat(s.format).name}

        </p>
      </div>
      <p className="text-[13px]">
        <span className={`inline-flex items-center gap-2 ${active ? 'text-ink' : 'text-ink-2'}`}>
          <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: active ? 'var(--voice-a)' : 'var(--ink-ghost)' }} />
          {state}
        </span>
      </p>
      <p className="font-mono text-[12px] text-ink-3 tabular">{when(s.lastActivityAt ?? s.startedAt)}</p>
      <nav aria-label={`Open ${s.title}`} className="flex flex-wrap items-center gap-1">
        <Link href={`${base}/spatial`} className="mr-2 inline-flex h-11 items-center rounded-[3px] border border-border-2 px-4 text-[13px] text-ink hover:bg-field-deep">
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
    <div className={`hidden gap-x-5 border-b border-border pb-2 text-[12px] text-ink-3 xl:grid ${COLS}`} aria-hidden>
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
    sessions = publicSessions(await listSessions());
  } catch (err) {
    console.error('[home] listSessions', err);
    failed = true;
  }
  const active: SessionSummary[] = [];
  // Recordings are replayed several times as the pipeline improves: show one row per
  // recording (its newest non-test run) and keep earlier runs one click away.
  const groups = new Map<string, SessionSummary[]>();
  for (const s of sessions.filter((x) => !isActive(x))) {
    const key = s.source?.fixture ?? s.id;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const isTest = (s: SessionSummary) => /(^|-)test/.test(s.id);
  const past = [...groups.values()]
    .map((runs) => {
      const sorted = [...runs].sort((x, y) => Number(isTest(x)) - Number(isTest(y)) || y.startedAt.localeCompare(x.startedAt));
      return { primary: sorted[0]!, earlier: sorted.slice(1) };
    })
    .sort((x, y) => (y.primary.lastActivityAt ?? y.primary.startedAt).localeCompare(x.primary.lastActivityAt ?? x.primary.startedAt));

  return (
    <main className="min-h-dvh bg-field">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <span className="label-caps !text-[13px] !tracking-[0.24em] text-ink">Anti-Debate</span>
        <Link href="/host" className="text-[13px] text-ink hover:text-ink-2">
          Host a session
        </Link>
      </header>

      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 pb-20 pt-12">
        <h1 className="text-[30px] leading-tight text-ink">Sessions</h1>
        <p className="mt-2 max-w-[62ch] text-[15px] text-ink-2">See where a conversation diverges, what it shares, and how it changes. Open a session to explore the map and its sources.</p>

        {failed ? <p className="mt-10 text-[14px] text-ink-2">Sessions could not be loaded. Try again.</p> : null}

        <section className="mt-12" aria-labelledby="h-past">
          <h2 id="h-past" className="label-caps mb-4 text-ink-3">
            Sessions
          </h2>
          {past.length ? (
            <>
              <Head />
              <ul>
                {past.map(({ primary, earlier }) => (
                  <li key={primary.id} className="list-none">
                    <ul>
                      <Row s={primary} active={false} />
                    </ul>
                    {earlier.length ? (
                      <details className="-mt-2 border-b border-border pb-3 text-[13px] text-ink-3">
                        <summary className="cursor-pointer py-3 hover:text-ink">Earlier runs ({earlier.length})</summary>
                        <ul className="mt-1 space-y-1 pl-4">
                          {earlier.map((r) => (
                            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <Link href={`/s/${encodeURIComponent(r.id)}/spatial`} className="break-all py-2 font-mono text-[12px] hover:text-ink">
                                {r.id}
                              </Link>
                              <span className="font-mono text-[12px]">{when(r.lastActivityAt ?? r.startedAt)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="border-y border-border py-5 text-[14px] text-ink-3">No finished sessions yet. Host a session to map your first conversation.</p>
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
