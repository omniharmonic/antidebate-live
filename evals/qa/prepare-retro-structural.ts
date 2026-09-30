/** Local-only, deterministic corrections. Original logs remain intact; production publish is separate. */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {project,type DomainEvent} from '../../packages/core/src/index';
import {validateStance} from '../../packages/ontology/src/index';
const sessions=['ball-kokotajlo-r5','belief-in-god-r3','open-source-ai-r3','gender-affirming-care-r3','destiny-shermer-r3','ignite-talk-r1'];
mkdirSync('.data/qa/corrected',{recursive:true});
for(const sid of sessions){
 const backup=`.data/qa/${sid}.production-before.jsonl`;
 const events=readFileSync(existsSync(backup)?backup:`.data/${sid}.events.jsonl`,'utf8').trim().split('\n').map(l=>JSON.parse(l) as DomainEvent);
 const s=project(sid,events);const patch:DomainEvent[]=[];
 const edit=(id:string,changes:Record<string,unknown>,reason:string)=>{
  const mediaMs=events.find(e=>e.eventId===`${id}:proposed`)?.mediaMs??s.lastMediaMs;
  patch.push({eventId:`${sid}:qa-structural-v1:${id}`,sessionId:sid,actor:'system',mediaMs,wallTs:new Date().toISOString(),type:'item.edited',payload:{itemId:id,patch:changes,reason}});
 };
 for(const st of s.stances.values()){
  if(!['approved','released'].includes(st.state)||!st.value.viaAduId)continue;
  const adu=s.adus.get(st.value.viaAduId)?.value;
  if(adu&&validateStance(adu,st.value).some(i=>i.code==='rhetorical_overcommitted'))edit(st.value.id,{strength:'leaning'},'QA: ontology §8.6 caps rhetorical implied commitment at leaning');
 }
 for(const i of s.insights.values()){
  if(i.value.kind!=='crux'||!['approved','released'].includes(i.state))continue;
  const body=i.value.body as {sides?:{stanceId:string;attitude:string;strength:string;via?:unknown}[]};
  let changed=false;const sides=body.sides?.map(side=>{
   const stance=s.stances.get(side.stanceId)?.value;
   if(!stance||!side.via||side.attitude===stance.attitude&&side.strength===stance.strength)return side;
   changed=true;return {...side,attitude:stance.attitude,strength:stance.strength};
  });
  if(changed)edit(i.value.id,{body:{...body,sides}},'QA: a clash side carries its stance on its own cited claim; an attack on an inference does not establish rejection of the conclusion');
 }
 writeFileSync(`.data/qa/${sid}.structural-corrections.jsonl`,patch.map(e=>JSON.stringify(e)).join('\n')+(patch.length?'\n':''));
 writeFileSync(`.data/qa/corrected/${sid}.events.jsonl`,[...events,...patch].map(e=>JSON.stringify(e)).join('\n')+'\n');
 console.log(sid,patch.length,'append-only corrections prepared');
}
