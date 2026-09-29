import { describe, expect, it } from 'vitest';
import { checkTrackSettings } from './capture';

describe('checkTrackSettings', () => {
  it('passes a clean 2-channel interface', () => {
    expect(checkTrackSettings({ channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, { channels: 2 })).toEqual([]);
  });
  it('explains each problem in a sentence', () => {
    expect(checkTrackSettings({ channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true }, { channels: 2 })).toEqual([
      'This device gives one channel, so both mics are mixed together. Choose the 2-input interface, or use the one-mic setup.',
      'The browser is cleaning up the audio (echo cancellation), which hurts transcription. Reload the page and allow the microphone again.',
      'The browser is adjusting the volume automatically, which hurts transcription. Reload the page and allow the microphone again.',
    ]);
  });
});
