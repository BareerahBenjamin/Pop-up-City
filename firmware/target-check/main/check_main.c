/* Compile/link harness only. Not the product application and never a flash handoff. */
#include "personal_store.h"
#include "pop_city.h"
#include "cloud_idf.h"
#include "network_worker.h"
static esp_err_t (*volatile worker_link_check)(void)=pc_network_worker_start;
#include "esp_log.h"
void app_main(void)
{
    pc_state state;
    pc_store store;
    pc_init(&state,false,false);
    esp_err_t error=pc_store_load(&store);
    (void)worker_link_check; /* Retain/link Wi-Fi/BLE worker without starting it. */
    pc_cloud cloud;
    pc_cloud_bind_idf(&cloud,&store,&state);
    ESP_LOGI("component_check","Component harness only; storage load status: %d",(int)error);
    /* No save, network submission, rendering, registration or automatic reset. */
}
