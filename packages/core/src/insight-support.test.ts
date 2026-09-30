import {expect,it} from 'vitest';
import {emptyState,type Tracked} from './state';
import {insightSupported} from './insight-support';
import type {Insight} from './events';
import type {Proposition,Stance} from '@adl/ontology';
const track=<T>(value:T):Tracked<T>=>({value,state:'approved',issues:[],proposedAtWall:''});
it('invalidates a synthesis when either participant withdraws a supporting commitment',()=>{
 const s=emptyState('test');s.participants=[{key:'A',displayName:'A',role:'debater'},{key:'B',displayName:'B',role:'debater'}];
 for(const key of ['A','B']){s.propositions.set(key,track({id:key} as Proposition));s.stances.set(key,track({id:key,propositionId:key,participantKey:key,atMs:0,attitude:'accepts',source:'stated'} as Stance));}
 const i:Insight={id:'hg',kind:'higher_ground',refs:['A','B'],body:{text:'Independent audits could address both concerns.',construction:'pareto_move',derivation:{A:['A'],B:['B']},costs:{A:'nothing',B:'nothing'},reliesOnInferred:false}};
 expect(insightSupported(s,i)).toBe(true);
 s.stances.set('withdrawn',track({...s.stances.get('B')!.value,id:'withdrawn',atMs:1,attitude:'rejects'}));
 expect(insightSupported(s,i)).toBe(false);
});
it('never keeps a prompt whose source proposition has been rejected',()=>{
 const s=emptyState('test');s.propositions.set('p',track({id:'p'} as Proposition));
 const i:Insight={id:'q',kind:'prompt',refs:['p'],body:{text:'What supports this?'}};
 expect(insightSupported(s,i)).toBe(true);s.propositions.get('p')!.state='rejected';expect(insightSupported(s,i)).toBe(false);
});
