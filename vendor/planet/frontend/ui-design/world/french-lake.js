// French lakeside hamlet, on its own rear/southern patch of the globe.
const frenchDir=new T.Vector3(.08,-.98,.08).normalize();
const frenchVillage=anchor(frenchDir,1);frenchVillage.name='French_Lakeside_Village';frenchVillage.scale.setScalar(.105);
function fvBox(name,c,x,y,z,w,h,d){const m=box(frenchVillage,c,x,y,z,w,h,d);m.name=name;return m;}
const shore=mesh(new T.CylinderGeometry(4.9,4.9,.16,40),'#8eaa78',frenchVillage);shore.position.y=.02;shore.name='Forest_Ground';
const lake=mesh(new T.CylinderGeometry(2.35,2.4,.05,48),'#709e9c',frenchVillage);lake.position.y=.13;lake.name='Central_Lake';lake.material=mat('#709e9c',{roughness:.24,metalness:.12});
for(let i=0;i<38;i++){const a=i/38*Math.PI*2;ball(frenchVillage,i%2?'#b8b89b':'#a4b19a',Math.cos(a)*2.48,.15,Math.sin(a)*2.48,.20,.11,.15);}
function fvPath(name,a,b){const count=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/.23);for(let i=0;i<=count;i++){const f=i/count;fvBox(name+'_'+i,i%3?'#d6cbb0':'#c5bca1',a[0]+(b[0]-a[0])*f,.16,a[1]+(b[1]-a[1])*f,.21,.055,.21);}}
// A complete ring promenade joins every front door and the dock.
for(let i=0;i<100;i++){const a=i/100*Math.PI*2;fvBox('Promenade_'+i,'#d2c6a8',Math.cos(a)*2.92,.16,Math.sin(a)*2.92,.22,.045,.22);}
const villageHouses=[];
for(let i=0;i<8;i++){const a=i/8*Math.PI*2,x=Math.cos(a)*3.7,z=Math.sin(a)*3.7,g=new T.Group();frenchVillage.add(g);g.name='Maison_'+(i+1);g.position.set(x,.13,z);g.rotation.y=-a-Math.PI/2;villageHouses.push(g);box(g,['#e7d2b4','#d8bc9c','#e5cfb9'][i%3],0,.48,0,.95,.96,.78);const roof=mesh(new T.ConeGeometry(.85,.6,4),i%3?'#a87360':'#6c8088',g);roof.rotation.y=Math.PI/4;roof.scale.z=.9;roof.position.y=1.22;box(g,'#b0a38d',.28,1.2,-.13,.14,.55,.16);box(g,'#786e56',0,.29,.4,.21,.58,.035);for(const side of [-1,1]){box(g,'#92b1b4',side*.29,.65,.405,.18,.24,.02);for(const dx of [-.12,.12])box(g,i%2?'#72918b':'#98a581',side*.29+dx,.65,.415,.065,.27,.03);box(g,'#ad8165',side*.29,.46,.47,.3,.07,.12);for(let f=0;f<4;f++)ball(g,['#dc9eae','#e9c273','#ba91bd'][f%3],side*.29-.11+f*.07,.53,.48,.045,.045,.05);}fvPath('Door_Path_'+i,[Math.cos(a)*2.92,Math.sin(a)*2.92],[Math.cos(a)*3.2,Math.sin(a)*3.2]);}
// The derelict lake house has missing roof tiles, open window frames and a leaning porch.
const ruin=new T.Group();ruin.name='Lake_Centre_Abandoned_House';frenchVillage.add(ruin);for(const x of [-.48,.48])for(const z of [-.4,.4])box(ruin,'#6d776a',x,.24,z,.09,.5,.09);box(ruin,'#8d8e78',0,.46,0,1.22,.1,1.05);box(ruin,'#b5ad8f',0,.94,-.43,1.08,.85,.09);for(const x of [-.5,.5])box(ruin,'#aaa589',x,.93,0,.08,.84,.86);for(const x of [-.41,.41])box(ruin,'#aea78c',x,.9,.43,.2,.8,.09);box(ruin,'#817966',0,1.3,.43,1.08,.13,.1);for(let i=0;i<8;i++){if(i===2||i===5)continue;for(const side of [-1,1]){const tile=box(ruin,'#777f75',-.55+i*.15,1.51,side*.22,.14,.06,.64);tile.rotation.x=side*.58;}}for(let i=0;i<5;i++){const plank=box(ruin,'#8d8169',-.4+i*.2,.52,.76,.16,.045,.6);plank.rotation.x=i===2?.22:0;}for(let i=0;i<14;i++)ball(ruin,'#758863',Math.sin(i*2)*.5,.5+(i%4)*.19,-.47,.10,.09,.05);
// Dock stops at the water: the abandoned house remains isolated in the lake.
for(let i=0;i<8;i++)fvBox('Village_Dock_'+i,'#a7916c',0,.21,2.95-i*.14,.64,.07,.12);
const boat= new T.Group();boat.name='Moored_Rowboat';frenchVillage.add(boat);boat.position.set(.6,.19,2.15);box(boat,'#8b7158',0,.04,0,.3,.09,.64);for(const x of [-.14,.14])box(boat,'#ad9270',x,.12,0,.03,.14,.64);
fvPath('Gate_To_Plaza',[0,4.85],[0,2.95]);fvPath('West_Forest_Path',[-4.9,0],[-2.95,0]);fvPath('East_Forest_Path',[4.9,0],[2.95,0]);
const fountain=mesh(new T.CylinderGeometry(.34,.38,.18,16),'#c3bda6',frenchVillage);fountain.position.set(0,.23,3.5);ball(frenchVillage,'#87aca7',0,.35,3.5,.25,.03,.25);fvBox('Fountain_Column','#c6bea8',0,.51,3.5,.10,.36,.1);
// New forest is intentional to this district; it does not repopulate the thinned planet.
for(let i=0;i<24;i++){const a=i/24*Math.PI*2+.07,r=4.45+(i%3)*.16,g=new T.Group();g.name='Forest_Tree_'+i;frenchVillage.add(g);g.position.set(Math.cos(a)*r,.13,Math.sin(a)*r);branch(g,'#85765a',[0,0,0],[0,.7,0],.06);ball(g,i%2?'#739568':'#8ca473',0,.92,0,.33,.46,.34);}
for(let i=0;i<96;i++){const a=i*2.39996,r=3.12+(i%5)*.27;ball(frenchVillage,['#df9ca9','#d7bd72','#b193ba','#e9d2bf'][i%4],Math.cos(a)*r,.22,Math.sin(a)*r,.05,.065,.05);}
const lakeRipples=[];for(let i=0;i<4;i++){const ring=mesh(new T.TorusGeometry(.3+i*.32,.008,4,40),'#b6d1be',frenchVillage);ring.rotation.x=-Math.PI/2;ring.position.set(.4,.164,-.5);lakeRipples.push(ring);}
function animateFrenchLake(t){lakeRipples.forEach((r,i)=>r.scale.setScalar(1+.04*Math.sin(t*.8+i)));boat.rotation.z=Math.sin(t*1.2)*.025;}
assetDistricts.French_Lakeside_Village=frenchVillage;
window.frenchLake={root:frenchVillage,houses:villageHouses,ruin,trees:24,paths:['promenade','doors','gate','west','east','dock']};
