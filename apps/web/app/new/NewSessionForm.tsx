'use client';

import { postOperatorEvents } from '@/lib/operator-events';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FORMATS, type DomainEvent } from '@adl/core';
import { newSessionId } from '@/lib/session-id';

type Role = 'debater' | 'moderator';
type Seat = 'aff' | 'neg' | 'moderator';
interface Row {
  key: string;
  displayName: string;
  role: Role;
  seat: Seat;
}

const field = 'min-h-11 w-full min-w-0 rounded-[3px] border border-border bg-surface px-3 py-2 text-[16px] focus:border-focus';
const labelCls = 'block text-sm text-ink-2';

function CommandBlock({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <div className="mt-3 flex items-start gap-3 rounded border border-border bg-field-subtle px-4 py-3">
      <code className="min-w-0 flex-1 break-all font-mono text-[13px]">{cmd}</code>
      <button
        type="button"
        className="min-h-11 shrink-0 rounded border border-border-2 px-2.5 py-1 text-xs hover:bg-field-deep"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            setCopyError(false);
            setTimeout(() => setCopied(false), 1500);
          } catch { setCopyError(true); }
        }}
      >
        {copied ? 'Copied' : copyError ? 'Select & copy' : 'Copy'}
      </button>
    </div>
  );
}

export function NewSessionForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'live' | 'recording'>('live');
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState('anti-debate');
  const [rows, setRows] = useState<Row[]>([
    { key: 'A', displayName: '', role: 'debater', seat: 'aff' },
    { key: 'B', displayName: '', role: 'debater', seat: 'neg' },
    { key: 'MOD', displayName: '', role: 'moderator', seat: 'moderator' },
  ]);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const createLive = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const people = rows.filter((r) => r.displayName.trim());
    if (!title.trim()) return setError('Give the session a title.');
    const minimum = format === 'anti-debate' ? 2 : 1;
    if (people.filter((r) => r.role === 'debater').length < minimum) return setError(minimum === 2 ? 'Name both debaters.' : 'Name at least one speaker.');
    const keys = people.map((r) => r.key.trim());
    if (keys.some((k) => !/^[A-Za-z0-9_]{1,8}$/.test(k)) || new Set(keys).size !== keys.length) return setError('Participant keys must be unique, up to 8 letters or digits.');
    const id = newSessionId(title);
    const ev: DomainEvent = {
      eventId: `${id}:start`,
      sessionId: id,
      type: 'session.started',
      actor: 'operator',
      mediaMs: 0,
      wallTs: new Date().toISOString(),
      payload: {
        title: title.trim(),
        format,
        participants: people.map((r) => ({ key: r.key.trim(), displayName: r.displayName.trim(), role: r.role })),
        seats: Object.fromEntries(people.map((r) => [r.key.trim(), r.seat])),
        source: { kind: 'live' },
      },
    };
    setBusy(true);
    try {
      const res = await postOperatorEvents([ev]);
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      router.push(`/s/${encodeURIComponent(id)}/console`);
    } catch (err) {
      setError(`Session not created: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
    }
  };

  const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const recordingCmd = `pnpm --filter @adl/worker run:session -- --url ${url.trim() ? shellQuote(url.trim()) : "'<recording-url>'"}`;

  return (
    <div>
      <div role="group" aria-label="Source" className="flex gap-1 border-b border-border">
        {(
          [
            ['live', 'Live room'],
            ['recording', 'Recording'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`-mb-px min-h-11 border-b-2 px-4 py-2 text-sm ${mode === m ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'live' ? (
        <form onSubmit={createLive} className="mt-8 space-y-6">
          <div>
            <label htmlFor="title" className={labelCls}>
              Title
            </label>
            <input id="title" required maxLength={180} className={`${field} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Should governments or markets control AI?" />
          </div>
          <div>
            <label htmlFor="format" className={labelCls}>
              Format
            </label>
            <select id="format" className={`${field} mt-1`} value={format} onChange={(e) => setFormat(e.target.value)}>
              {Object.values(FORMATS).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend className={labelCls}>Participants</legend>
            <div className="mt-3 space-y-4">
              {rows.map((r, i) => (
                <div key={r.key} className="grid grid-cols-2 gap-3 border border-border bg-field-subtle p-4 sm:grid-cols-[minmax(0,1fr)_130px_145px]">
                  <label className="col-span-2 text-sm text-ink-2 sm:col-span-1">
                    {i === 2 ? 'Moderator (optional)' : `Speaker ${i + 1}`}
                    <input aria-label={`Name ${i + 1}`} autoComplete="off" className={`${field} mt-2`} value={r.displayName} onChange={(e) => setRow(i, { displayName: e.target.value })} placeholder="Full name" />
                  </label>
                  <label className="text-sm text-ink-2">Role
                    <select aria-label={`Role ${i + 1}`} className={`${field} mt-2`} value={r.role} onChange={(e) => { const role = e.target.value as Role; setRow(i, { role, seat: role === 'moderator' ? 'moderator' : i === 1 ? 'neg' : 'aff' }); }}>
                      <option value="debater">Debater</option><option value="moderator">Moderator</option>
                    </select>
                  </label>
                  <label className="text-sm text-ink-2">Side
                    <select aria-label={`Seat ${i + 1}`} disabled={r.role === 'moderator'} className={`${field} mt-2 disabled:opacity-60`} value={r.seat} onChange={(e) => setRow(i, { seat: e.target.value as Seat })}>
                      <option value="aff">Affirmative</option><option value="neg">Negative</option><option value="moderator" disabled={r.role !== 'moderator'}>Moderator</option>
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-ink">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={busy} className="min-h-11 rounded-[3px] bg-ink px-5 py-2 text-sm text-field hover:bg-ink-2 disabled:opacity-40">
              {busy ? 'Creating…' : 'Create session'}
            </button>
            <p className="text-xs text-ink-3">Opens the review console. Audio capture is connected separately.</p>
          </div>
        </form>
      ) : (
        <div className="mt-8 space-y-6">
          <div>
            <label htmlFor="url" className={labelCls}>
              Recording URL
            </label>
            <input id="url" type="url" inputMode="url" className={`${field} mt-1`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…" />
          </div>
          <div>
            <p className="text-sm text-ink-2">Recordings run on the operator machine. Run this in the repo; the session appears on the sessions page when its first event is written.</p>
            <CommandBlock cmd={recordingCmd} />
          </div>
        </div>
      )}
    </div>
  );
}
