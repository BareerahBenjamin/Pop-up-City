#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
/* ROM font; caller supplies the same 192x32 buffer used by signed website names. */
bool pc_cjk_name_bitmap(const uint8_t *font,size_t font_bytes,const char *name,uint8_t out[768]);

#define PC_NAME_BITMAP_STYLE "popcity-pixel-v1"
bool pc_pixel_name_render(const uint8_t *,size_t,const char *,uint8_t *,size_t,unsigned,unsigned,unsigned,bool,bool);
#ifdef ESP_PLATFORM
bool pc_pixel_name_local(const char *,uint8_t *,size_t,unsigned,unsigned,unsigned,bool,bool);
#endif

unsigned pc_pixel_name_width(const char *,unsigned);
/* Draw bounded UTF-8 text directly into an RGB565 strip, fixed 12x16 pixels.
 * No expanded text bitmap or heap allocation; viewport scrolling preserves size. */
bool pc_pixel_line_strip(const uint8_t *,size_t,const char *,uint32_t,int,int,unsigned,unsigned,unsigned,uint16_t *,uint16_t);
