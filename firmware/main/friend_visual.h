#pragma once
#include <stdint.h>
#include <stdbool.h>
#define PC_FRIEND_ANIMATION_MS 2400u
typedef enum {PC_HAIR_NONE,PC_HAIR_SHORT,PC_HAIR_MEDIUM,PC_HAIR_LONG} pc_friend_hair;
typedef struct {pc_friend_hair hair_length;uint16_t hair_rgb,shirt_rgb;bool fallback;} pc_friend_person;
typedef struct {bool valid;pc_friend_person self,peer;} pc_friend_visual;
void pc_friend_visual_default(pc_friend_visual *out);
/* Geometry matches the accepted 112x80 scene. Self is always on the left.
 * Input colors are server-validated native RGB565. No implicit default avatar. */
void pc_friend_visual_strip(uint16_t *pixels,unsigned row,unsigned rows,uint32_t elapsed,const pc_friend_visual *visual);
