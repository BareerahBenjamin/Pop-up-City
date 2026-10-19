#pragma once
#include "event_storage.h"
#include "feedback_consumer.h"
typedef struct {pc_personal_data data;bool writable;} pc_store;
/* NOT_FOUND means empty/new namespace; corrupt or future records disable writes. */
esp_err_t pc_store_load(pc_store *store);
esp_err_t pc_store_commit(pc_store *store,const pc_personal_data *next);
bool pc_store_feedback_save(const pc_feedback_cursor *cursor,void *store);
esp_err_t pc_store_skip_hello(pc_store *store);
/* Successful return is required BEFORE issuing a new network submission. */
esp_err_t pc_store_pending_begin(pc_store *store,unsigned slot,const pc_pending_operation *operation);
/* Caller must first verify the authoritative receipt/result matches this ID. */
esp_err_t pc_store_pending_clear(pc_store *store,unsigned slot,const char *verified_operation_id);
/* After authoritative partial/failed status, persist retry ID before POST retry. */
esp_err_t pc_store_pending_retry(pc_store *store,unsigned slot,const char *verified_batch_id,const char *retry_id);
