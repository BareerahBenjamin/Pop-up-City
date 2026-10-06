import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root));
const audit=JSON.parse(readFileSync(process.argv[2]||'/private/tmp/planet-asset-audit.json'));
const sha=v=>createHash('sha256').update(v).digest('hex');
if(Object.values(audit.refs).some(r=>!Array.isArray(r)))throw Error('Unresolved model reference');
const worldSha=sha(read('vendor/planet/frontend/ui-design/world/planet-world.js'));
const units=audit.units.map(u=>({...u,id:'unit_'+sha(u.path).slice(0,24)}));
if(new Set(units.map(u=>u.id)).size!==units.length)throw Error('Unit collision');
const byPath=new Map(units.map(u=>[u.path,u]));
const refUnits=Object.fromEntries(Object.entries(audit.refs).map(([ref,paths])=>[ref,paths.map(path=>{const u=byPath.get(path);if(!u?.attached)throw Error('Detached grant asset');return u.id;})]));
const protectedIds=new Set(Object.values(refUnits).flat());
const free=units.filter(u=>u.attached&&u.initiallyVisible&&!protectedIds.has(u.id));
// Preserve source subgroups, distribute their geometry evenly within each named scene.
const groups=new Map();for(const u of free){const scene=u.scene.startsWith('root_')?'other':u.scene;const key=scene+':'+u.path.split('/').slice(0,2).join('/');if(!groups.has(key))groups.set(key,{scene,units:[]});groups.get(key).units.push(u.id);}
const counts=new Map(),marketRounds=[[],[]];
for(const [key,g] of [...groups].sort(([a],[b])=>a.localeCompare(b))){const n=counts.get(g.scene)||[0,0],round=n[0]<=n[1]?0:1;marketRounds[round].push(...g.units);n[round]+=g.units.length;counts.set(g.scene,n);}
const manifest={schemaVersion:1,modelVersion:'herstory-model-'+worldSha.slice(0,20),worldSha256:worldSha,registrySha256:sha(read('vendor/planet/frontend/ui-design/asset-registry.js')),units,refUnits,marketRounds:marketRounds.map(r=>r.sort()),excludedHelpers:units.filter(u=>!u.initiallyVisible&&!protectedIds.has(u.id)).map(u=>u.id),marketSceneCounts:Object.fromEntries(counts)};
writeFileSync(new URL('config/planet_asset_manifest_v1.json',root),JSON.stringify(manifest,null,2)+'\n');
console.log({modelVersion:manifest.modelVersion,units:units.length,market:marketRounds.map(r=>r.length),scenes:manifest.marketSceneCounts});
