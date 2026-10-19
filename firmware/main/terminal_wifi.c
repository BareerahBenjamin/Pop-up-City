#include "terminal_wifi.h"

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_wifi_default.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

#include <string.h>
#include <stdatomic.h>

#define CONNECTED_BIT BIT0

static const char *TAG = "terminal_wifi";
static EventGroupHandle_t s_events;
static esp_netif_t *s_station;
static esp_event_handler_instance_t s_wifi_handler;
static esp_event_handler_instance_t s_ip_handler;
static esp_event_handler_instance_t s_lost_ip_handler;
static bool s_initialized;
static bool s_driver_initialized;
static atomic_bool s_reconnect = true;

static void startup_rollback(void)
{
    if (s_wifi_handler) {
        esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, s_wifi_handler);
        s_wifi_handler = NULL;
    }
    if (s_ip_handler) {
        esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, s_ip_handler);
        s_ip_handler = NULL;
    }
    if (s_lost_ip_handler) {
        esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_LOST_IP, s_lost_ip_handler);
        s_lost_ip_handler = NULL;
    }
    if (s_driver_initialized) {
        (void)esp_wifi_stop();
        (void)esp_wifi_deinit();
        s_driver_initialized = false;
    }
    if (s_station) { esp_netif_destroy_default_wifi(s_station); s_station = NULL; }
    if (s_events) { vEventGroupDelete(s_events); s_events = NULL; }
}

static void event_handler(void *arg, esp_event_base_t base, int32_t id,
                          void *data)
{
    (void)arg;
    (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        if (s_reconnect) (void)esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(s_events, CONNECTED_BIT);
        if (s_reconnect) (void)esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(s_events, CONNECTED_BIT);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_LOST_IP) {
        xEventGroupClearBits(s_events, CONNECTED_BIT);
    }
}

esp_err_t terminal_wifi_start(const char *ssid, const char *password)
{
    if (s_initialized) return ESP_OK;
    if (!ssid || !ssid[0] || strlen(ssid) > sizeof(((wifi_config_t *)0)->sta.ssid) ||
        !password || strlen(password) > sizeof(((wifi_config_t *)0)->sta.password)) {
        return ESP_ERR_INVALID_ARG;
    }
    s_events = xEventGroupCreate();
    if (!s_events) return ESP_ERR_NO_MEM;
    s_reconnect = true;

    esp_err_t error = esp_netif_init();
    if (error != ESP_OK && error != ESP_ERR_INVALID_STATE) goto fail;
    error = esp_event_loop_create_default();
    if (error != ESP_OK && error != ESP_ERR_INVALID_STATE) goto fail;

    esp_netif_config_t netif_config = ESP_NETIF_DEFAULT_WIFI_STA();
    s_station = esp_netif_new(&netif_config);
    if (!s_station) { error = ESP_ERR_NO_MEM; goto fail; }
    error = esp_netif_attach_wifi_station(s_station);
    if (error != ESP_OK) goto fail;
    error = esp_wifi_set_default_wifi_sta_handlers();
    if (error != ESP_OK) goto fail;

    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    error = esp_wifi_init(&init);
    if (error != ESP_OK) goto fail;
    s_driver_initialized = true;
    error = esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                                event_handler, NULL,
                                                &s_wifi_handler);
    if (error != ESP_OK) goto fail;
    error = esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                                event_handler, NULL,
                                                &s_ip_handler);
    if (error != ESP_OK) goto fail;
    error = esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_LOST_IP,
                                                event_handler, NULL,
                                                &s_lost_ip_handler);
    if (error != ESP_OK) goto fail;

    wifi_config_t config = {0};
    memcpy(config.sta.ssid, ssid, strlen(ssid));
    memcpy(config.sta.password, password, strlen(password));
    config.sta.threshold.authmode = password[0] ? WIFI_AUTH_WPA2_PSK :
                                                 WIFI_AUTH_OPEN;
    error = esp_wifi_set_storage(WIFI_STORAGE_RAM);
    if (error == ESP_OK) error = esp_wifi_set_mode(WIFI_MODE_STA);
    if (error == ESP_OK) error = esp_wifi_set_config(WIFI_IF_STA, &config);
    if (error == ESP_OK) error = esp_wifi_start();
    if (error != ESP_OK) goto fail;
    s_initialized = true;
    return ESP_OK;
fail:
    ESP_LOGE(TAG, "Wi-Fi startup failed: %s", esp_err_to_name(error));
    startup_rollback();
    return error;
}

bool terminal_wifi_wait_connected(uint32_t timeout_ms)
{
    if (!s_events) return false;
    EventBits_t bits = xEventGroupWaitBits(s_events, CONNECTED_BIT, pdFALSE,
                                           pdTRUE, pdMS_TO_TICKS(timeout_ms));
    return (bits & CONNECTED_BIT) != 0;
}

bool terminal_wifi_is_connected(void)
{
    return s_events && (xEventGroupGetBits(s_events) & CONNECTED_BIT) != 0;
}

void terminal_wifi_pause(bool pause)
{
    s_reconnect = !pause;
    if (pause && s_initialized) {
        xEventGroupClearBits(s_events, CONNECTED_BIT);
        (void)esp_wifi_disconnect();
    }
}

esp_err_t terminal_wifi_set_network(const char *ssid, const char *password)
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    if (!ssid || !*ssid || strlen(ssid)>32 || !password || strlen(password)>64)
        return ESP_ERR_INVALID_ARG;
    terminal_wifi_pause(true);
    wifi_config_t config = {0};
    memcpy(config.sta.ssid, ssid, strlen(ssid));
    memcpy(config.sta.password, password, strlen(password));
    config.sta.threshold.authmode = *password ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    esp_err_t error=esp_wifi_set_config(WIFI_IF_STA,&config);
    if (error==ESP_OK) {
        s_reconnect=true;
        error=esp_wifi_connect();
    }
    return error;
}
