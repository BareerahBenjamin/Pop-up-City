'use strict';
// Presentation names are scoped to these three tasks and their real manager.
// Keep host_id and host_nickname intact for permissions and device consumers.
const team1EventIds=new Set(['f8fb1d84-74d5-4758-bb07-a2876a3bdbb5','e518dfc2-3c25-4262-8347-27fe6ffc2f66','18c62200-f02e-4d64-a0ba-2e1ce48b78e3']);
function eventOrganizerName(event){
 return event.host_id==='0aeff874-c8e3-49a4-9fe3-eb7b440f5bc0'&&team1EventIds.has(event.id)?'Team1':event.host_nickname||'';
}
const isWebPinned=(event,now=Date.now()/1000)=>event.pinned===true&&event.status==='published'&&event.ends_at>now;
function eventPinButton(event){
 if(state.me?.role!=='admin'||!event.pinned_at&&(event.status!=='published'||event.ends_at<=Date.now()/1000))return '';
 return `<button type="button" class="btn light" data-action="toggle-event-pin" data-id="${esc(event.id)}" aria-pressed="${Boolean(event.pinned_at)}">${event.pinned_at?'取消置顶':'置顶活动'}</button>`;
}
async function handleEventOptionsAction(button){
 if(button.dataset.action!=='toggle-event-pin')return false;
 const event=state.events.find(e=>e.id===button.dataset.id);if(!event)return true;
 if(button.dataset.busy)return true;button.dataset.busy='1';button.disabled=true;
 try{await api(`/api/admin/events/${event.id}/pin`,{method:'PUT',body:{pinned:!event.pinned_at}});await refresh();toast(event.pinned_at?'已取消置顶':'活动已置顶');document.querySelector(`[data-action="toggle-event-pin"][data-id="${event.id}"]`)?.focus({preventScroll:true});}
 finally{delete button.dataset.busy;button.disabled=false;}
 return true;
}
