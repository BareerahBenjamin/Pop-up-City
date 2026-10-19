#pragma once
#include "nearby_participants.h"
#include "esp_err.h"

/* A permanent application service; callbacks only enqueue bounded observations. */
esp_err_t nearby_ble_init(void);
esp_err_t nearby_ble_update(const uint8_t advertisement[30], bool scan);
bool nearby_ble_receive(nearby_participant_t *observation);
esp_err_t nearby_ble_provisioning(bool enabled,const char *name);

bool nearby_ble_phone_connected(void);
