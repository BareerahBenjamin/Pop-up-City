import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const {HerstoryProfileSave:save}=runInNewContext(readFileSync(new URL('../public/profile-save.js',import.meta.url),'utf8')+';globalThis',{setTimeout});
const body={nickname:'Rae',bio:'hihi',skills:'睡觉',needs:'睡觉的地方',card_public:true,avatar:{release:'v1',selection:{a:'x',b:'y'}},finalize:true};
const result={member:{id:'owner',...body,avatar_locked:true},next:'/#planet/welcome'};
const network=()=>Object.assign(new Error('network closed'),{network:true});
const noWait=async()=>{};
test('lost response after committing reconciles saved profile without another write',async()=>{
 const calls=[];const actual=await save.save(async(path,options)=>{calls.push(options?.method||'GET');if(options?.method)throw network();return result},'owner',body,noWait);
 assert.equal(actual,result);assert.deepEqual(calls,['PATCH','GET']);
});
test('lost request before committing retries once only after confirming same unsaved owner',async()=>{
 let patches=0,reads=0;const actual=await save.save(async(path,options)=>{if(options?.method){assert.equal(options.headers['X-Profile-Owner'],'owner');if(++patches===1)throw network();return result}reads++;return {member:{...result.member,avatar_locked:false}}},'owner',body,noWait);
 assert.equal(actual,result);assert.equal(patches,2);assert.equal(reads,1);
});
test('one failed reconciliation read can recover on the next read',async()=>{
 let reads=0;assert.equal(await save.save(async(path,options)=>{if(options?.method)throw network();if(++reads===1)throw network();return result},'owner',body,noWait),result);assert.equal(reads,2);
});
test('persistent disconnection never reports saved or blindly repeats an uncertain write',async()=>{
 let writes=0,reads=0;await assert.rejects(save.save(async(path,options)=>{if(options?.method)writes++;else reads++;throw network()},'owner',body,noWait),e=>e.network);assert.equal(writes,1);assert.equal(reads,2);
});
test('validation errors are preserved without network retries',async()=>{
 let calls=0;await assert.rejects(save.save(async()=>{calls++;throw Object.assign(new Error('invalid'),{status:400})},'owner',body,noWait),e=>e.status===400);assert.equal(calls,1);
});
test('session expiration and changed account stop recovery and never write to another owner',async()=>{
 for(const changed of [false,true]){let writes=0;await assert.rejects(save.save(async(path,options)=>{if(options?.method){writes++;throw network()}if(!changed)throw Object.assign(new Error('expired'),{status:401});return {member:{...result.member,id:'other'}}},'owner',body,noWait),e=>e.status===401);assert.equal(writes,1)}
});
test('a different locked avatar or profile is not accepted as a successful save',async()=>{
 for(const member of [{...result.member,avatar:{release:'v1',selection:{a:'z',b:'y'}}},{...result.member,nickname:'another tab'}]){let writes=0;await assert.rejects(save.save(async(path,options)=>{if(options?.method){writes++;throw network()}return {member}},'owner',body,noWait),e=>e.status===409);assert.equal(writes,1)}
});
test('ordinary profile edit reconciles editable fields while retaining locked avatar',async()=>{
 const edit={nickname:'新名字',bio:'新介绍',skills:'绘画',needs:'合作',card_public:false};const saved={member:{...result.member,...edit}};assert.equal(await save.save(async(path,options)=>{if(options?.method)throw network();return saved},'owner',edit,noWait),saved);
});
