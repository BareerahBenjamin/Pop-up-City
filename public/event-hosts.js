'use strict';
let eventHostCandidates=[],eventHostTrigger=null;
function eventHostOptions(selected,query=''){
 const term=query.trim().toLocaleLowerCase();
 const members=eventHostCandidates.filter(m=>m.id===selected||!term||`${m.nickname} ${m.email}`.toLocaleLowerCase().includes(term));
 return `<option value="">请选择发起人</option>${members.map(m=>`<option value="${esc(m.id)}" ${m.id===selected?'selected':''}>${esc(m.nickname)} · ${esc(m.email)}</option>`).join('')}`;
}
async function handleEventHostAction(button){
 if(button.dataset.action!=='change-event-host')return false;
 const event=state.events.find(e=>e.id===button.dataset.id);if(!event)return true;
 const owner=state.me?.id;if(state.me?.role!=='admin')throw new Error('仅管理员可以修改活动发起人');
 button.disabled=true;
 try{
  const data=await api('/api/admin/event-hosts');if(state.me?.id!==owner||state.me?.role!=='admin')return true;
  eventHostCandidates=data.members;eventHostTrigger=button;
  modal(`<h2 id="dialog-title">修改活动发起人</h2><p>${esc(event.title)}</p><p class="muted">当前发起人：${esc(event.host_nickname)}</p><form id="event-host-form" data-event-id="${esc(event.id)}" data-previous-host="${esc(event.host_id)}"><label for="host-search">搜索已注册用户</label><input id="host-search" type="search" placeholder="昵称或邮箱" autocomplete="off"><label for="event-host-select">新的活动发起人</label><select id="event-host-select" name="host_id" required aria-describedby="host-help host-form-error">${eventHostOptions(event.host_id)}</select><p id="host-help" class="muted">仅可选择已注册且未停用的用户。保存后由新发起人管理活动和课件。</p><p id="host-form-error" class="error" role="alert"></p><div class="modal-actions"><button class="btn light" type="button" data-action="close">取消</button><button class="btn" type="submit">保存发起人</button></div></form>`);
 }finally{button.disabled=false;}
 return true;
}
document.addEventListener('input',event=>{if(event.target.id==='host-search'){const select=document.getElementById('event-host-select');select.innerHTML=eventHostOptions(select.value,event.target.value);}});
document.addEventListener('submit',async event=>{
 const form=event.target;if(form.id!=='event-host-form')return;event.preventDefault();if(form.dataset.busy)return;
 form.dataset.busy='1';form.setAttribute('aria-busy','true');const submit=form.querySelector('[type=submit]'),errorNode=form.querySelector('#host-form-error');submit.disabled=true;submit.textContent='正在保存…';errorNode.textContent='';
 try{
  await api(`/api/admin/events/${form.dataset.eventId}/host`,{method:'PATCH',body:{host_id:form.elements.host_id.value,previous_host_id:form.dataset.previousHost}});
  if(!form.isConnected||!document.getElementById('modal').open){await refresh();return;}
  close();await refresh();toast('活动发起人已更新');
  document.querySelector(`[data-action="change-event-host"][data-id="${form.dataset.eventId}"]`)?.focus({preventScroll:true});
 }catch(error){errorNode.textContent=error.message;form.elements.host_id.setAttribute('aria-invalid','true');}
 finally{delete form.dataset.busy;form.removeAttribute('aria-busy');submit.disabled=false;submit.textContent='保存发起人';}
});
document.addEventListener('change',event=>{if(event.target.id==='event-host-select')event.target.removeAttribute('aria-invalid');});
document.getElementById('modal').addEventListener('close',()=>{const trigger=eventHostTrigger;eventHostTrigger=null;if(trigger?.isConnected)trigger.focus({preventScroll:true});});
