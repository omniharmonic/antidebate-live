// Browser glue: taps the streams, cuts utterances per setup channel and feeds the runner, with the
// once-a-second activity tick. Session time is wall time since `startedAt`, so a pause, a reload or
// reopened audio never reuses an utterance id.
import { tapAll } from './capture';
import { utteranceId, type LiveRunner } from './runner';
import { Segmenter } from './segmenter';

export type ListenOptions = {
  streams: MediaStream[];
  channels: string[];
  /** Call/room feeds combine stereo into mono; separate mics preserve their input channels. */
  mono?: boolean;
  runner: Pick<LiveRunner, 'onUtterance' | 'tick'>;
  /** Epoch ms of session time zero. */
  startedAt: number;
  /** Each cut's audio, by the utterance id the runner will give it. */
  onClip?: (id: string, pcm: Float32Array) => void;
};

export async function listen(o: ListenOptions): Promise<() => void> {
  const wallStartMs = Date.now();
  const seg = new Segmenter({
    channels: o.channels,
    offsetMs: wallStartMs - o.startedAt,
    wallStartMs,
    onUtterance: (x) => {
      o.onClip?.(utteranceId(x.channel, x.u.startMs), x.u.pcm);
      void o.runner.onUtterance(x.channel, x.u, x.rms, x.overlap, x.endedAtWallMs, o.onClip);
    },
  });
  const stopTap = await tapAll(o.streams, (c, f, at) => seg.push(c, f, at), o.mono);
  const t = setInterval(() => {
    const now = Date.now() - o.startedAt;
    o.runner.tick(now, seg.active(now));
  }, 1000);
  return () => {
    clearInterval(t);
    stopTap();
    seg.flush();
  };
}
