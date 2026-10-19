#pragma once
#include "esp_err.h"
#include "network_scan_model.h"
esp_err_t network_radio_scan_start(void);
/* Main worker drains the completed scan and releases the driver's AP list. */
bool network_radio_scan_tick(void);
void network_radio_scan_stop(void);
bool network_radio_scanning(void);
const network_scan_list_t *network_radio_scan_list(void);
void network_radio_scan_move(int direction);
