// Approved account confirmation footer and name-font specification, no unrelated layout edits.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import sharp from 'sharp';
import {nameBitmap} from '../../hardware-cloud/name-bitmap.mjs';
const root=path.resolve(import.meta.dirname,'../..'),source=root+'/output/approved-current-design',file='assets/4a5c31cb11-state-confirm.png';
fs.copyFileSync(root+'/output/binding-confirm-preview/check-account-ok-confirm.png',source+'/'+file);
const samples=[['海椰','account-name-pixel-chinese.png'],['Rae 海椰','account-name-pixel-mixed.png']];
for(const [name,filename] of samples){
 const {data,info}=await sharp(source+'/'+file).removeAlpha().raw().toBuffer({resolveWithObject:true});
 for(let y=110;y<146;y++)for(let x=24;x<218;x++)data.fill(0,(y*240+x)*3,(y*240+x)*3+3);
 const bits=Buffer.from(await nameBitmap(name),'hex');for(let y=0;y<32;y++)for(let x=0;x<192;x++)if(bits[y*24+(x>>3)]&(128>>(x&7))){const at=((112+y)*240+25+x)*3;data.set([240,244,240],at);}
 await sharp(data,{raw:{width:info.width,height:info.height,channels:3}}).png().toFile(source+'/assets/'+filename);
}
fs.mkdirSync(source+'/fonts',{recursive:true});
for(const filename of ['popcity-pixel-name.bin','popcity-pixel-name.json','PIXEL_FONT_LICENSE.txt'])fs.copyFileSync(root+'/assets/fonts/'+filename,source+'/fonts/'+filename);
const note='账号核对页增加PRESS OK TO / CONFIRM BINDING提示；OK单击确认、长按拒绝。姓名采用popcity-pixel-v1：英文与原设计5x7字形一致，中文固定点阵，中英文共用12×16字格；不自动拉伸、不启用平滑。';
const manifestPath=source+'/manifest.json',manifest=JSON.parse(fs.readFileSync(manifestPath));const entry=manifest.find(x=>x.state==='核对绑定账号');if(!entry)throw Error('Missing account state');entry.logic=note;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const spec=`# 姓名字体及绑定确认提示（已确认）\n\n${note}\n\n仅修改姓名字形和通过的OK提示，标题、邮箱、四位码、其他页面布局均保持原稿。姓名大小写取真实昵称，不因字库擅自变成全大写。\n\n- 英文：原5×7设计字形按整数2倍绘制，字身10×14，步进12像素；RAE字形及位置与原稿逐像素一致。\n- 中文：原生12px点阵优先，仅收录注册姓名清单中的64个汉字；同12×16字格、相同排版/基线规则，不做自动缩放。\n- 普通姓名位图192×32，最多32字符、超16字符两行；个人大字姓名按整数2倍输出，板端再用既有整数倍绘制；名单保持既有姓名窗口。\n- 后台与固件共享fonts/popcity-pixel-name.bin；样式标记popcity-pixel-v1。旧后台无标记时，板端按真实UTF-8昵称用同一ROM字库生成，不混用旧平滑位图。\n- 字库仅在程序Flash，使用原姓名缓冲；不写event_save，不改变存档格式。\n- 未覆盖的Unicode明确用缺字框，不用另一种平滑字体替代。字库覆盖及补充来源见fonts/popcity-pixel-name.json和授权文件。\n\n## 注册姓名字库裁剪\n保留完整95个ASCII字符、64个注册姓名汉字、已批准的🌟像素星星与缺字框，共161字形、5804字节。新姓名出现未收录汉字需更新字库。原始用户姓名清单不随设计包分发。\n\n![像素星星放大预览](assets/name-pixel-star.png)\n\n## 英文原稿\n![英文核对页](assets/4a5c31cb11-state-confirm.png)\n\n## 中文示例（同一页面，仅姓名数据不同）\n![中文核对页](assets/account-name-pixel-chinese.png)\n\n## 中英混排示例（同一页面，仅姓名数据不同）\n![混排核对页](assets/account-name-pixel-mixed.png)\n`;
fs.writeFileSync(source+'/姓名像素字体规范.md',spec);
const mdPath=source+'/页面设计与逻辑.md';let md=fs.readFileSync(mdPath,'utf8');if(!md.includes('## 已确认：姓名像素字体'))md+='\n## 已确认：姓名像素字体与绑定提示\n\n'+note+'\n\n完整规范及中英示例见[姓名像素字体规范](姓名像素字体规范.md)。\n';fs.writeFileSync(mdPath,md);
const htmlPath=source+'/index.html';let html=fs.readFileSync(htmlPath,'utf8');if(!html.includes('id="pixel-name-spec"'))html=html.replace('<h3>正在确认绑定</h3>','<div id="pixel-name-spec"><p>'+note+'</p><p><a href="姓名像素字体规范.md">字形、字位图与授权规范</a></p><div class="grid"><div class="card"><h4>中文姓名示例</h4><img src="assets/account-name-pixel-chinese.png"></div><div class="card"><h4>中英混排示例</h4><img src="assets/account-name-pixel-mixed.png"></div></div></div><h3>正在确认绑定</h3>');fs.writeFileSync(htmlPath,html);
const provenancePath=root+'/firmware/portable/design-source.json',provenance=JSON.parse(fs.readFileSync(provenancePath));provenance.approved_revision='2026-10-19-account-ok-pixel-names';provenance.manifest_sha256=crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');provenance.name_font_sha256=crypto.createHash('sha256').update(fs.readFileSync(source+'/fonts/popcity-pixel-name.bin')).digest('hex');fs.writeFileSync(provenancePath,JSON.stringify(provenance,null,2)+'\n');
console.log('Approved account/footer, pixel-font specification and examples synchronized.');
