#include "startup.h"
#include <stdio.h>
#include <string.h>
static const char *str(const cJSON *o,const char *key){const cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);return cJSON_IsString(v)?v->valuestring:"";}
void pc_startup_init(pc_startup *s,pc_cloud *cloud){memset(s,0,sizeof(*s));s->cloud=cloud;}
static pc_cloud_result apply(pc_startup *s,cJSON *r,uint32_t ms){
 pc_cloud *c=s->cloud;const char *state=str(r,"state");
 s->member_label_bitmap_valid=false;
 if(!strcmp(state,"pending")&&cJSON_GetObjectItemCaseSensitive(r,"member_label_bitmap")){s->member_label_bitmap_valid=pc_cloud_decode_bitmap(r,"member_label_bitmap",s->member_label_bitmap,sizeof(s->member_label_bitmap));if(!s->member_label_bitmap_valid)return PC_CLOUD_INVALID;}
 if(!strcmp(state,"bound")){
  const char *member=str(r,"member_id");bool changed=strcmp(c->store->data.member_id,member)!=0;
  if(changed&&c->store->data.member_id[0]){s->phase=PC_BIND_REVOKED;pc_facts(c->state,true,false,false,ms);return PC_CLOUD_INVALID;}
  if(changed){pc_personal_data next=c->store->data;memcpy(next.member_id,member,37);if(pc_store_commit(c->store,&next)!=ESP_OK){s->phase=PC_BIND_STORAGE_ERROR;return PC_CLOUD_STORAGE;}s->new_binding=true;}
  snprintf(s->member_label,sizeof(s->member_label),"%s",str(r,"member_name"));
  s->request_id[0]=0;pc_facts(c->state,true,true,c->state->host_active,ms);return PC_CLOUD_OK;
 }
 pc_facts(c->state,true,false,false,ms);
 if(!strcmp(state,"revoked")){s->phase=PC_BIND_REVOKED;s->request_id[0]=0;return PC_CLOUD_OK;}
 snprintf(s->claim_code,sizeof(s->claim_code),"%s",str(r,"claim_code"));
 const cJSON *expires=cJSON_GetObjectItemCaseSensitive(r,"expires_at");s->expires_at=(uint64_t)expires->valuedouble;
 if(!strcmp(state,"pending")){
  const char *id=str(r,"request_id");if(strcmp(s->request_id,id)){memcpy(s->request_id,id,37);s->shown_ms=ms;}
  s->phase=PC_BIND_CONFIRM;snprintf(s->member_label,sizeof(s->member_label),"%s",str(r,"member_label"));snprintf(s->member_hint,sizeof(s->member_hint),"%s",str(r,"member_hint"));
 }else{s->phase=PC_BIND_WAITING;s->request_id[0]=0;s->member_label[0]=0;s->member_hint[0]=0;}
 return PC_CLOUD_OK;
}
pc_cloud_result pc_startup_poll(pc_startup *s,uint32_t ms){
 cJSON *r=NULL;pc_cloud_result result=pc_cloud_enrollment_status(s->cloud,&r);
 if(result==PC_CLOUD_OK)result=apply(s,r,ms);else if(s->phase!=PC_BIND_CHECKING)s->phase=PC_BIND_SERVICE_ERROR;
 cJSON_Delete(r);return result;
}
pc_cloud_result pc_startup_confirm(pc_startup *s,bool accept,uint32_t key_ms){
 if(s->phase!=PC_BIND_CONFIRM||!s->request_id[0]||(int32_t)(key_ms-s->shown_ms)<0)return PC_CLOUD_INVALID;
 s->phase=PC_BIND_CHECKING;cJSON *r=NULL;pc_cloud_result result=pc_cloud_enrollment_confirm(s->cloud,s->request_id,accept,&r);
 if(result==PC_CLOUD_OK)result=apply(s,r,key_ms);
 /* Unknown HTTP outcome remains CHECKING; next poll reconciles, never auto-consents. */
 cJSON_Delete(r);return result;
}
