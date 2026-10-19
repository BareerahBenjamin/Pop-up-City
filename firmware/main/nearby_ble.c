#include "nearby_ble.h"
#include "nearby_radio_policy.h"
#include "network_blufi.h"
#include "esp_blufi.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "host/ble_gap.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "services/gap/ble_svc_gap.h"
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>

static QueueHandle_t sightings;
static TaskHandle_t host_task_handle;
static volatile bool synced;
static uint8_t address_type;
static atomic_bool provisioning;
static atomic_bool provisioning_connected;
static atomic_uint provisioning_handle;
static int provision_advertise(void);
static int provision_gap(struct ble_gap_event *event,void *arg)
{
    (void)arg;
    if(event->type==BLE_GAP_EVENT_CONNECT&&event->connect.status==0){
        provisioning_connected=true;provisioning_handle=event->connect.conn_handle;
        if(!provisioning){(void)ble_gap_terminate(event->connect.conn_handle,BLE_ERR_REM_USER_CONN_TERM);return 0;}
    }
    if(network_blufi_transport_running()&&(event->type==BLE_GAP_EVENT_CONNECT||event->type==BLE_GAP_EVENT_DISCONNECT||event->type==BLE_GAP_EVENT_MTU))
        (void)esp_blufi_handle_gap_events(event,NULL);
    if(event->type==BLE_GAP_EVENT_DISCONNECT)provisioning_connected=false;
    if(provisioning&&!provisioning_connected&&(event->type==BLE_GAP_EVENT_DISCONNECT||event->type==BLE_GAP_EVENT_ADV_COMPLETE||
       (event->type==BLE_GAP_EVENT_CONNECT&&event->connect.status!=0))) (void)provision_advertise();
    return 0;
}
static int provision_advertise(void)
{
    if(!provisioning||provisioning_connected||ble_gap_adv_active())return 0;
    ble_uuid16_t service=BLE_UUID16_INIT(BLUFI_APP_UUID);
    const char *name=ble_svc_gap_device_name();
    struct ble_hs_adv_fields fields={.flags=BLE_HS_ADV_F_DISC_GEN|BLE_HS_ADV_F_BREDR_UNSUP,
        .name=(uint8_t *)name,.name_len=strlen(name),.name_is_complete=1,
        .uuids16=&service,.num_uuids16=1,.uuids16_is_complete=1};
    int rc=ble_gap_adv_set_fields(&fields);if(rc)return rc;
    struct ble_gap_adv_params params={.conn_mode=BLE_GAP_CONN_MODE_UND,.disc_mode=BLE_GAP_DISC_MODE_GEN,
        .itvl_min=160,.itvl_max=240};
    return ble_gap_adv_start(address_type,NULL,BLE_HS_FOREVER,&params,provision_gap,NULL);
}

static int gap_event(struct ble_gap_event *event, void *arg)
{
    (void)arg;
    if(event->type != BLE_GAP_EVENT_DISC) return 0;
    const uint8_t *data=event->disc.data;
    size_t length=event->disc.length_data;
    /* Laboratory manufacturer marker 0xffff; skip unrelated AD fields safely. */
    for(size_t offset=0;offset<length;) {
        size_t field=data[offset];
        if(!field||offset+field+1>length) break;
        if(field==29&&data[offset+1]==0xff&&data[offset+2]==0xff&&data[offset+3]==0xff) {
            const uint8_t *p=data+offset;
            nearby_participant_t sighting={.occupied=true,.rssi=event->disc.rssi,
                .seen_ms=(uint32_t)(esp_timer_get_time()/1000)};
            memcpy(sighting.device_id,p+4,16);
            for(size_t i=0;i<4;++i)sighting.presence_epoch=(sighting.presence_epoch<<8)|p[20+i];
            for(size_t i=0;i<6;++i)snprintf(sighting.presence_tag+2*i,3,"%02x",p[24+i]);
            (void)xQueueSend(sightings,&sighting,0);
        }
        offset+=field+1;
    }
    return 0;
}
static void on_sync(void)
{
    if(ble_hs_util_ensure_addr(0)==0&&ble_hs_id_infer_auto(0,&address_type)==0){synced=true;network_blufi_radio_sync();}
}
static void on_reset(int reason)
{
    (void)reason; synced=false;
}
static void run_host(void *arg)
{
    (void)arg;nimble_port_run();
    for(;;)vTaskSuspend(NULL);
}
esp_err_t nearby_ble_init(void)
{
    if(host_task_handle)return ESP_ERR_INVALID_STATE;
    /* ESP32-C3 controller initialization needs a contiguous DMA allocation
     * before its internal startup task can safely run. Reserve it before UI,
     * planet and Wi-Fi allocations, rather than entering the ROM on low RAM. */
    if(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_DMA)<40u*1024u)
        return ESP_ERR_NO_MEM;
    sightings=xQueueCreate(32,sizeof(nearby_participant_t));
    if(!sightings)return ESP_ERR_NO_MEM;
    esp_err_t error=nimble_port_init();
    if(error!=ESP_OK){vQueueDelete(sightings);sightings=NULL;return error;}
    error=network_blufi_radio_init();
    if(error!=ESP_OK){(void)nimble_port_deinit();vQueueDelete(sightings);sightings=NULL;return error;}
    ble_hs_cfg.sync_cb=on_sync;ble_hs_cfg.reset_cb=on_reset;
    if(xTaskCreatePinnedToCore(run_host,"nearby_ble",NIMBLE_HS_STACK_SIZE,NULL,
        configMAX_PRIORITIES-4,&host_task_handle,NIMBLE_CORE)!=pdPASS) {
        (void)nimble_port_deinit();vQueueDelete(sightings);sightings=NULL;return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}
esp_err_t nearby_ble_update(const uint8_t advertisement[30],bool scan)
{
    if(!synced||provisioning)return ESP_ERR_INVALID_STATE;
    if(ble_gap_adv_active()&&ble_gap_adv_stop()!=0)return ESP_FAIL;
    if(!scan&&ble_gap_disc_active()&&ble_gap_disc_cancel()!=0)return ESP_FAIL;
#ifdef CONFIG_PLANET_DIAGNOSTIC_PEER_RADIO_OFF
    if(ble_gap_disc_active())(void)ble_gap_disc_cancel();
    /* Keep host/controller allocations unchanged for an RF activity comparison. */
    (void)advertisement;(void)scan;return ESP_OK;
#endif
    if(advertisement) {
        if(ble_gap_adv_set_data(advertisement,30)!=0)return ESP_FAIL;
        struct ble_gap_adv_params params={.conn_mode=BLE_GAP_CONN_MODE_NON,
            .disc_mode=BLE_GAP_DISC_MODE_NON,
            .itvl_min=scan?NEARBY_ADV_SCAN_MIN:NEARBY_ADV_IDLE_MIN,
            .itvl_max=scan?NEARBY_ADV_SCAN_MAX:NEARBY_ADV_IDLE_MAX};
        if(ble_gap_adv_start(address_type,NULL,6000,&params,gap_event,NULL)!=0)return ESP_FAIL;
    }
    if(scan&&!ble_gap_disc_active()) {
        struct ble_gap_disc_params params={.passive=1,.itvl=NEARBY_SCAN_INTERVAL,.window=NEARBY_SCAN_WINDOW,.filter_duplicates=0};
        if(ble_gap_disc(address_type,BLE_HS_FOREVER,&params,gap_event,NULL)!=0)return ESP_FAIL;
    }
    return ESP_OK;
}
bool nearby_ble_receive(nearby_participant_t *observation)
{
    return sightings&&observation&&xQueueReceive(sightings,observation,0)==pdTRUE;
}
esp_err_t nearby_ble_provisioning(bool enabled,const char *name)
{
    if(!synced)return ESP_ERR_INVALID_STATE;
    provisioning=enabled;
    if(ble_gap_disc_active())(void)ble_gap_disc_cancel();
    if(ble_gap_adv_active())(void)ble_gap_adv_stop();
    if(!enabled){if(provisioning_connected)(void)ble_gap_terminate(provisioning_handle,BLE_ERR_REM_USER_CONN_TERM);return ESP_OK;}
    if(!name||ble_svc_gap_device_name_set(name)!=0)return ESP_ERR_INVALID_ARG;
    return provision_advertise()==0?ESP_OK:ESP_FAIL;
}

bool nearby_ble_phone_connected(void){return provisioning_connected;}
