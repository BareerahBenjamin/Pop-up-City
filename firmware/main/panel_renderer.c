#include "panel_renderer.h"
#include "bsp_display.h"
#include "bsp_pins.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_io.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <string.h>
extern const uint8_t screen_data[] asm("_binary_screens_rle_start");
extern const uint8_t screen_end[] asm("_binary_screens_rle_end");
static SemaphoreHandle_t transferred;
static uint16_t *strip;
static bool failed;
static bool completed(esp_lcd_panel_io_handle_t io,esp_lcd_panel_io_event_data_t *event,void *context){
 (void)io;(void)event;(void)context;BaseType_t wake=pdFALSE;xSemaphoreGiveFromISR(transferred,&wake);return wake==pdTRUE;
}
const pc_screen_asset *pc_screen_find(const char *key){if(!key)return NULL;for(unsigned i=0;i<pc_screen_asset_count;i++)if(!strcmp(pc_screen_assets[i].key,key))return &pc_screen_assets[i];return NULL;}
esp_err_t pc_panel_start(void){
 if(strip)return ESP_ERR_INVALID_STATE;
 esp_err_t result=bsp_display_init();if(result!=ESP_OK)return result;
 transferred=xSemaphoreCreateBinary();strip=heap_caps_malloc(BSP_LCD_W*10*sizeof(uint16_t),MALLOC_CAP_DMA|MALLOC_CAP_INTERNAL);
 if(!transferred||!strip){if(transferred)vSemaphoreDelete(transferred);if(strip)heap_caps_free(strip);transferred=NULL;strip=NULL;return ESP_ERR_NO_MEM;}
 esp_lcd_panel_io_callbacks_t callbacks={.on_color_trans_done=completed};
 result=esp_lcd_panel_io_register_event_callbacks(bsp_display_io(),&callbacks,NULL);
 if(result!=ESP_OK){vSemaphoreDelete(transferred);heap_caps_free(strip);transferred=NULL;strip=NULL;return result;}
 bsp_display_backlight(80);return ESP_OK;
}
static unsigned u16(const uint8_t *p){return (unsigned)p[0]|((unsigned)p[1]<<8);}
esp_err_t pc_panel_present_region(const pc_screen_asset *asset,pc_panel_overlay overlay,void *context,unsigned top,unsigned bottom){
 if(top>=bottom||bottom>BSP_LCD_H)return ESP_ERR_INVALID_ARG;
 if(!strip||failed)return ESP_ERR_INVALID_STATE;
 if(asset&&(asset->length%4||asset->offset>(size_t)(screen_end-screen_data)||asset->length>(size_t)(screen_end-screen_data)-asset->offset))return ESP_ERR_INVALID_ARG;
 const uint8_t *cursor=asset?screen_data+asset->offset:NULL;
 unsigned total=0;
 if(asset)for(unsigned i=0;i<asset->length;i+=4){unsigned count=u16(cursor+i);if(!count||count>BSP_LCD_W*BSP_LCD_H-total)return ESP_ERR_INVALID_ARG;total+=count;}
 if(asset&&total!=BSP_LCD_W*BSP_LCD_H)return ESP_ERR_INVALID_ARG;
 unsigned remaining=0,color=0;
 /* Skip RLE runs, rather than decoding and transmitting unchanged prefix rows. */
 if(asset){unsigned skip=top*BSP_LCD_W;while(skip){if(!remaining){remaining=u16(cursor);color=u16(cursor+2);cursor+=4;}unsigned n=remaining<skip?remaining:skip;remaining-=n;skip-=n;}}
 for(unsigned row=top;row<bottom;row+=10){
  unsigned rows=bottom-row;if(rows>10)rows=10;
  for(unsigned p=0;p<BSP_LCD_W*rows;p++){
   if(asset){if(!remaining){remaining=u16(cursor);color=u16(cursor+2);cursor+=4;}remaining--;}
   strip[p]=(uint16_t)color;
  }
  if(overlay)overlay(context,row,rows,strip);
  for(unsigned p=0;p<BSP_LCD_W*rows;p++)strip[p]=(uint16_t)((strip[p]>>8)|(strip[p]<<8));
  (void)xSemaphoreTake(transferred,0);
  esp_err_t result=esp_lcd_panel_draw_bitmap(bsp_display_panel(),0,row,BSP_LCD_W,row+rows,strip);
  if(result!=ESP_OK){failed=true;return result;}
  /* DMA keeps the buffer until completion. Timeout permanently disables reuse. */
  if(xSemaphoreTake(transferred,pdMS_TO_TICKS(1000))!=pdTRUE){failed=true;return ESP_ERR_TIMEOUT;}
 }
 return ESP_OK;
}

esp_err_t pc_panel_present(const pc_screen_asset *asset,pc_panel_overlay overlay,void *context){return pc_panel_present_region(asset,overlay,context,0,BSP_LCD_H);}
