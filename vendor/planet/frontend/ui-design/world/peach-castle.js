// Princess Peach's castle, reimagined as a miniature radial landmark.
const castleDir=new T.Vector3(-.86,-.36,-.34).normalize(),castleRoot=anchor(castleDir,1);castleRoot.scale.setScalar(.13);
box(castleRoot,'#b3b38b',0,.05,0,5.3,.1,4.7);box(castleRoot,'#d0c8ae',0,.16,0,4.5,.2,3.9);
function castleTower(x,z,h,r){const shaft=mesh(new T.CylinderGeometry(r,r*1.06,h,14),'#f2e6cf',castleRoot);shaft.position.set(x,h/2+.23,z);for(const y of [.35,h*.55,h+.18]){const band=mesh(new T.CylinderGeometry(r*1.12,r*1.12,.12,14),'#d7c6a8',castleRoot);band.position.set(x,y,z);}const roof=mesh(new T.ConeGeometry(r*1.38,r*2.25,14),'#d67e96',castleRoot);roof.position.set(x,h+.23+r*1.12,z);for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const win=box(castleRoot,'#6e9da9',x+Math.sin(a)*(r+.01),h*.7,z+Math.cos(a)*(r+.01),.16,.38,.035);win.rotation.y=a;}branch(castleRoot,'#c7a15b',[x,h+r*2.25+.23,z],[x,h+r*2.25+.75,z],.023);const flag=box(castleRoot,'#eaa7bb',x+.15,h+r*2.25+.62,z,.3,.17,.02);castleFlags.push(flag);}
const castleFlags=[];box(castleRoot,'#eee2c8',0,1.18,0,2.9,2,2.3);box(castleRoot,'#d9ccb0',0,2.2,0,3.08,.18,2.45);
for(const x of [-1.65,1.65])for(const z of [-1.35,1.35])castleTower(x,z,z<0?2.3:2,.42);castleTower(0,-.45,3.25,.67);
for(const x of [-1.05,-.7,.7,1.05])box(castleRoot,'#8cabb3',x,1.25,1.16,.18,.55,.025);
// Arched gate and front steps.
box(castleRoot,'#8f716b',0,.75,1.18,.72,1.1,.06);const arch=mesh(new T.TorusGeometry(.42,.09,6,18,Math.PI),'#d8c5a6',castleRoot);arch.position.set(0,1.25,1.22);for(const x of [-.42,.42])box(castleRoot,'#d8c5a6',x,.75,1.22,.15,1,.12);for(let i=0;i<4;i++)box(castleRoot,'#d9ccb0',0,.08+i*.065,2.18-i*.22,1.2,.13,.4);
// Rose window: a small colored-glass Peach portrait and gold crown.
const portrait=mesh(new T.CircleGeometry(.36,24),'#88b8c5',castleRoot);portrait.position.set(0,1.85,1.24);const castleRim=mesh(new T.TorusGeometry(.36,.045,6,24),'#d1ae65',castleRoot);castleRim.position.copy(portrait.position);ball(castleRoot,'#efc262',0,1.94,1.26,.17,.21,.025);ball(castleRoot,'#f3ceac',0,1.94,1.29,.10,.12,.02);box(castleRoot,'#e999b4',0,1.71,1.29,.25,.23,.035);for(const x of [-.09,0,.09])box(castleRoot,'#f4d179',x,2.12,1.29,.055,.1,.025);
for(let i=0;i<22;i++){const a=i/22*Math.PI*2;ball(castleRoot,i%2?'#d9a2b1':'#f0d2d4',Math.cos(a)*2.35,.21,Math.sin(a)*2.02,.11,.08,.11);}
window.peachCastle={root:castleRoot,dir:castleDir,focus(){window.manhattanExplorer.exit();goal=new T.Quaternion().setFromUnitVectors(castleDir,new T.Vector3(0,.08,1).normalize());distance=11.6;}};

