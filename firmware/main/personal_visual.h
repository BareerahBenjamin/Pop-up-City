#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "cJSON.h"
typedef struct {
 bool valid,house,lake;
 uint8_t palette,stage;
 uint32_t revision;
 char name[129],name_version[65];
 uint16_t name_width;
 uint8_t name_bitmap[3072];
} pc_personal_visual;
/* Decode atomically; malformed or incompatible metadata never replaces the last valid view. */
bool pc_personal_visual_decode(const cJSON *runtime,pc_personal_visual *out);
/* UI-owned strip overlay. Output native RGB565; frame RAM is never allocated. */
void pc_personal_planet_overlay(const pc_personal_visual *,uint32_t elapsed_ms,unsigned row,unsigned rows,uint16_t *pixels);
void pc_personal_name_overlay(const pc_personal_visual *,uint32_t elapsed_ms,unsigned row,unsigned rows,uint16_t *pixels);
