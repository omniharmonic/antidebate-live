'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { HOST_SESSIONS_KEY, parseHostSessions } from '@/lib/recording/host-sessions';
import { KEY_STORAGE } from '@/lib/anthropic-key';
import { useStored } from '@/lib/use-stored';

const action = 'flex min-h-11 items-center rounded border border-border-2 px-4 text-[15px] text-ink hover:bg-field-deep';

export function HostHome() {
  const key = useStored(KEY_STORAGE);
  const raw = useStored(HOST_SESSIONS_KEY);
  const prepared = Boolean(useStored('adl.prepared'));
  const sessions = useMemo(() => parseHostSessions(raw), [raw]);

  useEffect(() => {
    if (key === null) window.location.replace('/host/key?next=/host');
  }, [key]);

  if (!key) return null;
  return (
    <div className="mt-8 space-y-10">
      <div className="flex flex-wrap gap-3">
        <Link href="/host/new?kind=recording" className={action}>Process a recording</Link>
        <span className="flex flex-col">
          <button type="button" disabled className={`${action} disabled:opacity-50`}>New live session</button>
          <span className="mt-1 text-xs text-ink-3">Coming next: live capture</span>
        </span>
        <Link href="/host/prepare" className={prepared ? action : `${action} border-ink bg-field-deep`}>
          Prepare this laptop
        </Link>
      </div>
      {!prepared && <p className="text-[15px] text-ink-2">This laptop has not been prepared yet. Do that first: it downloads the transcription model and checks the speed.</p>}

      <section>
        <h2 className="label-caps">On this laptop</h2>
        {sessions.length === 0 ? (
          <p className="mt-3 text-[15px] text-ink-2">No sessions yet.</p>
        ) : (
          <ul className="mt-3">
            {sessions.map((s) => (
              <li key={s.id} className="border-t border-border py-3 first:border-t-0">
                <Link href={`/host/s/${encodeURIComponent(s.id)}`} className="flex items-baseline justify-between gap-4 text-[15px] text-ink hover:underline">
                  <span className="min-w-0 truncate">{s.title}</span>
                  <span className="shrink-0 text-sm text-ink-3">{s.done ? 'Done' : 'In progress'} · {s.createdAt.slice(0, 10)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
