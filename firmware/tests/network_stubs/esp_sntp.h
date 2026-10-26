#pragma once
#include <stdbool.h>
#define SNTP_OPMODE_POLL 0
bool esp_sntp_enabled(void);
void esp_sntp_setoperatingmode(int mode);
void esp_sntp_setservername(int index,const char *server);
void esp_sntp_init(void);
