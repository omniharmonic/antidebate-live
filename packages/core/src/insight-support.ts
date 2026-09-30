import type { Insight } from './events';
import type { Stance } from '@adl/ontology';
import type { Tracked, SessionState } from './state';
import { CruxCard, HigherGroundCard } from '@adl/ontology';

const acceptedState = (state: string | undefined) => state === 'approved' || state === 'released';
/** Stop a formerly approved card from outliving its evidence or a participant's stance. */
export function insightSupported(s: SessionState, i: Insight): boolean {
  if (i.refs.some(id => !acceptedState(s.propositions.get(id)?.state))) return false;
  if (i.kind !== 'crux' && i.kind !== 'higher_ground') return true;
  const latest = (key: string, pid: string) => {
    let found: Tracked<Stance> | undefined;
    for (const st of s.stances.values()) {
      if (!acceptedState(st.state) || st.value.participantKey !== key || st.value.propositionId !== pid || st.value.source === 'inferred') continue;
      if (!found || st.value.atMs >= found.value.atMs) found = st;
    }
    return found;
  };
  if (i.kind === 'higher_ground') {
    const p = HigherGroundCard.safeParse(i.body); if (!p.success) return false;
    const keys=s.participants.filter(p=>p.role==='debater').map(p=>p.key);
    return keys.length>=2 && keys.every(key=>p.data.derivation[key]?.length && p.data.derivation[key]!.every(id=>{
      if (!acceptedState(s.propositions.get(id)?.state)) return false;
      const stance=latest(key,id)?.value;
      return stance && ['accepts','accepts_conditionally'].includes(stance.attitude);
    }));
  }
  const p = CruxCard.safeParse(i.body); if (!p.success) return false;
  if (s.propositions.get(p.data.propositionId)?.value.canonical !== p.data.statement) return false;
  return p.data.sides.every(side=>{
    const pid=side.via?.propositionId??p.data.propositionId;
    return acceptedState(s.propositions.get(pid)?.state) && latest(side.participantKey,pid)?.value.id===side.stanceId;
  });
}
