import type { DomainEvent } from '@adl/core';
import type { LlmCallLog } from '@adl/llm';

export interface EventLog {
  readonly kind: 'db' | 'file' | 'http';
  readonly where: string;
  append(events: DomainEvent[]): Promise<void>;
  /** Events after `cursor`, in append order, and the new cursor. */
  read(cursor: number): Promise<{ cursor: number; events: DomainEvent[] }>;
  logCall(log: LlmCallLog): Promise<void>;
}
