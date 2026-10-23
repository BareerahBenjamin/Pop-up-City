#pragma once
#include "personal_store.h"
/* Import only this product's historical default-NVS records, read-only.
 * Never opens another application's event_save namespace. No random identity. */
esp_err_t pc_legacy_import(pc_store *,const char *https_origin);
