import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function websiteContext(){
 const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}},Date,Intl});
 for(const file of ['vendor/planet/frontend/ui-design/report-model.js','public/planet-host.js','public/planet-reports.js'])
  vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 return context;
}
test('photo labels follow Shanghai campaign dates without advancing runtime growth',()=>{
 const c=websiteContext();
 assert.equal(c.planetPhotoDate(Date.parse('2026-10-29T16:00:00Z')),'2026-10-30');
 for(const [date,day]of [['2026-10-18',0],['2026-10-19',1],['2026-10-25',7],['2026-10-30',12],['2026-11-01',14]])assert.equal(c.planetPhotoDay(date),day);
 const runtime={day:0,growth:{unitIds:[]}},photo={config:{day:0,date:'2026-10-30'}};
 c.mountPlanetPhoto({contentWindow:{HerstoryPhoto:photo,HerstoryApp:{getState:()=>({snapshot:runtime})}}});
 assert.equal(photo.config.day,12);
 photo.config.date='2026-10-31';assert.equal(photo.config.day,13);
 assert.deepEqual(runtime,{day:0,growth:{unitIds:[]}});
});
test('current report images retain their capture date and never become historical archives',()=>{
 const c=websiteContext(),model=c.window.HerstoryReportModel;
 const base=model.build('week',null,{userId:'member'}),report={open:true,opens_at:'2026-10-26T00:00:00+08:00',cutoff_at:'2026-10-25T16:00:00Z',records:{checkins:[],hosted:[],friends:[]},counts:{checkins:0,days:0,hosted:0},note:'历史留影尚未归档'};
 const shot={image_url:'data:image/png;base64,fixture',captured_at:'2026-10-30T02:00:00Z',caption:'当前星球 · 拍摄于 2026/10/30 10:00（上海时间）',source:'current',view_key:'website-current'};
 const view=c.websitePlanetReport(model,base,report,shot);
 assert.equal(view.snapshot,shot);assert.match(view.phase.copy,/当前星球.*2026\/10\/30/);
 assert.equal(view.cutoff,report.cutoff_at);assert.equal(view.finalized,false);assert.equal(view.freezeEligible,false);
 assert.equal(view.snapshot.cutoff_at,undefined);assert.match(view.issues.join(' '),/历史留影尚未归档/);
 assert.equal(base.phase.copy,model.phases[0].copy);
 assert.equal(c.websitePlanetReport(model,base,report).snapshot,null);
 const locked=c.websitePlanetReport(model,model.build('full',null,{userId:'member'}),{open:false},shot);
 assert.equal(locked.snapshot,null);assert.equal(locked.ready,false);
});
