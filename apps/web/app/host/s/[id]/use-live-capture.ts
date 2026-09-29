'use client';

import { useCallback, useRef, useState } from 'react';
import { micError, onStreamEnded, openCapture, stopStreams } from '@/lib/live/capture';
import { listen } from '@/lib/live/listen';
import { listenChannels } from '@/lib/live/live-view';
import type { LiveSession } from './start-live';

/** waiting: needs a click (after a reload); stopped: the audio ended (device unplugged, share stopped). */
export type CaptureState = 'waiting' | 'on' | 'paused' | 'stopped';

const CLIP_KEEP_MS = 10 * 60_000;

/**
 * The live tap for one session: start from handed-over streams or reopen the stored setup,
 * pause and resume (the tap stops; the streams stay open), and the last 10 minutes of cut audio
 * for the play buttons. The caller calls `end()` when the page goes away or the session ends.
 */
export function useLiveCapture(session: LiveSession | null, onError: (message: string) => void) {
  const [state, setState] = useState<CaptureState>('waiting');
  const streams = useRef<MediaStream[]>([]);
  const stopListen = useRef<(() => void) | null>(null);
  const clips = useRef(new Map<string, { pcm: Float32Array; at: number }>());

  const halt = useCallback(() => {
    stopListen.current?.();
    stopListen.current = null;
  }, []);

  const begin = useCallback(async (s: MediaStream[]) => {
    const st = session?.state;
    if (!session?.runner || !st) return;
    halt();
    streams.current = s;
    try {
      stopListen.current = await listen({
        streams: s,
        channels: listenChannels(st.setup),
        runner: session.runner,
        startedAt: st.startedAt ?? Date.now(),
        onClip: (id, pcm) => {
          const now = Date.now();
          for (const [k, v] of clips.current) if (now - v.at > CLIP_KEEP_MS) clips.current.delete(k);
          clips.current.set(id, { pcm, at: now });
        },
      });
    } catch (e) {
      onError(micError(e));
      setState('stopped');
      return;
    }
    for (const x of s) {
      onStreamEnded(x, () => {
        if (streams.current !== s) return;
        halt();
        stopStreams(s);
        setState('stopped');
      });
    }
    setState('on');
  }, [session, halt, onError]);

  /** Opens the stored setup again (after a reload, or when the audio stopped). Call from a click. */
  const reopen = useCallback(async () => {
    const spec = session?.state?.capture;
    if (!spec) return onError('This session has no stored audio setup on this laptop.');
    try {
      const s = await openCapture(spec);
      stopStreams(streams.current);
      await begin(s);
    } catch (e) {
      onError(micError(e));
    }
  }, [session, begin, onError]);

  const pause = useCallback(() => { halt(); setState('paused'); }, [halt]);
  const resume = useCallback(() => void begin(streams.current), [begin]);
  const end = useCallback(() => {
    halt();
    stopStreams(streams.current);
    streams.current = [];
  }, [halt]);
  const clip = useCallback((id: string) => clips.current.get(id)?.pcm, []);

  return { state, begin, reopen, pause, resume, end, clip };
}
