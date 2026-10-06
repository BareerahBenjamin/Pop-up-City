// Resolve the pinned upstream model once, before the H5 re-parents its original world.
const assetRegistry=(()=>{
 const roots=[...window.HerstoryAssetRoots],paths=new Map(),objects=new Map();
 function walk(object,path){paths.set(object,path);objects.set(path,object);object.children.forEach((child,i)=>walk(child,path+'/'+i));}
 roots.forEach(root=>walk(root,root.userData.assetSourceRoot));
 const aliases={'@starlightSwallows':[starlightSwallows.root]};
 aliases['@railBase']=railway.children.filter(o=>!o.name.startsWith('Train_')&&!railSignals.includes(o));
 for(let i=1;i<=3;i++)aliases['@train'+i]=[railway.getObjectByName('Train_'+i)];
 aliases['@signalA']=railSignals.slice(0,6);aliases['@signalB']=railSignals.slice(6);
 aliases['@floristCore']=florist.children.filter(o=>!/^(Pot_Street|Plant_Street|Vending|Drink|Utility|Pole_|Traffic|Signal_|Bicycle)/.test(o.name));
 aliases['@kilnHouses']=[];aliases['@kilnOvens']=[];
 for(let i=140;i<=142;i++){const root=objects.get('root_'+String(i).padStart(4,'0'));if(!root)throw Error('Kiln mapping missing');aliases['@kilnHouses'].push(...root.children.slice(0,-2));aliases['@kilnOvens'].push(...root.children.slice(-2));}
 const visuals=[...objects.entries()].filter(([,o])=>o.geometry&&(o.isMesh||o.isLine||o.isPoints));
 const visualSet=new Set(visuals.map(([,o])=>o));
 const descriptions=visuals.map(([path,o])=>{let p=o,attached=false,visible=true,zone='';while(p){visible=visible&&p.visible;if(p.userData.zone)zone=p.userData.zone;if(p===planet){attached=true;break;}p=p.parent;}return {path,name:o.name,type:o.type,geometry:o.geometry.type,vertices:o.geometry.attributes.position?.count||0,attached,initiallyVisible:visible,scene:zone||path.split('/')[0]};});
 function resolve(ref){const targets=ref.startsWith('@')?aliases[ref]:[objects.get(ref)];if(!targets?.length||targets.some(o=>!o))throw Error('Asset reference missing: '+ref);const found=new Set();for(const target of targets)target.traverse(o=>{if(visualSet.has(o))found.add(paths.get(o));});if(!found.size)throw Error('Asset reference has no geometry: '+ref);return [...found].sort();}
 let manifest=null,lastIds=[],lastError=null;
 function apply(ids,version){
  if(!Array.isArray(ids)||!manifest||version!==manifest.modelVersion)throw Error('Asset model version mismatch');
  const idsToPaths=new Map(manifest.units.map(unit=>[unit.id,unit.path]));const enabled=new Set();
  for(const id of ids){const path=idsToPaths.get(id);if(!path||!objects.has(path))throw Error('Unknown planet asset');enabled.add(objects.get(path));}
  // Only admitted geometry and its ancestors are visible; a granted parent never reveals siblings.
  for(const [,o] of visuals)o.visible=enabled.has(o);
  for(const [,o]of visuals)if(enabled.has(o)){let parent=o.parent;while(parent&&parent!==planet){parent.visible=true;parent=parent.parent;}}
  // The source terrain itself is an opening entitlement; the bare sphere stays available.
  lastIds=[...ids];lastError=null;
 }
 function setManifest(value){manifest=value;for(const unit of value.units)if(!objects.has(unit.path))throw Error('Frozen asset path missing');}
 function audit(){return {modelVersion:manifest?.modelVersion||null,visibleUnitIds:[...lastIds],actualVisibleUnitIds:manifest?.units.filter(u=>{let o=objects.get(u.path);while(o&&o!==planet){if(!o.visible)return false;o=o.parent;}return o===planet;}).map(u=>u.id)||[],error:lastError,roots:roots.length,visuals:visuals.length};}
 return {resolve,setManifest,apply,audit,describe(){return descriptions;}};
})();
window.HerstoryAssets=assetRegistry;
if(window.HERSTORY_ASSET_MANIFEST)assetRegistry.setManifest(window.HERSTORY_ASSET_MANIFEST);
