// A compact Manhattan-inspired layout, shared by globe and street explorer.
// Distances are game units; this is not a geographic survey or a 1:1 replica.
const cityLayout={width:25,avenues:[-6,6],streets:[-11,-2,6,11],park:{x:0,z:-6.5,w:9,d:7},buildings:[]};
for(const x of [-9,9])for(const z of [-8,-4])cityLayout.buildings.push({x,z,w:2.3,d:2.2,h:2.3,type:'brownstone'});
for(const x of [-9,-2.3,2.3,9])for(const z of [2,8.5])cityLayout.buildings.push({x,z,w:2.6,d:z===2?4:2.2,h:3.5+(Math.abs(x)+z)%3,type:x===2.3&&z===2?'empire':'tower'});
function cityBox(parent,color,x,y,z,w,h,d){return box(parent,color,x,y,z,w,h,d);}
function cityBuilding(parent,b){
 const c=b.type==='brownstone'?'#a77c61':b.type==='empire'?'#d9c9a3':'#9fac9e';
 cityBox(parent,c,0,b.h/2,0,b.w,b.h,b.d);cityBox(parent,'#d8d1b8',0,b.h+.07,0,b.w+.13,.14,b.d+.13);
 const floors=Math.floor(b.h/.48),positions=[];
 for(let k=0;k<floors;k++)for(let j=0;j<3;j++)for(const sign of [-1,1])positions.push([(j-1)*b.w*.25,.38+k*.48,sign*(b.d/2+.014)]);
 const windows=new T.InstancedMesh(cubeGeo,mat('#46666b'),positions.length),tmp=new T.Object3D();
 positions.forEach((p,i)=>{tmp.position.set(...p);tmp.scale.set(.29,.23,.022);tmp.updateMatrix();windows.setMatrixAt(i,tmp.matrix);});parent.add(windows);
 cityBox(parent,'#566b60',0,.45,b.d/2+.025,.45,.9,.035);
 if(b.type==='brownstone'){
  for(let i=0;i<3;i++)cityBox(parent,'#c2b092',0,.05+i*.08,b.d/2+.45-i*.12,.7,.1,.22);
  cityBox(parent,'#626d55',0,1.05,b.d/2+.15,b.w,.12,.38);
 }else if(b.type==='empire'){
  for(let i=0;i<3;i++)cityBox(parent,'#c9b994',0,b.h+.4+i*.6,0,b.w*(.76-i*.2),.65,b.d*(.7-i*.18));
  branch(parent,'#b1a782',[0,b.h+1.6,0],[0,b.h+3.2,0],.045);
 }else{cityBox(parent,'#798776',.4,b.h+.28,0,.5,.36,.6);}
}
function cityTree(g,s=1){branch(g,'#7c7152',[0,0,0],[0,.7*s,0],.065*s);ball(g,'#8ea567',0,.9*s,0,.42*s,.47*s,.38*s);}
function buildCity(place){
 for(const x of cityLayout.avenues){const g=place(x,0,1);cityBox(g,'#83877d',0,.016,0,1.6,.032,24);for(const sx of [-1,1])cityBox(g,'#d1cbb2',sx*1.0,.04,0,.4,.08,24);for(let z=-10;z<11;z+=1.5)cityBox(g,'#e5d7a7',0,.039,z,.07,.008,.62);}
 for(const z of cityLayout.streets){const g=place(0,z,1);cityBox(g,'#83877d',0,.021,0,24,.04,1.3);for(const sz of [-1,1])cityBox(g,'#d1cbb2',0,.047,sz*.85,24,.07,.35);}
 for(const x of cityLayout.avenues)for(const z of cityLayout.streets){const g=place(x,z,1);for(let i=0;i<5;i++)cityBox(g,'#f3e6c4',-.52+i*.26,.052,.94,.14,.012,.55);}
 const pg=place(0,-6.5,1);cityBox(pg,'#9fab70',0,.04,0,9,.08,7);cityBox(pg,'#d6cc9f',0,.087,0,.55,.014,7);cityBox(pg,'#d6cc9f',0,.09,0,9,.014,.55);
 for(const x of [-3.3,-1.8,1.8,3.3])for(const z of [-2.4,-1.2,1.2,2.4]){const g=new T.Group();g.position.set(x,.08,z);pg.add(g);cityTree(g,.8+(Math.abs(z)%1));}
 for(const x of [-1.2,1.2]){cityBox(pg,'#826d4d',x,.28,.65,.7,.12,.25);cityBox(pg,'#8d7756',x,.5,.77,.7,.33,.08);}
 cityLayout.buildings.forEach((b,i)=>{const g=place(b.x,b.z,2+i%11);cityBuilding(g,b);});
 for(let i=0;i<8;i++){const g=place(i%2?-4.8:4.8,-9+i*2.6,1);branch(g,'#5f6c5a',[0,0,0],[0,1.4,0],.027);ball(g,'#e8d9a6',0,1.42,0,.10);}
 const stop=place(-4.7,4.5,2);cityBox(stop,'#6a8275',0,1.35,0,.75,.09,1.7);for(const z of [-.7,.7])cityBox(stop,'#748476',0,.7,z,.07,1.3,.07);cityBox(stop,'#d5d8ba',0,.8,-.75,.7,1,.06);
}
const cityScale=.073;
// Separate the new district from the original city/rail hub.
const manhattanDir=new T.Vector3(-.04,.86,.56).normalize();
function globeCityPlace(x,z,unlock){const d=offset(manhattanDir,x*cityScale/radius,z*cityScale/radius);const g=anchor(d,unlock);g.scale.setScalar(cityScale);g.userData.cityComponent=true;return g;}
buildCity(globeCityPlace);
categories.learn.tag='学习类 · 曼哈顿小城';categories.learn.title='从共学出发，走进城市。';categories.learn.desc='中央公园与中城首区：林荫步道、褐石街屋、阶梯塔冠与穿梭的黄色出租车。';
const streetScene=new T.Scene();streetScene.background=new T.Color('#f5f5e9');streetScene.fog=new T.Fog('#f5f5e9',38,95);
streetScene.add(new T.HemisphereLight('#fff7dc','#8c9775',2.2));const streetSun=new T.DirectionalLight('#ffe4bd',3);streetSun.position.set(-14,28,15);streetScene.add(streetSun);
const cityGround=cityBox(streetScene,'#b6b89b',0,-.16,0,25,.3,25);const streetRoots=[];
buildCity((x,z)=>{const g=new T.Group();g.position.set(x,0,z);streetScene.add(g);streetRoots.push(g);return g;});
const streetCamera=new T.OrthographicCamera(-15,15,15,-15,.1,120),cityExplorer={active:false,x:-6,z:10,angle:.55,zoom:14,keys:new Set(),savedQ:null,};
const walker=new T.Group();streetScene.add(walker);ball(walker,'#d9b792',0,.7,0,.13);cityBox(walker,'#a26650',0,.40,0,.24,.38,.18);const walkerLegs=[];for(const x of [-.07,.07])walkerLegs.push(cityBox(walker,'#576351',x,.14,0,.08,.26,.1));
const taxiInstances=[];
function taxi(parent,isBus=false){const g=new T.Group();parent.add(g);cityBox(g,isBus?'#9ba98e':'#dbb34e',0,.22,0,.6,.32,isBus?1.7:1.0);cityBox(g,'#d5d7bc',0,.43,0,.53,.2,isBus?1.4:.52);cityBox(g,'#566f70',0,.44,.28,.43,.12,.02);for(const x of [-.31,.31])for(const z of [-.3,.3])ball(g,'#5d6157',x,.12,z,.08,.1,.1);return g;}
for(let i=0;i<6;i++)taxiInstances.push({street:taxi(streetScene,i===5),globe:taxi(planet,i===5),phase:i*3.7});
taxiInstances.forEach(v=>v.globe.scale.setScalar(cityScale));
function cityRoad(x,z){if(Math.abs(x)>11.7||Math.abs(z)>11.7)return false;return cityLayout.avenues.some(a=>Math.abs(x-a)<.65)||cityLayout.streets.some(a=>Math.abs(z-a)<.55)||(Math.abs(x)<.24&&z>=-10&&z<=-2)||(Math.abs(z+6.5)<.24&&Math.abs(x)<=6);}
function moveWalker(dx,dz){const nx=cityExplorer.x+dx,nz=cityExplorer.z+dz;if(cityRoad(nx,cityExplorer.z))cityExplorer.x=nx;if(cityRoad(cityExplorer.x,nz))cityExplorer.z=nz;}
function frameCity(){const w=host.clientWidth,h=host.clientHeight,a=w/h,r=cityExplorer.zoom;streetCamera.left=-r*a;streetCamera.right=r*a;streetCamera.top=r;streetCamera.bottom=-r;streetCamera.updateProjectionMatrix();const target=new T.Vector3(cityExplorer.x*.55,0,cityExplorer.z*.55);streetCamera.position.copy(target).add(new T.Vector3(Math.sin(cityExplorer.angle)*28,31,Math.cos(cityExplorer.angle)*28));streetCamera.lookAt(target);}
function animateCity(t,dt){
 taxiInstances.forEach((v,i)=>{const a=(t*1.4+v.phase*3)%69.28;let x,z,rot;if(a<22){x=-6.32;z=-11+a;rot=0;}else if(a<34.64){x=-6.32+a-22;z=11;rot=Math.PI/2;}else if(a<56.64){x=6.32;z=11-(a-34.64);rot=Math.PI;}else{x=6.32-(a-56.64);z=-11;rot=-Math.PI/2;}v.street.position.set(x,.04,z);v.street.rotation.y=rot;const d=offset(manhattanDir,x*cityScale/radius,z*cityScale/radius);v.globe.position.copy(d).multiplyScalar(terrain(d).r+.009);v.globe.quaternion.setFromUnitVectors(up,d);v.globe.rotateY(rot);v.globe.visible=day>=4;});
 if(!cityExplorer.active)return;
 let dx=0,dz=0;const k=cityExplorer.keys;if(k.has('ArrowUp')||k.has('w'))dz-=1;if(k.has('ArrowDown')||k.has('s'))dz+=1;if(k.has('ArrowLeft')||k.has('a'))dx-=1;if(k.has('ArrowRight')||k.has('d'))dx+=1;
 const len=Math.hypot(dx,dz)||1;moveWalker(dx/len*dt*3,dz/len*dt*3);walker.position.set(cityExplorer.x,.06,cityExplorer.z);if(dx||dz)walker.rotation.y=Math.atan2(dx,dz);walkerLegs.forEach((leg,i)=>leg.rotation.x=dx||dz?Math.sin(t*9+i*Math.PI)*.4:0);frameCity();
 const label=document.querySelector('#city-location');if(label)label.textContent=cityExplorer.z<-2?'中央公园 · 林荫步道':cityExplorer.z>6?'中城 · 地标街区':'中城 · 大道与褐石街屋';
}
window.manhattanExplorer={
 enter(){if(cityExplorer.active)return;cityExplorer.savedQ=planet.quaternion.clone();cityExplorer.active=true;document.body.classList.add('city-mode');document.querySelector('#city-controls').hidden=false;cityExplorer.keys.clear();frameCity();},
 exit(){cityExplorer.active=false;cityExplorer.keys.clear();if(cityExplorer.savedQ)planet.quaternion.copy(cityExplorer.savedQ);document.body.classList.remove('city-mode');document.querySelector('#city-controls').hidden=true;},
 go(place){const p={park:[0,-6.5],midtown:[6,2],homes:[-6,-4]}[place];if(p){cityExplorer.x=p[0];cityExplorer.z=p[1];frameCity();}},
 step(dx,dz){moveWalker(T.MathUtils.clamp(dx,-.2,.2),T.MathUtils.clamp(dz,-.2,.2));},steer(key,pressed){if(pressed)cityExplorer.keys.add(key);else cityExplorer.keys.delete(key);},rotate(delta){cityExplorer.angle+=delta;frameCity();},zoom(delta){cityExplorer.zoom=T.MathUtils.clamp(cityExplorer.zoom+delta,7,20);frameCity();},
 snapshot(){if(cityExplorer.active)renderer.render(streetScene,streetCamera);else renderer.render(scene,camera);return renderer.domElement;},
 audit(){return {region:'Central Park + Midtown',layout:cityLayout,player:{x:cityExplorer.x,z:cityExplorer.z,onRoad:cityRoad(cityExplorer.x,cityExplorer.z)},active:cityExplorer.active,streetModels:streetRoots.length,taxis:taxiInstances.length};}
};
addEventListener('keydown',e=>{if(cityExplorer.active&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(e.key)){e.preventDefault();cityExplorer.keys.add(e.key);}});
addEventListener('keyup',e=>cityExplorer.keys.delete(e.key));addEventListener('blur',()=>cityExplorer.keys.clear());

