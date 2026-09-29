'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { UploadStatus } from '@adl/engine';
import { setPublished } from './start-recording';

export const button = 'min-h-11 rounded border border-border-2 px-4 text-[15px] text-ink hover:bg-field-deep disabled:opacity-50';

/** `newTab` while a live session runs: leaving this page would stop capture and the analysis. */
export function DoneLinks({ id, newTab = false }: { id: string; newTab?: boolean }) {
  const s = encodeURIComponent(id);
  const tab = newTab ? { target: '_blank', rel: 'noopener' } : {};
  return (
    <div className="flex flex-wrap gap-3">
      <Link className={`${button} inline-flex items-center`} href={`/s/${s}/spatial`} {...tab}>Open the map</Link>
      <Link className={`${button} inline-flex items-center`} href={`/s/${s}/cockpit`} {...tab}>Open the cockpit</Link>
    </div>
  );
}

/** Events this device still has to deliver: the session is not finished until they are on the server. */
export function UploadWaiting({ status, onRetry, busy }: { status: UploadStatus; onRetry: () => void; busy: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-[15px] text-ink">{status.pending} {status.pending === 1 ? 'event' : 'events'} waiting to upload</p>
      {status.lastError && <p role="alert" className="text-sm text-ink-2">{status.lastError}</p>}
      <button type="button" className={button} disabled={busy} onClick={onRetry}>{busy ? 'Uploading' : 'Retry'}</button>
    </div>
  );
}

export function KeyRejected({ id }: { id: string }) {
  return (
    <div className="space-y-3">
      <p role="alert" className="text-[15px] text-ink">Your Anthropic key was rejected. Add a working key to continue.</p>
      <Link className={`${button} inline-flex items-center`} href={`/host/key?next=${encodeURIComponent(`/host/s/${id}`)}`}>Add a working key</Link>
    </div>
  );
}

/** Host sessions start off the public list; the map link works either way. */
export function Publish({ id }: { id: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/sessions')
      .then((r) => r.json() as Promise<{ sessions?: { id: string }[] }>)
      .then((b) => { if (live) setOn(Boolean(b.sessions?.some((s) => s.id === id))); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, [id]);

  const toggle = async () => {
    if (on === null) return;
    setBusy(true);
    setError(null);
    try {
      await setPublished(id, !on);
      setOn(!on);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (on === null) return null;
  return (
    <div className="space-y-2">
      <p className="text-[15px] text-ink-2">{on ? 'This session is on the public list.' : 'This session is not on the public list. Anyone with the map link can still open it.'}</p>
      <button type="button" className={button} disabled={busy} onClick={() => void toggle()}>{on ? 'Unpublish' : 'Publish to the public list'}</button>
      {error && <p role="alert" className="text-sm text-ink">{error}</p>}
    </div>
  );
}
