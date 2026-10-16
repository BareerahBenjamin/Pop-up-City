const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function hardwarePage(api,events){
 const data=await api('/api/admin/hardware');
 const devices=data.devices,options=devices.map(d=>`<option value="${esc(d.id)}" data-kind="${esc(d.role)}" data-order="${esc(d.rgb565_byte_order||'little')}">${esc(d.nickname)} · ${esc(d.id)}</option>`).join('');
 const userOptions=devices.filter(d=>d.role==='user').map(d=>`<option value="${esc(d.id)}">${esc(d.nickname)} · ${esc(d.id)}</option>`).join('');
 const eventOptions=events.map(e=>`<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('');
 return `<h1>硬件管理</h1><p>先在成员管理绑定设备。任何成员发布的活动开始后，本人的用户板自动进入签到模式，无需额外授权；活动结束后退出。设备类型保存后不能切换。</p><div class="table-wrap"><table><thead><tr><th>成员／设备</th><th>类型</th><th>画面字节序</th><th>指定签到板</th></tr></thead><tbody>${devices.map(d=>`<tr><td>${esc(d.nickname)}<br><small>${esc(d.id)}</small></td><td>${d.role==='checkin'?'签到板':'用户板'}</td><td>${esc(d.rgb565_byte_order||'未配置')}</td><td>${d.role==='checkin'?'—':esc(d.station_device_id||'仅一块可用签到板时自动选择')}</td></tr>`).join('')}</tbody></table></div>
 <div class="split"><form class="panel" data-hardware-form="profile"><h3>设备类型与画面</h3><label class="field">设备<select name="device_id">${options}</select></label><label class="field">类型<select name="device_kind"><option value="user" ${devices[0]?.role!=='checkin'?'selected':''}>用户板</option><option value="checkin" ${devices[0]?.role==='checkin'?'selected':''}>固定签到板</option></select></label><label class="field">RGB565 字节序<select name="rgb565_byte_order"><option value="little" ${devices[0]?.rgb565_byte_order!=='big'?'selected':''}>little</option><option value="big" ${devices[0]?.rgb565_byte_order==='big'?'selected':''}>big</option></select></label><p>须按固件显示路径确认字节序。</p><button class="btn">保存</button><p role="status"></p></form>
 <form class="panel" data-hardware-form="station"><h3>签到板活动授权</h3><label class="field">签到板<select name="station_device_id">${devices.filter(d=>d.role==='checkin').map(d=>`<option value="${esc(d.id)}" data-kind="${esc(d.role)}" data-order="${esc(d.rgb565_byte_order||'little')}">${esc(d.nickname)} · ${esc(d.id)}</option>`).join('')}</select></label><label class="field">活动<select name="activity_id">${eventOptions}</select></label><p>授权窗口采用活动开始前一小时。活动需已发布，用户需已报名。</p><label><input type="checkbox" name="revoked">撤销此授权</label><button class="btn">保存授权</button><p role="status"></p></form>
 <form class="panel" data-hardware-form="station-link"><h3>用户板对应签到板</h3><label class="field">用户板<select name="device_id">${userOptions}</select></label><label class="field">签到板<select name="station_device_id"><option value="">自动选择</option>${devices.filter(d=>d.role==='checkin').map(d=>`<option value="${esc(d.id)}" data-kind="${esc(d.role)}" data-order="${esc(d.rgb565_byte_order||'little')}">${esc(d.nickname)} · ${esc(d.id)}</option>`).join('')}</select></label><button class="btn">保存</button><p role="status"></p></form>
 </div>
 <h3>当前活动授权</h3><div class="table-wrap"><table><thead><tr><th>方式</th><th>设备</th><th>活动</th><th>状态</th></tr></thead><tbody>${[...data.station_activities.map(a=>({...a,device_id:a.station_device_id,kind:'固定签到板'}))].map(a=>`<tr><td>${a.kind}</td><td>${esc(a.device_id)}</td><td>${esc(events.find(e=>e.id===a.activity_id)?.title||a.activity_id)}</td><td>${a.revoked_at?'已撤销':'已授权'}</td></tr>`).join('')}</tbody></table></div>`;
}
export async function submitHardware(form,api,events){
 const data=new FormData(form),body=Object.fromEntries(data),kind=form.dataset.hardwareForm;
 if(kind==='profile')await api(`/api/admin/devices/${body.device_id}/hardware`,{method:'PUT',body:{device_kind:body.device_kind,...(body.device_kind==='user'?{rgb565_byte_order:body.rgb565_byte_order}:{})}});
 if(kind==='station'){
  const e=events.find(e=>e.id===body.activity_id);if(!e)throw Error('请选择活动');
  await api('/api/admin/checkin-stations/activities',{method:'PUT',body:{station_device_id:body.station_device_id,activity_id:e.id,opens_at:e.starts_at-3600,closes_at:e.starts_at,revoked:data.has('revoked')}});
 }
 if(kind==='station-link')await api('/api/admin/hardware/configure',{method:'PUT',body:{device_id:body.device_id,station_device_id:body.station_device_id||null}});
 if(kind==='host')await api('/api/admin/hardware/configure',{method:'PUT',body:{device_id:body.device_id,host_activity_id:body.host_activity_id,enabled:data.has('enabled')}});
}
