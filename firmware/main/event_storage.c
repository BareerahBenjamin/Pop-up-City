#include "event_storage.h"
#include "event_app_identity.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <string.h>
_Static_assert(sizeof(event_save_record_t)<=EVENT_STORAGE_MAX_RECORD_BYTES,"record exceeds storage quota");
_Static_assert(sizeof(event_save_record_t)<=EVENT_APP_SAVE_QUOTA_BYTES,"record exceeds app quota");
esp_err_t event_storage_init(void){return nvs_flash_init_partition(EVENT_STORAGE_PARTITION);}
esp_err_t event_storage_load(const char *id,event_save_record_t *out){
 if(!id||!out||strcmp(id,EVENT_APP_ID))return ESP_ERR_INVALID_ARG;
 nvs_handle_t h;esp_err_t err=nvs_open_from_partition(EVENT_STORAGE_PARTITION,id,NVS_READONLY,&h);if(err!=ESP_OK)return err;
 uint8_t bytes[PC_RECORD_BYTES];size_t size=0;err=nvs_get_blob(h,"record",NULL,&size);
 if(err==ESP_OK){if(size>sizeof(bytes)||size==0)err=ESP_ERR_INVALID_SIZE;else err=nvs_get_blob(h,"record",bytes,&size);}nvs_close(h);
 if(err!=ESP_OK)return err;
 pc_personal_data data;if(!pc_record_decode(bytes,size,id,&data,NULL))return ESP_ERR_INVALID_CRC;
 event_save_record_t next;if(!pc_record_encode(id,&data,&next))return ESP_ERR_INVALID_CRC;*out=next;return ESP_OK;
}
esp_err_t event_storage_save(const event_save_record_t *r){
 if(!event_save_record_valid(r,EVENT_APP_ID))return ESP_ERR_INVALID_ARG;
 nvs_handle_t h;esp_err_t err=nvs_open_from_partition(EVENT_STORAGE_PARTITION,EVENT_APP_ID,NVS_READWRITE,&h);if(err!=ESP_OK)return err;
 err=nvs_set_blob(h,"record",r,sizeof(*r));if(err==ESP_OK)err=nvs_commit(h);nvs_close(h);return err;
}
