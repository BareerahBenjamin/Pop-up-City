#include "display_status.h"
#include "bsp_battery.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdatomic.h>
static atomic_int battery = -1;
static void poll(void *unused){
 (void)unused;
 if(bsp_battery_init()!=ESP_OK){vTaskDelete(NULL);return;}
 for(;;){atomic_store(&battery,bsp_battery_soc());vTaskDelay(pdMS_TO_TICKS(5000));}
}
esp_err_t pc_display_status_start(void){return xTaskCreate(poll,"battery",3072,NULL,2,NULL)==pdPASS?ESP_OK:ESP_ERR_NO_MEM;}
int pc_display_battery(void){return atomic_load(&battery);}
