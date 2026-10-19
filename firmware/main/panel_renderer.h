#pragma once
#include "screen_assets.h"
#include "esp_err.h"
#include <stddef.h>
/* Single UI task owns this renderer. Overlay sees host-order RGB565, ten rows at a time. */
typedef void (*pc_panel_overlay)(void *,unsigned row,unsigned rows,uint16_t *pixels);
esp_err_t pc_panel_start(void);
esp_err_t pc_panel_present(const pc_screen_asset *,pc_panel_overlay,void *);
