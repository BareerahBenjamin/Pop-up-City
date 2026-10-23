#include "proximity.h"
#include "cjk_name.h"
#include "cloud_internal.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int hex(char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;}
void pc_device_uuid(const uint8_t bytes[16],char out[37]){
 unsigned n=0;static const char digits[]="0123456789abcdef";
 for(unsigned i=0;i<16;i++){if(i==4||i==6||i==8||i==10)out[n++]='-';out[n++]=digits[bytes[i]>>4];out[n++]=digits[bytes[i]&15];}out[n]=0;
}
bool pc_presence_advertisement(pc_cloud *c,uint32_t ms,uint8_t out[30]){
 if(!c||!out||!c->sign||!c->clock_known||!c->state->bound||!c->state->online||(uint32_t)(ms-c->server_ms)>=15000||!pc_cloud_uuid(c->store->data.device_id))return false;
 uint64_t epoch=c->server_time+(uint32_t)(ms-c->server_ms)/1000;if(!epoch||epoch>UINT32_MAX)return false;
 cJSON *a=cJSON_CreateArray();if(!a)return false;
 cJSON_AddItemToArray(a,cJSON_CreateString("herstory-presence-v1"));cJSON_AddItemToArray(a,cJSON_CreateString(c->store->data.device_id));cJSON_AddItemToArray(a,cJSON_CreateNumber((double)epoch));
 char *canonical=cJSON_PrintUnformatted(a),signature[65];cJSON_Delete(a);bool ok=canonical&&c->sign(c->sign_context,canonical,signature);free(canonical);if(!ok)return false;
 uint8_t packet[30]={29,255,255,255};unsigned n=4;const char *id=c->store->data.device_id;
 for(unsigned i=0;i<36;){if(id[i]=='-'){i++;continue;}packet[n++]=(uint8_t)((hex(id[i])<<4)|hex(id[i+1]));i+=2;}
 for(unsigned i=0;i<4;i++)packet[20+i]=(uint8_t)(epoch>>(24-i*8));
 for(unsigned i=0;i<6;i++){int high=hex(signature[i*2]),low=hex(signature[i*2+1]);if(high<0||low<0)return false;packet[24+i]=(uint8_t)((high<<4)|low);}
 memcpy(out,packet,30);return true;
}
bool pc_presence_observe(nearby_participants_t *list,const nearby_participant_t *observation,const char *own,uint32_t ms,int8_t threshold){
 if(!list||!observation||!own||(uint32_t)(ms-observation->seen_ms)>=NEARBY_TTL_MS||!observation->presence_epoch||observation->presence_tag[12])return false;
 for(unsigned i=0;i<12;i++)if(hex(observation->presence_tag[i])<0)return false;
 char peer[37];pc_device_uuid(observation->device_id,peer);if(!strcmp(peer,own))return false;
 if(!nearby_observe(list,observation->device_id,observation->rssi,observation->seen_ms,threshold))return false;
 for(unsigned i=0;i<NEARBY_CAPACITY;i++)if(list->entries[i].occupied&&!memcmp(list->entries[i].device_id,observation->device_id,16)){
  list->entries[i].presence_epoch=observation->presence_epoch;memcpy(list->entries[i].presence_tag,observation->presence_tag,13);return true;
 }
 return false;
}
static const char *field(const cJSON *r,const char *key){const cJSON *v=cJSON_GetObjectItemCaseSensitive(r,key);return cJSON_IsString(v)?v->valuestring:NULL;}
pc_cloud_result pc_cloud_host_candidate(pc_cloud *c,const char *activity,const nearby_participant_t *peer,pc_host_candidate *out){
 if(!peer||!out||!pc_cloud_uuid(activity)||!peer->presence_epoch||peer->presence_tag[12])return PC_CLOUD_INVALID;
 for(unsigned i=0;i<12;i++)if(hex(peer->presence_tag[i])<0)return PC_CLOUD_INVALID;
 char device[37];pc_device_uuid(peer->device_id,device);if(!strcmp(device,c->store->data.device_id))return PC_CLOUD_INVALID;
 cJSON *body=cJSON_CreateObject(),*r=NULL;if(!body)return PC_CLOUD_INVALID;
 cJSON_AddStringToObject(body,"activity_id",activity);cJSON_AddStringToObject(body,"user_device_id",device);cJSON_AddNumberToObject(body,"presence_epoch",peer->presence_epoch);cJSON_AddStringToObject(body,"presence_tag",peer->presence_tag);
 pc_cloud_result result=pc_cloud_call(c,false,"/local/host/nearby",body,&r);cJSON_Delete(body);if(result!=PC_CLOUD_OK)return result;
 const char *id=field(r,"user_device_id"),*event=field(r,"activity_id"),*tag=field(r,"presence_tag"),*label=field(r,"user_label"),*bitmap=field(r,"name_bitmap");
 bool valid=id&&!strcmp(id,device)&&event&&!strcmp(event,activity)&&tag&&!strcmp(tag,peer->presence_tag)&&label&&strlen(label)<129&&bitmap&&strlen(bitmap)==1536;
 pc_host_candidate candidate={0};candidate.signed_in=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(r,"signed_in"));candidate.signed_status_known=cJSON_IsBool(cJSON_GetObjectItemCaseSensitive(r,"signed_in"));
 if(valid)for(unsigned i=0;i<768;i++){int high=hex(bitmap[i*2]),low=hex(bitmap[i*2+1]);if(high<0||low<0){valid=false;break;}candidate.name_bitmap[i]=(uint8_t)((high<<4)|low);}

#ifdef ESP_PLATFORM
 const char *style=field(r,"name_bitmap_style");
 if(valid&&(!style||strcmp(style,PC_NAME_BITMAP_STYLE)))valid=pc_pixel_name_local(label,candidate.name_bitmap,sizeof(candidate.name_bitmap),192,32,1,true,true);
#endif
 if(valid){memcpy(candidate.device_id,id,37);strcpy(candidate.label,label);*out=candidate;}
 cJSON_Delete(r);return valid?PC_CLOUD_OK:PC_CLOUD_INVALID;
}
