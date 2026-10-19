#include "network_setup.h"
#include "network_profiles.h"
#include "network_blufi.h"
#include "network_radio_scan.h"
#include "terminal_wifi.h"
#include "esp_wifi.h"
#include "esp_sntp.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_heap_caps.h"
#include "app_services.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define ATTEMPT_MS 15000u
#define SETUP_ATTEMPT_MS 90000u
#define SETUP_TIMEOUT_MS 300000u
static network_profiles_t saved={.version=1};
static network_profile_t candidates[NETWORK_PROFILE_COUNT+1],current;
static size_t candidate_count,candidate_index,failed_candidates;
static bool network_started;
static bool have_record,testing,connected_saved,list_requested;
static atomic_bool active;
static uint32_t attempt_ms,setup_ms,complete_ms;
static QueueHandle_t commands;
static char screen[240];
static char origin[256]=CONFIG_PLANET_SERVER_ORIGIN;
typedef struct {network_setup_command_t operation;network_profile_t profile;} setup_command_t;
static uint32_t millis(void){return (uint32_t)(esp_timer_get_time()/1000);}
static bool store(const network_profiles_t *value)
{
    if(!app_save_networks(value))return false;
    saved=*value;have_record=true;return true;
}
static void rebuild_candidates(void)
{
    memset(candidates,0,sizeof(candidates));candidate_count=saved.count;candidate_index=0;
    for(size_t i=0;i<candidate_count;i++)candidates[i]=saved.profiles[i];
    /* A persisted empty record means the user explicitly forgot all networks. */
    if(!have_record && !candidate_count) {
        network_profile_t fallback={0};
        snprintf(fallback.ssid,sizeof(fallback.ssid),"%s",CONFIG_PLANET_WIFI_SSID);
        snprintf(fallback.password,sizeof(fallback.password),"%s",CONFIG_PLANET_WIFI_PASSWORD);
        if(network_profile_valid(&fallback))candidates[candidate_count++]=fallback;
    }
}
static bool at_current_network(void)
{
    wifi_ap_record_t ap={0};
    return terminal_wifi_is_connected()&&esp_wifi_sta_get_ap_info(&ap)==ESP_OK&&
        !strncmp((const char *)ap.ssid,current.ssid,32);
}
static void reset_discovery(void)
{
    snprintf(origin,sizeof(origin),"%s",CONFIG_PLANET_SERVER_ORIGIN);
}
static void attempt(const network_profile_t *p,uint32_t now)
{
    current=*p;connected_saved=false;attempt_ms=now;reset_discovery();
    if(terminal_wifi_set_network(p->ssid,p->password)!=ESP_OK)ESP_LOGW("network_setup","Wi-Fi attempt could not start");
}
static bool persist_connected(void)
{
    network_profiles_t next=saved;if(!network_profiles_promote(&next,&current))return false;
    if(have_record&&!memcmp(&next,&saved,sizeof(next)))return true;
    return store(&next);
}
esp_err_t network_start(void)
{
    if(network_started)return ESP_OK;
    network_profiles_t loaded={.version=1};
    if(app_load_networks(&loaded)){saved=loaded;have_record=true;}
    memset(&loaded,0,sizeof(loaded));rebuild_candidates();
    if(candidate_count)current=candidates[0];else{strcpy(current.ssid,"setup-pending");current.password[0]=0;}
    if(!commands)commands=xQueueCreate(4,sizeof(setup_command_t));
    if(!commands)return ESP_ERR_NO_MEM;
    attempt_ms=millis();
    esp_err_t result=terminal_wifi_start(current.ssid,current.password);
    /* terminal_wifi_start initializes esp_netif/lwIP. SNTP calls into its
     * mailbox and must never run before that successful initialization. */
    if(result==ESP_OK&&!esp_sntp_enabled()){
        esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
        esp_sntp_setservername(0,"pool.ntp.org");
        esp_sntp_init();
    }
#ifdef CONFIG_PLANET_DIAGNOSTIC_WIFI_NO_PS
    if(result==ESP_OK)result=esp_wifi_set_ps(WIFI_PS_NONE);
    ESP_LOGI("network_setup","Diagnostic Wi-Fi power save disabled: %s",esp_err_to_name(result));
#endif
    if(result==ESP_OK)network_started=true;
    return result;
}

static void setup_prompt(void)
{
    snprintf(screen,sizeof(screen),"BLUETOOTH WI-FI\n\n%s\n\nOpen phone mini program\nSelect Wi-Fi / enter password\n\nSelect 2.4 GHz Wi-Fi on phone",network_blufi_name());
}
esp_err_t network_setup_begin(void)
{
    if(active)return ESP_ERR_INVALID_STATE;
    terminal_wifi_pause(true);reset_discovery();
    xQueueReset(commands);testing=false;complete_ms=0;connected_saved=false;list_requested=false;
    active=true;setup_ms=millis();setup_prompt();
    esp_err_t e=network_blufi_begin();
    if(e!=ESP_OK){network_blufi_end();active=false;rebuild_candidates();if(candidate_count)attempt(&candidates[0],millis());return e;}
    (void)network_radio_scan_start();
    ESP_LOGI("network_setup","BLUFI setup active; free heap %u; largest block %u",(unsigned)esp_get_free_heap_size(),
        (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
    return ESP_OK;
}
void network_setup_end(void)
{
    bool keep=active&&connected_saved&&at_current_network();active=false;
    network_blufi_end();network_radio_scan_stop();xQueueReset(commands);
    testing=false;complete_ms=0;list_requested=false;rebuild_candidates();
    if(!keep){if(candidate_count)attempt(&candidates[0],millis());else terminal_wifi_pause(true);}
    else reset_discovery();
}
bool network_setup_queue(network_setup_command_t operation,const network_profile_t *profile)
{
    if(!active||!commands||operation>NETWORK_SETUP_FORGET)return false;
    setup_command_t command={.operation=operation};
    if(operation==NETWORK_SETUP_CONNECT){if(!network_profile_valid(profile))return false;command.profile=*profile;}
    bool ok=xQueueSend(commands,&command,0)==pdTRUE;memset(&command,0,sizeof(command));return ok;
}
bool network_setup_forget(void)
{
    if(!active)return false;
    network_profiles_t empty={.version=1};if(!store(&empty))return false;
    terminal_wifi_pause(true);testing=false;connected_saved=false;complete_ms=0;
    snprintf(screen,sizeof(screen),"Saved Wi-Fi cleared\n\n%s\n\nChoose network on phone\nRetry on phone",network_blufi_name());
    return true;
}
void network_tick(uint32_t now)
{
    if(active) {
        if(network_elapsed(now,setup_ms,SETUP_TIMEOUT_MS)||(complete_ms&&network_elapsed(now,complete_ms,3000))){network_setup_end();return;}
        if(network_radio_scan_tick()&&list_requested){network_blufi_list(network_radio_scan_list());list_requested=false;}
        setup_command_t command={0};
        while(xQueueReceive(commands,&command,0)==pdTRUE){
            switch(command.operation){
            case NETWORK_SETUP_CONNECT:
                network_radio_scan_stop();attempt(&command.profile,now);testing=true;complete_ms=0;
                snprintf(screen,sizeof(screen),"Connecting Wi-Fi...\n\nKeep hotspot enabled\nUp to 90 seconds\n\nKeep device powered on");
                network_blufi_report(&current,false,true);break;
            case NETWORK_SETUP_SCAN:
                if(testing||connected_saved){network_blufi_list(network_radio_scan_list());break;}
                list_requested=true;
                if(!network_radio_scanning()&&network_radio_scan_start()!=ESP_OK){list_requested=false;}
                break;
            case NETWORK_SETUP_STATUS:network_blufi_report(&current,at_current_network(),testing);break;
            case NETWORK_SETUP_DISCONNECT:terminal_wifi_pause(true);testing=false;connected_saved=false;complete_ms=0;setup_prompt();break;
            case NETWORK_SETUP_FORGET:(void)network_setup_forget();break;
            }
            memset(&command,0,sizeof(command));
        }
        if(testing&&at_current_network()){
            connected_saved=persist_connected();testing=false;
            network_blufi_report(&current,true,false);
            snprintf(screen,sizeof(screen),"%s\n\nConnection ready",connected_saved?"Wi-Fi saved":"Connected / save failed");
            if(connected_saved)complete_ms=now;
            ESP_LOGI("network_setup","Wi-Fi verified; saved %d; free heap %u",connected_saved,(unsigned)esp_get_free_heap_size());
        }else if(testing&&network_elapsed(now,attempt_ms,SETUP_ATTEMPT_MS)){
            terminal_wifi_pause(true);testing=false;connected_saved=false;network_blufi_report(&current,false,false);
            snprintf(screen,sizeof(screen),"Wi-Fi failed\nOld networks kept\n\nRetry on phone\nCheck 2.4 GHz / password\nRetry on phone");
        }
        return;
    }
    if(at_current_network()){
        failed_candidates=0;
        if(!connected_saved)connected_saved=persist_connected();
        return;
    }
    reset_discovery();
    connected_saved=false;
    if(candidate_count&&network_elapsed(now,attempt_ms,ATTEMPT_MS)){if(failed_candidates<candidate_count)failed_candidates++;candidate_index=(candidate_index+1)%candidate_count;attempt(&candidates[candidate_index],now);}
}
bool network_setup_active(void){return active;}
const char *network_setup_screen(void){return screen;}
const char *network_origin(void){return origin;}
bool network_ready(void){return !active&&at_current_network();}

const char *network_setup_summary(void)
{
    static char summary[160];
    if(active){
        if(testing)return "Testing connection...\nPlease wait";
        if(connected_saved)return "Connected / saved\nFinishing phone pairing";
        snprintf(summary,sizeof(summary),"Pair phone with:\n%s",network_blufi_name());
        return summary;
    }
    /* Keep the same two rows before and after connecting; only status changes. */
    if(at_current_network())return "Connected\nUP: configure connection";
    return candidate_count?"Connecting...\nUP: configure connection":"Not connected\nUP: configure connection";
}

bool network_reconnecting_saved(void){return !active&&candidate_count&&failed_candidates<candidate_count;}
