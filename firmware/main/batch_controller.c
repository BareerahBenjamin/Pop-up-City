#include "batch_controller.h"
#include <string.h>
static const char *field(const cJSON *r,const char *key){const cJSON *v=cJSON_GetObjectItemCaseSensitive(r,key);return cJSON_IsString(v)?v->valuestring:NULL;}
void pc_batch_init(pc_batch_controller *b,pc_cloud *cloud){
 memset(b,0,sizeof(*b));b->cloud=cloud;b->slot=PC_PENDING_OPERATIONS;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(cloud->store->data.pending[i].kind==PC_PENDING_BATCH){
  b->slot=i;b->loaded=true;b->phase=PC_BATCH_CHECKING;memcpy(b->operation_id,cloud->store->data.pending[i].operation_id,37);memcpy(b->activity_id,cloud->store->data.pending[i].activity_id,37);break;
 }
}
static pc_cloud_result apply(pc_batch_controller *b,cJSON *r,uint32_t ms){
 const char *status=field(r,"state");pc_batch_phase phase;
 if(!strcmp(status,"queued")||!strcmp(status,"running"))phase=PC_BATCH_WORKING;
 else if(!strcmp(status,"completed"))phase=PC_BATCH_ALL_OK;
 else if(!strcmp(status,"partial"))phase=PC_BATCH_SOME_FAILED;
 else if(!strcmp(status,"failed"))phase=PC_BATCH_ALL_FAILED;
 else phase=PC_BATCH_STOPPED;
 uint32_t total=(uint32_t)cJSON_GetObjectItemCaseSensitive(r,"total")->valuedouble;
 uint32_t signed_count=(uint32_t)cJSON_GetObjectItemCaseSensitive(r,"signed")->valuedouble;
 uint32_t failed=(uint32_t)cJSON_GetObjectItemCaseSensitive(r,"failed")->valuedouble;
 uint32_t pending=(uint32_t)cJSON_GetObjectItemCaseSensitive(r,"pending")->valuedouble;
 bool changed=!b->known||b->phase!=phase||b->cloud->state->unresolved||b->cloud->state->page==PC_RECONCILE;
 b->known=true;b->phase=phase;b->total=total;b->signed_count=signed_count;b->failed=failed;b->pending=pending;b->sequence++;
 if(phase==PC_BATCH_WORKING){pc_operation_started(b->cloud->state,PC_BATCH_RUNNING);return PC_CLOUD_OK;}
 /* Keep the verified terminal operation durable until explicit dismissal/retry. */
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(i!=b->slot&&b->cloud->store->data.pending[i].kind){b->cloud->state->unresolved=true;b->cloud->state->page=PC_RECONCILE;return PC_CLOUD_OK;}
 if(changed){
  pc_page page=phase==PC_BATCH_ALL_OK?PC_BATCH_SUCCESS:phase==PC_BATCH_SOME_FAILED?PC_BATCH_PARTIAL:phase==PC_BATCH_ALL_FAILED?PC_BATCH_FAILED:PC_PLANET;
  pc_resolved(b->cloud->state,page,ms);
 }
 return PC_CLOUD_OK;
}
pc_cloud_result pc_batch_start(pc_batch_controller *b,const char *id,const char *activity,uint32_t ms){
 pc_cloud *c=b->cloud;
 if(b->loaded||!c->state->online||!c->state->bound||!c->state->host_active||c->state->unresolved||!pc_cloud_uuid(id)||!pc_cloud_uuid(activity)||strcmp(c->active_activity_id,activity))return PC_CLOUD_BUSY;
 unsigned slot=PC_PENDING_OPERATIONS;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++){if(c->store->data.pending[i].kind)return PC_CLOUD_BUSY;if(slot==PC_PENDING_OPERATIONS)slot=i;}
 cJSON *r=NULL;pc_cloud_result result=pc_cloud_batch_start(c,slot,id,activity,&r);
 if(c->store->data.pending[slot].kind==PC_PENDING_BATCH){b->slot=slot;b->loaded=true;b->known=false;b->phase=PC_BATCH_CHECKING;memcpy(b->operation_id,id,37);memcpy(b->activity_id,activity,37);}
 if(result==PC_CLOUD_OK){result=apply(b,r,ms);}
 cJSON_Delete(r);return result;
}
pc_cloud_result pc_batch_poll(pc_batch_controller *b,uint32_t ms){
 if(!b->loaded||!b->cloud->state->online||!b->cloud->state->bound)return PC_CLOUD_BUSY;
 cJSON *r=NULL;pc_cloud_result result=pc_cloud_batch_query(b->cloud,b->slot,&r);
 if(result==PC_CLOUD_OK)result=apply(b,r,ms);
 else if(!b->known||b->phase==PC_BATCH_WORKING){b->known=false;b->phase=PC_BATCH_CHECKING;b->cloud->state->unresolved=true;if(b->cloud->state->online)b->cloud->state->page=PC_RECONCILE;}
 cJSON_Delete(r);return result;
}
pc_cloud_result pc_batch_retry(pc_batch_controller *b,const char *new_request,uint32_t ms){
 if(!b->loaded||!b->known||!b->cloud->state->online||!b->cloud->state->host_active||strcmp(b->cloud->active_activity_id,b->activity_id)||(b->phase!=PC_BATCH_SOME_FAILED&&b->phase!=PC_BATCH_ALL_FAILED))return PC_CLOUD_BUSY;
 const pc_pending_operation *p=&b->cloud->store->data.pending[b->slot];
 /* A lost POST response retains its original retry ID, including across reboot. */
 const char *request=p->retry_id[0]?p->retry_id:new_request;cJSON *r=NULL;
 pc_cloud_result result=pc_cloud_batch_retry(b->cloud,b->slot,request,&r);
 if(result==PC_CLOUD_OK){
  pc_personal_data next=b->cloud->store->data;next.pending[b->slot].retry_id[0]=0;
  if(pc_store_commit(b->cloud->store,&next)!=ESP_OK)result=PC_CLOUD_STORAGE;
  else result=apply(b,r,ms);
 }
 if(result!=PC_CLOUD_OK){b->known=false;b->phase=PC_BATCH_CHECKING;b->cloud->state->unresolved=true;b->cloud->state->page=PC_RECONCILE;}
 cJSON_Delete(r);return result;
}
pc_cloud_result pc_batch_dismiss(pc_batch_controller *b){
 if(!b->loaded||!b->known||b->phase==PC_BATCH_CHECKING||b->phase==PC_BATCH_WORKING)return PC_CLOUD_BUSY;
 if(pc_store_pending_clear(b->cloud->store,b->slot,b->operation_id)!=ESP_OK)return PC_CLOUD_STORAGE;
 b->loaded=false;b->known=false;b->phase=PC_BATCH_NONE;return PC_CLOUD_OK;
}
