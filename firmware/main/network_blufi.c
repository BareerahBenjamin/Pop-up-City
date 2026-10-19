#include "device_identity.h"
/* BLUFI transport for the application's existing NimBLE host, ESP-IDF 5.5.3.
 * Protocol/security reference: FoloToy demo/blufi-provisioning commit
 * 9c039cc5127f22072afa83bedb7fa3d8efe635ad. No demo UI is reused. */
#include "network_blufi.h"
#include "network_setup.h"
#include "blufi_input.h"
#include "blufi_security.h"
#include "nearby_ble.h"
#include "esp_blufi.h"
#include "esp_blufi_api.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "host/ble_gatt.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
/* Version-pinned SDK entries. The checked bootstrap avoids the SDK helper's
 * assert on allocation failure; the receive entry feeds the standard protocol. */
extern int btc_init(void);
extern void btc_blufi_recv_handler(uint8_t *data,int len);
static atomic_bool accepting,connected,profile_ready,profile_stopped,radio_ready,btc_running;
static blufi_input_t input;
static char device_name[24];
static int access(uint16_t connection,uint16_t attribute,struct ble_gatt_access_ctxt *context,void *arg)
{
    (void)connection;(void)attribute;(void)arg;
    if(!accepting)return BLE_ATT_ERR_INSUFFICIENT_AUTHOR;
    if(context->op==BLE_GATT_ACCESS_OP_READ_CHR)return 0;
    if(context->op!=BLE_GATT_ACCESS_OP_WRITE_CHR)return BLE_ATT_ERR_UNLIKELY;
    size_t length=OS_MBUF_PKTLEN(context->om);
    if(length<4||length>512)return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    uint8_t packet[512];uint16_t copied=0;
    if(ble_hs_mbuf_to_flat(context->om,packet,sizeof(packet),&copied)!=0)return BLE_ATT_ERR_INSUFFICIENT_RES;
    btc_blufi_recv_handler(packet,copied);memset(packet,0,sizeof(packet));return 0;
}
/* Use bounded writes directly, avoiding the SDK example's one-byte value
 * buffer and its unchecked 517-byte allocation for chained incoming mbufs. */
static const struct ble_gatt_svc_def services[]={
 {.type=BLE_GATT_SVC_TYPE_PRIMARY,.uuid=BLE_UUID16_DECLARE(0xffff),
  .characteristics=(struct ble_gatt_chr_def[]){
   {.uuid=BLE_UUID16_DECLARE(0xff01),.access_cb=access,.flags=BLE_GATT_CHR_F_WRITE},
   {.uuid=BLE_UUID16_DECLARE(0xff02),.access_cb=access,.flags=BLE_GATT_CHR_F_READ|BLE_GATT_CHR_F_NOTIFY,
    .val_handle=&gatt_values[1].val_handle},{0}}},{0}};
static void queue_command(network_setup_command_t command,const network_profile_t *profile)
{
    if(!network_setup_queue(command,profile))esp_blufi_send_error_info(ESP_BLUFI_DATA_FORMAT_ERROR);
}
static void event(esp_blufi_cb_event_t event,esp_blufi_cb_param_t *param)
{
    if(event==ESP_BLUFI_EVENT_INIT_FINISH){profile_ready=param->init_finish.state==ESP_BLUFI_INIT_OK;return;}
    if(event==ESP_BLUFI_EVENT_DEINIT_FINISH){profile_ready=false;profile_stopped=true;return;}
    if(event==ESP_BLUFI_EVENT_BLE_DISCONNECT){
        passport_blufi_security_deinit();blufi_input_reset(&input);connected=false;return;
    }
    if(!accepting)return;
    switch(event){
    case ESP_BLUFI_EVENT_BLE_CONNECT:
        blufi_input_reset(&input);
        if(passport_blufi_security_init()!=0){esp_blufi_disconnect();return;}
        connected=true;ESP_LOGI("network_blufi","Phone connected; free heap %u",(unsigned)esp_get_free_heap_size());break;
    case ESP_BLUFI_EVENT_RECV_STA_SSID:
        if(!blufi_input_ssid(&input,param->sta_ssid.ssid,param->sta_ssid.ssid_len))esp_blufi_send_error_info(ESP_BLUFI_DATA_FORMAT_ERROR);
        break;
    case ESP_BLUFI_EVENT_RECV_STA_PASSWD:
        if(!blufi_input_password(&input,param->sta_passwd.passwd,param->sta_passwd.passwd_len))esp_blufi_send_error_info(ESP_BLUFI_DATA_FORMAT_ERROR);
        break;
    case ESP_BLUFI_EVENT_REQ_CONNECT_TO_AP:
        if(!blufi_input_ready(&input)||!passport_blufi_security_ready())esp_blufi_send_error_info(ESP_BLUFI_INIT_SECURITY_ERROR);
        else queue_command(NETWORK_SETUP_CONNECT,&input.profile);
        break;
    case ESP_BLUFI_EVENT_GET_WIFI_LIST:queue_command(NETWORK_SETUP_SCAN,NULL);break;
    case ESP_BLUFI_EVENT_GET_WIFI_STATUS:queue_command(NETWORK_SETUP_STATUS,NULL);break;
    case ESP_BLUFI_EVENT_REQ_DISCONNECT_FROM_AP:queue_command(NETWORK_SETUP_DISCONNECT,NULL);break;
    case ESP_BLUFI_EVENT_DEAUTHENTICATE_STA:queue_command(NETWORK_SETUP_FORGET,NULL);break;
    case ESP_BLUFI_EVENT_RECV_SLAVE_DISCONNECT_BLE:esp_blufi_disconnect();break;
    default:break;
    }
}
static esp_blufi_callbacks_t callbacks={.event_cb=event,.negotiate_data_handler=passport_blufi_negotiate,
 .encrypt_func=passport_blufi_encrypt,.decrypt_func=passport_blufi_decrypt,.checksum_func=passport_blufi_checksum};
esp_err_t network_blufi_radio_init(void)
{
    if(!passport_blufi_security_prepare())return ESP_ERR_NO_MEM;
    snprintf(device_name,sizeof(device_name),"BLUFI_HS_%.8s",identity_device_id());
    esp_err_t e=esp_blufi_register_callbacks(&callbacks);if(e!=ESP_OK)return e;
    ble_svc_gap_init();ble_svc_gatt_init();
    if(ble_gatts_count_cfg(services)!=0||ble_gatts_add_svcs(services)!=0)return ESP_FAIL;
    if(ble_svc_gap_device_name_set(device_name)!=0)return ESP_FAIL;
    return ESP_OK;
}
void network_blufi_radio_sync(void){radio_ready=true;}
bool network_blufi_transport_running(void){return btc_running;}
esp_err_t network_blufi_begin(void)
{
    if(!radio_ready)return ESP_ERR_INVALID_STATE;
    if(!btc_running){
        if(btc_init()!=0){esp_blufi_btc_deinit();return ESP_ERR_NO_MEM;}
        btc_running=true;profile_ready=false;profile_stopped=false;
        if(esp_blufi_profile_init()!=ESP_OK)return ESP_FAIL;
        for(unsigned i=0;!profile_ready&&i<100;i++)vTaskDelay(pdMS_TO_TICKS(10));
        if(!profile_ready)return ESP_ERR_TIMEOUT;
    }
    accepting=true;
    esp_err_t e=nearby_ble_provisioning(true,device_name);
    if(e!=ESP_OK)accepting=false;
    return e;
}
void network_blufi_end(void)
{
    accepting=false;(void)nearby_ble_provisioning(false,NULL);
    if(!btc_running)return;
    /* GAP queues disconnect before clearing its physical-connected flag.
     * BTC then owns/frees crypto. Do not delete a live callback's context. */
    for(unsigned i=0;(connected||nearby_ble_phone_connected())&&i<100;i++)vTaskDelay(pdMS_TO_TICKS(20));
    if(connected||nearby_ble_phone_connected()){
        ESP_LOGW("network_blufi","Phone disconnect pending; retain transport safely");return;
    }
    profile_stopped=false;
    if(esp_blufi_profile_deinit()!=ESP_OK)return;
    for(unsigned i=0;!profile_stopped&&i<100;i++)vTaskDelay(pdMS_TO_TICKS(10));
    if(!profile_stopped){ESP_LOGW("network_blufi","Profile stop pending; retain transport safely");return;}
    /* IDF's osi_thread_free joins the worker before freeing stack/queues. */
    esp_blufi_btc_deinit();btc_running=false;
    passport_blufi_security_deinit();
    ESP_LOGI("network_blufi","Provisioning worker released; free heap %u",(unsigned)esp_get_free_heap_size());
}
bool network_blufi_connected(void){return connected;}
const char *network_blufi_name(void){return device_name;}
void network_blufi_report(const network_profile_t *profile,bool ok,bool connecting)
{
    if(!connected)return;
    esp_blufi_extra_info_t extra={0};
    if(profile){extra.sta_ssid=(uint8_t *)profile->ssid;extra.sta_ssid_len=strlen(profile->ssid);}
    esp_blufi_send_wifi_conn_report(WIFI_MODE_STA,ok?ESP_BLUFI_STA_CONN_SUCCESS:connecting?ESP_BLUFI_STA_CONNECTING:ESP_BLUFI_STA_CONN_FAIL,0,&extra);
}
void network_blufi_list(const network_scan_list_t *list)
{
    if(!connected||!list)return;
    esp_blufi_ap_record_t records[NETWORK_SCAN_MAX]={0};
    for(size_t i=0;i<list->count;i++){records[i].rssi=list->rows[i].rssi;memcpy(records[i].ssid,list->rows[i].ssid,32);}
    esp_blufi_send_wifi_list(list->count,records);
}
