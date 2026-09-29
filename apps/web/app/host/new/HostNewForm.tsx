'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FORMATS } from '@adl/core';
import { checkSession, defaultRows, field, labelCls, ParticipantRows, type Row } from '@/app/new/NewSessionForm';
import { getKey } from '@/lib/anthropic-key';
import { pendingFiles, rememberHostSession } from '@/lib/recording/host-sessions';
import { LiveFlow, type LiveDraft, type LiveSource } from './setups/LiveFlow';
import { HostConfirmsNote } from './setups/shared';

const SOURCES = [
  { id: 'mics', label: 'Each speaker has their own mic' },
  { id: 'call', label: 'A video call' },
  { id: 'room', label: 'One mic in the room' },
  { id: 'recording', label: 'A recording' },
] as const;
type Source = (typeof SOURCES)[number]['id'];

export function HostNewForm({ kind }: { kind?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState('anti-debate');
  const [rows, setRows] = useState<Row[]>(defaultRows);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<Source>(kind === 'live' ? 'mics' : 'recording');
  const [live, setLive] = useState<LiveDraft | null>(null);
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  useEffect(() => {
    if (!getKey()) window.location.replace('/host/key?next=/host/new');
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const checked = checkSession(title, format, rows);
    if ('error' in checked) return setError(checked.error);
    if (source !== 'recording') {
      return setLive({ title: title.trim(), format, participants: checked.participants, seats: checked.seats, source: source as LiveSource });
    }
    if (!file) return setError('Choose the recording file.');
    setBusy(true);
    try {
      const res = await fetch('/api/host/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), format, participants: checked.participants, seats: checked.seats, source: { kind: 'recording' } }),
      });
      const body = (await res.json().catch(() => ({}))) as { sessionId?: string; error?: string };
      if (!res.ok || !body.sessionId) throw new Error(body.error ?? `The server returned ${res.status}`);
      rememberHostSession({ id: body.sessionId, title: title.trim(), createdAt: new Date().toISOString(), kind: 'recording' });
      pendingFiles.set(body.sessionId, file);
      router.push(`/host/s/${encodeURIComponent(body.sessionId)}`);
    } catch (err) {
      setError(`Session not created: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
    }
  };

  if (live) return <LiveFlow draft={live} />;
  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <label htmlFor="title" className={labelCls}>Title</label>
        <input id="title" required maxLength={180} className={`${field} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Should governments or markets control AI?" />
      </div>
      <div>
        <label htmlFor="format" className={labelCls}>Format</label>
        <select id="format" className={`${field} mt-1`} value={format} onChange={(e) => setFormat(e.target.value)}>
          {Object.values(FORMATS).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <ParticipantRows rows={rows} setRow={setRow} />
      <fieldset>
        <legend className={labelCls}>How will the audio reach this laptop?</legend>
        <div className="mt-3 space-y-2">
          {SOURCES.map((s) => (
            <label key={s.id} className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
              <input type="radio" name="source" value={s.id} checked={source === s.id} onChange={() => setSource(s.id)} />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      {source === 'recording' && <div>
        <label htmlFor="file" className={labelCls}>Recording file</label>
        <input id="file" type="file" accept="audio/*,video/*" className="mt-2 block text-[15px] text-ink" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="mt-2"><HostConfirmsNote setup="recording" /></div>
        <p className="mt-2 text-sm text-ink-3">
          YouTube links can&apos;t be processed here: YouTube blocks servers from downloading. Download the video first (for example with yt-dlp or the creator&apos;s own copy), then choose the file.
        </p>
      </div>}
      {error && <p role="alert" className="text-sm text-ink">{error}</p>}
      <button type="submit" disabled={busy} className="min-h-11 rounded-[3px] bg-ink px-5 py-2 text-sm text-field hover:bg-ink-2 disabled:opacity-40">
        {source !== 'recording' ? 'Continue' : busy ? 'Creating…' : 'Create and start'}
      </button>
    </form>
  );
}
