(()=>{
'use strict';
const overlays=new Map();let returning=false;
function theme(){const photo=document.querySelector('#planet-card')?.open,reports=document.querySelector('#reports-view')?.open;document.querySelector('meta[name="theme-color"]').content=photo?'#EFE9DB':reports||document.body.dataset.tab==='mine'?'#f5f5e9':'#0C1210';}
function register(dialog,canRestore=()=>true){dialog.addEventListener('close',theme);overlays.set(dialog.id,{dialog,canRestore});dialog.addEventListener('cancel',event=>{event.preventDefault();close(dialog);});}
function open(dialog){if(returning)return false;if(dialog.open)return true;dialog.showModal();theme();history.pushState({...history.state,herstoryOverlay:dialog.id},'',location.href);return true;}
function close(dialog){if(!dialog.open)return;dialog.close();if(history.state?.herstoryOverlay===dialog.id){returning=true;history.back();}}
addEventListener('popstate',()=>{returning=false;const id=history.state?.herstoryOverlay;for(const [key,entry]of overlays){if(key!==id&&entry.dialog.open)entry.dialog.close();}const entry=overlays.get(id);if(entry&&!entry.dialog.open){if(entry.canRestore()){entry.dialog.showModal();theme();}else{const state={...history.state};delete state.herstoryOverlay;history.replaceState(state,'',location.href);}}});
// A reload has no photo Blob to restore; remove a stale transient marker.
if(history.state?.herstoryOverlay){const state={...history.state};delete state.herstoryOverlay;history.replaceState(state,'',location.href);}
window.HerstoryModal={register,open,close};
})();
