#include "legacy_import.h"
#include "nvs.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#define nvs_get_blob event_fake_get_blob
#define nvs_close event_fake_close
#include "nvs_fake.h"
#undef nvs_get_blob
#undef nvs_close
static uint8_t legacy_id[184],legacy_net[204];static bool have_id,have_net;static unsigned legacy_writes;
esp_err_t nvs_open(const char *ns,int mode,nvs_handle_t *h){assert(mode==NVS_READONLY);if(!strcmp(ns,"device_identity")){if(!have_id)return ESP_ERR_NVS_NOT_FOUND;*h=10;return ESP_OK;}assert(!strcmp(ns,"planet_net"));if(!have_net)return ESP_ERR_NVS_NOT_FOUND;*h=11;return ESP_OK;}
esp_err_t nvs_get_blob(nvs_handle_t h,const char *key,void *b,size_t *n){
 if(h<10)return event_fake_get_blob(h,key,b,n);
 assert((h==10&&!strcmp(key,"record"))||(h==11&&!strcmp(key,"profiles")));
 size_t size=h==10?sizeof(legacy_id):sizeof(legacy_net);if(!b){*n=size;return ESP_OK;}if(*n<size)return ESP_ERR_INVALID_SIZE;memcpy(b,h==10?legacy_id:legacy_net,size);*n=size;return ESP_OK;
}
void nvs_close(nvs_handle_t h){if(h<10)event_fake_close(h);else assert(h==10||h==11);}

static void fixture(void){
 memset(legacy_id,0,sizeof(legacy_id));legacy_id[0]=0x31;legacy_id[1]=0x44;legacy_id[2]=0x49;legacy_id[3]=0x48;
 strcpy((char *)legacy_id+4,"11111111-1111-1111-1111-111111111111");memset(legacy_id+41,'a',64);
 strcpy((char *)legacy_id+106,"22222222-2222-2222-2222-222222222222");
 memset(legacy_net,0,sizeof(legacy_net));legacy_net[0]=1;legacy_net[4]=2;strcpy((char *)legacy_net+8,"first");strcpy((char *)legacy_net+41,"password-one");strcpy((char *)legacy_net+106,"second");strcpy((char *)legacy_net+139,"password-two");have_id=have_net=true;
}
int main(void){
 pc_store s;CHECK(pc_store_load(&s)==ESP_ERR_NVS_NOT_FOUND);CHECK(pc_legacy_import(&s,"https://example.test")==ESP_OK&&writes==0);
 fixture();uint8_t id_copy[184],net_copy[204];memcpy(id_copy,legacy_id,184);memcpy(net_copy,legacy_net,204);
 commit_error=ESP_FAIL;CHECK(pc_legacy_import(&s,"https://example.test")==ESP_FAIL);CHECK(!s.data.device_id[0]&&length==0);commit_error=ESP_OK;
 CHECK(pc_legacy_import(&s,"https://example.test")==ESP_OK);CHECK(s.data.wifi_count==2&&!strcmp(s.data.wifi[1].ssid,"second"));CHECK(!strcmp(s.data.member_id,(char *)legacy_id+106));
 CHECK(!memcmp(id_copy,legacy_id,184)&&!memcmp(net_copy,legacy_net,204)&&legacy_writes==0);
 unsigned before=writes;legacy_id[0]=0;CHECK(pc_legacy_import(&s,"https://example.test")==ESP_OK&&writes==before);
 pc_store reloaded;CHECK(pc_store_load(&reloaded)==ESP_OK&&reloaded.data.wifi_count==2&&!strcmp(reloaded.data.device_token,s.data.device_token));
 length=0;CHECK(pc_store_load(&s)==ESP_ERR_NVS_NOT_FOUND);CHECK(pc_legacy_import(&s,"https://example.test")==ESP_ERR_INVALID_CRC&&length==0);
 fixture();legacy_net[4]=3;CHECK(pc_legacy_import(&s,"https://example.test")==ESP_ERR_INVALID_CRC&&length==0);
 fixture();memset(legacy_net+8,'x',33);CHECK(pc_legacy_import(&s,"https://example.test")==ESP_ERR_INVALID_CRC&&length==0);
 fixture();CHECK(pc_legacy_import(&s,"http://invalid.test")==ESP_ERR_INVALID_ARG&&length==0);
 puts("Legacy own-NVS import: bounds, corruption, commit failure, modern precedence, read-only preservation PASS");
}
