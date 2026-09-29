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

const field = 'w-full rounded border border-border-2 bg-surface px-3 py-2 text-[15px]';
const labelCls = 'block text-sm text-ink-2';

function CommandBlock({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex items-start gap-3 rounded border border-border bg-field-subtle px-4 py-3">
      <code className="min-w-0 flex-1 break-all font-mono text-[13px]">{cmd}</code>
      <button
        type="button"
        className="shrink-0 rounded border border-border-2 px-2.5 py-1 text-xs hover:bg-field-deep"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
      >
        {copied ? 'Copied' : 'Copy'}
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
    if (people.filter((r) => r.role === 'debater').length < 2) return setError('Name both debaters.');
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

  const recordingCmd = `pnpm --filter @adl/worker run:session -- --url ${url.trim() ? JSON.stringify(url.trim()) : '<url>'}`;

  return (
    <div>
      <div role="tablist" aria-label="Source" className="flex gap-1 border-b border-border">
        {(
          [
            ['live', 'Live room'],
            ['recording', 'Recording'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${mode === m ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
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
            <input id="title" className={`${field} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Should governments or markets control AI?" />
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
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_8rem_8rem] gap-2 text-xs text-ink-3" aria-hidden>
                <span>Key</span>
                <span>Name</span>
                <span>Role</span>
                <span>Seat</span>
              </div>
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)_8rem_8rem] gap-2">
                  <input aria-label={`Key ${i + 1}`} className={`${field} font-mono`} value={r.key} onChange={(e) => setRow(i, { key: e.target.value })} />
                  <input aria-label={`Name ${i + 1}`} className={field} value={r.displayName} onChange={(e) => setRow(i, { displayName: e.target.value })} />
                  <select aria-label={`Role ${i + 1}`} className={field} value={r.role} onChange={(e) => setRow(i, { role: e.target.value as Role })}>
                    <option value="debater">debater</option>
                    <option value="moderator">moderator</option>
                  </select>
                  <select aria-label={`Seat ${i + 1}`} className={field} value={r.seat} onChange={(e) => setRow(i, { seat: e.target.value as Seat })}>
                    <option value="aff">aff</option>
                    <option value="neg">neg</option>
                    <option value="moderator">moderator</option>
                  </select>
                </div>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-ink">
              {error}
            </p>
          ) : null}
          <div className="flex items-center gap-4">
            <button type="submit" disabled={busy} className="rounded border border-ink-3 px-4 py-2 text-sm hover:bg-field-deep disabled:opacity-40">
              {busy ? 'Creating' : 'Create session'}
            </button>
            <p className="text-xs text-ink-3">Opens the operator console. Then start capture and the worker for this session id.</p>
          </div>
        </form>
      ) : (
        <div className="mt-8 space-y-6">
          <div>
            <label htmlFor="url" className={labelCls}>
              Recording URL
            </label>
            <input id="url" className={`${field} mt-1`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…" />
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
