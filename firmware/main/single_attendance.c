#include "single_attendance.h"
#include "cloud_internal.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
static const char *field(const cJSON *r,const char *key){const cJSON *v=cJSON_GetObjectItemCaseSensitive(r,key);return cJSON_IsString(v)?v->valuestring:NULL;}
static bool receipt(const cJSON *r,const pc_pending_operation *op){
 const char *id=field(r,"interaction_id"),*event=field(r,"activity_id"),*status=field(r,"status");
 return id&&!strcmp(id,op->operation_id)&&event&&!strcmp(event,op->activity_id)&&status&&!strcmp(status,"checked_in")&&pc_cloud_uuid(field(r,"user_id"))&&cJSON_IsBool(cJSON_GetObjectItemCaseSensitive(r,"duplicate"));
}
void pc_single_init(pc_single_controller *s,pc_cloud *c){
 memset(s,0,sizeof(*s));s->cloud=c;s->slot=PC_PENDING_OPERATIONS;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(c->store->data.pending[i].kind==PC_PENDING_SINGLE){s->slot=i;s->loaded=true;break;}
}
static pc_cloud_result finish(pc_single_controller *s,uint32_t ms){
 pc_cloud *c=s->cloud;const char *id=c->store->data.pending[s->slot].operation_id;
 char peer[37],activity[37];memcpy(peer,c->store->data.pending[s->slot].peer_device_id,37);memcpy(activity,c->store->data.pending[s->slot].activity_id,37);
 if(pc_store_pending_clear(c->store,s->slot,id)!=ESP_OK)return PC_CLOUD_STORAGE;
 memcpy(s->completed_peer,peer,37);memcpy(s->completed_activity,activity,37);
 s->loaded=false;
 bool remaining=false;for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)remaining|=c->store->data.pending[i].kind!=0;
 if(remaining){c->state->unresolved=true;c->state->page=PC_RECONCILE;}else pc_resolved(c->state,PC_SINGLE_SUCCESS,ms);
 return PC_CLOUD_OK;
}
static pc_cloud_result submit(pc_single_controller *s,uint32_t ms){
 pc_cloud *c=s->cloud;const pc_pending_operation *op=&c->store->data.pending[s->slot];
 if(!op->peer_device_id[0]||!op->occurred_at)return PC_CLOUD_INVALID;
 cJSON *a=cJSON_CreateArray(),*body=cJSON_CreateObject(),*r=NULL;
 if(!a||!body){cJSON_Delete(a);cJSON_Delete(body);return PC_CLOUD_TRANSPORT;}
 cJSON_AddItemToArray(a,cJSON_CreateString("herstory-host-checkin-v1"));cJSON_AddItemToArray(a,cJSON_CreateString(op->operation_id));cJSON_AddItemToArray(a,cJSON_CreateString(c->store->data.device_id));cJSON_AddItemToArray(a,cJSON_CreateString(op->peer_device_id));cJSON_AddItemToArray(a,cJSON_CreateString(op->activity_id));cJSON_AddItemToArray(a,cJSON_CreateNumber(op->detail.single.epoch));cJSON_AddItemToArray(a,cJSON_CreateString(op->detail.single.tag));cJSON_AddItemToArray(a,cJSON_CreateNumber((double)op->occurred_at));cJSON_AddItemToArray(a,cJSON_CreateBool(true));
 char *canonical=cJSON_PrintUnformatted(a),signature[65];cJSON_Delete(a);bool signed_ok=canonical&&c->sign&&c->sign(c->sign_context,canonical,signature);free(canonical);if(!signed_ok){cJSON_Delete(body);return PC_CLOUD_INVALID;}
 cJSON_AddStringToObject(body,"interaction_id",op->operation_id);cJSON_AddStringToObject(body,"host_device_id",c->store->data.device_id);cJSON_AddStringToObject(body,"user_device_id",op->peer_device_id);cJSON_AddStringToObject(body,"activity_id",op->activity_id);cJSON_AddNumberToObject(body,"presence_epoch",op->detail.single.epoch);cJSON_AddStringToObject(body,"presence_tag",op->detail.single.tag);cJSON_AddNumberToObject(body,"occurred_at",(double)op->occurred_at);cJSON_AddBoolToObject(body,"host_confirmed",true);cJSON_AddStringToObject(body,"host_proof",signature);
 pc_operation_started(c->state,PC_SINGLE_SAVING);pc_cloud_result result=pc_cloud_call(c,false,"/local/host/submit",body,&r);cJSON_Delete(body);
 if(result==PC_CLOUD_OK){if(!receipt(r,op))result=PC_CLOUD_INVALID;else result=finish(s,ms);}cJSON_Delete(r);
 if(result!=PC_CLOUD_OK){c->state->unresolved=true;c->state->page=PC_RECONCILE;}
 return result;
}
static pc_cloud_result retire(pc_single_controller *s,uint32_t ms){
 pc_cloud *c=s->cloud;const pc_pending_operation *op=&c->store->data.pending[s->slot];
 cJSON *a=cJSON_CreateArray(),*body=cJSON_CreateObject(),*r=NULL;if(!a||!body){cJSON_Delete(a);cJSON_Delete(body);return PC_CLOUD_TRANSPORT;}
 cJSON_AddItemToArray(a,cJSON_CreateString("herstory-host-cancel-v1"));cJSON_AddItemToArray(a,cJSON_CreateString(op->operation_id));cJSON_AddItemToArray(a,cJSON_CreateString(c->store->data.device_id));cJSON_AddItemToArray(a,cJSON_CreateString(op->peer_device_id));cJSON_AddItemToArray(a,cJSON_CreateString(op->activity_id));
 char *canonical=cJSON_PrintUnformatted(a),proof[65];cJSON_Delete(a);bool ok=canonical&&c->sign&&c->sign(c->sign_context,canonical,proof);free(canonical);if(!ok){cJSON_Delete(body);return PC_CLOUD_INVALID;}
 cJSON_AddStringToObject(body,"interaction_id",op->operation_id);cJSON_AddStringToObject(body,"activity_id",op->activity_id);cJSON_AddStringToObject(body,"user_device_id",op->peer_device_id);cJSON_AddStringToObject(body,"host_proof",proof);
 pc_cloud_result result=pc_cloud_call(c,false,"/local/host/cancel",body,&r);cJSON_Delete(body);
 if(result==PC_CLOUD_OK){const char *state=field(r,"state"),*id=field(r,"interaction_id"),*activity=field(r,"activity_id");const cJSON *saved=cJSON_GetObjectItemCaseSensitive(r,"receipt");
  if(!id||strcmp(id,op->operation_id)||!activity||strcmp(activity,op->activity_id)||!state)result=PC_CLOUD_INVALID;
  else if(!strcmp(state,"saved")&&receipt(saved,op))result=finish(s,ms);
  else if(!strcmp(state,"cancelled")&&field(saved,"status")&&!strcmp(field(saved,"status"),"cancelled")&&field(saved,"interaction_id")&&!strcmp(field(saved,"interaction_id"),op->operation_id)){
   if(pc_store_pending_clear(c->store,s->slot,op->operation_id)!=ESP_OK)result=PC_CLOUD_STORAGE;
   else {s->loaded=false;pc_resolved(c->state,c->state->host_active?PC_HOST:PC_PLANET,ms);}
  }else result=PC_CLOUD_INVALID;
 }
 cJSON_Delete(r);return result;
}
static bool fresh_peer(pc_cloud *c,const nearby_participant_t *peer,uint32_t ms){
 if(!peer||!c->clock_known||!peer->presence_epoch||(uint32_t)(ms-peer->seen_ms)>=NEARBY_TTL_MS||(uint32_t)(ms-c->server_ms)>=15000)return false;
 if(peer->presence_tag[12])return false;
 for(unsigned i=0;i<12;i++)if(!((peer->presence_tag[i]>='a'&&peer->presence_tag[i]<='f')||(peer->presence_tag[i]>='0'&&peer->presence_tag[i]<='9')))return false;
 return true;
}
pc_cloud_result pc_single_begin(pc_single_controller *s,const char *id,const char *activity,const nearby_participant_t *peer,uint32_t ms){
 pc_cloud *c=s->cloud;if(s->loaded||c->state->unresolved||!c->state->online||!c->state->host_active||!pc_cloud_uuid(id)||!pc_cloud_uuid(activity)||strcmp(activity,c->active_activity_id)||!fresh_peer(c,peer,ms))return PC_CLOUD_BUSY;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(c->store->data.pending[i].kind)return PC_CLOUD_BUSY;
 pc_pending_operation op={.kind=PC_PENDING_SINGLE};strcpy(op.operation_id,id);strcpy(op.activity_id,activity);pc_device_uuid(peer->device_id,op.peer_device_id);
 if(!strcmp(op.peer_device_id,c->store->data.device_id))return PC_CLOUD_INVALID;
 op.occurred_at=c->server_time+(uint32_t)(ms-c->server_ms)/1000;op.detail.single.epoch=peer->presence_epoch;memcpy(op.detail.single.tag,peer->presence_tag,13);
 if(pc_store_pending_begin(c->store,0,&op)!=ESP_OK)return PC_CLOUD_STORAGE;
 s->slot=0;s->loaded=true;return submit(s,ms);
}
pc_cloud_result pc_single_recover(pc_single_controller *s,const nearby_participant_t *peer,uint32_t ms){
 pc_cloud *c=s->cloud;if(!s->loaded||!c->state->online||!c->state->bound)return PC_CLOUD_BUSY;
 cJSON *r=NULL;pc_cloud_result result=pc_cloud_operation_query(c,s->slot,&r);if(result!=PC_CLOUD_OK){cJSON_Delete(r);return result;}
 bool cancelled=!strcmp(field(r,"state"),"cancelled");bool saved=!strcmp(field(r,"state"),"saved");bool valid_saved=!saved||receipt(cJSON_GetObjectItemCaseSensitive(r,"receipt"),&c->store->data.pending[s->slot]);cJSON_Delete(r);if(!valid_saved)return PC_CLOUD_INVALID;if(saved)return finish(s,ms);if(cancelled)return retire(s,ms);
 const pc_pending_operation *original=&c->store->data.pending[s->slot];
 if(c->known_activity_closed&&!strcmp(c->known_activity_id,original->activity_id)){
  return retire(s,ms);
 }
 /* Authoritative unknown means not saved, but retry still requires user OK.
  * Keep the durable ID until success/cancellation, never automatically resubmit. */
 c->state->unresolved=false;c->state->page=PC_SINGLE_FAILED;
 (void)peer;return PC_CLOUD_OK;
}
pc_cloud_result pc_single_retry(pc_single_controller *s,const nearby_participant_t *peer,uint32_t ms){
 pc_cloud *c=s->cloud;if(!s->loaded||c->state->unresolved||!c->state->online||!c->state->bound)return PC_CLOUD_BUSY;
 const pc_pending_operation *original=&c->store->data.pending[s->slot];
 if(!c->state->host_active||strcmp(c->active_activity_id,original->activity_id)||!fresh_peer(c,peer,ms))return PC_CLOUD_BUSY;
 char id[37];pc_device_uuid(peer->device_id,id);if(strcmp(id,original->peer_device_id))return PC_CLOUD_BUSY;
 pc_personal_data next=c->store->data;pc_pending_operation *op=&next.pending[s->slot];op->detail.single.epoch=peer->presence_epoch;memcpy(op->detail.single.tag,peer->presence_tag,13);op->occurred_at=c->server_time+(uint32_t)(ms-c->server_ms)/1000;
 if(pc_store_commit(c->store,&next)!=ESP_OK)return PC_CLOUD_STORAGE;
 return submit(s,ms);
}

pc_cloud_result pc_single_abandon(pc_single_controller *s,uint32_t ms){
 if(!s||!s->loaded||s->cloud->state->unresolved||!s->cloud->state->online||!s->cloud->state->bound)return PC_CLOUD_BUSY;
 return retire(s,ms);
}
