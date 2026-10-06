// Ten sparrow-sized volumetric starlight swallows; no halo, particles or leader.
const starlightSwallows=(()=>{
 const root=new T.Group();root.name='StarlightSwallows';root.userData={role:'planet-guardians',species:'星光燕',count:10};root.rotation.z=.38;planet.add(root);
 const silver=new T.MeshStandardMaterial({color:'#edf0ef',roughness:.87,metalness:0,emissive:'#b8d8ee',emissiveIntensity:.055});
 const blue=new T.MeshStandardMaterial({color:'#aecfe2',roughness:.88,metalness:0,emissive:'#9fc9eb',emissiveIntensity:.09});
 const dark=new T.MeshStandardMaterial({color:'#424d57',roughness:.9});const beakMat=new T.MeshStandardMaterial({color:'#a1afb5',roughness:.9});
 const rounded=new T.SphereGeometry(1,8,5),feather=new T.IcosahedronGeometry(1,0),beakGeo=new T.ConeGeometry(.0035,.010,5);
 function add(parent,name,geo,mat,p,s){const mesh=new T.Mesh(geo,mat);mesh.name=name;mesh.position.set(...p);mesh.scale.set(...s);parent.add(mesh);return mesh;}
 const birds=[];let measuredLength=0;
 for(let i=0;i<10;i++){
  const bird=new T.Group();bird.name='StarlightSwallow_'+String(i+1).padStart(2,'0');bird.userData={species:'星光燕',leader:false};root.add(bird);bird.scale.setScalar(1.3);
  const body=new T.Group();body.name='Body';bird.add(body);
  add(body,'RoundBody',rounded,silver,[0,0,0],[.017,.020,.025]);add(body,'Head',rounded,silver,[0,.012,.023],[.013,.013,.013]);
  const beak=add(body,'Beak',beakGeo,beakMat,[0,.011,.038],[1,1,1]);beak.rotation.x=Math.PI/2;
  for(const sign of [-1,1]){add(body,'Eye'+sign,rounded,dark,[sign*.0105,.017,.031],[.002,.0023,.002]);const tail=add(body,'ForkTail'+sign,feather,silver,[sign*.006,-.002,-.031],[.005,.003,.012]);tail.rotation.y=-sign*.27;}
  const wings=[-1,1].map(sign=>{const joint=new T.Group();joint.name=sign<0?'Wing_L':'Wing_R';joint.position.set(sign*.011,.006,0);bird.add(joint);const wing=add(joint,'Wing',feather,silver,[sign*.017,0,-.002],[.025,.0035,.012]);wing.rotation.y=sign*.20;const tip=add(joint,'BlueTip',feather,blue,[sign*.034,0,-.006],[.012,.003,.007]);tip.rotation.y=sign*.25;return joint;});
  const bounds=new T.Box3().setFromObject(bird);measuredLength=Math.max(measuredLength,bounds.max.z-bounds.min.z);
  birds.push({object:bird,wings,phase:i*.233+(i%3)*.023,radius:3.22+(i%3)*.08,flap:i*1.37});
 }
 const p=new T.Vector3(),next=new T.Vector3(),normal=new T.Vector3(),forward=new T.Vector3(),side=new T.Vector3(),basis=new T.Matrix4();
 function point(angle,r,offset,target){const lat=.13+Math.sin(angle*1.3+offset)*.10;return target.set(Math.cos(angle)*Math.cos(lat)*r,Math.sin(lat)*r,Math.sin(angle)*Math.cos(lat)*r);}
 function animate(t){for(const b of birds){const a=t*.105+b.phase;point(a,b.radius,b.phase*.12,p);point(a+.001,b.radius,b.phase*.12,next);normal.copy(p).normalize();forward.copy(next).sub(p).normalize();side.crossVectors(normal,forward).normalize();normal.crossVectors(forward,side).normalize();b.object.position.copy(p);b.object.quaternion.setFromRotationMatrix(basis.makeBasis(side,normal,forward));const flap=Math.sin(t*6.2+b.flap)*.52;b.wings[0].rotation.z=-flap;b.wings[1].rotation.z=flap;}}
 animate(0);let triangles=0;root.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;}});
 return {root,birds,animate,audit(){return {count:birds.length,length:measuredLength,planetDiameter:4.90,lengthPercent:measuredLength/4.90*100,triangles,maxEmissiveIntensity:.09,uniformScale:birds.every(b=>b.object.scale.equals(birds[0].object.scale))};},asset(){return root.toJSON();}};
})();
window.starlightSwallows=starlightSwallows;
