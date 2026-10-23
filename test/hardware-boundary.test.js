import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {checkHardwareBoundary} from '../scripts/check-hardware-boundary.mjs';
import {deviceGateway,isDevicePath,DeviceApiError} from '../hardware-interface/gateway.mjs';
test('hardware namespace includes device, enrollment and local only',async()=>{
 for(const path of ['/api/device/runtime','/local/host/submit','/api/device-enrollment/status'])assert.equal(isDevicePath(path),true);
 for(const path of ['/api/events','/api/admin/events','/api/device-looking-like-a-page','/'])assert.equal(isDevicePath(path),false);
 assert.equal(await deviceGateway(new Request('https://example.test/api/events'),{}),null);
 await assert.rejects(deviceGateway(new Request('https://example.test/api/device/runtime'),{}),e=>e instanceof DeviceApiError&&e.status===503);
});
test('boundary rejects modification, deletion, additions; frontend changes do not trip it',t=>{
 const root=mkdtempSync(join(tmpdir(),'popcity-boundary-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'hardware-interface'));mkdirSync(join(root,'protected'));mkdirSync(join(root,'public'));
 const sha=createHash('sha256').update('fixed').digest('hex');
 writeFileSync(join(root,'protected/core.mjs'),'fixed');
 writeFileSync(join(root,'hardware-interface/protected-files.json'),JSON.stringify({roots:['protected'],sha256:{'protected/core.mjs':sha}}));
 assert.equal(checkHardwareBoundary(root),1);
 writeFileSync(join(root,'public/app.js'),'frontend edit');assert.equal(checkHardwareBoundary(root),1);
 writeFileSync(join(root,'protected/core.mjs'),'changed');assert.throws(()=>checkHardwareBoundary(root),/modified/);
 writeFileSync(join(root,'protected/core.mjs'),'fixed');writeFileSync(join(root,'protected/new.mjs'),'new');assert.throws(()=>checkHardwareBoundary(root),/addition/);
 rmSync(join(root,'protected/new.mjs'));rmSync(join(root,'protected/core.mjs'));assert.throws(()=>checkHardwareBoundary(root),/deleted/);
});
