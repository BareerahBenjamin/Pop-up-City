(()=>{
'use strict';
const initial=window.HERSTORY_INITIAL_STATE||{},config=window.HERSTORY_CONFIG||{},schemes=['green','pink','blue','apricot'];
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
let localId=read('herstory:local-user:v1');if(typeof localId!=='string'){localId='local-'+crypto.randomUUID();write('herstory:local-user:v1',localId);}
const localDemo=!initial.userId&&!config.userId&&!config.endpoint;
const userId=String(initial.userId||config.userId||localId),key='herstory:planet:v1:'+encodeURIComponent(userId);
let profile=localDemo?read(key):null;if(!profile||profile.userId!==userId)profile={userId,planetId:null,paletteId:null,activated:false};
function activate(data={}){if(data.userId&&String(data.userId)!==userId)throw Error('User changed: initialize a new authenticated page');if(profile.activated){if(schemes.includes(data.paletteId)&&data.planetId){if(String(data.planetId)!==profile.planetId||data.paletteId!==profile.paletteId)throw Error('Persisted planet assignment changed for this account');}window.stellarScene?.setPalette(profile.paletteId);return {...profile};}if(!localDemo&&(!schemes.includes(data.paletteId)||!data.planetId))throw Error('Server planet and palette assignment required');const old=read('herstory:sharing:v1:'+userId)||(!initial.userId&&!config.userId?read('herstory:sharing:v1:local-demo'):null);profile={userId,planetId:String(data.planetId||'planet-'+crypto.randomUUID()),paletteId:schemes.includes(data.paletteId)?data.paletteId:schemes.includes(old?.palette)?old.palette:schemes[crypto.getRandomValues(new Uint32Array(1))[0]%4],activated:true};write(key,profile);window.stellarScene?.setPalette(profile.paletteId);return {...profile};}
// An authenticated server assignment is canonical at bootstrap, including on a new device.
if(schemes.includes(initial.paletteId)&&initial.planetId){profile={userId,planetId:String(initial.planetId),paletteId:initial.paletteId,activated:true};write(key,profile);}
else if(localDemo)activate(initial);
if(profile.paletteId)window.stellarScene?.setPalette(profile.paletteId);
window.HerstoryIdentity={activate,getProfile(){return {...profile};},assertUser(data){if(data.userId!==userId||data.planetId!==profile.planetId||data.paletteId!==profile.paletteId)throw Error('Snapshot identity mismatch');if(data.report_data&&data.report_data.user_id!==userId)throw Error('Report identity mismatch');}};
})();
