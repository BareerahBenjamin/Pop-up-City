#pragma once
#include <stdint.h>
typedef struct {const char *key;uint32_t offset,length;} pc_screen_asset;
extern const pc_screen_asset pc_screen_assets[];
extern const unsigned pc_screen_asset_count;
const pc_screen_asset *pc_screen_find(const char *key);
