#pragma once
#include "esp_err.h"
#include "network_profiles.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
esp_err_t network_start(void);
/* Main application worker owns these calls; HTTP callbacks only queue input. */
esp_err_t network_setup_begin(void);
void network_tick(uint32_t now_ms);
void network_setup_end(void);
bool network_setup_active(void);
const char *network_setup_screen(void);
const char *network_origin(void);
bool network_ready(void);
typedef enum { NETWORK_SETUP_CONNECT, NETWORK_SETUP_SCAN, NETWORK_SETUP_STATUS,
               NETWORK_SETUP_DISCONNECT, NETWORK_SETUP_FORGET } network_setup_command_t;
/* BLUFI callback only enqueues a bounded copy. */
bool network_setup_queue(network_setup_command_t command,const network_profile_t *profile);
bool network_setup_forget(void);

/* Compact status; excludes passwords and uses the existing Latin font. */
const char *network_setup_summary(void);

bool network_reconnecting_saved(void);
