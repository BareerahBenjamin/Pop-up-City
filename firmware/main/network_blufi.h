#pragma once
#include "esp_err.h"
#include "network_profiles.h"
#include "network_scan_model.h"
/* Initialize once, before starting the existing NimBLE host. */
esp_err_t network_blufi_radio_init(void);
void network_blufi_radio_sync(void);
esp_err_t network_blufi_begin(void);
void network_blufi_end(void);
bool network_blufi_connected(void);
const char *network_blufi_name(void);
/* Reports are sent by the main worker, never from a button callback. */
void network_blufi_report(const network_profile_t *profile,bool connected,bool connecting);
void network_blufi_list(const network_scan_list_t *list);

bool network_blufi_transport_running(void);
