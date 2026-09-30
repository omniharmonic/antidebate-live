/** Prepare append-only QA corrections. No DB writes; inspect patches before publishing.
 * LLM_PROVIDER=api LLM_API_BUDGET_USD=<cumulative ceiling> node --import tsx evals/qa/retro-review.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { apply, project, type DomainEvent } from '../../packages/core/src/index';
import { validateStance } from '../../packages/ontology/src/index';
import { buildMapView } from '../../packages/pipeline/src/mapview';
import { reviewItems, reviewMap, type ReviewItem } from '../../packages/pipeline/src/review';
import { runL4 } from '../../packages/pipeline/src/l4';

const sessions = process.argv.slice(2).length ? process.argv.slice(2) : ['ball-kokotajlo-r5','belief-in-god-r3','open-source-ai-r3','gender-affirming-care-r3','destiny-shermer-r3'];
const active = (state: string) => ['approved','released'].includes(state);
async function audit(sid: string) {
  const basePath = `.data/qa/${sid}.production-before.jsonl`;
  const events = readFileSync(existsSync(basePath) ? basePath : `.data/${sid}.events.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l) as DomainEvent);
  const structuralPath = `.data/qa/${sid}.structural-corrections.jsonl`;
  const structural: DomainEvent[] = existsSync(structuralPath) ? readFileSync(structuralPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as DomainEvent) : [];
  const s = project(sid, [...events, ...structural]), original = structuredClone(s);
  const patch: DomainEvent[] = [...structural], verdicts: unknown[] = [];
  const base = { sessionId:sid, actor:'system' as const, mediaMs:s.lastMediaMs, wallTs:new Date().toISOString() };
  const emit = (event: DomainEvent) => { patch.push(event); apply(s,event); };
  const originalTime = (id: string) => events.find(e => e.eventId === `${id}:proposed`)?.mediaMs ?? base.mediaMs;
  const reject = (id: string, reason: string) => emit({ ...base, mediaMs: originalTime(id), eventId:`${sid}:qa-v1:${id}:reject`, type:'item.rejected', payload:{itemId:id,reason:`QA 2026-09-30: ${reason}`} });
  const assess = async (items: ReviewItem[], batchSize=20) => {
    for(let i=0;i<items.length;i+=batchSize) {
      const batch=items.slice(i,i+batchSize);
      const result=await reviewItems(batch,sid);
      if(result.error)throw new Error(`${sid}: ${result.error}`);
      const concerns = result.verdicts.filter(v=>v.verdict==='reject');
      // A second pass must independently reproduce the concern before a historical item is rejected.
      const confirmation = await reviewItems(concerns.map(v=>{const item=batch.find(x=>x.id===v.id)!;return {...item,evidence:{original:item.evidence,proposedConcern:v.reason,instruction:'Check the concern against the original evidence; pass if the item is actually faithful. The concern is not authoritative.'}};}),sid);
      if(confirmation.error)throw new Error(`${sid}: ${confirmation.error}`);
      verdicts.push(...result.verdicts.map(v=>({...v,kind:batch.find(x=>x.id===v.id)!.kind,confirmation:confirmation.verdicts.find(x=>x.id===v.id)})));
      for(const v of confirmation.verdicts) if(v.verdict==='reject') reject(v.id,v.reason);
      writeFileSync(`.data/qa/${sid}.review-progress.json`,JSON.stringify(verdicts,null,2));
      console.log(`${sid} ${items[0]?.kind} ${Math.min(i+batchSize,items.length)}/${items.length}; corrections ${patch.length}`);
    }
  };
  for(const st of s.stances.values()) {
    if(!active(st.state)||!st.value.viaAduId)continue;
    const adu=s.adus.get(st.value.viaAduId)?.value;if(!adu)continue;
    const issues=validateStance(adu,st.value);
    if(issues.some(i=>i.code==='rhetorical_overcommitted'))emit({...base,mediaMs:originalTime(st.value.id),eventId:`${sid}:qa-v1:${st.value.id}:strength`,type:'item.edited',payload:{itemId:st.value.id,patch:{strength:'leaning'},reason:'Ontology §8.6 caps rhetorical implied commitments at leaning'}});
    else if(issues.some(i=>['non_attributable_stance','non_committing_stance'].includes(i.code)))reject(st.value.id,'Non-committing speech act');
  }
  const utterances=[...s.utterances.values()];
  const claimItems: ReviewItem[]=[];
  for(const st of s.stances.values()) {
    const prop=s.propositions.get(st.value.propositionId);if(!active(st.state)||!prop||!active(prop.state))continue;
    const adu=st.value.viaAduId?s.adus.get(st.value.viaAduId)?.value:undefined;
    const positions=(adu?.spans??[]).map(span=>utterances.findIndex(u=>u.id===span.utteranceId)).filter(i=>i>=0);
    const context=[...new Set(positions.flatMap(i=>[i-2,i-1,i,i+1]))].filter(i=>i>=0&&i<utterances.length).map(i=>({speaker:utterances[i]!.participantKey,text:utterances[i]!.text}));
    claimItems.push({id:st.value.id,kind:'claim',content:{proposition:prop.value,stance:st.value,speechAct:adu?.speechAct},evidence:{participants:s.participants,quotes:adu?.spans.map(x=>x.quote),context}});
  }
  await assess(claimItems);
  for(const p of s.propositions.values())if(active(p.state)&&![...s.stances.values()].some(st=>st.value.propositionId===p.value.id&&active(st.state)))reject(p.value.id,'No surviving faithful stance supports this proposition');
  let view=buildMapView(s);
  const map=reviewMap(view);
  const relationItems:ReviewItem[]=[];
  for(const r of s.relations.values())if(active(r.state)) {
    if(!view.props.has(r.value.fromId)||!view.props.has(r.value.toId)){reject(r.value.id,'An endpoint was rejected in the source review');continue;}
    relationItems.push({id:r.value.id,kind:'relation',content:r.value,evidence:map.filter(p=>[r.value.fromId,r.value.toId].includes(p.id))});
  }
  await assess(relationItems,25);
  view=buildMapView(s);
  const evidence={participants:s.participants,commitments:reviewMap(view),note:'These are historical candidate cards, not confirmed agreement. Check sources and substantive consistency; a card may describe an earlier phase. Stance atMs records time.'};
  const cards:ReviewItem[]=[];
  for(const i of s.insights.values())if(active(i.state)&&['crux','higher_ground','prompt'].includes(i.value.kind)) {
    if(i.value.refs.some(id=>!view.props.has(id))){reject(i.value.id,'A referenced claim was rejected in the source review');continue;}
    cards.push({id:i.value.id,kind:i.value.kind,content:i.value.body,evidence});
  }
  await assess(cards,12);
  const finalView=buildMapView(s);
  const lastSeq=Math.max(0,...events.map(e=>Number(/:l4:(\d+):/.exec(e.eventId)?.[1]??0)))+1;
  const final=await runL4(finalView,{sessionId:sid,seq:lastSeq,mediaMs:s.lastMediaMs,formatId:s.formatId??'open',roundId:s.round?.roundId??null,recent:utterances.slice(-12).map(u=>({speaker:u.participantKey,text:u.text})),previous:{},previousShared:'',wallTs:()=>base.wallTs});
  if(final.error)throw new Error(final.error);
  for(const e of final.events)emit(e);
  writeFileSync(`.data/qa/${sid}.corrections.jsonl`,patch.map(e=>JSON.stringify(e)).join('\n')+'\n');
  writeFileSync(`.data/qa/${sid}.review.json`,JSON.stringify({sessionId:sid,reviewed:verdicts.length,before:{props:buildMapView(original).props.size},after:{props:finalView.props.size},corrections:patch.length,verdicts},null,2));
  console.log(`READY ${sid}: ${verdicts.length} reviewed, ${patch.length} correction events`);
}
async function main(){
 const env=parseEnv(readFileSync('.env','utf8'));for(const [k,v]of Object.entries(env))if(!process.env[k])process.env[k]=v;
 // Independent sessions can be reviewed concurrently; each session's corrections remain ordered.
 const pending=[...sessions];await Promise.all(Array.from({length:3},async()=>{while(pending.length){const sid=pending.shift()!;await audit(sid);}}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
