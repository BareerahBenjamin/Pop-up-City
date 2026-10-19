#include "friend_protocol.h"
#include "cloud_internal.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
static const char *field(const cJSON *r,const char *key){const cJSON *v=cJSON_GetObjectItemCaseSensitive(r,key);return cJSON_IsString(v)?v->valuestring:NULL;}
static bool hexadecimal(const char *s,unsigned n){if(!s||strlen(s)!=n)return false;for(unsigned i=0;i<n;i++)if(!((s[i]>='a'&&s[i]<='f')||(s[i]>='0'&&s[i]<='9')))return false;return true;}
static int rgb_nibble(char c){if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;if(c>='A'&&c<='F')return c-'A'+10;return -1;}
static bool rgb565(const char *s,uint16_t *out){
 if(!s||strlen(s)!=6)return false;
 unsigned rgb=0;for(unsigned i=0;i<6;i++){int n=rgb_nibble(s[i]);if(n<0)return false;rgb=(rgb<<4)|(unsigned)n;}
 unsigned r=rgb>>16,g=(rgb>>8)&255u,b=rgb&255u;*out=(uint16_t)(((r>>3)<<11)|((g>>2)<<5)|(b>>3));return true;
}
static bool person_visual(const cJSON *o,pc_friend_person *out){
 const char *hair=field(o,"hair_length");const cJSON *fallback=cJSON_GetObjectItemCaseSensitive(o,"fallback");
 if(!hair||!cJSON_IsBool(fallback)||!rgb565(field(o,"hair_rgb"),&out->hair_rgb)||!rgb565(field(o,"shirt_rgb"),&out->shirt_rgb))return false;
 if(!strcmp(hair,"none"))out->hair_length=PC_HAIR_NONE;else if(!strcmp(hair,"short"))out->hair_length=PC_HAIR_SHORT;else if(!strcmp(hair,"medium"))out->hair_length=PC_HAIR_MEDIUM;else if(!strcmp(hair,"long"))out->hair_length=PC_HAIR_LONG;else return false;
 out->fallback=cJSON_IsTrue(fallback);return true;
}
static void visual_decode(pc_cloud *c,const cJSON *r,pc_friend_visual *out){
 pc_friend_visual_default(out);const cJSON *v=cJSON_GetObjectItemCaseSensitive(r,"visual"),*version=cJSON_GetObjectItemCaseSensitive(v,"version"),*self=cJSON_GetObjectItemCaseSensitive(v,"self"),*peer=cJSON_GetObjectItemCaseSensitive(v,"peer");
 const char *template=field(v,"template"),*own=field(self,"member_id"),*other=field(peer,"member_id");
 if(!cJSON_IsNumber(version)||version->valuedouble!=1||!template||strcmp(template,"pixel-friend-v1")||!pc_cloud_uuid(own)||strcmp(own,c->store->data.member_id)||!pc_cloud_uuid(other)||!strcmp(own,other))return;
 pc_friend_visual next={0};if(!person_visual(self,&next.self)||!person_visual(peer,&next.peer))return;
 next.valid=true;*out=next;
}
static pc_cloud_result exchange(pc_cloud *c,bool get,const char *path,cJSON *body,pc_friend_session *out){
 if(!out)return PC_CLOUD_INVALID;
 cJSON *r=NULL;pc_cloud_result result=pc_cloud_call(c,get,path,body,&r);if(result!=PC_CLOUD_OK)return result;
 const char *state=field(r,"state");pc_friend_session next={0};bool valid=state&&strlen(state)<sizeof(next.state);
 bool idle=state&&(!strcmp(state,"idle")||!strcmp(state,"searching"));
 if(valid&&!idle){
  const char *id=field(r,"interaction_id"),*a=field(r,"device_a_id"),*b=field(r,"device_b_id"),*nonce=field(r,"nonce"),*code=field(r,"confirmation_code");
  const cJSON *when=cJSON_GetObjectItemCaseSensitive(r,"occurred_at"),*ac=cJSON_GetObjectItemCaseSensitive(r,"a_confirmed"),*bc=cJSON_GetObjectItemCaseSensitive(r,"b_confirmed"),*near=cJSON_GetObjectItemCaseSensitive(r,"proximity_ready");
  valid=(!strcmp(state,"waiting")||!strcmp(state,"submitting")||!strcmp(state,"failed")||!strcmp(state,"done"))&&pc_cloud_uuid(id)&&pc_cloud_uuid(a)&&pc_cloud_uuid(b)&&strcmp(a,b)&&(!strcmp(a,c->store->data.device_id)||!strcmp(b,c->store->data.device_id))&&hexadecimal(nonce,32)&&code&&strlen(code)==4&&cJSON_IsNumber(when)&&isfinite(when->valuedouble)&&when->valuedouble>0&&when->valuedouble<=9007199254740991.0&&floor(when->valuedouble)==when->valuedouble&&cJSON_IsBool(ac)&&cJSON_IsBool(bc)&&cJSON_IsBool(near);
  if(valid)for(unsigned i=0;i<4;i++)if(code[i]<'0'||code[i]>'9')valid=false;
  if(valid){strcpy(next.interaction_id,id);strcpy(next.device_a,a);strcpy(next.device_b,b);strcpy(next.nonce,nonce);strcpy(next.code,code);next.occurred_at=(uint64_t)when->valuedouble;next.a_confirmed=cJSON_IsTrue(ac);next.b_confirmed=cJSON_IsTrue(bc);next.proximity_ready=cJSON_IsTrue(near);}
  if(valid&&!strcmp(state,"done")){
   const cJSON *receipt=cJSON_GetObjectItemCaseSensitive(r,"receipt");const char *saved=field(receipt,"interaction_id"),*status=field(receipt,"status");
   valid=next.a_confirmed&&next.b_confirmed&&saved&&!strcmp(saved,id)&&status&&!strcmp(status,"connected")&&pc_cloud_uuid(field(receipt,"friendship_id"));
  }
 }
 if(valid){strcpy(next.state,state);visual_decode(c,r,&next.visual);*out=next;}
 cJSON_Delete(r);return valid?PC_CLOUD_OK:PC_CLOUD_INVALID;
}
pc_cloud_result pc_friend_request(pc_cloud *c,pc_friend_session *out){
 cJSON *body=cJSON_CreateObject();if(!body)return PC_CLOUD_TRANSPORT;pc_cloud_result result=exchange(c,false,"/local/friend/request",body,out);cJSON_Delete(body);return result;
}
pc_cloud_result pc_friend_poll(pc_cloud *c,pc_friend_session *out){return exchange(c,true,"/local/friend/session",NULL,out);}
pc_cloud_result pc_friend_observations(pc_cloud *c,const nearby_participants_t *list,uint32_t ms,pc_friend_session *out){
 if(!list)return PC_CLOUD_INVALID;
 cJSON *body=cJSON_CreateObject(),*items=cJSON_CreateArray();if(!body||!items){cJSON_Delete(body);cJSON_Delete(items);return PC_CLOUD_TRANSPORT;}
 cJSON_AddItemToObject(body,"observations",items);
 for(unsigned i=0;i<NEARBY_CAPACITY;i++){
  const nearby_participant_t *p=&list->entries[i];unsigned age=(uint32_t)(ms-p->seen_ms);
  if(!p->occupied||age>=NEARBY_TTL_MS||!p->presence_epoch||!hexadecimal(p->presence_tag,12))continue;
  char id[37];pc_device_uuid(p->device_id,id);if(!strcmp(id,c->store->data.device_id))continue;
  cJSON *item=cJSON_CreateObject();if(!item){cJSON_Delete(body);return PC_CLOUD_TRANSPORT;}
  cJSON_AddStringToObject(item,"peer_device_id",id);cJSON_AddNumberToObject(item,"rssi",p->rssi);cJSON_AddNumberToObject(item,"age_ms",age);cJSON_AddNumberToObject(item,"presence_epoch",p->presence_epoch);cJSON_AddStringToObject(item,"presence_tag",p->presence_tag);cJSON_AddItemToArray(items,item);
 }
 pc_cloud_result result=exchange(c,false,"/local/friend/nearby",body,out);cJSON_Delete(body);return result;
}
static bool same_intent(const pc_pending_operation *op,const pc_friend_session *s,const char *peer){
 return op->kind==PC_PENDING_FRIEND&&!strcmp(op->operation_id,s->interaction_id)&&!strcmp(op->peer_device_id,peer)&&op->occurred_at==s->occurred_at&&!strcmp(op->detail.pairing.nonce,s->nonce)&&!strcmp(op->detail.pairing.code,s->code);
}
pc_cloud_result pc_friend_confirm(pc_cloud *c,const pc_friend_session *s,pc_friend_session *out){
 if(!s||!out||!c->sign||!c->state->online||!c->state->bound||!s->proximity_ready||!pc_cloud_uuid(s->interaction_id)||!pc_cloud_uuid(s->device_a)||!pc_cloud_uuid(s->device_b)||!strcmp(s->device_a,s->device_b)||!hexadecimal(s->nonce,32)||strlen(s->code)!=4||!s->occurred_at||s->occurred_at>9007199254740991ULL||(strcmp(s->state,"waiting")&&strcmp(s->state,"failed")))return PC_CLOUD_INVALID;
 for(unsigned i=0;i<4;i++)if(s->code[i]<'0'||s->code[i]>'9')return PC_CLOUD_INVALID;
 bool side_a=!strcmp(c->store->data.device_id,s->device_a);if(!side_a&&strcmp(c->store->data.device_id,s->device_b))return PC_CLOUD_INVALID;
 const char *peer=side_a?s->device_b:s->device_a;unsigned slot=PC_PENDING_OPERATIONS;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(c->store->data.pending[i].kind){if(!same_intent(&c->store->data.pending[i],s,peer))return PC_CLOUD_BUSY;slot=i;}
 if(slot==PC_PENDING_OPERATIONS){
  pc_pending_operation op={.kind=PC_PENDING_FRIEND,.occurred_at=s->occurred_at};strcpy(op.operation_id,s->interaction_id);strcpy(op.peer_device_id,peer);strcpy(op.detail.pairing.nonce,s->nonce);strcpy(op.detail.pairing.code,s->code);
  if(pc_store_pending_begin(c->store,0,&op)!=ESP_OK)return PC_CLOUD_STORAGE;
 }
 c->state->unresolved=true;
 cJSON *a=cJSON_CreateArray(),*body=cJSON_CreateObject();if(!a||!body){cJSON_Delete(a);cJSON_Delete(body);return PC_CLOUD_TRANSPORT;}
 cJSON_AddItemToArray(a,cJSON_CreateString("herstory-hardware-v1"));cJSON_AddItemToArray(a,cJSON_CreateString("friend"));cJSON_AddItemToArray(a,cJSON_CreateString(s->interaction_id));cJSON_AddItemToArray(a,cJSON_CreateString(s->device_a));cJSON_AddItemToArray(a,cJSON_CreateString(s->device_b));cJSON_AddItemToArray(a,cJSON_CreateString(s->nonce));cJSON_AddItemToArray(a,cJSON_CreateString(s->code));cJSON_AddItemToArray(a,cJSON_CreateNumber((double)s->occurred_at));cJSON_AddItemToArray(a,cJSON_CreateBool(true));cJSON_AddItemToArray(a,cJSON_CreateBool(true));
 char *canonical=cJSON_PrintUnformatted(a),proof[65];cJSON_Delete(a);bool signed_ok=canonical&&c->sign(c->sign_context,canonical,proof);cJSON_free(canonical);if(!signed_ok){cJSON_Delete(body);return PC_CLOUD_INVALID;}
 cJSON_AddStringToObject(body,"interaction_id",s->interaction_id);cJSON_AddStringToObject(body,"user_proof",proof);
 pc_friend_session response={0};pc_cloud_result result=exchange(c,false,"/local/friend/confirm",body,&response);cJSON_Delete(body);
 if(result==PC_CLOUD_OK){
  if(strcmp(response.interaction_id,s->interaction_id)||strcmp(response.device_a,s->device_a)||strcmp(response.device_b,s->device_b)||strcmp(response.nonce,s->nonce)||strcmp(response.code,s->code)||response.occurred_at!=s->occurred_at)return PC_CLOUD_INVALID;
  *out=response;
 }
 return result;
}
pc_cloud_result pc_friend_cancel(pc_cloud *c,const pc_friend_session *s,pc_friend_session *out){
 if(!s||!out||(!pc_cloud_uuid(s->interaction_id)&&s->interaction_id[0]))return PC_CLOUD_INVALID;
 const pc_pending_operation *pending=NULL;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(c->store->data.pending[i].kind){
  if(c->store->data.pending[i].kind!=PC_PENDING_FRIEND||strcmp(c->store->data.pending[i].operation_id,s->interaction_id))return PC_CLOUD_BUSY;
  pending=&c->store->data.pending[i];
 }
 cJSON *body=cJSON_CreateObject();if(!body)return PC_CLOUD_TRANSPORT;
 if(s->interaction_id[0])cJSON_AddStringToObject(body,"interaction_id",s->interaction_id);
 if(pending){
  cJSON *a=cJSON_CreateArray();if(!a){cJSON_Delete(body);return PC_CLOUD_TRANSPORT;}
  cJSON_AddItemToArray(a,cJSON_CreateString("herstory-friend-retire-v1"));cJSON_AddItemToArray(a,cJSON_CreateString(pending->operation_id));cJSON_AddItemToArray(a,cJSON_CreateString(c->store->data.device_id));cJSON_AddItemToArray(a,cJSON_CreateString(pending->peer_device_id));cJSON_AddItemToArray(a,cJSON_CreateString(pending->detail.pairing.nonce));cJSON_AddItemToArray(a,cJSON_CreateString(pending->detail.pairing.code));cJSON_AddItemToArray(a,cJSON_CreateNumber((double)pending->occurred_at));
  char *canonical=cJSON_PrintUnformatted(a),proof[65];cJSON_Delete(a);bool valid=c->sign&&canonical&&c->sign(c->sign_context,canonical,proof);cJSON_free(canonical);
  if(!valid){cJSON_Delete(body);return PC_CLOUD_INVALID;}
  cJSON_AddStringToObject(body,"peer_device_id",pending->peer_device_id);cJSON_AddStringToObject(body,"nonce",pending->detail.pairing.nonce);cJSON_AddStringToObject(body,"confirmation_code",pending->detail.pairing.code);cJSON_AddNumberToObject(body,"occurred_at",(double)pending->occurred_at);cJSON_AddStringToObject(body,"user_proof",proof);
  cJSON *response=NULL;pc_cloud_result result=pc_cloud_call(c,false,"/local/friend/retire",body,&response);cJSON_Delete(body);cJSON_Delete(response);
  /* Never clear on POST alone: independently validate the durable lookup. */
  if(result!=PC_CLOUD_OK)return result;
  bool saved=false;result=pc_friend_recover(c,0,&saved,out);if(result==PC_CLOUD_OK&&!saved){memset(out,0,sizeof(*out));strcpy(out->state,"idle");}return result;
 }
 pc_cloud_result result=exchange(c,false,"/local/friend/cancel",body,out);cJSON_Delete(body);return result;
}
pc_cloud_result pc_friend_recover(pc_cloud *c,uint32_t ms,bool *saved,pc_friend_session *restored){
 if(!saved)return PC_CLOUD_INVALID;
 *saved=false;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(c->store->data.pending[i].kind==PC_PENDING_FRIEND){
  cJSON *r=NULL;pc_cloud_result result=pc_cloud_operation_query(c,i,&r);if(result!=PC_CLOUD_OK)return result;
  bool found=field(r,"state")&&!strcmp(field(r,"state"),"saved");bool cancelled=field(r,"state")&&!strcmp(field(r,"state"),"cancelled");
  pc_friend_session recovered={0};if(found){
   const pc_pending_operation *op=&c->store->data.pending[i];strcpy(recovered.state,"done");strcpy(recovered.interaction_id,op->operation_id);strcpy(recovered.nonce,op->detail.pairing.nonce);strcpy(recovered.code,op->detail.pairing.code);recovered.occurred_at=op->occurred_at;recovered.a_confirmed=recovered.b_confirmed=true;
   bool own_first=strcmp(c->store->data.device_id,op->peer_device_id)<0;strcpy(recovered.device_a,own_first?c->store->data.device_id:op->peer_device_id);strcpy(recovered.device_b,own_first?op->peer_device_id:c->store->data.device_id);visual_decode(c,r,&recovered.visual);
  }cJSON_Delete(r);
  if(!found&&!cancelled)return PC_CLOUD_BUSY;
  if(pc_store_pending_clear(c->store,i,c->store->data.pending[i].operation_id)!=ESP_OK)return PC_CLOUD_STORAGE;
  for(unsigned j=0;j<PC_PENDING_OPERATIONS;j++)if(c->store->data.pending[j].kind)return PC_CLOUD_BUSY;
  if(found){if(restored)*restored=recovered;pc_friend_saved(c->state,ms);*saved=true;}else pc_resolved(c->state,c->state->host_active?PC_HOST:PC_PLANET,ms);return PC_CLOUD_OK;
 }
 return PC_CLOUD_BUSY;
}

pc_cloud_result pc_friend_visual_refresh(pc_cloud *c,pc_friend_session *session){
 if(!session||!pc_cloud_uuid(session->interaction_id)||strcmp(session->state,"done"))return PC_CLOUD_INVALID;
 char path[128];snprintf(path,sizeof(path),"/api/device/operations/%s",session->interaction_id);cJSON *r=NULL;pc_cloud_result result=pc_cloud_call(c,true,path,NULL,&r);if(result!=PC_CLOUD_OK)return result;
 const char *id=field(r,"interaction_id"),*state=field(r,"state"),*type=field(r,"operation_type");const cJSON *receipt=cJSON_GetObjectItemCaseSensitive(r,"receipt");const char *saved=field(receipt,"interaction_id"),*status=field(receipt,"status");
 bool valid=id&&!strcmp(id,session->interaction_id)&&state&&!strcmp(state,"saved")&&type&&!strcmp(type,"friend")&&saved&&!strcmp(saved,id)&&status&&!strcmp(status,"connected")&&pc_cloud_uuid(field(receipt,"friendship_id"));
 pc_friend_visual visual;if(valid){visual_decode(c,r,&visual);valid=visual.valid;if(valid)session->visual=visual;}cJSON_Delete(r);return valid?PC_CLOUD_OK:PC_CLOUD_INVALID;
}
