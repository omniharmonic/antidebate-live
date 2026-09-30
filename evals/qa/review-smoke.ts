import {readFileSync,writeFileSync} from 'node:fs';import {parseEnv} from 'node:util';
Object.assign(process.env,parseEnv(readFileSync('.env','utf8')));process.env.LLM_PROVIDER='api';
const spent=JSON.parse(readFileSync('.cache/llm/api-spend.json','utf8')).usd;process.env.LLM_API_BUDGET_USD=String(spent+1);
const {reviewItems}=await import('../../packages/pipeline/src/review');
const evidence={participants:['A','B'],commitments:[{id:'p1',speaker:'A',attitude:'accepts',canonical:'Independent safety audits should be required.',quote:'I support mandatory independent safety audits.'},{id:'p2',speaker:'B',attitude:'accepts',canonical:'Independent audits would help users compare models.',quote:'Independent audits could help users compare models, but I oppose mandatory licensing.'}]};
const items=[
{id:'faithful',kind:'higher_ground',content:{text:'Independent safety audits could help people evaluate models, while the requirement to undergo them remains disputed.',costs:{A:'nothing',B:'nothing'},status:'candidate'},evidence,expected:'pass'},
{id:'forced',kind:'higher_ground',content:{text:'Both should support a mandatory international licensing agency by 2027.',costs:{A:'nothing',B:'give up opposition to licensing'},status:'candidate'},evidence,expected:'reject'},
{id:'guessed-update',kind:'crux',content:{statement:'Audits should be mandatory.',updateConditions:{B:'B would update if audits lowered risk by 20%.'}},evidence,expected:'reject'},
{id:'neutral-question',kind:'prompt',content:{text:'What would make an audit credible to each of you?',addresseeKey:'both'},evidence,expected:'pass'},
{id:'false-premise',kind:'prompt',content:{text:'Why have you both agreed to international licensing?',addresseeKey:'both'},evidence,expected:'reject'},
{id:'rejection-polarity',kind:'claim',content:{canonical:'All regulation is harmful.',stance:{attitude:'rejects',strength:'confident'}},evidence:{quote:'I do not believe all regulation is harmful.'},expected:'pass'},
];
const r=await reviewItems(items.map(({expected,...item})=>item),'qa-authored-review');
const results=items.map(item=>({id:item.id,expected:item.expected,...r.verdicts.find(v=>v.id===item.id)}));
writeFileSync('.data/qa/review-smoke.json',JSON.stringify({error:r.error,log:r.log,results},null,2));console.log(JSON.stringify(results,null,2));
