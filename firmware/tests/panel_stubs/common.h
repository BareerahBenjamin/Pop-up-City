#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "esp_err.h"
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_TIMEOUT 0x107
#define BSP_LCD_W 240
#define BSP_LCD_H 320
#define MALLOC_CAP_DMA 1
#define MALLOC_CAP_INTERNAL 2
#define pdFALSE 0
#define pdTRUE 1
#define pdMS_TO_TICKS(n) (n)
typedef int BaseType_t;
typedef void *SemaphoreHandle_t;
typedef void *esp_lcd_panel_io_handle_t;
typedef struct {int unused;} esp_lcd_panel_io_event_data_t;
typedef struct {bool (*on_color_trans_done)(esp_lcd_panel_io_handle_t,esp_lcd_panel_io_event_data_t *,void *);} esp_lcd_panel_io_callbacks_t;
void *heap_caps_malloc(size_t,int);void heap_caps_free(void *);
SemaphoreHandle_t xSemaphoreCreateBinary(void);void vSemaphoreDelete(SemaphoreHandle_t);
int xSemaphoreTake(SemaphoreHandle_t,int);void xSemaphoreGiveFromISR(SemaphoreHandle_t,BaseType_t *);
esp_err_t bsp_display_init(void);void bsp_display_backlight(int);void *bsp_display_io(void);void *bsp_display_panel(void);
esp_err_t esp_lcd_panel_io_register_event_callbacks(void *,const esp_lcd_panel_io_callbacks_t *,void *);
esp_err_t esp_lcd_panel_draw_bitmap(void *,int,int,int,int,const void *);
