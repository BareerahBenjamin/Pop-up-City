#pragma once
#include <stdbool.h>
#include <stdint.h>
/* Internal facts only. UI maps these to existing approved assets. */
typedef enum { PC_WIFI_IDLE, PC_WIFI_PROVISIONING, PC_WIFI_CONNECTING,
 PC_WIFI_SAVED, PC_WIFI_FAILED, PC_WIFI_SAVE_FAILED } pc_wifi_phase;
typedef enum { PC_WIFI_ERROR_NONE, PC_WIFI_ERROR_AUTH, PC_WIFI_ERROR_NO_AP,
 PC_WIFI_ERROR_LINK, PC_WIFI_ERROR_DHCP_TIMEOUT, PC_WIFI_ERROR_CONNECT_TIMEOUT,
 PC_WIFI_ERROR_STORAGE, PC_WIFI_ERROR_RADIO, PC_WIFI_ERROR_SESSION_TIMEOUT } pc_wifi_error;
typedef struct {
 pc_wifi_phase phase;
 pc_wifi_error error;
 bool associated,has_ip,persisted;
 uint16_t disconnect_reason;
} pc_wifi_status;
