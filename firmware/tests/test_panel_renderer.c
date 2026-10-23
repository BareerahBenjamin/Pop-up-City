#include "panel_renderer.h"
#include "common.h"
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
const uint8_t blob[] __asm__("_binary_screens_rle_start")={0xff,0xff,0x34,0x12,0x01,0x2c,0x78,0x56};
__asm__(".globl _binary_screens_rle_end\n_binary_screens_rle_end = _binary_screens_rle_start+8");
const pc_screen_asset pc_screen_assets[]={{"test",0,8}};const unsigned pc_screen_asset_count=1;
static uint16_t panel[320][240];static int pending,calls,overlay_calls;static bool timeout;
static esp_lcd_panel_io_callbacks_t callback;
void *heap_caps_malloc(size_t n,int flags){assert(n==4800&&flags==3);return malloc(n);}void heap_caps_free(void *p){free(p);}
SemaphoreHandle_t xSemaphoreCreateBinary(void){return &pending;}void vSemaphoreDelete(SemaphoreHandle_t s){(void)s;}
int xSemaphoreTake(SemaphoreHandle_t s,int ticks){(void)s;if(ticks&&timeout)return 0;int v=pending;pending=0;return v;}
void xSemaphoreGiveFromISR(SemaphoreHandle_t s,BaseType_t *wake){(void)s;pending=1;*wake=1;}
esp_err_t bsp_display_init(void){return ESP_OK;}void bsp_display_backlight(int v){assert(v==80);}void *bsp_display_io(void){return NULL;}void *bsp_display_panel(void){return NULL;}
esp_err_t esp_lcd_panel_io_register_event_callbacks(void *p,const esp_lcd_panel_io_callbacks_t *c,void *v){(void)p;(void)v;callback=*c;return ESP_OK;}
esp_err_t esp_lcd_panel_draw_bitmap(void *p,int left,int top,int right,int bottom,const void *raw){(void)p;assert(left==0&&right==240&&bottom>top&&bottom-top<=10);const uint16_t *s=raw;for(int y=top;y<bottom;y++)for(int x=0;x<240;x++){uint16_t a=*s++;panel[y][x]=(uint16_t)(a>>8|a<<8);}calls++;callback.on_color_trans_done(NULL,NULL,NULL);return ESP_OK;}
static void overlay(void *c,unsigned row,unsigned rows,uint16_t *pixels){(void)c;assert(row>=116&&row+rows<=212);pixels[0]=0xabcd;overlay_calls++;}
int main(void){
 assert(pc_panel_start()==ESP_OK);memset(panel,0xee,sizeof(panel));
 assert(pc_panel_present_region(pc_screen_assets,NULL,NULL,270,280)==ESP_OK&&calls==1);
 for(int y=0;y<320;y++)for(int x=0;x<240;x++)assert(panel[y][x]==(y<270||y>=280?0xeeee:y*240+x<65535?0x1234:0x5678));
 calls=0;assert(pc_panel_present_region(NULL,overlay,NULL,116,212)==ESP_OK&&calls==10&&overlay_calls==10);
 assert(panel[116][0]==0xabcd&&panel[116][1]==0&&panel[115][0]==0xeeee&&panel[212][0]==0xeeee);
 assert(pc_panel_present_region(NULL,NULL,NULL,12,12)==ESP_ERR_INVALID_ARG);assert(pc_panel_present_region(NULL,NULL,NULL,0,321)==ESP_ERR_INVALID_ARG);
 calls=0;assert(pc_panel_present(pc_screen_assets,NULL,NULL)==ESP_OK&&calls==32);assert(panel[273][14]==0x1234&&panel[273][15]==0x5678);
 pc_screen_asset invalid={"bad",0,7};assert(pc_panel_present(&invalid,NULL,NULL)==ESP_ERR_INVALID_ARG);
 timeout=true;assert(pc_panel_present_region(NULL,NULL,NULL,0,10)==ESP_ERR_TIMEOUT);int before=calls;assert(pc_panel_present(NULL,NULL,NULL)==ESP_ERR_INVALID_STATE&&calls==before);
 puts("Actual panel renderer: bounded DMA, RLE mid-run crop, partial-row limits, unchanged rows and timeout reuse guards PASS");
}
