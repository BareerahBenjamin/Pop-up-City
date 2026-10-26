#pragma once

#include "esp_err.h"

#include <stdbool.h>
#include <stdint.h>
#include "network_status.h"

esp_err_t terminal_wifi_start(const char *ssid, const char *password);
bool terminal_wifi_wait_connected(uint32_t timeout_ms);
bool terminal_wifi_is_connected(void);
/* Worker-task only; reconnect control lets temporary provisioning own STA. */
esp_err_t terminal_wifi_set_network(const char *ssid, const char *password);
void terminal_wifi_pause(bool pause);

/* AP association is independent of DHCP readiness. No credentials in snapshot. */
pc_wifi_status terminal_wifi_status(void);
