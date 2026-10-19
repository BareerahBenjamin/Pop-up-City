#pragma once
#include "esp_err.h"
/* Dedicated task owns CW2017 I2C calls; unavailable hardware reports -1. */
esp_err_t pc_display_status_start(void);
int pc_display_battery(void);
