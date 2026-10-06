(function(root){
'use strict';
const SIZE=64,RENDER_VERSION='broad-canopy-v8';
const palettes=typeof module!=='undefined'&&module.exports?require('./planet-palettes.js'):root.HerstoryPlanetPalettes;
const C={cream:'#FFF0CE',wall:'#E2D3AD',roof:'#A25B28',roofLight:'#BE7735',wood:'#774723',leafLight:'#A5BE62',leaf:'#789A46',leafDark:'#36582B',leafShade:'#507535',field:'#D8A63D',soil:'#B18430',crop:'#FFE18A',water:'#65A7A8',waterDark:'#488A90',waterLight:'#A3D0CD'};
const rgb=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16));
function validateState(s){if(!s||!palettes[s.paletteId]||!Number.isSafeInteger(s.aiCheckinCount)||s.aiCheckinCount<0||s.aiStage!==Math.min(s.aiCheckinCount,6)||typeof s.lakeUnlocked!=='boolean'||!Number.isSafeInteger(s.stateVersion)||s.stateVersion<0||s.ruleVersion!=='herstory-pixel-20261004-v1')throw TypeError('Invalid pixel planet state');return s;}
// Explicit scanlines, mirrored around x=32: no noise, gradients or source-image erasure.
const halfWidths=[7,11,14,16,18,19,20,21,22,23,23,24,24,25,25,25,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,25,25,25,24,24,23,23,22,21,21,20,19,18,18,17,15,12,8];
const highlightRight=[38,42,44,46,47,48,49,49,50,50,50,49,49,49,48,48,47,47,46,45,44,43,42,41,40,38,36,33,30,27];
function sphereMask(x,y){return y>=8&&y<60&&x>=32-halfWidths[y-8]&&x<32+halfWidths[y-8];}
const sprites={
 house:['.....d........','....rrrrrr....','..rrRrrRrrr...','.rrrRrrRrrrr..','rrRrRrrRrrRr..','..rrrrrrrrrr..','..cccccccccb..','..cccccccccb..','..cccttccccb..','..cccddccclm..','..cccddcclmms.','..cccddcclmss.','..wwwwwwwwsss.'],
 roundTree:['.....llll.....','...lllllllm...','..llaallllmm..','.llaaallllmmm.','llaaaalllmmmmm','llaaalllmmmmms','llallllmmmmsss','llllllmmmmmsss','.lllmmmmmmsss.','.mmmmmmmmssss.','..mmmmmmssss..','...ssssssss...','......dd......','......dd......','......ddd.....'],
 pine:['.....m.....','....llm....','....llms...','...lllmm...','...lllmms..','..llllmmss.','..lllmmmss.','.llllmmmsss','.lllmmmmsss','llllmmmmsss','sssssssssss','....dd.....','....dd.....','....dd.....'],
 rearLeft:[".mm.........","slllm.......","slllllmm....","sklllllllmm.","skmmlllllllm","skmmlllllllm","skmmmmllllmm",".kkmmmmmmsss",".kkmmmmmmss.",".kkmmmmsss..",".kkmmmsss...","..kkksss....",".....dd.....",".....dd.....",".....dd....."],
 rearRight:[".........mm.",".......mllls","....mmllllls",".mmlllllllks","mlllllllmmks","mlllllllmmks","mmllllmmmmks","sssmmmmmmkk.",".ssmmmmmmkk.","..sssmmmmkk.","...sssmmmkk.","....ssskkk..",".....dd.....",".....dd.....",".....dd....."]
};
const slots={rearLeft:[8,3],rearRight:[45,3],house:[25,15],roundTree:[3,21],pine:[43,41],field:[16,37],lake:[39,29]};
function renderPixels(state){validateState(state);const pixels=new Uint8ClampedArray(SIZE*SIZE*4),p=palettes[state.paletteId],detail=state.aiStage===6;
function dot(x,y,color){if(x<0||y<0||x>=SIZE||y>=SIZE)return;pixels.set([...rgb(color),255],(y*SIZE+x)*4);}
function rect(x,y,w,h,c){for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)dot(col,row,c);}
// Authored stepped bands: broad upper-left light, rounded lower shadow and a narrow rim.
const blend=(a,b,t)=>'#'+rgb(a).map((v,i)=>Math.round(v+(rgb(b)[i]-v)*t).toString(16).padStart(2,'0')).join('');
const mid=p[1],rim=p[3];
for(let y=8;y<60;y++)for(let x=6;x<58;x++)if(sphereMask(x,y)){
 const dx=x-32,lower=43+Math.floor((13-Math.abs(dx))/4),bottom=53+Math.floor((9-Math.abs(dx))/5);
 let color=p[1];if(y>=lower)color=p[2];if(y>=bottom)color=p[3];
 const hy=y-8,left=10+Math.floor((Math.abs(y-22)-3)/3);
 if(hy<highlightRight.length&&x>=left&&x<highlightRight[hy])color=p[0];
 const edge=32+halfWidths[hy]-1;
 if(x>=edge-1&&y>18)color=y>=bottom?p[3]:rim;
 if(y>55&&x<32-halfWidths[hy]+2)color=p[3];
 if(y===8)color=p[2];
 dot(x,y,color);
}
function sprout(x,y){dot(x,y,C.leafDark);dot(x+1,y,C.leaf);dot(x+2,y,C.leaf);dot(x+1,y-1,C.leaf);}
function sprite(name){const [x,y]=slots[name],map={a:'#91B557',l:C.leafLight,m:C.leaf,s:C.leafShade,k:C.leafDark,d:C.wood,r:C.roof,R:C.roofLight,t:'#EEDBB6',b:'#D4BF95',c:C.cream,w:C.wall};sprites[name].forEach((row,j)=>[...row].forEach((key,i)=>{if(key!=='.')dot(x+i,y+j,map[key]);}));}
// Permanent plants and rear trees exist even at zero check-ins.
sprout(19,23);sprout(26,32);
// Ground layers go first, independently of the house and trees.
if(state.aiStage>=2){rect(16,37,10,13,C.soil);rect(16,37,9,12,C.field);for(let row=0;row<4;row++)for(let col=0;col<3;col++)rect(17+col*3,38+row*3,2,detail?2:1,C.crop);}
if(state.lakeUnlocked){const spans=[[5,9],[3,11],[2,12],[1,13],[0,14],[0,14],[1,13],[2,12],[3,11],[4,10],[5,9]];spans.forEach(([left,right],row)=>{for(let x=left;x<=right;x++)dot(39+x,29+row,C.cream);if(row>0&&row<10)for(let x=left+1;x<right;x++)dot(39+x,29+row,row>=7?C.waterDark:C.water);});rect(44,32,2,2,C.waterLight);rect(48,34,2,2,C.waterLight);}
sprite('rearLeft');sprite('rearRight');
if(state.aiStage>=1){sprite('house');sprout(38,25);}
if(state.aiStage>=2){sprout(25,39);sprout(26,40);}if(state.aiStage>=3)sprite('roundTree');
if(state.aiStage>=4)sprite('pine');
if(state.aiStage>=5){for(const [x,y]of [[12,43],[29,44],[37,47],[21,54],[41,55],[33,29]])sprout(x,y);}
if(detail){rect(28,17,1,4,C.roofLight);rect(31,17,1,4,C.roofLight);rect(34,18,1,3,C.wood);dot(8,27,C.leafLight);dot(14,28,C.leaf);dot(49,50,C.leafLight);dot(17,48,C.crop);}
return pixels;}
function renderFrame(state,{width=240,height=320,background=null}={}){if(!Number.isInteger(width)||!Number.isInteger(height)||width<64||height<64||width>2048||height>2048)throw TypeError('Frame dimensions must be 64–2048');if(background!==null&&(!Array.isArray(background)||background.length!==3||background.some(x=>!Number.isInteger(x)||x<0||x>255)))throw TypeError('Invalid RGB background');const source=renderPixels(state),rgba=new Uint8ClampedArray(width*height*4),scale=Math.floor(Math.min(width,height)/SIZE),size=SIZE*scale,x0=Math.floor((width-size)/2),y0=Math.floor((height-size)/2);if(background)for(let i=0;i<rgba.length;i+=4)rgba.set([...background,255],i);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(Math.floor(y/scale)*SIZE+Math.floor(x/scale))*4;if(source[i+3])rgba.set(source.subarray(i,i+4),((y0+y)*width+x0+x)*4);}return {width,height,rgba,scale,renderVersion:RENDER_VERSION};}
function encodeRGB565(state,{width=240,height=320,byteOrder,background=[0,0,0]}={}){if(!['little','big'].includes(byteOrder))throw TypeError('Explicit RGB565 byteOrder required');const frame=renderFrame(state,{width,height,background}),bytes=new Uint8Array(width*height*2);for(let i=0,j=0;i<frame.rgba.length;i+=4,j+=2){const v=((frame.rgba[i]>>3)<<11)|((frame.rgba[i+1]>>2)<<5)|(frame.rgba[i+2]>>3);bytes[j]=byteOrder==='little'?v&255:v>>8;bytes[j+1]=byteOrder==='little'?v>>8:v&255;}return {...frame,bytes,format:'RGB565',byteOrder};}
const api={SIZE,RENDER_VERSION,palettes,slots,sphereMask,validateState,renderPixels,renderFrame,encodeRGB565,renderPixelPlanet({paletteId,aiStage,lakeUnlocked}){return renderPixels({paletteId,aiStage,aiCheckinCount:aiStage,lakeUnlocked,stateVersion:0,ruleVersion:'herstory-pixel-20261004-v1'});}};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HerstoryPixelRenderer=api;
})(typeof window==='undefined'?globalThis:window);
