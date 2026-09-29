'use client';

import type { ChannelMap } from '@/lib/attribution/attributor';
import { channelOf, noticeLine, visibleNotices } from '@/lib/live/live-view';
import type { LiveStatus } from '@/lib/live/runner';
import { button } from './RunnerParts';

/** Notices as plain lines; a swap suggestion carries its Swap button. */
export function Notices({ status, channels, names, dismissed, onDismiss, onSwap }: {
  status: LiveStatus;
  channels: ChannelMap;
  names: Record<string, string>;
  dismissed: Set<number>;
  onDismiss: (index: number) => void;
  onSwap: (a: string, b: string) => void;
}) {
  const shown = visibleNotices(status.notices, dismissed).map(({ index, notice }) => ({ index, notice, line: noticeLine(notice, { channels, names }) })).filter((n) => n.line);
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-3">
      {shown.map(({ index, notice, line }) => {
        const partner = notice.kind === 'swap_suggested' && notice.participantKey ? channelOf(channels, notice.participantKey) : undefined;
        return (
          <li key={index} className="space-y-2 border-t border-border pt-3 text-[15px] text-ink">
            <p>{line}</p>
            <div className="flex flex-wrap gap-2">
              {partner && notice.channel && <button type="button" className={button} onClick={() => { onSwap(notice.channel!, partner); onDismiss(index); }}>Swap</button>}
              <button type="button" className={button} onClick={() => onDismiss(index)}>Dismiss</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Lines that could not be transcribed or saved, each with Retry (keyed by input and start, not position). */
export function Failed({ items, onRetry }: { items: LiveStatus['failed']; onRetry: (channel: string, startMs: number) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2">
      {items.map((f) => (
        <li key={`${f.channel}-${f.startMs}`} className="flex flex-wrap items-center gap-3 text-[15px] text-ink">
          <span>A line at {Math.floor(f.startMs / 60_000)}:{String(Math.floor((f.startMs % 60_000) / 1000)).padStart(2, '0')} was not saved: {f.reason}</span>
          <button type="button" className={button} onClick={() => onRetry(f.channel, f.startMs)}>Retry</button>
        </li>
      ))}
    </ul>
  );
}

export function Transcript({ lines }: { lines: { id: string; speaker: string; text: string }[] }) {
  if (lines.length === 0) return null;
  return (
    <section>
      <h2 className="label-caps">Transcript</h2>
      <ul className="mt-3 space-y-2">
        {lines.map((l) => <li key={l.id} className="text-[15px] text-ink"><span className="text-ink-2">{l.speaker}:</span> {l.text}</li>)}
      </ul>
    </section>
  );
}
