// Browser capture: mic devices, shared-tab audio, and a per-channel 16 kHz tap. Thin on purpose;
// only checkTrackSettings is unit-tested. Chrome gives at most 2 channels per device and the
// browser's audio processing must be off (docs/research/2026-09-29-browser-audio-capture.md).

export class NoAudioShared extends Error {
  constructor() {
    super('The shared tab had no audio. Share again and tick “Share tab audio”.');
    this.name = 'NoAudioShared';
  }
}

export function checkTrackSettings(s: MediaTrackSettings, want: { channels: 1 | 2 }): string[] {
  const problems: string[] = [];
  if (want.channels === 2 && (s.channelCount ?? 1) !== 2) {
    problems.push('This device gives one channel, so both mics are mixed together. Choose the 2-input interface, or use the one-mic setup.');
  }
  if (s.echoCancellation !== false) {
    problems.push('The browser is cleaning up the audio (echo cancellation), which hurts transcription. Reload the page and allow the microphone again.');
  }
  if (s.noiseSuppression !== false) {
    problems.push('The browser is filtering out noise, which hurts transcription. Reload the page and allow the microphone again.');
  }
  if (s.autoGainControl !== false) {
    problems.push('The browser is adjusting the volume automatically, which hurts transcription. Reload the page and allow the microphone again.');
  }
  return problems;
}

export function openMicDevice(deviceId: string, channels: 1 | 2): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      channelCount: { ideal: channels },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: { ideal: 48000 },
    },
  });
}

export async function openTabAudio(): Promise<MediaStream> {
  // `systemAudio` is a Chrome getDisplayMedia option that the TS lib types do not declare.
  const options = {
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
  } as DisplayMediaStreamOptions;
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  stream.getVideoTracks().forEach((t) => t.stop());
  if (stream.getAudioTracks().length === 0) throw new NoAudioShared();
  return stream;
}

export async function tapChannels(
  stream: MediaStream,
  onFrame: (channel: number, frame: Float32Array, atMs: number) => void,
): Promise<() => void> {
  const track = stream.getAudioTracks()[0];
  const n = track?.getSettings().channelCount ?? 1;
  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule('/worklets/tap.js');
    await ctx.resume(); // the browser may start the context suspended outside a gesture
  } catch (e) {
    void ctx.close();
    throw e;
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'tap', { channelCount: n, channelCountMode: 'explicit', numberOfInputs: 1 });
  const frames: number[] = [];
  node.port.onmessage = (e: MessageEvent<{ channel: number; frame: Float32Array }>) => {
    const { channel, frame } = e.data;
    const idx = frames[channel] ?? 0;
    frames[channel] = idx + 1;
    onFrame(channel, frame, idx * 20);
  };
  source.connect(node);
  return () => {
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    void ctx.close();
  };
}

export function onStreamEnded(stream: MediaStream, cb: () => void): void {
  const tracks = stream.getAudioTracks();
  let live = tracks.length;
  if (live === 0) return;
  for (const t of tracks) {
    t.addEventListener('ended', () => {
      live -= 1;
      if (live === 0) cb();
    }, { once: true });
  }
}

/** How a live session's audio is opened, stored so a reload or "Resume audio" opens the same thing. */
export type CaptureSpec = { kind: 'mic'; devices: { deviceId: string; channels: 1 | 2 }[] } | { kind: 'tab' };

/** Opens every stream the spec names, in order. `tab` shows the browser's share picker (needs a click). */
export async function openCapture(spec: CaptureSpec): Promise<MediaStream[]> {
  if (spec.kind === 'tab') return [await openTabAudio()];
  const streams: MediaStream[] = [];
  try {
    for (const d of spec.devices) streams.push(await openMicDevice(d.deviceId, d.channels));
  } catch (e) {
    stopStreams(streams);
    throw e;
  }
  return streams;
}

export function stopStreams(streams: MediaStream[]): void {
  for (const s of streams) s.getTracks().forEach((t) => t.stop());
}

/** Taps every stream; channel ids are `d<stream index>c<channel index>`. */
export async function tapAll(streams: MediaStream[], onFrame: (channel: string, frame: Float32Array, atMs: number) => void): Promise<() => void> {
  const stops: (() => void)[] = [];
  try {
    for (const [i, s] of streams.entries()) stops.push(await tapChannels(s, (c, f, at) => onFrame(`d${i}c${c}`, f, at)));
  } catch (e) {
    stops.forEach((stop) => stop());
    throw e;
  }
  return () => stops.forEach((stop) => stop());
}

/** Audio inputs with their names (the browser only names them once the microphone is allowed). */
export async function listInputs(): Promise<MediaDeviceInfo[]> {
  const inputs = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  let list = await inputs();
  if (list.length === 0 || list.some((d) => !d.label)) {
    stopStreams([await navigator.mediaDevices.getUserMedia({ audio: true })]);
    list = await inputs();
  }
  return list;
}

/** A microphone error in words, with the next step. */
export function micError(e: unknown): string {
  if (e instanceof Error && e.name === 'NotAllowedError') return 'The microphone is blocked for this site. Allow it from the icon in the address bar, then try again.';
  if (e instanceof Error && e.name === 'NotFoundError') return 'That device is not connected. Plug it in and choose it again.';
  return e instanceof Error ? e.message : String(e);
}
