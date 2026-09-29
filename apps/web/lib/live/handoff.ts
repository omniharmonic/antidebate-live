/**
 * What the setup screens hand to the live host view on the hop from /host/new to /host/s/<id>:
 * the open audio (a shared tab cannot be reopened without another click) and the loaded models.
 * Memory only; after a reload the view reopens capture from the stored spec on a click.
 */
import type { AsrClient } from '../asr/client';
import type { DiarizeClient } from '../diarize/client';

export type LiveHandoff = { streams: MediaStream[]; asr?: AsrClient; voices?: DiarizeClient };

export const pendingLive = new Map<string, LiveHandoff>();
