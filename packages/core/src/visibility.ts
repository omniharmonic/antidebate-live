/**
 * Server-side audience filter (ARCHITECTURE §5; PRD §6). Audience channels only
 * ever receive what this function returns. Never send raw state to an audience.
 */
import type { ChannelId, Insight, Module } from './events';
import type { SessionState } from './state';

export interface AudienceView {
  channel: ChannelId;
  level: number;
  blackout: boolean;
  frame?: { title: string; round: string | null };
  positions?: { participantKey: string; propositionIds: string[] }[];
  insights?: Insight[];
  propositions?: { id: string; canonical: string; type: string; stratum: string }[];
  spotlight?: string | null;
}

const LEVEL_MODULES: Record<number, Module[]> = {
  0: [],
  1: [],
  2: [],
  3: ['crux', 'common_ground', 'higher_ground'],
  4: ['crux', 'common_ground', 'higher_ground', 'questions', 'credences', 'drift'],
  5: ['crux', 'common_ground', 'higher_ground', 'questions', 'credences', 'drift', 'transcript'],
};

const INSIGHT_MODULE: Partial<Record<Insight['kind'], Module>> = {
  crux: 'crux',
  higher_ground: 'higher_ground',
  drift: 'drift',
  question: 'questions',
};

export function audienceView(s: SessionState, channel: ChannelId): AudienceView {
  const ch = s.channels[channel];
  const level = s.blackout ? 0 : ch.level;
  const view: AudienceView = { channel, level, blackout: s.blackout, spotlight: level > 0 ? ch.spotlight : null };
  if (level === 0) return view;
  view.frame = { title: s.title, round: s.round?.name ?? null };
  if (level < 2) return view;

  const released = [...s.propositions.values()].filter((p) => p.state === 'released');
  const releasedIds = new Set(released.map((p) => p.value.id));
  const byParticipant = new Map<string, string[]>();
  for (const st of s.stances.values()) {
    if (st.state !== 'released' || !releasedIds.has(st.value.propositionId)) continue;
    if (st.value.attitude !== 'accepts') continue;
    const list = byParticipant.get(st.value.participantKey) ?? [];
    list.push(st.value.propositionId);
    byParticipant.set(st.value.participantKey, list);
  }
  view.positions = [...byParticipant.entries()].map(([participantKey, propositionIds]) => ({ participantKey, propositionIds }));
  view.propositions = released.map((p) => ({ id: p.value.id, canonical: p.value.canonical, type: p.value.type, stratum: p.value.stratum }));

  const allowed = new Set(LEVEL_MODULES[level] ?? []);
  view.insights = [...s.insights.values()]
    .filter((i) => i.state === 'released')
    .filter((i) => {
      const m = INSIGHT_MODULE[i.value.kind];
      return m !== undefined && allowed.has(m) && ch.toggles[m];
    })
    .map((i) => i.value);
  return view;
}
