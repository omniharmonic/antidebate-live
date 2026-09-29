import type { DomainEvent } from '@adl/core';
import type { EventLog } from '@adl/engine';

/** An event log that lives only in memory (the rehearsal: nothing is sent or kept). */
export class MemoryEventLog implements EventLog {
  readonly kind = 'http' as const;
  readonly where = 'memory';
  readonly events: DomainEvent[] = [];
  private readonly ids = new Set<string>();
  async append(events: DomainEvent[]): Promise<void> {
    for (const e of events) if (!this.ids.has(e.eventId)) { this.ids.add(e.eventId); this.events.push(e); }
  }
  async read(cursor: number) {
    return { cursor: this.events.length, events: this.events.slice(cursor) };
  }
  async logCall(): Promise<void> {}
}
