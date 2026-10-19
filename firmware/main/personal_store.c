#include "personal_store.h"
#include "event_app_identity.h"
#include "nvs.h"
#include <string.h>
esp_err_t pc_store_load(pc_store *s){
 if(!s)return ESP_ERR_INVALID_ARG;
 memset(s,0,sizeof(*s));event_save_record_t r;
 esp_err_t err=event_storage_init();if(err!=ESP_OK)return err;
 err=event_storage_load(EVENT_APP_ID,&r);
 if(err==ESP_ERR_NVS_NOT_FOUND){s->writable=true;return err;}
 if(err!=ESP_OK)return err;
 if(!pc_record_decode(r.bytes,sizeof(r.bytes),EVENT_APP_ID,&s->data,NULL))return ESP_ERR_INVALID_CRC;
 s->writable=true;return ESP_OK;
}
esp_err_t pc_store_commit(pc_store *s,const pc_personal_data *next){
 if(!s||!next)return ESP_ERR_INVALID_ARG;
 if(!s->writable)return ESP_ERR_INVALID_STATE;
 event_save_record_t r;if(!pc_record_encode(EVENT_APP_ID,next,&r))return ESP_ERR_INVALID_ARG;
 esp_err_t err=event_storage_save(&r);if(err==ESP_OK)s->data=*next;return err;
}
bool pc_store_feedback_save(const pc_feedback_cursor *c,void *context){
 pc_store *s=context;if(!s||!c)return false;pc_personal_data next=s->data;
 memcpy(next.feedback_session,c->session_id,sizeof(next.feedback_session));next.feedback_consumed=c->consumed;
 return pc_store_commit(s,&next)==ESP_OK;
}
esp_err_t pc_store_skip_hello(pc_store *s){if(!s)return ESP_ERR_INVALID_ARG;pc_personal_data next=s->data;next.hello_skipped=true;return pc_store_commit(s,&next);}
esp_err_t pc_store_pending_begin(pc_store *s,unsigned slot,const pc_pending_operation *op){
 if(!s||!op||slot>=PC_PENDING_OPERATIONS||!op->kind)return ESP_ERR_INVALID_ARG;
 pc_personal_data next=s->data;
 /* Never overwrite an unresolved operation, including an attempted new retry ID. */
 if(next.pending[slot].kind)return ESP_ERR_INVALID_STATE;
 next.pending[slot]=*op;return pc_store_commit(s,&next);
}
esp_err_t pc_store_pending_clear(pc_store *s,unsigned slot,const char *id){
 if(!s||!id||slot>=PC_PENDING_OPERATIONS)return ESP_ERR_INVALID_ARG;
 if(!s->data.pending[slot].kind||strcmp(s->data.pending[slot].operation_id,id))return ESP_ERR_INVALID_STATE;
 pc_personal_data next=s->data;memset(&next.pending[slot],0,sizeof(next.pending[slot]));return pc_store_commit(s,&next);
}
esp_err_t pc_store_pending_retry(pc_store *s,unsigned slot,const char *batch,const char *retry){
 if(!s||!batch||!retry||slot>=PC_PENDING_OPERATIONS||strlen(retry)!=36)return ESP_ERR_INVALID_ARG;
 if(s->data.pending[slot].kind!=PC_PENDING_BATCH||strcmp(s->data.pending[slot].operation_id,batch))return ESP_ERR_INVALID_STATE;
 pc_personal_data next=s->data;memcpy(next.pending[slot].retry_id,retry,37);return pc_store_commit(s,&next);
}
