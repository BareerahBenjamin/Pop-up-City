#include "app_services.h"
#include <string.h>
static pc_store *owner;
void app_services_bind(pc_store *store){owner=store;}
bool app_save_networks(const network_profiles_t *profiles){
 if(!owner||!network_profiles_valid(profiles))return false;
 pc_personal_data next=owner->data;next.wifi_count=(uint8_t)profiles->count;memset(next.wifi,0,sizeof(next.wifi));
 for(unsigned i=0;i<profiles->count;i++){memcpy(next.wifi[i].ssid,profiles->profiles[i].ssid,33);memcpy(next.wifi[i].password,profiles->profiles[i].password,65);}
 return pc_store_commit(owner,&next)==ESP_OK;
}
bool app_load_networks(network_profiles_t *profiles){
 if(!owner||!owner->writable||!profiles)return false;
 memset(profiles,0,sizeof(*profiles));profiles->version=1;profiles->count=owner->data.wifi_count;
 for(unsigned i=0;i<profiles->count;i++){memcpy(profiles->profiles[i].ssid,owner->data.wifi[i].ssid,33);memcpy(profiles->profiles[i].password,owner->data.wifi[i].password,65);}
 return network_profiles_valid(profiles);
}
const char *identity_device_id(void){return owner?owner->data.device_id:"";}
