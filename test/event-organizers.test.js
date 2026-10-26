import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('Team1 is a website display alias for exactly three tasks managed by the real account',()=>{
 const context=vm.createContext({document:{addEventListener(){}},Date,Intl});
 vm.runInContext(['event-options.js','dashboard.js'].map(name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8')).join('\n'),context);
 const ids=['f8fb1d84-74d5-4758-bb07-a2876a3bdbb5','e518dfc2-3c25-4262-8347-27fe6ffc2f66','18c62200-f02e-4d64-a0ba-2e1ce48b78e3'];
 const events=ids.map(id=>Object.freeze({id,host_id:'0aeff874-c8e3-49a4-9fe3-eb7b440f5bc0',host_nickname:'海椰',title:'系列任务',category:'任务',location:'线上',starts_at:1000,ends_at:2000,status:'published'}));
 for(const event of events)assert.equal(context.eventOrganizerName(event),'Team1');
 assert.equal(context.eventOrganizerName({...events[0],id:'other-event'}),'海椰');
 assert.equal(context.eventOrganizerName({...events[0],host_id:'new-host',host_nickname:'新的发起人'}),'新的发起人');
 for(const query of ['team1','海椰'])assert.equal(context.filterDiscovery(events,{query,category:'',scope:'all'},1500).length,3);
 assert.ok(events.every(event=>event.host_nickname==='海椰'&&event.host_id==='0aeff874-c8e3-49a4-9fe3-eb7b440f5bc0'));
});
