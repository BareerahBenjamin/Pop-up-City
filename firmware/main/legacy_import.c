#include "legacy_import.h"
#include "nvs.h"
#include <string.h>
#include <stdint.h>
static uint32_t le32(const uint8_t *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static bool uuid(const char *s){
 if(s[36])return false;
 for(unsigned i=0;i<36;i++){if(i==8||i==13||i==18||i==23){if(s[i]!='-')return false;}else if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return false;}
 return true;
}
static esp_err_t blob(const char *ns,const char *key,void *out,size_t expected){
 nvs_handle_t h;esp_err_t e=nvs_open(ns,NVS_READONLY,&h);if(e!=ESP_OK)return e;
 size_t n=expected;e=nvs_get_blob(h,key,out,&n);nvs_close(h);
 return e==ESP_OK&&n!=expected?ESP_ERR_INVALID_SIZE:e;
}
esp_err_t pc_legacy_import(pc_store *s,const char *origin){
 if(!s||!s->writable||!origin||strncmp(origin,"https://",8)||!origin[8])return ESP_ERR_INVALID_ARG;
 for(const char *p=origin+8;*p;p++)if(!((*p>='a'&&*p<='z')||(*p>='A'&&*p<='Z')||(*p>='0'&&*p<='9')||*p=='.'||*p=='-'||*p==':'))return ESP_ERR_INVALID_ARG;
 /* A modern record is authoritative. Do not resurrect old identity or networks. */
 if(s->data.device_id[0]||s->data.device_token[0]||s->data.server_origin[0]||s->data.member_id[0]||s->data.wifi_count)return ESP_OK;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(s->data.pending[i].kind)return ESP_OK;
 uint8_t identity[184]={0},net[204]={0};pc_personal_data next=s->data;
 esp_err_t e=blob("device_identity","record",identity,sizeof(identity));
 if(e==ESP_ERR_NVS_NOT_FOUND)return ESP_OK;
 if(e!=ESP_OK)return e;
 /* Exact ESP32 legacy HID1 layout: magic + id/token/member/station + bool/pad. */
 const char *id=(const char *)identity+4,*token=(const char *)identity+41,*member=(const char *)identity+106,*station=(const char *)identity+143;
 bool valid=le32(identity)==0x48494431u&&uuid(id)&&token[64]==0&&member[36]==0&&station[36]==0&&identity[180]<=1;
 for(unsigned i=0;valid&&i<64;i++)valid=(token[i]>='0'&&token[i]<='9')||(token[i]>='a'&&token[i]<='f');
 valid=valid&&(!member[0]||uuid(member))&&(!station[0]||uuid(station));
 if(!valid){memset(identity,0,sizeof(identity));return ESP_ERR_INVALID_CRC;}
 memcpy(next.device_id,id,37);memcpy(next.device_token,token,65);memcpy(next.member_id,member,37);
 if(strlen(origin)>=sizeof(next.server_origin)){memset(identity,0,sizeof(identity));memset(&next,0,sizeof(next));return ESP_ERR_INVALID_ARG;}
 strcpy(next.server_origin,origin);memset(identity,0,sizeof(identity));
 e=blob("planet_net","profiles",net,sizeof(net));
 if(e!=ESP_OK&&e!=ESP_ERR_NVS_NOT_FOUND){memset(&next,0,sizeof(next));return e;}
 if(e==ESP_OK){
  uint32_t count=le32(net+4);if(le32(net)!=1||count>2){memset(net,0,sizeof(net));memset(&next,0,sizeof(next));return ESP_ERR_INVALID_CRC;}
  for(unsigned i=0;i<count;i++){const uint8_t *p=net+8+i*98;if(!p[0]||!memchr(p,0,33)||!memchr(p+33,0,65)){memset(net,0,sizeof(net));memset(&next,0,sizeof(next));return ESP_ERR_INVALID_CRC;}memcpy(next.wifi[i].ssid,p,33);memcpy(next.wifi[i].password,p+33,65);}
  next.wifi_count=(uint8_t)count;
 }
 memset(net,0,sizeof(net));
 /* pc_store_commit validates current schema and updates RAM only after commit. */
 e=pc_store_commit(s,&next);memset(&next,0,sizeof(next));return e;
}
