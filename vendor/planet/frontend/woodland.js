import * as T from './vendor/three.module.js';

const host=document.querySelector('#world'),notice=document.querySelector('#notice');
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer;
try{renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});}catch(e){notice.textContent='浏览器未能启动 3D，请开启硬件加速后重试。';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;host.appendChild(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#edf1dc');scene.fog=new T.FogExp2('#edf1dc',.018);
const camera=new T.PerspectiveCamera(36,innerWidth/innerHeight,.1,100);let distance=innerWidth<640?13.8:12.6;camera.position.set(0,0,distance);
scene.add(new T.HemisphereLight('#fff9df','#84916a',2.1));const sun=new T.DirectionalLight('#ffe4bd',3.5);sun.position.set(-4,7,9);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.5,far:25});sun.shadow.bias=-.0004;sun.shadow.normalBias=.025;sun.shadow.radius=3;scene.add(sun);const rim=new T.DirectionalLight('#e7e9c7',1.2);rim.position.set(5,1,-4);scene.add(rim);
const planet=new T.Group();scene.add(planet);const up=new T.Vector3(0,1,0),radius=2.45;
let seed=137;function rand(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
const matCache=new Map();function mat(color,extra={}){const key=color+JSON.stringify(extra);if(!matCache.has(key))matCache.set(key,new T.MeshStandardMaterial({color,roughness:.86,...extra}));return matCache.get(key);}
function mesh(geo,color,parent=planet,extra={}){const m=new T.Mesh(geo,mat(color,extra));m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
const sphereGeo=new T.IcosahedronGeometry(1,2),cubeGeo=new T.BoxGeometry(1,1,1),coneGeo=new T.ConeGeometry(1,1,7);
function ball(parent,color,x,y,z,sx,sy=sx,sz=sx){const m=mesh(sphereGeo,color,parent);m.position.set(x,y,z);m.scale.set(sx,sy,sz);return m;}
function box(parent,color,x,y,z,sx,sy,sz){const m=mesh(cubeGeo,color,parent);m.position.set(x,y,z);m.scale.set(sx,sy,sz);return m;}
const branchGeo=new T.CylinderGeometry(.65,1,1,7);
function branch(parent,color,from,to,width){const a=new T.Vector3(...from),b=new T.Vector3(...to),m=mesh(branchGeo,color,parent);m.position.copy(a).add(b).multiplyScalar(.5);m.scale.set(width,a.distanceTo(b),width);m.quaternion.setFromUnitVectors(up,b.sub(a).normalize());return m;}
function rockSpire(parent,height,width,color,snow=false){
 const geo=new T.BufferGeometry(),verts=[],shades=[],sides=7;
 const rings=[[1,0],[.91,.2],[.64,.49],[.36,.76],[.025,1]];
 for(let level=0;level<4;level++)for(let k=0;k<sides;k++){
   const point=(r,j)=>{const angle=j/sides*Math.PI*2;return [Math.cos(angle)*width*rings[r][0]*(1+.16*Math.sin(j*3.1))+height*rings[r][1]*.13,height*rings[r][1],Math.sin(angle)*width*rings[r][0]];};
   const c=new T.Color(snow&&level>1?'#e8f1e9':color);c.multiplyScalar(.9+(k%3)*.07);
   for(const v of [point(level,k),point(level+1,k),point(level,k+1),point(level,k+1),point(level+1,k),point(level+1,k+1)]){verts.push(...v);shades.push(c.r,c.g,c.b);}
 }
 geo.setAttribute('position',new T.Float32BufferAttribute(verts,3));geo.setAttribute('color',new T.Float32BufferAttribute(shades,3));geo.computeVertexNormals();
 const m=new T.Mesh(geo,new T.MeshStandardMaterial({vertexColors:true,roughness:snow?.5:.95,side:T.DoubleSide}));m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
const biomes={forest:{dir:new T.Vector3(-.56,.43,.9).normalize(),color:'#659d60',title:'相遇，长成一片森林。',desc:'圆冠树、松林与蜿蜒小径，收藏每一次新连接。',tag:'相遇之森'},farm:{dir:new T.Vector3(-.48,-.42,.94).normalize(),color:'#a8b870',title:'认真生活，就有收获。',desc:'麦田、红顶谷仓与转动的风车，让参与留下金色的痕迹。',tag:'丰收农场'},volcano:{dir:new T.Vector3(.91,-.40,-.16).normalize(),color:'#706c75',title:'把灵感，变成一次喷发。',desc:'炽热的火山口、熔岩溪与黑曜石，记录你的创造力。',tag:'灵感火山'},ice:{dir:new T.Vector3(.53,.45,.88).normalize(),color:'#99b5a1',title:'在安静里，发现新大陆。',desc:'冰峰、蓝色冰湖与微小的营地，等待下一段探索。',tag:'极光冰原'}};
function frame(dir){const x=new T.Vector3().crossVectors(up,dir).normalize();return {x,z:new T.Vector3().crossVectors(dir,x).normalize()};}
function offset(dir,x,y){const f=frame(dir);return dir.clone().addScaledVector(f.x,x).addScaledVector(f.z,y).normalize();}
// Main islands have designed compositions; smaller rear islands punctuate open sea.
const islands=Object.entries(biomes).map(([key,b])=>({key,dir:b.dir,edge:(key==='forest'||key==='farm')?.907:.921,main:true}));
for(const [key,x,y,z]of [['forest',-.65,.38,-1],['farm',-.5,-.6,-1],['volcano',.8,-.35,-1],['ice',.55,.65,-1]])islands.push({key,dir:new T.Vector3(x,y,z).normalize(),edge:.973,main:false});
function terrain(dir){
 let key='forest',best=-2;for(const [k,b] of Object.entries(biomes)){const v=dir.dot(b.dir);if(v>best){best=v;key=k;}}
 const mountainZone=T.MathUtils.smoothstep(dir.dot(biomes.volcano.dir),.78,.97);
 const height=.075+.038*Math.sin(dir.x*9+dir.y*6)*Math.cos(dir.z*7-dir.y*4)+mountainZone*.08;
 return {key,land:true,score:.08,height,r:radius+height};
}
const earthGeo=new T.IcosahedronGeometry(radius,18),pos=earthGeo.attributes.position,colors=[];
for(let i=0;i<pos.count;i++){
  const dir=new T.Vector3().fromBufferAttribute(pos,i).normalize(),info=terrain(dir);let c;
  if(info.land){
    c=new T.Color(info.key==='farm'?'#adb575':'#a8b67b');c.lerp(new T.Color('#999382'),T.MathUtils.smoothstep(dir.dot(biomes.volcano.dir),.78,.96));
    const variation=(Math.sin(dir.x*51+dir.z*21)*Math.sin(dir.y*37-dir.z*13))*.035;
    c.multiplyScalar(1+variation);
    if(info.score<.009)c=new T.Color(info.key==='ice'?'#b8b399':info.key==='volcano'?'#635b64':'#ab9b79');
    if(info.score>=.009&&info.score<.018)c.lerp(new T.Color('#d3c296'),.24);
  }else{
    c=new T.Color('#226f88');
    if(info.score>-.025)c.lerp(new T.Color('#73bfb5'),(info.score+.025)/.025);
  }
  colors.push(c.r,c.g,c.b);dir.multiplyScalar(info.r);pos.setXYZ(i,dir.x,dir.y,dir.z);
}
earthGeo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
earthGeo.computeVertexNormals();
const earth=new T.Mesh(earthGeo,new T.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true}));
earth.receiveShadow=true;earth.castShadow=true;planet.add(earth);
// A restrained Fresnel shell makes the planet readable against space.
const atmosphere=new T.Mesh(new T.SphereGeometry(2.53,48,32),new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.BackSide,uniforms:{},vertexShader:'varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.); n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',fragmentShader:'varying vec3 n; varying vec3 v; void main(){float a=pow(1.-abs(dot(n,v)),3.);gl_FragColor=vec4(.35,.66,.87,a*.24);}'}));atmosphere.visible=false;planet.add(atmosphere);
const growthObjects=[],windmills=[],embers=[];
function anchor(dir,day=1){const g=new T.Group();g.position.copy(dir).multiplyScalar(terrain(dir).r);g.quaternion.setFromUnitVectors(up,dir);planet.add(g);g.userData.day=day;growthObjects.push(g);return g;}
function at(key,x,y,day=1){return anchor(offset(biomes[key].dir,x,y),day);}
function pine(g,h=1){box(g,'#71533e',0,.10*h,0,.045*h,.22*h,.045*h);for(let j=0;j<3;j++){const m=mesh(coneGeo,['#425a32','#5e7540','#839452'][j],g);m.scale.set((.16-j*.031)*h,.30*h,(.16-j*.031)*h);m.position.y=(.23+j*.115)*h;}}
function tree(g,h=1){
 branch(g,'#796348',[0,0,0],[.008*h,.34*h,0],.032*h);
 for(let i=0;i<3;i++){const a=i*2.1;branch(g,'#88734f',[0,.19*h,0],[Math.cos(a)*.12*h,.31*h,Math.sin(a)*.1*h],.012*h);branch(g,'#7b7250',[0,.065*h,0],[Math.cos(a)*.09*h,.008,Math.sin(a)*.09*h],.016*h);}
 const crown=new T.Group();crown.position.y=.31*h;g.add(crown);
 ball(crown,'#50895b',0,0,0,.18*h,.12*h,.17*h);
 ball(crown,'#72a869',-.095*h,.05*h,.015*h,.14*h,.11*h,.12*h);
 ball(crown,'#91bc75',.045*h,.095*h,-.025*h,.14*h,.105*h,.13*h);
 ball(crown,'#609c62',.105*h,.025*h,.045*h,.12*h,.095*h,.11*h);
 for(let i=0;i<4;i++){const a=i*2.4;ball(crown,i%2?'#8eb974':'#a4c67d',Math.cos(a)*.105*h,.10*h,Math.sin(a)*.09*h,.057*h,.035*h,.05*h);}
}
for(let i=0;i<30;i++){let x=(rand()-.5)*.61,y=(rand()-.5)*.56;if(Math.abs(x+.09*Math.sin(y*12))<.07)continue;const dir=offset(biomes.forest.dir,x,y);if(terrain(dir).key!=='forest'||terrain(dir).score<.012)continue;const g=anchor(dir,1+Math.floor(rand()*12));(i%4===0?pine:tree)(g,.8+rand()*.35);}
// Pebble trails are projected onto the sphere, rather than floating above it.
for(let i=0;i<28;i++){const y=-.33+i*.024;const g=at('forest',-.09*Math.sin(y*12),y,2);ball(g,'#d1c5a0',0,.012,0,.035,.015,.022);}
function house(g,s=1){
 const home=new T.Group();home.scale.setScalar(s);g.add(home);
 box(home,'#ede2bc',0,.13,0,.28,.26,.25);
 box(home,'#a28a63',0,.022,0,.33,.044,.30);
 for(const x of [-.13,.13])box(home,'#706248',x,.14,.13,.021,.26,.012);
 box(home,'#706248',0,.24,.13,.27,.018,.015);
 const roofGeo=new T.BufferGeometry();
 roofGeo.setAttribute('position',new T.Float32BufferAttribute([-.18,.25,-.16,.18,.25,-.16,0,.40,-.16,-.18,.25,.16,0,.40,.16,.18,.25,.16,-.18,.25,-.16,0,.40,-.16,0,.40,.16,-.18,.25,-.16,0,.40,.16,-.18,.25,.16,.18,.25,-.16,.18,.25,.16,0,.40,.16,.18,.25,-.16,0,.40,.16,0,.40,-.16],3));roofGeo.computeVertexNormals();
 mesh(roofGeo,'#8d6650',home,{side:T.DoubleSide});
 for(let j=0;j<5;j++){for(const sign of [-1,1]){const tile=box(home,'#a47b54',sign*(.025+j*.032),.39-j*.029,0,.025,.012,.33);tile.rotation.z=sign*-.74;}}
 box(home,'#665b46',0,.09,.13,.065,.18,.018);
 for(const x of [-.09,.09]){box(home,'#725f43',x,.15,.132,.055,.07,.015);box(home,'#edc988',x,.15,.143,.037,.052,.009);}
 box(home,'#bbaf95',.10,.36,-.08,.048,.16,.05);
 box(home,'#766953',.10,.447,-.08,.061,.023,.064);
 for(const x of [-.09,.09]){
   for(const side of [-1,1])box(home,'#60817a',x+side*.034,.15,.145,.015,.068,.014);
   box(home,'#99724e',x,.105,.16,.076,.021,.036);
   for(let i=0;i<3;i++){ball(home,'#769058',x-.024+i*.024,.121,.163,.016,.012,.014);ball(home,'#e3b6a0',x-.024+i*.024,.135,.163,.009);}
 }
 for(let i=0;i<3;i++)box(home,'#baad88',0,.014+i*.018,.23-i*.035,.115,.028,.065);
 branch(home,'#8f7951',[-.05,.015,.21],[-.05,.21,.21],.007);branch(home,'#8f7951',[.05,.015,.21],[.05,.21,.21],.007);
 box(home,'#9e8861',0,.22,.175,.15,.015,.13);
}
house(at('forest',-.22,-.20,7),.7);
for(let a=0;a<2;a++)for(let b=0;b<3;b++){const g=at('farm',-.15+a*.18,-.17+b*.15,2+a+b);g.rotateY(.15);box(g,'#92794f',0,.008,0,.34,.025,.29);for(let row=0;row<5;row++){box(g,'#d7b45f',-.135+row*.067,.031,0,.027,.025,.26);for(let j=0;j<5;j++){const x=-.135+row*.067,z=-.105+j*.05;box(g,(a+b)%2?'#c4ce7b':'#e9c971',x,.063,z,.018,.068,.018);}}}
house(at('farm',-.04,.31,5),1.25);house(at('farm',.20,.26,8),.72);
const mill=at('farm',-.31,.22,9);mesh(new T.CylinderGeometry(.055,.1,.36,8),'#e7e0be',mill).position.y=.18;const millRoof=mesh(coneGeo,'#6f8d99',mill);millRoof.scale.set(.14,.16,.14);millRoof.position.y=.4;const rotor=new T.Group();rotor.position.set(0,.31,.10);mill.add(rotor);for(let i=0;i<4;i++){const blade=new T.Group();blade.rotation.z=i*Math.PI/2;rotor.add(blade);box(blade,'#f7e9c8',0,.12,0,.048,.22,.014);box(blade,'#b39971',0,.1,.009,.013,.27,.012);}windmills.push(rotor);
for(let i=0;i<11;i++){const g=at('farm',-.24+i*.041,-.27,5);box(g,'#f5dcae',0,.055,0,.022,.11,.022);box(g,'#e4c893',.046,.063,0,.10,.016,.016);}
// Sculpted open crater, with an actual recessed molten bowl.
const volcano=at('volcano',0,0,8),vg=new T.BufferGeometry(),vp=[],vc=[];const rings=[[.49,0],[.44,.09],[.40,.13],[.34,.28],[.31,.31],[.25,.48],[.21,.54],[.19,.67],[.125,.63],[.09,.51]];const n=23;
for(let j=0;j<rings.length-1;j++)for(let i=0;i<n;i++){const point=(ring,k)=>{const angle=k/n*Math.PI*2;const [r,y]=rings[ring];const ridge=1+.075*Math.sin(angle*7)+.035*Math.cos(angle*11);return [Math.cos(angle)*r*ridge,y+(ring>1?Math.sin(angle*5)*.025:0),Math.sin(angle)*r*ridge];};const verts=[point(j,i),point(j,i+1),point(j+1,i),point(j+1,i),point(j,i+1),point(j+1,i+1)];const c=new T.Color(j>=7?'#b36b54':['#69616c','#786c72','#534f5d'][j%3]);c.multiplyScalar(.94+(i%3)*.045);for(const v of verts){vp.push(...v);vc.push(c.r,c.g,c.b);}}
vg.setAttribute('position',new T.Float32BufferAttribute(vp,3));vg.setAttribute('color',new T.Float32BufferAttribute(vc,3));vg.computeVertexNormals();volcano.add(new T.Mesh(vg,new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:1,flatShading:true})));
const lava=mesh(new T.CircleGeometry(.125,24),'#ffc367',volcano,{emissive:'#ff5b21',emissiveIntensity:2});lava.rotation.x=-Math.PI/2;lava.position.y=.535;
for(let k=0;k<3;k++){const points=[];for(let i=0;i<12;i++){const f=i/11,a=k*2.2+.15*Math.sin(f*10);points.push(new T.Vector3(Math.cos(a)*(.15+f*.38),.64*(1-f)+.02,Math.sin(a)*(.15+f*.38)));}mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points),25,.016,5,false),'#ffad53',volcano,{emissive:'#ff4f20',emissiveIntensity:1.4});}
for(let i=0;i<15;i++){const e=ball(volcano,'#ffbd73',0,.7,0,.012);e.material=mat('#ffbd73',{emissive:'#ff682e',emissiveIntensity:2});e.userData={phase:rand(),angle:rand()*6.28};embers.push(e);}
for(let i=0;i<11;i++){const a=i/11*Math.PI*2,r=.23+rand()*.065;const g=at('volcano',Math.cos(a)*r,Math.sin(a)*r,3+Math.floor(rand()*10));ball(g,'#766d83',0,.05,0,.05+rand()*.05,.065,.05);}
// Four quiet satellite islands keep the rear view intentional and spacious.
const coverage={forest:0,farm:0,volcano:0,ice:0,back:0};
for(const island of islands.filter(i=>!i.main)){
  for(let i=0;i<7;i++){
    const angle=i*2.4,r=i===0?0:.075+rand()*.055;
    const dir=offset(island.dir,Math.cos(angle)*r,Math.sin(angle)*r);
    const g=anchor(dir,3+i),key=island.key;
    coverage[key]++;coverage.back++;
    if(key==='forest'){(i%3?tree:pine)(g,.65+rand()*.2);}
    else if(key==='farm'){
      if(i===0){house(g,.8);continue;}
      box(g,'#967a51',0,.012,0,.18,.025,.15);
      for(let j=0;j<3;j++)box(g,'#dac276',-.06+j*.06,.048,0,.026,.055,.13);
    }else if(key==='ice'){
      box(g,'#c5d8d4',0,.12,0,.09,.24,.09);
    }else{
      if(i===0){const mountain=new T.Mesh(vg,volcano.children[0].material);mountain.scale.setScalar(.52);g.add(mountain);const molten=mesh(new T.CircleGeometry(.065,12),'#ffc078',g,{emissive:'#ff6528',emissiveIntensity:1.2});molten.rotation.x=-Math.PI/2;molten.position.y=.28;}
      else ball(g,'#8c7e8c',0,.04,0,.06,.06,.06);
    }
  }
}
const livingBoats=[];
// Original adventure landmarks: a mossy sanctuary, working harbor and ice gate.
function stoneArch(g,scale=1){
 const arch=new T.Group();arch.scale.setScalar(scale);g.add(arch);
 for(const x of [-.16,.16]){box(arch,'#9caa96',x,.17,0,.105,.34,.12);box(arch,'#829b7b',x,.055,0,.135,.11,.16);}
 for(let i=0;i<7;i++){const a=i/6*Math.PI;const block=box(arch,'#bdc5a6',Math.cos(a)*.16,.33+Math.sin(a)*.16,0,.10,.10,.13);block.rotation.z=a;}
 box(arch,'#bdd8bb',0,.025,0,.36,.05,.27);
 for(let i=0;i<3;i++)ball(arch,'#668d57',-.15+i*.13,.03,.13,.065,.025,.044);
}
const sanctuary=at('forest',-.03,.18,10);stoneArch(sanctuary,.95);
const crystal=mesh(new T.OctahedronGeometry(.07),'#9fe6ca',sanctuary,{emissive:'#4ba589',emissiveIntensity:.7});crystal.position.set(0,.24,0);
for(let i=0;i<5;i++){const g=at('forest',-.08+i*.039,.03,4);box(g,'#ad9567',0,.015,0,.065,.03,.05);}
// Stream conforms to the raised terrain, then spills over the coastal shelf.
const riverPoints=[];for(let i=0;i<48;i++){const f=i/47,dir=offset(biomes.forest.dir,.15+.035*Math.sin(f*7),.14-f*.53);riverPoints.push(dir.multiplyScalar(terrain(dir).r+.009));}
const river=mesh(new T.TubeGeometry(new T.CatmullRomCurve3(riverPoints),72,.024,6,false),'#79c9cf',planet,{roughness:.3});river.castShadow=false;river.visible=false;
const footbridge=at('forest',.18,-.06,6);for(let i=0;i<7;i++)box(footbridge,'#b79764',(i-3)*.036,.065,0,.031,.023,.15);for(const z of [-.08,.08]){box(footbridge,'#92754e',0,.12,z,.27,.015,.016);for(const x of [-.12,.12])box(footbridge,'#92754e',x,.08,z,.017,.16,.017);}
const pier=at('farm',.29,-.12,6);for(let i=0;i<10;i++)box(pier,'#a5875d',.05+i*.025,.03,0,.021,.023,.14);for(const x of [.07,.23])for(const z of [-.07,.07])box(pier,'#6a644c',x,.015,z,.025,.15,.025);
const beacon=at('farm',.25,.15,12);mesh(new T.CylinderGeometry(.055,.09,.36,8),'#ddd6bc',beacon).position.y=.18;box(beacon,'#47656b',0,.365,0,.14,.035,.14);box(beacon,'#f4d596',0,.415,0,.09,.075,.09);const cap=mesh(coneGeo,'#547a78',beacon);cap.scale.set(.10,.08,.10);cap.position.y=.49;
const obelisk=at('volcano',-.23,.06,12);for(let i=0;i<3;i++)box(obelisk,'#716b72',0,.025+i*.03,0,.22-i*.035,.045,.22-i*.035);const spire=mesh(new T.CylinderGeometry(.035,.058,.36,5),'#3d505b',obelisk);spire.position.y=.26;box(obelisk,'#a6dfd5',0,.30,.052,.017,.12,.012).material=mat('#a6dfd5',{emissive:'#6dbaaf',emissiveIntensity:.65});
// Handcrafted details are clustered around landmarks, keeping the sea and paths clear.
function barrel(parent,x,y,z,s=.065){const g=new T.Group();g.position.set(x,y,z);parent.add(g);const body=mesh(new T.CylinderGeometry(s*.78,s*.87,s*1.5,10),'#a18559',g);body.position.y=s*.75;for(const h of [.3,1.2]){const band=mesh(new T.TorusGeometry(s*.85,s*.065,4,10),'#616c68',g);band.rotation.x=Math.PI/2;band.position.y=s*h;}return g;}
function mushroom(g,x,z,s=1){branch(g,'#e0d9b6',[x,.004,z],[x,.04*s,z],.009*s);const cap=mesh(new T.SphereGeometry(.027*s,8,5,0,Math.PI*2,0,Math.PI/2),'#bc7d62',g);cap.position.set(x,.04*s,z);ball(g,'#eedac0',x+.008*s,.064*s,z,.006*s);}
const forestFloor=at('forest',-.21,-.04,5);for(let i=0;i<4;i++)mushroom(forestFloor,(i-1.5)*.035,Math.sin(i)*.03,.7+i*.14);
const fallenLog=at('forest',-.19,.19,6);const log=branch(fallenLog,'#816947',[-.10,.045,0],[.13,.065,.035],.033);const end=mesh(new T.CircleGeometry(.027,10),'#c7ad74',fallenLog);end.position.set(.132,.065,.036);end.rotation.y=Math.PI/2;for(let i=0;i<3;i++)ball(fallenLog,'#718c52',-.05+i*.045,.075,.01,.034,.013,.024);
const lanterns=[];for(const [key,x,y]of [['forest',.025,.11],['farm',.15,.22]]){const g=at(key,x,y,9);branch(g,'#72664e',[0,0,0],[0,.19,0],.009);box(g,'#807559',.025,.19,0,.065,.012,.012);const lamp=box(g,'#ffe0a0',.055,.145,0,.04,.055,.035);lamp.material=mat('#ffe0a0',{emissive:'#d98a3a',emissiveIntensity:.45});box(g,'#67736c',.055,.18,0,.055,.014,.046);lanterns.push(lamp);}
const supplies=at('farm',.12,.26,7);barrel(supplies,0,0,0,.046);barrel(supplies,.09,0,.015,.039);box(supplies,'#aa8860',.035,.034,-.075,.075,.068,.065);box(supplies,'#cfb77e',.035,.035,-.11,.065,.009,.008);
const wagon=at('farm',.23,-.005,10);box(wagon,'#a68c63',0,.058,0,.16,.025,.11);for(const z of [-.06,.06])box(wagon,'#b89a6a',0,.095,z,.17,.065,.016);for(const x of [-.065,.065])for(const z of [-.077,.077]){const wheel=mesh(new T.TorusGeometry(.037,.009,5,10),'#605b4c',wagon);wheel.position.set(x,.04,z);branch(wagon,'#8c7957',[x-.028,.04,z],[x+.028,.04,z],.004);branch(wagon,'#8c7957',[x,.013,z],[x,.067,z],.004);}branch(wagon,'#9c8157',[-.08,.06,0],[-.24,.027,0],.009);ball(wagon,'#d1b46d',-.025,.11,0,.055,.04,.034);ball(wagon,'#b7be75',.04,.105,0,.043,.036,.03);
const garden=at('farm',-.22,-.08,5);for(let i=0;i<4;i++){ball(garden,'#d3a35b',(i%2)*.075,.037,Math.floor(i/2)*.068,.033,.027,.031);branch(garden,'#648556',[(i%2)*.075,.06,Math.floor(i/2)*.068],[(i%2)*.075+.007,.08,Math.floor(i/2)*.068],.005);}
const basalt=at('volcano',.22,.15,7);for(let i=0;i<8;i++){const h=.08+.13*Math.sin((i+1)*1.8)**2;const column=mesh(new T.CylinderGeometry(.032,.036,h,6),i%2?'#5d5964':'#78717c',basalt);column.position.set((i%4)*.055,h/2,Math.floor(i/4)*.059);}
const hotPool=at('volcano',.10,-.25,11);const rimPool=mesh(new T.TorusGeometry(.095,.018,6,16),'#807778',hotPool);rimPool.rotation.x=-Math.PI/2;const pool=mesh(new T.CircleGeometry(.078,20),'#e7ab65',hotPool,{emissive:'#c67a39',emissiveIntensity:.35});pool.rotation.x=-Math.PI/2;pool.position.y=.008;
const steam=[];for(let i=0;i<5;i++){const puff=ball(volcano,'#a7a3ac',0,.8,0,.05);puff.material=new T.MeshStandardMaterial({color:'#b3abb4',transparent:true,opacity:.14,depthWrite:false,roughness:1});puff.castShadow=false;puff.receiveShadow=false;puff.userData.phase=i/5;steam.push(puff);}
// Sparse terrain details use instancing to keep the mobile draw-call count bounded.
const grassPositions=[],flowerPositions=[];
for(const key of ['forest','farm'])for(let i=0;i<300;i++){
 const x=(rand()-.5)*.7,y=(rand()-.5)*.7,dir=offset(biomes[key].dir,x,y),info=terrain(dir);
 if(!info.land||info.key!==key||info.score<.015)continue;
 if(key==='forest'&&(Math.abs(x)<.10||Math.abs(x-.17)<.065))continue;
 if(key==='farm'&&x>-.23&&x<.13&&y>-.26&&y<.25)continue;
 grassPositions.push({dir,h:.025+rand()*.042});if(i%9===0)flowerPositions.push(dir);
}
const blades=new T.InstancedMesh(new T.ConeGeometry(.015,1,3),mat('#709854'),grassPositions.length),dummy=new T.Object3D();
grassPositions.forEach(({dir,h},i)=>{dummy.position.copy(dir).multiplyScalar(terrain(dir).r+h/2);dummy.quaternion.setFromUnitVectors(up,dir);dummy.scale.set(1,h,1);dummy.updateMatrix();blades.setMatrixAt(i,dummy.matrix);});blades.receiveShadow=true;planet.add(blades);
const flowers=new T.InstancedMesh(sphereGeo,mat('#f3dfb1'),flowerPositions.length);flowerPositions.forEach((dir,i)=>{dummy.position.copy(dir).multiplyScalar(terrain(dir).r+.04);dummy.scale.setScalar(.017);dummy.updateMatrix();flowers.setMatrixAt(i,dummy.matrix);});planet.add(flowers);
// A few high, slow birds bring movement into the negative space above the water.
const birds=[];for(let i=0;i<4;i++){const b=new T.Group();const left=mesh(new T.ConeGeometry(.022,.15,3),'#e7ebd8',b);left.rotation.z=-.8;left.position.x=-.045;const right=mesh(new T.ConeGeometry(.022,.15,3),'#e7ebd8',b);right.rotation.z=.8;right.position.x=.045;b.userData.phase=i*1.6;planet.add(b);birds.push(b);}
// Extend the original handcrafted globe with activities, wildlife and transport.
const categories={
 learn:{dir:biomes.ice.dir,tag:'学习类 · 未来都市',title:'每次共学，多一扇亮起的窗。',desc:'重点：AI共学 ×12、国学 ×3。城市楼宇、书院与天文台逐步生长，列车连接新的街区。'},
 create:{dir:biomes.volcano.dir,tag:'创造类 · 火山工坊',title:'让灵感成为看得见的作品。',desc:'重点：AI硬件 ×2、陶瓷、市集 ×2、黑客松。陶窑、机器人和市集环绕火山，最终点亮能源塔。'},
 play:{dir:biomes.forest.dir.clone().add(biomes.farm.dir).normalize(),tag:'娱乐休闲类 · 森野乐园',title:'森林有居民，海边有欢笑。',desc:'重点：茶和冥想 ×12、开营、结营。鹿群与绵羊漫步，风车、摩天轮和热气球陪伴每一次相聚。'}
};
// Timber learning village replaces the modern towers.
for(let i=0;i<8;i++){const g=at('ice',-.25+(i%3)*.24,-.22+Math.floor(i/3)*.23,1+i);house(g,.9+(i%3)*.16);g.rotateY(i*.7);}
const school=at('ice',.02,.04,9);house(school,1.4);box(school,'#82936d',0,.38,-.04,.23,.22,.21);const schoolRoof=mesh(coneGeo,'#737f55',school);schoolRoof.scale.set(.25,.23,.25);schoolRoof.position.y=.57;
// Elevated coastal railway, on terrain-following supports.
const railDir=biomes.ice.dir,railPoints=[];
function railPosition(a){const d=offset(railDir,Math.cos(a)*.35,Math.sin(a)*.34);return d.multiplyScalar(terrain(d).r+.15);}
for(let i=0;i<=120;i++)railPoints.push(railPosition(i/120*Math.PI*2));
const railCurve=new T.CatmullRomCurve3(railPoints,true);
mesh(new T.TubeGeometry(railCurve,160,.026,5,true),'#bcb79b');
for(let i=0;i<18;i++){const a=i/18*Math.PI*2,g=at('ice',Math.cos(a)*.35,Math.sin(a)*.34,1);box(g,'#758b85',0,.075,0,.022,.15,.022);}
const carriages=[];
for(let i=0;i<3;i++){const g=new T.Group();planet.add(g);box(g,i?'#e0c28c':'#d8825f',0,.043,0,.075,.085,.17);box(g,'#def0dc',0,.093,0,.08,.022,.18);for(const x of [-.039,.039])for(const z of [-.05,.015])box(g,'#406b80',x,.058,z,.006,.03,.045);carriages.push(g);}
// Ceramic, hardware and market buildings surround the original volcano.
for(let i=0;i<3;i++){const g=at('volcano',-.26+i*.23,-.25,3+i*3);house(g,.65);const kiln=mesh(new T.SphereGeometry(.11,10,8,0,Math.PI*2,0,Math.PI/2),'#cb9373',g);kiln.position.x=.14;box(g,'#ffcb74',.14,.035,.095,.047,.062,.012).material=mat('#ffcb74',{emissive:'#e77e33',emissiveIntensity:.6});}
for(let i=0;i<6;i++){const g=at('volcano',-.31+i*.12,.29,i<3?6:11);box(g,'#b99468',0,.045,0,.19,.09,.13);for(const x of [-.09,.09])box(g,'#e5cba4',x,.12,0,.01,.17,.01);box(g,i%2?'#d9b971':'#cd806c',0,.21,0,.23,.025,.18);ball(g,'#8bbfc0',-.04,.115,.015,.035,.055,.035);ball(g,'#e9d7b0',.04,.12,.015,.03,.05,.03);}
for(let i=0;i<2;i++){const g=at('volcano',.30,-.06+i*.15,5+i*5);box(g,'#98bcc0',0,.13,0,.12,.15,.09);box(g,'#e1d7b9',0,.25,0,.14,.10,.11);for(const x of [-.035,.035]){ball(g,'#3a687c',x,.26,.057,.014);branch(g,'#ccaa79',[x,.08,0],[x,.02,.018],.014);}branch(g,'#94b7ae',[-.065,.18,0],[-.12,.25,0],.013);branch(g,'#94b7ae',[.065,.18,0],[.13,.14,0],.013);}
// Ferris wheel with upright suspended cabins.
const fair=at('farm',.08,-.37,8);box(fair,'#c6b488',0,.01,0,.70,.025,.28);
for(const z of [-.045,.045])for(const x of [-.15,.15])branch(fair,'#e3d8b2',[x,0,z],[0,.35,z],.014);
const ferris=new T.Group();ferris.position.y=.35;fair.add(ferris);
mesh(new T.TorusGeometry(.27,.014,6,40),'#e0ad75',ferris);
const cabins=[];for(let i=0;i<8;i++){const a=i/8*Math.PI*2;branch(ferris,'#ddd6b9',[0,0,0],[Math.cos(a)*.27,Math.sin(a)*.27,0],.006);const c=new T.Group();c.position.set(Math.cos(a)*.27,Math.sin(a)*.27,0);ferris.add(c);box(c,['#d88372','#8dbab6','#e6c478'][i%3],0,-.035,0,.065,.07,.068);box(c,'#f1dfb9',0,.01,0,.075,.017,.078);cabins.push(c);}
const carousel=at('farm',-.22,-.35,10);mesh(new T.CylinderGeometry(.14,.16,.025,16),'#d7bb91',carousel).position.y=.02;const canopy=mesh(coneGeo,'#db8c79',carousel);canopy.position.y=.24;canopy.scale.set(.18,.12,.18);for(let i=0;i<5;i++){const a=i/5*6.28;branch(carousel,'#e0c88c',[Math.cos(a)*.10,.025,Math.sin(a)*.10],[Math.cos(a)*.10,.20,Math.sin(a)*.10],.005);ball(carousel,'#ede2c2',Math.cos(a)*.10,.10,Math.sin(a)*.10,.035,.025,.02);}
// Small recognizable grazing animals: legs, muzzle, ears and antlers.
const animals=[];
function animal(key,x,y,kind,index){const g=at(key,x,y,1);const body=new T.Group();g.add(body);const deer=kind==='deer',color=deer?'#bc9468':kind==='rabbit'?'#ece3cd':'#eee8cc';
 ball(body,color,0,.10,0,.085,.055,.045);ball(body,deer?'#b98a60':'#b4a28b',.07,.15,0,.034,.038,.03);
 for(const xx of [-.045,.045])for(const z of [-.025,.025])branch(body,'#a38a68',[xx,.075,z],[xx,.015,z],.008);
 for(const z of [-.02,.02]){ball(body,color,.07,.195,z,.012,kind==='rabbit'?.05:.025,.009);ball(body,'#3d4140',.093,.158,z,.006);}
 if(deer)for(const z of [-.021,.021]){branch(body,'#8b7350',[.065,.18,z],[.045,.26,z*2],.005);branch(body,'#8b7350',[.05,.23,z*1.7],[.09,.25,z*2.5],.004);}
 g.rotateY(index*1.7);animals.push({body,phase:index});}
animal('forest',-.30,.08,'deer',0);animal('forest',.29,-.18,'deer',1);animal('forest',-.12,-.29,'rabbit',2);
for(let i=0;i<4;i++)animal('farm',-.28+i*.13,.04,'sheep',i+3);
// Leisure balloon and a dirigible travel slowly above the planet.
const balloon=at('forest',-.36,-.05,7);balloon.position.multiplyScalar(1.16);ball(balloon,'#dba072',0,.28,0,.13,.17,.13);for(const x of [-.04,.04])branch(balloon,'#dfcfa7',[x,.06,0],[x,.20,0],.004);box(balloon,'#ac885e',0,.035,0,.08,.06,.065);
const airship=new T.Group();planet.add(airship);ball(airship,'#eadcbb',0,.10,0,.12,.12,.30);box(airship,'#a18363',0,-.055,0,.085,.075,.12);box(airship,'#ca966b',0,.11,-.25,.23,.012,.10);
function animateLife(t,dt){
 livingBoats.forEach(({boat,rest},i)=>{boat.quaternion.copy(rest);boat.rotateZ(Math.sin(t*1.3+i)*.055);});
 ferris.rotation.z=t*.16;cabins.forEach(c=>c.rotation.z=-ferris.rotation.z);
 carriages.forEach((g,i)=>{const a=t*.12-i*.075,p=railPosition(a),normal=p.clone().normalize();g.position.copy(p);const forward=railPosition(a+.001).sub(p).normalize(),right=new T.Vector3().crossVectors(normal,forward).normalize();g.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(right,normal,forward));g.visible=day>=4;});
 animals.forEach(({body,phase})=>{body.position.x=Math.sin(t*.45+phase)*.02;body.rotation.z=Math.sin(t*.8+phase)*.035;});
 const a=t*.045+.6,d=new T.Vector3(Math.cos(a)*.65,.58,Math.sin(a)*.65).normalize();airship.position.copy(d).multiplyScalar(3.35);airship.quaternion.setFromUnitVectors(up,d);airship.rotateY(-a);airship.visible=day>=10;
}

// Original procedural Mediterranean forest vignette. No combat or imported assets.
sanctuary.visible=false;
sanctuary.userData.day=99;
const mythWoods=[];
// Keep the existing forest footprint and replace its crown clusters with olives.
for(const g of growthObjects){
 const d=g.position.clone().normalize();
 if(terrain(d).key!=='forest'||g===sanctuary)continue;
 for(const child of g.children){
  if(child.isMesh&&child.geometry===sphereGeo&&child.position.y>.2){child.scale.y*=.63;child.material=mat('#9ea76e');mythWoods.push(child);child.userData.restZ=child.rotation.z;}
 }
}
const caveRoot=at('forest',-.035,.19,1);
// Open arch built from separate stones: the aperture stays genuinely open.
for(const z of [-.10,.02,.14]){
 for(const x of [-.22,.22]){
  const r=ball(caveRoot,'#bdbaa0',x,.14,z,.095,.18,.10);r.rotation.z=x*.4;
 }
 for(let i=0;i<9;i++){
  const a=i/8*Math.PI,r=ball(caveRoot,i%2?'#d9cfad':'#c4bea1',Math.cos(a)*.22,.27+Math.sin(a)*.15,z,.08,.07,.09);r.rotation.z=a;
 }
}
box(caveRoot,'#666c58',0,.005,.02,.34,.015,.46);
// Recessed darkness beyond the open arch rather than a flat front-facing decal.
box(caveRoot,'#343f39',0,.15,-.19,.31,.30,.025);
for(let i=0;i<6;i++)ball(caveRoot,'#788c60',-.23+i*.085,.40+Math.sin(i)*.022,-.01,.058,.018,.04);
const mythPath=[];
for(let i=0;i<35;i++){const u=i/34,d=offset(biomes.forest.dir,-.035+.07*Math.sin(u*4),.15-u*.46);mythPath.push(d.multiplyScalar(terrain(d).r+.014));}
mesh(new T.TubeGeometry(new T.CatmullRomCurve3(mythPath),48,.024,5,false),'#d7c9a1');
// Seated, sleeping Cyclops with a single closed eye and jointed arms.
const giantBase=at('forest',-.20,.08,1),giant=new T.Group();giantBase.add(giant);giant.rotation.y=-.35;
ball(giant,'#bfa17f',0,.15,0,.095,.13,.067);
ball(giant,'#aa8a67',0,.28,.012,.071,.075,.062);
ball(giant,'#665b47',0,.328,-.008,.072,.025,.054);
box(giant,'#4d4939',0,.286,.073,.038,.005,.005);
ball(giant,'#c4a481',0,.267,.074,.013,.019,.013);
ball(giant,'#79684e',0,.232,.052,.043,.016,.028);
for(const side of [-1,1]){
 branch(giant,'#b89a76',[side*.073,.21,0],[side*.12,.125,.045],.03);
 branch(giant,'#c1a17c',[side*.12,.125,.045],[side*.045,.08,.11],.025);
 ball(giant,'#c6a782',side*.045,.075,.115,.025);
 branch(giant,'#a88b68',[side*.045,.09,0],[side*.07,.045,.16],.035);
 ball(giant,'#b99972',side*.07,.035,.20,.034,.024,.055);
}
box(giant,'#927455',0,.08,.025,.17,.06,.13);
branch(giantBase,'#76654b',[.14,.03,.19],[.24,.04,-.12],.022);
ball(giantBase,'#8e8a76',.25,.05,-.14,.055,.04,.075);
// Supplies and a fire at the cave mouth.
barrel(caveRoot,.30,0,.13,.045);barrel(caveRoot,.31,0,.02,.035);
const camp=at('forest',.09,.10,2),flames=[];
for(let i=0;i<7;i++){const a=i/7*6.28;ball(camp,'#9f9b81',Math.cos(a)*.05,.012,Math.sin(a)*.05,.016);}
for(let i=0;i<3;i++){const f=mesh(coneGeo,'#edb569',camp,{emissive:'#ec8c35',emissiveIntensity:.7});f.position.set((i-1)*.016,.039,0);f.scale.set(.015,.07,.015);flames.push(f);}
// Red-sailed Greek-inspired ship moored off the forest coast.
const shipDir=offset(biomes.forest.dir,-.55,-.10),mythShip=new T.Group();
mythShip.position.copy(shipDir).multiplyScalar(terrain(shipDir).r+.025);mythShip.quaternion.setFromUnitVectors(up,shipDir);mythShip.visible=false;planet.add(mythShip);
const shipRest=mythShip.quaternion.clone();
ball(mythShip,'#624f3b',0,.025,0,.075,.045,.23);
box(mythShip,'#b29264',0,.052,0,.12,.012,.35);
for(const z of [-.21,.21])branch(mythShip,'#786247',[0,.025,z],[0,.13,z*1.08],.013);
branch(mythShip,'#9b8159',[0,.055,0],[0,.43,0],.01);
branch(mythShip,'#a68a5c',[-.13,.37,0],[.13,.37,0],.009);
const sailGeoMyth=new T.PlaneGeometry(.25,.22,8,8),sp=sailGeoMyth.attributes.position;
for(let i=0;i<sp.count;i++){const x=sp.getX(i),y=sp.getY(i);sp.setZ(i,Math.cos(x/.25*Math.PI)*Math.cos(y/.22*Math.PI)*.035);}
sailGeoMyth.computeVertexNormals();
const redSail=mesh(sailGeoMyth,'#b95f46',mythShip,{side:T.DoubleSide,roughness:1});redSail.position.set(0,.255,0);
for(const x of [-.055,.055])for(let i=0;i<5;i++)branch(mythShip,'#b59a6e',[x,.05,-.12+i*.055],[x*2.5,.015,-.15+i*.055],.004);
for(const x of [-.12,.12])branch(mythShip,'#d4bc8a',[x,.37,0],[x*.4,.06,.17],.002);
const forestCypresses=[];
for(const [x,y] of [[-.30,.20],[.27,.23],[.29,.03],[-.28,-.25]]){const g=at('forest',x,y,1);pine(g,.85);forestCypresses.push(g);}
categories.play.desc='重点：茶和冥想 ×12、开营、结营。橄榄林深处有岩洞与沉睡的独眼巨人，红帆船停在岸边；农场与游乐场继续生长。';
function animateForestMyth(t){
 giant.scale.y=1+Math.sin(t*1.4)*.018;
 mythShip.quaternion.copy(shipRest);mythShip.rotateZ(Math.sin(t*.85)*.045);mythShip.rotateX(Math.sin(t*.65)*.024);
 mythWoods.forEach((c,i)=>c.rotation.z=c.userData.restZ+Math.sin(t*.65+i)*.025);
 flames.forEach((f,i)=>f.scale.y=.058+Math.sin(t*6+i)*.013);
 redSail.rotation.y=Math.sin(t*.7)*.035;
}

// Gentle cloud clusters, kept small so that the terrain remains legible.
// Continuous planted surface, with a protected reserve around existing landmarks.
const reserved=Object.values(biomes).map(b=>b.dir);
for(let i=0;i<410;i++){
 const y=1-2*(i+.5)/410,a=i*2.399963,r=Math.sqrt(1-y*y),dir=new T.Vector3(Math.cos(a)*r,y,Math.sin(a)*r);
 if(reserved.some(d=>d.dot(dir)>.927)||dir.dot(biomes.volcano.dir)>.77)continue;
 const g=anchor(dir,1+(i%10));g.rotateY(i*1.7);
 if(i%9===0){ball(g,'#c4c3a0',0,.04,0,.07,.055,.055);continue;}
 if(i%3){pine(g,.65+rand()*.6);}else{tree(g,.6+rand()*.6);if(i%5===0)for(const m of g.children)if(m.geometry===sphereGeo)m.material=mat('#c9aa9a');}
}
// Irregular stepping stones wrap around the entire spherical world.
function stoneTrail(from,to){for(let i=0;i<34;i++){const f=i/33,d=from.clone().lerp(to,f).normalize();const g=anchor(d,1);const p=mesh(new T.CylinderGeometry(.039,.045,.012,6),'#dad0aa',g);p.position.y=.012;p.rotation.y=i*.8;}}
stoneTrail(biomes.forest.dir,biomes.ice.dir);stoneTrail(biomes.forest.dir,biomes.farm.dir);stoneTrail(biomes.farm.dir,biomes.volcano.dir);stoneTrail(biomes.ice.dir,biomes.volcano.dir);
for(let i=0;i<150;i++){
 const d=new T.Vector3(rand()*2-1,rand()*2-1,rand()*2-1).normalize();if(d.dot(biomes.volcano.dir)>.77)continue;const g=anchor(d,1);const color=['#f2dc9a','#ead6bd','#ccac9c'][i%3];
 for(let j=0;j<3;j++){const x=(j-1)*.032;branch(g,'#7c9659',[x,0,0],[x,.055,0],.003);ball(g,color,x,.06,0,.019,.010,.019);}
}
for(const [x,y,z]of [[0,.1,1],[.1,-.55,-1],[-.65,.3,-.7]]){const g=anchor(new T.Vector3(x,y,z).normalize(),5);house(g,1.3);g.rotateY(.25);}
// The old pier becomes a timber viewing deck; keep only land-based scenery.
categories.learn.title='把好奇心，种进林间木屋。';categories.learn.tag='学习类 · 共学小镇';categories.learn.desc='AI共学 ×12、国学 ×3。木屋、书院和穿林列车沿石板路生长。';
categories.create.tag='创造类 · 山间工坊';categories.create.desc='AI硬件、陶瓷、市集与黑客松，让山间木屋成为热闹的创作工坊。';
categories.play.desc='茶和冥想、开营与结营。林间岩洞、沉睡巨人、动物、农场和摩天轮，藏在同一片绿意里。';
// Rugged foothills separate the remote volcanic region from inhabited districts.
for(let i=0;i<16;i++){
 const a=i/16*Math.PI*2,r=.38+(i%3)*.045;
 const g=at('volcano',Math.cos(a)*r,Math.sin(a)*r,1);
 const h=.22+(i%4)*.095;
 rockSpire(g,h,.14+(i%3)*.025,['#999483','#a7a28c','#858777'][i%3]);g.rotateY(i*1.35);
 const shoulder=rockSpire(g,h*.52,.12,'#aaa58e');shoulder.position.set(.10,0,.05);
}
for(let i=0;i<24;i++){
 const a=i*2.39996,r=.47+rand()*.13,g=at('volcano',Math.cos(a)*r,Math.sin(a)*r,1);
 ball(g,i%2?'#a9a38d':'#8b8e7d',0,.028,0,.045+rand()*.04,.04,.055);
}
categories.create.desc='远离共学小镇与森野乐园的火山山地。岩峰与山麓围合创作工坊、市集和陶窑，留出独立的山间空间。';
// A small inland lake follows the sphere instead of floating on a flat disc.
const pondDir=new T.Vector3(-.05,.02,1).normalize(),pondFrame=frame(pondDir);
function pondPoint(x,z,lift=.018){const d=offset(pondDir,x,z);return d.multiplyScalar(terrain(d).r+lift);}
// Clear the lake's footprint while preserving the surrounding woodland.
growthObjects.forEach(g=>{const d=g.position.clone().normalize();const f=frame(pondDir),x=d.dot(f.x),z=d.dot(f.z);if(d.dot(pondDir)>.97&&(x/.18)**2+(z/.12)**2<1.22){g.visible=false;g.userData.day=99;}});
const pondVertices=[],pondSegments=56;
function pondEdge(a){const r=1+.08*Math.sin(a*3)+.04*Math.cos(a*5);return [.18*Math.cos(a)*r,.12*Math.sin(a)*r];}
for(let i=0;i<pondSegments;i++){const a=pondEdge(i/pondSegments*6.283185),b=pondEdge((i+1)/pondSegments*6.283185);for(const p of [pondPoint(0,0),pondPoint(...a),pondPoint(...b)])pondVertices.push(p.x,p.y,p.z);}
const pondGeo=new T.BufferGeometry();pondGeo.setAttribute('position',new T.Float32BufferAttribute(pondVertices,3));pondGeo.computeVertexNormals();
const pondWater=mesh(pondGeo,'#85b7ad',planet,{roughness:.3,metalness:.08,side:T.DoubleSide});pondWater.castShadow=false;
const pondRim=[];for(let i=0;i<=pondSegments;i++)pondRim.push(pondPoint(...pondEdge(i/pondSegments*6.283185),.023));
mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pondRim,true),72,.018,5,true),'#c4c59b');
for(let i=0;i<12;i++){const a=i/12*6.283185,[x,z]=pondEdge(a),g=anchor(offset(pondDir,x*1.12,z*1.12),1);if(i%3===0)ball(g,'#c0bea0',0,.02,0,.035,.025,.028);else for(let j=0;j<3;j++)branch(g,'#73864c',[(j-1)*.015,0,0],[(j-1)*.02,.065+j*.012,.01],.004);}
const pondDucks=[];
for(let i=0;i<4;i++){
 const duck=new T.Group();planet.add(duck);const s=i>1?.65:1;duck.scale.setScalar(s);
 ball(duck,i===1?'#c4ae83':'#f1dfae',0,.025,0,.045,.03,.027);
 ball(duck,i===1?'#637e50':'#f6e8c2',.03,.059,0,.022,.026,.021);
 box(duck,'#d6a45a',.056,.057,0,.025,.010,.019);
 for(const z of [-.018,.018])ball(duck,'#424d36',.038,.064,z,.004);
 ball(duck,'#e3cb93',-.01,.042,.022,.027,.009,.009);
 pondDucks.push({duck,phase:i*.75});
}
const pondRipples=[];for(let i=0;i<3;i++){const pts=[];for(let j=0;j<28;j++){const a=j/27*6.283185;pts.push(pondPoint(Math.cos(a)*(.035+i*.032),Math.sin(a)*(.025+i*.016),.023));}const line=new T.Line(new T.BufferGeometry().setFromPoints(pts),new T.LineBasicMaterial({color:'#e2edcd',transparent:true,opacity:.3}));planet.add(line);pondRipples.push(line);}
function animatePond(t){pondDucks.forEach(({duck,phase})=>{const a=t*.16+phase,x=Math.cos(a)*.105,z=Math.sin(a)*.055,p=pondPoint(x,z,.028),next=pondPoint(Math.cos(a+.01)*.105,Math.sin(a+.01)*.055,.028),normal=p.clone().normalize(),forward=next.sub(p).normalize(),side=new T.Vector3().crossVectors(forward,normal).normalize();duck.position.copy(p);duck.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(forward,normal,side));});pondRipples.forEach((r,i)=>r.material.opacity=.17+.12*Math.sin(t*1.2+i));}

const clouds=new T.Group();planet.add(clouds);for(const [x,y,z]of [[-2.3,.3,1.3],[1.95,1.3,.8],[.4,-2.5,.5],[-.9,2.45,.3],[2.3,-.8,.5]]){const g=new T.Group();g.position.set(x,y,z).normalize().multiplyScalar(2.92);clouds.add(g);g.quaternion.setFromUnitVectors(up,g.position.clone().normalize());for(let i=0;i<4;i++)ball(g,'#e9ecdf',(i-1.5)*.11,Math.sin(i)*.035,0,.11,.06,.065);}
// Distant stars are one draw call.
const stars=[];for(let i=0;i<650;i++){stars.push((rand()-.5)*65,(rand()-.5)*45,-8-rand()*28);}const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(stars,3));const hiddenStars=new T.Points(sg,new T.PointsMaterial({color:'#bdd4ef',size:.035,transparent:true,opacity:0,sizeAttenuation:true}));
const orbit=new T.Mesh(new T.TorusGeometry(3.35,.006,5,160),new T.MeshBasicMaterial({color:'#78919f',transparent:true,opacity:.24}));orbit.rotation.x=1.15;orbit.rotation.y=.22;orbit.visible=false;scene.add(orbit);
let auto=false,goal=null,day=14;const homeQ=new T.Quaternion();planet.quaternion.copy(homeQ);
function setRegion(key){document.querySelectorAll('[data-biome]').forEach(b=>{b.classList.toggle('active',b.dataset.biome===key);b.setAttribute('aria-pressed',String(b.dataset.biome===key));});const b=categories[key];goal=b?new T.Quaternion().setFromUnitVectors(b.dir,new T.Vector3(0,0,1)):homeQ.clone();document.querySelector('#region-tag').textContent=b?b.tag:'你的完整世界';document.querySelector('#region-title').textContent=b?b.title:'小小星球，正在发光。';document.querySelector('#region-copy').textContent=b?b.desc:'一整颗长满草木的小星球。石板路连接共学木屋、创作工坊与森林乐园。';distance=b?(innerWidth<640?12.5:10):(innerWidth<640?13.8:12.6);auto=false;document.querySelector('#rotate').setAttribute('aria-pressed','false');document.querySelector('#rotate').textContent='自转';}
document.querySelectorAll('[data-biome]').forEach(b=>b.onclick=()=>setRegion(b.dataset.biome));document.querySelector('#rotate').onclick=()=>{auto=!auto;goal=null;document.querySelector('#rotate').setAttribute('aria-pressed',String(auto));document.querySelector('#rotate').textContent=auto?'暂停':'自转';};
document.querySelector('#reset').onclick=()=>{setRegion('all');distance=innerWidth<640?13.8:12.6;};
document.querySelector('#growth').oninput=e=>{day=Number(e.target.value);document.querySelector('#day-label').textContent=day;growthObjects.forEach(g=>{g.visible=g.userData.day<=day;});};
const pointers=new Map();let pinch=0;
renderer.domElement.addEventListener('pointerdown',e=>{renderer.domElement.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});goal=null;auto=false;document.querySelector('#rotate').setAttribute('aria-pressed','false');document.querySelector('#rotate').textContent='自转';});
renderer.domElement.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const prev=pointers.get(e.pointerId);if(pointers.size===1){const q=new T.Quaternion().setFromEuler(new T.Euler((e.clientY-prev.y)*.006,(e.clientX-prev.x)*.006,0));planet.quaternion.premultiply(q);}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinch)distance=T.MathUtils.clamp(distance-(d-pinch)*.025,8,19);pinch=d;}});
for(const event of ['pointerup','pointercancel'])renderer.domElement.addEventListener(event,e=>{pointers.delete(e.pointerId);pinch=0;});
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();distance=T.MathUtils.clamp(distance+e.deltaY*.008,8,19);},{passive:false});
function notify(s){notice.textContent=s;notice.classList.remove('hide');setTimeout(()=>notice.classList.add('hide'),2600);}
document.querySelector('#capture').onclick=()=>{try{renderer.render(scene,camera);const c=document.createElement('canvas');c.width=renderer.domElement.width;c.height=renderer.domElement.height;const ctx=c.getContext('2d');ctx.drawImage(renderer.domElement,0,0);const scale=c.width/innerWidth;ctx.fillStyle='#435d3b';ctx.font=`${26*scale}px sans-serif`;ctx.fillText('林间小宇宙 · 我的第 '+day+' 天',28*scale,48*scale);ctx.font=`${12*scale}px sans-serif`;ctx.fillStyle='#5f7050';ctx.fillText('herstory / 每一次发生，都让世界生长',28*scale,c.height-25*scale);c.toBlob(blob=>{if(!blob)return notify('图片生成失败，请重试');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='林间小宇宙-Day'+day+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notify('星球图片已生成，手机端可保存到相册');});}catch(e){notify('图片保存失败，请使用浏览器截图。');}};
function resize(){const w=innerWidth,h=innerHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);const mobile=w<640,short=mobile&&h<650;const top=mobile?(short?65:100):35,bottom=mobile?(short?150:210):145;const area=Math.max(100,h-top-bottom);const diameter=Math.min(mobile?w*.92:w*.69,area*1.16);const frustum=2*Math.tan(T.MathUtils.degToRad(18))*(mobile?13.8:12.6);const scale=diameter/h*frustum/5.9;planet.scale.setScalar(scale);planet.position.y=(.5-(top+area/2)/h)*frustum;orbit.scale.setScalar(scale);orbit.position.copy(planet.position);}
addEventListener('resize',resize);resize();const clock=new T.Clock();
function render(){requestAnimationFrame(render);const dt=Math.min(clock.getDelta(),.05),t=clock.elapsedTime;camera.position.z+=(distance-camera.position.z)*.1;if(goal){planet.quaternion.slerp(goal,reduced?1:.07);if(planet.quaternion.angleTo(goal)<.001)goal=null;}if(auto)planet.rotateY(dt*.12);birds.forEach(b=>{const a=(reduced?0:t*.08)+b.userData.phase;b.position.set(Math.cos(a)*2.85,.6+Math.sin(a*2)*.15,Math.sin(a)*2.85);b.rotation.y=-a;b.children[0].rotation.z=-.8+(reduced?0:Math.sin(t*3+b.userData.phase)*.25);b.children[1].rotation.z=-b.children[0].rotation.z;});steam.forEach(p=>{const f=((reduced?0:t*.13)+p.userData.phase)%1;p.position.set(f*.13,.69+f*.42,f*.03);p.scale.setScalar(.04+f*.08);p.material.opacity=(1-f)*.14;});if(!reduced){crystal.rotation.y=t*.5;windmills.forEach(r=>r.rotation.z+=dt*.5);embers.forEach(e=>{const f=(t*.28+e.userData.phase)%1;e.position.set(Math.cos(e.userData.angle)*f*.14,.66+f*.48,Math.sin(e.userData.angle)*f*.14);e.scale.setScalar(.012*(1-f));});}animateLife(reduced?0:t,dt);animateForestMyth(reduced?0:t);animatePond(reduced?0:t);renderer.render(scene,camera);}
render();notice.classList.add('hide');window.planetDemo={renderer,scene,planet,biomes,growthObjects,setRegion,coverage};
