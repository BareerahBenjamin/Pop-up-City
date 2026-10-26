'use strict';
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
