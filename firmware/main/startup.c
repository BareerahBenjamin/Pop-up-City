#include "startup.h"
#include "cjk_name.h"
#ifdef ESP_PLATFORM
#include "memory_report.h"
#include "esp_system.h"
extern const uint8_t pc_cjk_start[] asm("_binary_cjk_font_bin_start");
extern const uint8_t pc_cjk_end[] asm("_binary_cjk_font_bin_end");
#endif
#include <stdio.h>
#include <string.h>
static const char *str(const cJSON *o,const char *key){const cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);return cJSON_IsString(v)?v->valuestring:"";}
void pc_startup_init(pc_startup *s,pc_cloud *cloud){memset(s,0,sizeof(*s));s->cloud=cloud;}
static pc_cloud_result apply(pc_startup *s,cJSON *r,uint32_t ms){
 pc_cloud *c=s->cloud;const char *state=str(r,"state");
 s->member_label_bitmap_valid=false;s->member_label_width=192;
 if(!strcmp(state,"reset_required")){
  /* Explicit owner removal resets only popcity's own application record. Atomic
   * commit keeps the old identity recoverable if storage fails or power drops. */
  pc_personal_data next={0};
  snprintf(next.device_id,sizeof(next.device_id),"%s",str(r,"replacement_device_id"));
  snprintf(next.device_token,sizeof(next.device_token),"%s",str(r,"replacement_device_token"));
  memcpy(next.server_origin,c->store->data.server_origin,sizeof(next.server_origin));
  esp_err_t saved=pc_store_commit(c->store,&next);memset(&next,0,sizeof(next));
  pc_facts(c->state,true,false,false,ms);s->phase=PC_BIND_REVOKED;
  if(saved!=ESP_OK){s->phase=PC_BIND_STORAGE_ERROR;return PC_CLOUD_STORAGE;}
  s->reset_ready=true;return PC_CLOUD_OK;
 }
 if(!strcmp(state,"pending")&&!strcmp(str(r,"member_label_bitmap_style"),PC_NAME_BITMAP_STYLE)&&cJSON_GetObjectItemCaseSensitive(r,"member_label_bitmap")){s->member_label_bitmap_valid=pc_cloud_decode_bitmap(r,"member_label_bitmap",s->member_label_bitmap,sizeof(s->member_label_bitmap));if(!s->member_label_bitmap_valid)return PC_CLOUD_INVALID;}
 if(!strcmp(state,"bound")){
  const char *member=str(r,"member_id");bool changed=strcmp(c->store->data.member_id,member)!=0;
  if(changed&&c->store->data.member_id[0]){s->phase=PC_BIND_REVOKED;pc_facts(c->state,true,false,false,ms);return PC_CLOUD_INVALID;}
  if(changed){pc_personal_data next=c->store->data;memcpy(next.member_id,member,37);next.hello_skipped=false;if(pc_store_commit(c->store,&next)!=ESP_OK){s->phase=PC_BIND_STORAGE_ERROR;return PC_CLOUD_STORAGE;}s->new_binding=true;c->state->hello_skipped=false;}
  snprintf(s->member_label,sizeof(s->member_label),"%s",str(r,"member_name"));
  s->request_id[0]=0;pc_facts(c->state,true,true,c->state->host_active,ms);return PC_CLOUD_OK;
 }
 pc_facts(c->state,true,false,false,ms);
 if(!strcmp(state,"revoked")){s->phase=PC_BIND_REVOKED;s->request_id[0]=0;return PC_CLOUD_OK;}
 snprintf(s->claim_code,sizeof(s->claim_code),"%s",str(r,"claim_code"));
 const cJSON *expires=cJSON_GetObjectItemCaseSensitive(r,"expires_at");s->expires_at=(uint64_t)expires->valuedouble;
 const cJSON *remote=cJSON_GetObjectItemCaseSensitive(r,"server_time");uint64_t server=(uint64_t)remote->valuedouble;
 s->valid_seconds=s->expires_at>server?(uint32_t)(s->expires_at-server):0;s->updated_ms=ms;
 if(!strcmp(state,"pending")){
  const char *id=str(r,"request_id");if(strcmp(s->request_id,id)){memcpy(s->request_id,id,37);s->shown_ms=ms;}
  s->phase=PC_BIND_CONFIRM;snprintf(s->member_label,sizeof(s->member_label),"%s",str(r,"member_label"));snprintf(s->member_hint,sizeof(s->member_hint),"%s",str(r,"member_hint"));
#ifdef ESP_PLATFORM
  unsigned label_width=pc_pixel_name_width(s->member_label,1);
  if(label_width>192&&label_width<=384){s->member_label_bitmap_valid=pc_pixel_name_local(s->member_label,s->member_label_bitmap,sizeof(s->member_label_bitmap),label_width,16,1,false,false);s->member_label_width=(uint16_t)label_width;}
  else if(!s->member_label_bitmap_valid){s->member_label_bitmap_valid=pc_cjk_name_bitmap(pc_cjk_start,(size_t)(pc_cjk_end-pc_cjk_start),s->member_label,s->member_label_bitmap);pc_memory_report("name_fallback");}
#endif
 }else{s->phase=PC_BIND_WAITING;s->request_id[0]=0;s->member_label[0]=0;s->member_hint[0]=0;}
 return PC_CLOUD_OK;
}
pc_cloud_result pc_startup_poll(pc_startup *s,uint32_t ms){
 cJSON *r=NULL;pc_cloud_result result=pc_cloud_enrollment_status(s->cloud,&r);
 if(result==PC_CLOUD_OK)result=apply(s,r,ms);else if(s->phase!=PC_BIND_CHECKING)s->phase=PC_BIND_SERVICE_ERROR;
 cJSON_Delete(r);
#ifdef ESP_PLATFORM
 if(s->reset_ready)esp_restart(); /* Reload empty Wi-Fi and discard all old UI/radio caches. */
#endif
 return result;
}
pc_cloud_result pc_startup_confirm(pc_startup *s,bool accept,uint32_t key_ms){
 if(s->phase!=PC_BIND_CONFIRM||!s->request_id[0]||(int32_t)(key_ms-s->shown_ms)<0)return PC_CLOUD_INVALID;
 s->phase=PC_BIND_CHECKING;cJSON *r=NULL;pc_cloud_result result=pc_cloud_enrollment_confirm(s->cloud,s->request_id,accept,&r);
 if(result==PC_CLOUD_OK){result=apply(s,r,key_ms);if(result==PC_CLOUD_OK&&!accept&&s->phase==PC_BIND_WAITING)s->phase=PC_BIND_REJECTED;}
 /* Unknown HTTP outcome remains CHECKING; next poll reconciles, never auto-consents. */
 cJSON_Delete(r);return result;
}
