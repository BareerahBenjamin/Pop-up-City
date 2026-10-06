// Ground-footprint layout pass: terrain detail and intentional compound interiors are exempt.
const layoutReserved=[{dir:pondDir,r:.60,name:'DuckLake'},{dir:openLakeDir,r:.61,name:'OpenLake'},{dir:manhattanDir,r:1.22,name:'City'},{dir:gardenDir,r:.48,name:'Garden'},{dir:castleDir,r:.52,name:'Castle'}];
for(const [name,g] of Object.entries(assetDistricts)){layoutReserved.push({dir:g.position.clone().normalize(),r:name==='French_Lakeside_Village'?.57:name==='Railway_District'?.60:name==='Florist_District'?.49:.55,name});}
for(let i=0;i<100;i++)layoutReserved.push({dir:globeTrack(i/100*Math.PI*2).normalize(),r:.10,name:'Track'});
const fixedRoots=new Set([gardenRoot,castleRoot,...Object.values(assetDistricts)]);
function groundRadius(g){g.updateMatrixWorld(true);const inv=g.matrixWorld.clone().invert(),v=new T.Vector3();let r=0;g.traverse(o=>{if(!o.geometry)return;o.geometry.computeBoundingBox();const b=o.geometry.boundingBox,m=new T.Matrix4().multiplyMatrices(inv,o.matrixWorld);for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){v.set(x,y,z).applyMatrix4(m);r=Math.max(r,Math.hypot(v.x*g.scale.x,v.z*g.scale.z));}});return r;}
const layoutMovable=[];for(const g of growthObjects){if(g.parent!==planet||g.userData.day===99||g.userData.cityComponent||g.userData.pondEdge||fixedRoots.has(g))continue;const r=groundRadius(g);if(r<.065||r>1.3)continue;layoutMovable.push({g,r:r+.025,dir:g.position.clone().normalize()});}
layoutMovable.sort((a,b)=>b.r-a.r);const placed=[],unresolved=[];let moved=0;
function layoutFits(d,r){for(const q of layoutReserved){const clearance=q.name==='DuckLake'||q.name==='OpenLake'?r+q.r+.025:r*.7+q.r*.8;if(d.dot(q.dir)>Math.cos(clearance/radius))return false;}for(const q of placed){if(d.dot(q.dir)>Math.cos((r*.65+q.r*.65+.015)/radius))return false;}return true;}
// Keep the authored districts. Only nearby alternatives are allowed; never scatter props globally.
let maxShift=0;const zoneCounts={};
for(const item of layoutMovable){
 const zone=item.g.userData.zone;zoneCounts[zone||'landscape']=(zoneCounts[zone||'landscape']||0)+1;
 const f=frame(item.dir),originalRotation=item.g.quaternion.clone();let d=item.dir.clone(),found=layoutFits(d,item.r);
 const cap=zone==='farm'||zone==='forest'?.23:.18;
 function nearby(k){const a=k*2.399963,spread=cap*Math.sqrt(k/700);return item.dir.clone().multiplyScalar(Math.cos(spread)).addScaledVector(f.x,Math.sin(spread)*Math.cos(a)).addScaledVector(f.z,Math.sin(spread)*Math.sin(a)).normalize();}
 function sameZone(v){if(!zone)return true;return v.angleTo(biomes[zone].dir)<=Math.max(.58,item.dir.angleTo(biomes[zone].dir)+.045);}
 for(let k=1;!found&&k<=700;k++){const v=nearby(k);if(sameZone(v)&&layoutFits(v,item.r)){d=v;found=true;}}
 // Only vegetation is reduced when a tight authored cluster has no full-size slot.
 const vegetation=item.g.children.some(c=>c.userData.planetTree);
 if(!found&&vegetation){for(let pass=0;pass<3&&!found;pass++){item.g.scale.multiplyScalar(.88);item.r*=.88;for(let k=0;!found&&k<=700;k++){const v=nearby(k);if(sameZone(v)&&layoutFits(v,item.r)){d=v;found=true;}}}}
 if(!found){unresolved.push({zone:zone||'landscape',id:item.g.uuid});placed.push({dir:item.dir.clone(),r:item.r});continue;}
 const shift=d.angleTo(item.dir);if(shift>.001){const q=new T.Quaternion().setFromUnitVectors(item.dir,d);item.g.position.copy(d).multiplyScalar(terrain(d).r);item.g.quaternion.copy(q.multiply(originalRotation));moved++;maxShift=Math.max(maxShift,shift);}
 placed.push({dir:d.clone(),r:item.r});
}
console.log('Layout clearance',layoutMovable.length,moved,unresolved.length);window.layoutAudit={checked:layoutMovable.length,moved,reserved:layoutReserved.length,unresolved,maxShift,zoneCounts,scope:'District-preserving local clearance; never relocates across globe. Unresolved conservative bounds retained for review.'};

