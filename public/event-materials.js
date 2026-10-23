'use strict';
const materialLists=new Map();
const materialContext=e=>`${state.me?.id||'guest'}:${state.me?.role||''}:${e.host_id}:${e.status}`;
let materialRequest=0,materialDialogTrigger=null;
const materialSize=bytes=>bytes<1024*1024?`${Math.max(1,Math.ceil(bytes/1024))} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
function eventMaterialsSection(event){
 const cached=materialLists.get(event.id),data=cached?.context===materialContext(event)?cached.data:null;
 const canManage=Boolean(state.me&&(state.me.role==='admin'||state.me.id===event.host_id));
 return `<section class="event-materials" id="event-materials" data-event-id="${esc(event.id)}" aria-labelledby="materials-title"><div class="section-head"><div><span class="eyebrow">LEARN / KEEP EXPLORING</span><h2 id="materials-title" tabindex="-1">课件与资料</h2><p>把课堂里的灵感，带回日常。活动结束后也可以继续查阅。</p></div>${canManage?`<button type="button" class="btn light" data-action="material-upload" data-id="${esc(event.id)}">上传课件 ＋</button>`:''}</div><div id="material-list" aria-live="polite">${data?materialsMarkup(data):'<p class="muted" role="status">正在加载课件…</p>'}</div>${canManage?'<p class="material-help">支持 HTML 在线预览、PPT／PPTX 下载。单个文件不超过 20 MB；活动结束后仍可上传、编辑或替换。</p>':''}</section>`;
}
function materialsMarkup(data){
 if(!data.materials.length)return '<p class="empty">课件还在整理中，上传后会显示在这里。</p>';
 return `<ul class="material-list">${data.materials.map(m=>`<li class="material-card" data-material-id="${esc(m.id)}"><div class="material-heading"><span class="badge neutral">${esc(m.format.toUpperCase())}</span><h3>${esc(m.title)}</h3></div><p class="muted material-meta">${esc(m.filename)} · ${materialSize(m.byte_length)} · 更新于 ${datetime(m.updated_at)}</p><div class="material-actions"><a class="text-button" href="${esc(m.download_url)}" download>下载 ${esc(m.format.toUpperCase())}</a>${data.can_manage?`<button type="button" class="text-button" data-action="material-edit" data-id="${esc(m.id)}">编辑课件</button><button type="button" class="text-button" data-action="material-remove" data-id="${esc(m.id)}">删除课件</button>`:''}</div>${m.preview_url?`<details class="material-preview"><summary>在线预览：${esc(m.title)}</summary><iframe loading="lazy" sandbox="allow-scripts" referrerpolicy="no-referrer" title="${esc(m.title)} · HTML课件预览" src="${esc(m.preview_url)}"></iframe></details>`:'<p class="material-help">PPT 文件可下载查看；上传 HTML 版后可在线预览。</p>'}</li>`).join('')}</ul>`;
}
async function mountEventMaterials(force=false){
 const section=document.getElementById('event-materials');if(!section)return;
 const event=state.events.find(e=>e.id===section.dataset.eventId);if(!event)return;
 const context=materialContext(event),cached=materialLists.get(event.id);
 if(!force&&cached?.context===context)return;
 const request=++materialRequest,list=section.querySelector('#material-list');list.setAttribute('aria-busy','true');
 try{
  const data=await api(`/api/events/${event.id}/materials`);
  if(request!==materialRequest||!section.isConnected||context!==materialContext(state.events.find(e=>e.id===event.id)||event))return;
  materialLists.set(event.id,{context,data});list.innerHTML=materialsMarkup(data);
 }catch(error){
  if(request!==materialRequest||!section.isConnected)return;
  list.innerHTML=`<p class="error" role="alert">${esc(error.message)}</p><button class="btn light" type="button" data-action="materials-retry">重新加载课件</button>`;
 }finally{if(section.isConnected)list.removeAttribute('aria-busy');}
}
function materialDialog(html,trigger){materialDialogTrigger=trigger;modal(html);}
function materialEditor(id,trigger){
 const eventId=document.getElementById('event-materials')?.dataset.eventId;
 const item=id?materialLists.get(eventId)?.data.materials.find(m=>m.id===id):null;if(id&&!item){toast('课件列表已变化，请重新加载');return;}
 materialDialog(`<h2 id="dialog-title">${item?'编辑课件':'上传课件'}</h2><form id="material-form" data-event-id="${esc(eventId)}" data-material-id="${esc(item?.id||'')}" data-version="${item?.version||''}"><label for="material-title">课件名称</label><input id="material-title" name="title" maxlength="120" required value="${esc(item?.title||'')}" aria-describedby="material-form-error"><label for="material-file">${item?'替换文件（可选）':'课件文件'}</label><input id="material-file" name="file" type="file" accept=".html,.htm,.ppt,.pptx" ${item?'':'required'} aria-describedby="material-file-help material-form-error"><p class="muted" id="material-file-help">${item?`当前文件：${esc(item.filename)}。不选择新文件则保留原课件。<br>`:''}支持单文件 HTML、PPT 和 PPTX，每份不超过 20 MB。HTML 中的图片和样式请内嵌，或使用 HTTPS 地址。</p><p id="material-form-error" class="error" role="alert"></p><div class="modal-actions"><button class="btn light" type="button" data-action="close">取消</button><button class="btn" type="submit">${item?'保存课件':'上传课件'}</button></div></form>`,trigger);
}
async function handleEventMaterialsAction(button){
 const action=button.dataset.action;
 if(action==='materials-retry'){await mountEventMaterials(true);return true;}
 if(action==='material-upload'){materialEditor(null,button);return true;}
 if(action==='material-edit'){materialEditor(button.dataset.id,button);return true;}
 if(action==='material-remove'){
  const eventId=document.getElementById('event-materials')?.dataset.eventId,item=materialLists.get(eventId)?.data.materials.find(m=>m.id===button.dataset.id);if(!item)return true;
  materialDialog(`<h2 id="dialog-title">删除课件</h2><p>确定删除「${esc(item.title)}」吗？删除后将不再展示在活动详情中。</p><form id="material-delete-form" data-event-id="${esc(eventId)}" data-material-id="${esc(item.id)}" data-version="${item.version}"><p id="material-form-error" class="error" role="alert"></p><div class="modal-actions"><button type="button" class="btn light" data-action="close">保留课件</button><button type="submit" class="btn">确认删除课件</button></div></form>`,button);return true;
 }
 return false;
}
const materialBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件读取失败，请重新选择文件'));reader.readAsDataURL(file);});
document.addEventListener('submit',async event=>{
 const form=event.target;if(!['material-form','material-delete-form'].includes(form.id))return;event.preventDefault();if(form.dataset.busy)return;
 form.dataset.busy='1';form.setAttribute('aria-busy','true');const submit=form.querySelector('[type=submit]'),label=submit.textContent;submit.disabled=true;submit.textContent='正在保存…';
 const errorNode=form.querySelector('#material-form-error');errorNode.textContent='';
 try{
  const id=form.dataset.materialId,remove=form.id==='material-delete-form',input={...(id?{version:Number(form.dataset.version)}:{})};
  if(!remove){
   input.title=form.elements.title.value;const file=form.elements.file.files[0];
   if(file){if(file.size>20*1024*1024||!file.size)throw new Error('请上传非空课件，单个文件不超过 20 MB');input.filename=file.name;input.content=await materialBase64(file);}
  }
  await api(`/api/events/${form.dataset.eventId}/materials${id?'/'+id:''}`,{method:remove?'DELETE':id?'PATCH':'POST',body:input});
  const section=document.getElementById('event-materials');if(section?.dataset.eventId===form.dataset.eventId){await mountEventMaterials(true);}
  if(!form.isConnected||!document.getElementById('modal').open)return;
  close();document.querySelector('[data-action=material-upload]')?.focus({preventScroll:true});toast(remove?'课件已删除':'课件已保存');
 }catch(error){errorNode.textContent=error.message;const field=form.querySelector('#material-file');if(field)field.setAttribute('aria-invalid','true');}
 finally{delete form.dataset.busy;form.removeAttribute('aria-busy');submit.disabled=false;submit.textContent=label;}
});
document.addEventListener('change',event=>{if(event.target.id==='material-file')event.target.removeAttribute('aria-invalid');});
document.getElementById('modal').addEventListener('close',()=>{const trigger=materialDialogTrigger;materialDialogTrigger=null;if(trigger?.isConnected)trigger.focus({preventScroll:true});});
