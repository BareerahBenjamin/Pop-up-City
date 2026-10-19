#include "network_radio_scan.h"
#include "esp_event.h"
#include "esp_wifi.h"
#include "terminal_wifi.h"
#include <stdatomic.h>
#include <string.h>
static network_scan_list_t list;
static esp_event_handler_instance_t handler;
static atomic_bool completed;
static bool scanning;
static void scan_done(void *arg,esp_event_base_t base,int32_t event,void *data)
{
    (void)arg;(void)base;(void)event;(void)data;completed=true;
}
esp_err_t network_radio_scan_start(void)
{
    if(scanning)return ESP_ERR_INVALID_STATE;
    if(!handler) {
        esp_err_t e=esp_event_handler_instance_register(WIFI_EVENT,WIFI_EVENT_SCAN_DONE,scan_done,NULL,&handler);
        if(e!=ESP_OK)return e;
    }
    completed=false;network_scan_reset(&list);terminal_wifi_pause(true);
    wifi_scan_config_t config={.scan_type=WIFI_SCAN_TYPE_ACTIVE,.show_hidden=false};
    config.scan_time.active.max=120;
    esp_err_t e=esp_wifi_scan_start(&config,false);scanning=e==ESP_OK;return e;
}
bool network_radio_scan_tick(void)
{
    if(!scanning||!atomic_exchange(&completed,false))return false;
    scanning=false;uint16_t count=NETWORK_SCAN_MAX;wifi_ap_record_t records[NETWORK_SCAN_MAX]={0};
    if(esp_wifi_scan_get_ap_records(&count,records)==ESP_OK) {
        for(uint16_t i=0;i<count;i++) {
            unsigned security=2;
            switch(records[i].authmode) {
            case WIFI_AUTH_OPEN:security=0;break;
            case WIFI_AUTH_WPA_PSK:case WIFI_AUTH_WPA2_PSK:case WIFI_AUTH_WPA_WPA2_PSK:
            case WIFI_AUTH_WPA3_PSK:case WIFI_AUTH_WPA2_WPA3_PSK:security=1;break;
            default:break;
            }
            char ssid[33]={0};memcpy(ssid,records[i].ssid,32);
            (void)network_scan_add(&list,ssid,records[i].rssi,security);
        }
    }
    (void)esp_wifi_clear_ap_list();return true;
}
void network_radio_scan_stop(void)
{
    if(scanning)(void)esp_wifi_scan_stop();
    scanning=false;
    (void)esp_wifi_clear_ap_list();
    if(handler){esp_event_handler_instance_unregister(WIFI_EVENT,WIFI_EVENT_SCAN_DONE,handler);handler=NULL;}
    completed=false;
}
bool network_radio_scanning(void){return scanning;}
const network_scan_list_t *network_radio_scan_list(void){return &list;}
void network_radio_scan_move(int direction){network_scan_move(&list,direction);}
