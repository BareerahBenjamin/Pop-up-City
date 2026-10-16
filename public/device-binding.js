const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let stopCurrent=()=>{};
export function showDeviceBinding({member,api,modal,onBound}){
 stopCurrent();let active=true,timer,requestId,completed=false;
 const base=`/api/admin/members/${member.id}/device-claims`;
 const dialog=document.querySelector('#modal');
 const stop=()=>{if(!active)return;active=false;clearTimeout(timer);dialog.removeEventListener('close',stop);if(requestId&&!completed)api(base,{method:'DELETE',body:{request_id:requestId}}).catch(()=>{});};stopCurrent=stop;
 modal(`<h2 id="dialog-title">给 ${esc(member.nickname)} 绑定设备</h2><p>请让板子开机联网，输入屏幕上的四位领用码。</p><form id="device-claim-form"><label class="field">四位领用码<input name="code" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]{4}" maxlength="4" minlength="4" placeholder="例如 0087" required></label><p class="private-note">保留开头的零。领用码五分钟有效，绑定还需在板子上按 OK 确认。</p><p class="error" role="alert"></p><button class="btn">查找并申请绑定</button></form><div id="device-claim-status" role="status"></div>`);
 dialog.addEventListener('close',stop,{once:true});
 const form=document.querySelector('#device-claim-form'),view=document.querySelector('#device-claim-status');
 const poll=async()=>{
  if(!active||!dialog.open||!view.isConnected)return;
  const polling=requestId;
  try{
   const state=await api(base+'?request_id='+encodeURIComponent(polling));if(!active||requestId!==polling)return;
   if(state.state==='bound'){completed=true;
    view.innerHTML=`<p class="notice">绑定成功！这块板子已属于 ${esc(member.nickname)}，板子将自动读取个人星球。</p>`;stop();onBound?.();return;
   }
   if(state.state==='expired'){view.textContent='领用码已过期，请读取板子上的新码后重试。';form.hidden=false;return;}
   view.innerHTML=`<p class="notice">正在绑定给 ${esc(member.nickname)}。请核对板子上的账号提示，并在板子上按 OK 确认；长按 OK 可以拒绝。</p><button type="button" id="cancel-device-claim" class="text-button">取消这次申请</button>`;
   document.querySelector('#cancel-device-claim').onclick=async()=>{try{await api(base,{method:'DELETE',body:{request_id:requestId}});requestId=null;clearTimeout(timer);form.hidden=false;view.textContent='申请已取消，可重新输入领用码。';}catch(e){view.textContent=e.message;}};
  }catch(error){if(!active||requestId!==polling)return;if(error.status===404){view.textContent='板子已拒绝或申请已取消，请重新输入屏幕领用码。';form.hidden=false;return;}if(error.status===401||error.status===403){view.textContent=error.message;stop();return;}view.textContent='连接暂不可用，正在查询绑定结果…';}
  if(active&&requestId===polling)timer=setTimeout(poll,2000);
 };
 form.onsubmit=async event=>{
  event.preventDefault();if(form.dataset.busy)return;form.dataset.busy='1';form.querySelector('[role=alert]').textContent='';
  try{
   const code=String(new FormData(form).get('code')).trim();if(!/^\d{4}$/.test(code))throw Error('请输入四位数字，保留开头的零');
   const result=await api(base,{method:'POST',body:{code}});if(!active){await api(base,{method:'DELETE',body:{request_id:result.request_id}});return;}requestId=result.request_id;form.hidden=true;await poll();
  }catch(error){if(active)form.querySelector('[role=alert]').textContent=error.message;}finally{delete form.dataset.busy;}
 };
 form.elements.code.focus();
}
