import {readFileSync} from 'node:fs';
const map=JSON.parse(readFileSync(new URL('./avatar-style-map.json',import.meta.url),'utf8'));
export const avatarStyleMap=map;
export function fallbackVisual(memberId){return {member_id:memberId,hair_length:'short',hair_rgb:'774723',shirt_rgb:'FFFFFF',fallback:true};}
export function memberVisual(memberId,avatarJson){
 try{
  const avatar=typeof avatarJson==='string'?JSON.parse(avatarJson):avatarJson;
  if(avatar?.release!==map.release||!avatar.selection)return fallbackVisual(memberId);
  const selection=avatar.selection,hair=map.assets[selection.hst_layer_hair];
  const hoodieId=selection.hst_layer_hoodie,shirtId=hoodieId&&hoodieId!=='hst_ast_0052'?hoodieId:selection.hst_layer_body,shirt=map.assets[shirtId];
  if(hair?.layer!=='hst_layer_hair'||!shirt||!['hst_layer_body','hst_layer_hoodie'].includes(shirt.layer))return fallbackVisual(memberId);
  return {member_id:memberId,hair_length:hair.hair_length,hair_rgb:hair.rgb,shirt_rgb:shirt.rgb,fallback:false,release:map.release,hair_asset_id:selection.hst_layer_hair,shirt_asset_id:shirtId};
 }catch{return fallbackVisual(memberId);}
}
export function visualForReceipt(receipt,reporterId){
 if(!receipt||receipt.status!=='connected')return null;
 const selfA=receipt.device_a_id===reporterId,selfB=receipt.device_b_id===reporterId;
 if(!selfA&&!selfB)return null;
 const a=receipt.visual_a,b=receipt.visual_b;if(!a||!b)return null;
 return {version:1,template:'pixel-friend-v1',self:selfA?a:b,peer:selfA?b:a};
}
