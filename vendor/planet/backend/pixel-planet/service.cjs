'use strict';
const {randomInt}=require('node:crypto'),defaultRules=require('./rules.json');
const PALETTES=['green','pink','blue','apricot'];
function derivePixelProgress({userId,campaignId,activities,checkins,rules=defaultRules,now=Date.now()}){
 if(campaignId!==rules.campaignId)throw Error('Unsupported campaign');
 const catalog=new Map(activities.map(a=>[a.activity_id,a])),ai=new Set(rules.aiActivityIds),latest=new Map(),issues=[];
 const aiSessions=new Set(activities.filter(a=>ai.has(a.activity_id)&&a.canonical_session_id).map(a=>a.canonical_session_id));
 for(const f of checkins){
  if(f.user_id!==userId||f.campaign_id!==campaignId||f.fact_type&&f.fact_type!=='checkin')continue;
  const activity=catalog.get(f.activity_id),session=activity?.canonical_session_id||f.canonical_session_id;
  if(!session||typeof session!=='string'||!session.trim()){issues.push('missing-canonical-session');continue;}
  if(activity?.canonical_session_id&&f.canonical_session_id&&activity.canonical_session_id!==f.canonical_session_id){issues.push('conflicting-canonical-session');continue;}
  const revision=f.revision,verified=Date.parse(f.updated_at||f.verified_at);
  if(!Number.isSafeInteger(revision)||revision<0||!Number.isFinite(verified)||verified>now){issues.push('invalid-revision-or-verification');continue;}
  const previous=latest.get(session);
  if(!previous||revision>previous.revision||revision===previous.revision&&(verified>previous.verified||verified===previous.verified&&f.status!=='valid'))latest.set(session,{fact:f,activity,revision,verified});
 }
 let aiCheckinCount=0,lakeUnlocked=false;
 for(const [session,{fact:f,activity:a}]of latest){
  if(f.status!=='valid'||!a||a.enabled===false||['cancelled','invalid'].includes(a.status)||a.kind==='milestone')continue;
  const occurred=Date.parse(f.checked_in_at||f.occurred_at);
  if(!Number.isFinite(occurred)||occurred>now){issues.push('invalid-occurrence');continue;}
  if(ai.has(a.activity_id)||aiSessions.has(session))aiCheckinCount++;
  if(a.category===rules.entertainmentCategory)lakeUnlocked=true;
 }
 return {aiCheckinCount,aiStage:Math.min(aiCheckinCount,rules.stageLimit),lakeUnlocked,ruleVersion:rules.ruleVersion,issues:[...new Set(issues)]};
}
function createPixelPlanetService({repository,rules=defaultRules,pickPalette=()=>PALETTES[randomInt(PALETTES.length)],clock=Date.now}){
 if(!repository?.transaction)throw TypeError('Transactional repository required');
 async function read({auth,campaignId=rules.campaignId}){
  if(!auth?.userId||auth.verified!==true)throw Error('Authenticated server principal required');
  if(campaignId!==rules.campaignId)throw Error('Unsupported campaign');
  return repository.transaction(async tx=>{
   // Adapter must lock shared identity and enforce unique (user,campaign) before returning it.
   const user=await tx.getUserForUpdate(auth.userId,campaignId);
   if(!user||user.userId!==auth.userId||!user.planetId)throw Error('Stable existing user/planet identity required');
   let paletteId=user.paletteId;
   if(paletteId!=null&&!PALETTES.includes(paletteId))throw Error('Invalid persisted palette');
   if(!paletteId){paletteId=pickPalette();if(!PALETTES.includes(paletteId))throw Error('Invalid palette allocator');await tx.saveUser({...user,paletteId});}
   const activities=await tx.listActivities(campaignId),checkins=await tx.listCheckinRevisions(auth.userId,campaignId);
   const {issues,...progress}=derivePixelProgress({userId:auth.userId,campaignId,activities,checkins,rules,now:clock()});
   const next={paletteId,...progress},previous=await tx.getPixelState(auth.userId,campaignId);
   const changed=!previous||Object.keys(next).some(k=>next[k]!==previous[k]);
   const pixelPlanet={...next,stateVersion:changed?(previous?.stateVersion||0)+1:previous.stateVersion};
   if(!Number.isSafeInteger(pixelPlanet.stateVersion))throw Error('State version overflow');
   if(changed)await tx.savePixelState(auth.userId,campaignId,pixelPlanet);
   const revision=changed?await tx.bumpPlanetRevision(auth.userId,campaignId):await tx.getPlanetRevision(auth.userId,campaignId);
   if(!Number.isSafeInteger(revision)||revision<0)throw Error('Existing planet aggregate revision required');
   return {userId:auth.userId,planetId:user.planetId,paletteId,revision,pixelPlanet,diagnostics:issues};
  });
 }
 async function extendSnapshot({auth,campaignId,loadSnapshot}){
  if(typeof loadSnapshot!=='function')throw TypeError('Server snapshot loader required');
  const value=await read({auth,campaignId});
  const snapshot=await loadSnapshot({userId:value.userId,planetId:value.planetId,campaignId:campaignId||rules.campaignId});
  if(snapshot.userId!==value.userId||snapshot.planetId!==value.planetId||snapshot.paletteId!==value.paletteId)throw Error('Snapshot identity mismatch');
  if(snapshot.revision!==value.revision){const error=Error('Planet changed during read; retry coherent snapshot');error.code='RETRY_SNAPSHOT';throw error;}
  return {...snapshot,pixelPlanet:value.pixelPlanet};
 }
 return {read,extendSnapshot};
}
module.exports={PALETTES,derivePixelProgress,createPixelPlanetService};
