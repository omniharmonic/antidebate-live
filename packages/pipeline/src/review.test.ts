import { expect, it } from 'vitest';
import { setCaller } from '@adl/llm';
import { reviewItems } from './review';
const log = {} as never;
it('fails closed for missing, duplicate and invented review verdicts', async () => {
 setCaller(async()=>({ok:true,log,data:{verdicts:[{id:'a',verdict:'pass',reason:'ok'},{id:'a',verdict:'pass',reason:'again'},{id:'invented',verdict:'pass',reason:'ok'}]}}));
 const r=await reviewItems(['a','b'].map(id=>({id,kind:'higher_ground',content:{},evidence:[]})),'test');
 expect(r.verdicts.map(v=>[v.id,v.verdict])).toEqual([['a','reject'],['b','reject']]);
});
it('deduplicates shared context without dropping evidence and reports provider failure', async()=>{
 setCaller(async c=>{const input=JSON.parse(c.input);expect(input.evidence).toHaveLength(1);expect(input.items.map((x:any)=>x.evidenceIndex)).toEqual([0,0]);return {ok:false,reason:'provider_error',detail:'offline',log};});
 const r=await reviewItems(['a','b'].map(id=>({id,kind:'relation',content:{},evidence:{quote:'Same actual words'}})),'test');
 expect(r.verdicts).toEqual([]);expect(r.error).toContain('offline');
});
