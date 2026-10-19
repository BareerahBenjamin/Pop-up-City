#pragma once
#include "esp_err.h"
#include "event_save_model.h"
#define EVENT_STORAGE_PARTITION "event_save"
#define EVENT_STORAGE_MAX_RECORD_BYTES 2048u
esp_err_t event_storage_init(void);
esp_err_t event_storage_load(const char *app_id,event_save_record_t *record);
esp_err_t event_storage_save(const event_save_record_t *record);
