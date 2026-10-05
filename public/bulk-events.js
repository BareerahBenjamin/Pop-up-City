'use strict';
const bulkHeaders=['活动名称','开始时间','结束时间','地点','介绍','类型','参与名额','志愿者名额'];
// Quoted CSV/TSV supports commas, tabs, line breaks and escaped double quotes in fields.
function parseEventRows(text){
  if(text.length>500000)throw new Error('内容过大，请分批添加，每次最多 50 场');
  text=text.replace(/^\uFEFF/,'');
  let quoted=false,delimiter=',';
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"')quoted=!quoted;if(!quoted&&c==='\t'){delimiter='\t';break}if(!quoted&&(c==='\r'||c==='\n'))break}
  const rows=[];let row=[],cell='',inside=false,closed=false;
  function pushCell(){row.push(cell.trim());cell='';closed=false}
  function pushRow(){pushCell();if(row.some(Boolean))rows.push(row);row=[]}
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inside){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{inside=false;closed=true}}else cell+=c;continue}
    if(c==='"'){if(cell.trim()||closed)throw new Error('双引号格式不正确，请从模板重新复制');inside=true;cell=''}
    else if(c===delimiter)pushCell();
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow()}
    else{if(closed&&!/\s/.test(c))throw new Error('引号后只能跟分隔符或换行');cell+=c}
  }
  if(inside)throw new Error('有未闭合的双引号，请检查 CSV 内容');
  pushRow();
  if(rows[0]?.[0]==='活动名称'){
    if(rows[0].length!==8||rows[0].some((v,i)=>v!==bulkHeaders[i]))throw new Error('表头与模板不一致，请按模板的 8 列顺序粘贴');
    rows.shift();
  }
  if(!rows.length||rows.length>50)throw new Error('每次请添加 1–50 场活动');
  function timestamp(value,index,label){
    const match=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::00)?$/.exec(value);
    if(!match)throw new Error(`第 ${index+1} 行：${label}使用 YYYY-MM-DD HH:mm`);
    const iso=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}T${match[4].padStart(2,'0')}:${match[5]}:00`;
    const ms=Date.parse(iso+'+08:00');
    if(!Number.isFinite(ms)||new Date(ms+8*3600000).toISOString().slice(0,19)!==iso)throw new Error(`第 ${index+1} 行：${label}日期无效`);
    return ms/1000;
  }
  return rows.map((cols,i)=>{
    if(cols.length!==8)throw new Error(`第 ${i+1} 行：应为 8 列，实际 ${cols.length} 列`);
    const [title,start,end,location,description,category,capacity,volunteers]=cols;
    if(!/^\d+$/.test(capacity)||!/^\d+$/.test(volunteers))throw new Error(`第 ${i+1} 行：人数须为整数，志愿者不招募请填 0`);
    return {title,starts_at:timestamp(start,i,'开始时间'),ends_at:timestamp(end,i,'结束时间'),location,description,category,capacity:Number(capacity),volunteer_capacity:Number(volunteers)};
  });
}
function showBulkEvents(){
  modal(`<h2 id="dialog-title">批量添加活动</h2><p>从 Excel 复制 8 列，或导入 UTF-8 CSV。每批最多 50 场，时间按景德镇（UTC+8）。发起人统一为当前管理员，封面可在导入后编辑。</p><button type="button" class="text-button" id="bulk-template">下载 CSV 模板</button><form id="bulk-events-form"><label class="field">导入 CSV 文件<input id="bulk-file" type="file" accept=".csv,text/csv"></label><label class="field" for="bulk-rows">粘贴表格（列顺序如下）</label><p class="muted">${bulkHeaders.join(' / ')}</p><textarea id="bulk-rows" required wrap="off" aria-label="批量活动数据" placeholder="可直接粘贴 Excel 单元格，或填写 CSV 内容"></textarea><label class="field">添加后状态<select id="bulk-status"><option value="published">直接发布</option><option value="pending">待审核</option></select></label><label class="check"><input type="checkbox" id="bulk-official">本批全部标记为 Herstory 官方活动</label><p id="form-error" class="error" role="alert"></p><button class="btn light" type="submit">检查并预览</button><div id="bulk-preview" aria-live="polite"></div><button class="btn wide" type="button" id="bulk-commit" hidden>确认添加</button></form>`);
  const form=$('#bulk-events-form'),rows=$('#bulk-rows'),commit=$('#bulk-commit');let payload=null,busy=false;
  const invalidate=()=>{payload=null;commit.hidden=true;$('#bulk-preview').innerHTML='';$('#form-error').textContent=''};
  form.addEventListener('input',invalidate);
  $('#bulk-template').onclick=()=>{
    const date=shiftDay(eventDay(Date.now()/1000),1);
    const csv='\uFEFF'+bulkHeaders.join(',')+`\r\n陶艺共创,${date} 10:00,${date} 12:00,共创空间,一起体验陶艺,创作,12,2\r\n`;
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='herstory-events-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  };
  $('#bulk-file').onchange=async event=>{
    invalidate();const file=event.target.files[0];if(!file)return;
    try{if(file.size>500000)throw new Error('文件过大，请分批添加');rows.value=await file.text();if(rows.value.includes('\uFFFD'))throw new Error('文件编码无法识别，请在 Excel 中另存为 CSV UTF-8');}catch(error){formError(form,error)}
  };
  const lock=value=>{busy=value;for(const el of form.elements)el.disabled=value};
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;invalidate();lock(true);
    try{
      const candidate={request_id:crypto.randomUUID(),events:parseEventRows(rows.value).map(e=>({...e,official:$('#bulk-official').checked})),status:$('#bulk-status').value};
      const result=await api('/api/admin/events/import',{method:'POST',body:{...candidate,preview:true}});if(!form.isConnected)return;payload=candidate;
      $('#bulk-preview').innerHTML=`<p class="bulk-summary">检查通过：${result.count} 场，将${candidate.status==='published'?'直接发布':'进入待审核'}。</p><div class="table-wrap"><table><thead><tr><th>活动</th><th>开始 / 结束</th><th>地点</th><th>名额 / 志愿者</th></tr></thead><tbody>${result.events.map(e=>`<tr><td>${esc(e.title)}<br><small>${esc(e.category)}${e.official?' · 官方':''}</small></td><td>${datetime(e.starts)}<br>${datetime(e.ends)}</td><td>${esc(e.location)}</td><td>${e.capacity} / ${e.volunteers}</td></tr>`).join('')}</tbody></table></div>`;
      commit.textContent=`确认${candidate.status==='published'?'发布':'添加'} ${result.count} 场活动`;commit.hidden=false;
    }catch(error){if(form.isConnected)formError(form,error)}finally{lock(false)}
  });
  commit.onclick=async()=>{
    if(busy||!payload)return;lock(true);$('#form-error').textContent='';
    try{
      const result=await api('/api/admin/events/import',{method:'POST',body:payload});
      // Once committed, never offer another submit if the subsequent list refresh fails.
      payload=null;if(form.isConnected){commit.hidden=true;$('#bulk-preview').textContent=`已添加 ${result.imported} 场活动。`;}
      await refresh();if(form.isConnected)close();toast(`已批量添加 ${result.imported} 场活动`);
    }catch(error){if(form.isConnected)formError(form,error)}finally{lock(false)}
  };
}
