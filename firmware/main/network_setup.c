#include "network_setup.h"
#include "network_blufi.h"
#include "network_radio_scan.h"
#include "terminal_wifi.h"
#include "esp_wifi.h"
#include "esp_sntp.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "app_services.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#define ATTEMPT_MS 15000u
#define SETUP_ATTEMPT_MS 90000u
#define SETUP_TIMEOUT_MS 300000u
static network_profiles_t saved={.version=1};
static network_profile_t candidates[NETWORK_PROFILE_COUNT],current;
static size_t candidate_count,candidate_index,failed_candidates;
static bool network_started,have_record,testing,connected_saved,list_requested,auto_exhausted;
static atomic_bool active,connect_pending;
static uint32_t attempt_ms,setup_ms,complete_ms,save_ms;
static unsigned save_attempts,radio_stop_attempts;
static uint32_t radio_stop_ms;
static bool completed;
static QueueHandle_t commands;
static char screen[240];
static pc_wifi_phase phase=PC_WIFI_IDLE;
static pc_wifi_error error;
static uint16_t last_reason;
typedef struct {network_setup_command_t operation;network_profile_t profile;} setup_command_t;
static uint32_t millis(void){return (uint32_t)(esp_timer_get_time()/1000);}
static bool store(const network_profiles_t *value)
{
    if(!app_save_networks(value))return false;
    saved=*value;have_record=true;return true;
}
static void rebuild_candidates(void)
{
    memset(candidates,0,sizeof(candidates));candidate_count=saved.count;candidate_index=failed_candidates=0;
    for(size_t i=0;i<candidate_count;i++)candidates[i]=saved.profiles[i];
    auto_exhausted=candidate_count==0;
}
static bool at_current_network(void)
{
    wifi_ap_record_t ap={0};
    return current.ssid[0]&&terminal_wifi_is_connected()&&esp_wifi_sta_get_ap_info(&ap)==ESP_OK&&
        !strncmp((const char *)ap.ssid,current.ssid,32);
}
static void attempt(const network_profile_t *p,uint32_t now)
{
    current=*p;connected_saved=false;attempt_ms=now;save_attempts=0;completed=false;
    phase=PC_WIFI_CONNECTING;error=PC_WIFI_ERROR_NONE;last_reason=0;
    snprintf(screen,sizeof(screen),"Connecting Wi-Fi");
    if(terminal_wifi_set_network(p->ssid,p->password)!=ESP_OK){error=PC_WIFI_ERROR_RADIO;}
}
static bool persist_connected(void)
{
    network_profiles_t next=saved;if(!network_profiles_promote(&next,&current))return false;
    if(have_record&&!memcmp(&next,&saved,sizeof(next)))return true;
    return store(&next);
}
static bool save_connected(uint32_t now)
{
    if(connected_saved)return true;
    if(save_attempts>=3)return false;
    if(save_attempts&&!network_elapsed(now,save_ms,1000u<<(save_attempts-1)))return false;
    save_attempts++;save_ms=now;
    if(persist_connected()){
        connected_saved=true;phase=PC_WIFI_SAVED;error=PC_WIFI_ERROR_NONE;
        return true;
    }
    phase=PC_WIFI_SAVE_FAILED;error=PC_WIFI_ERROR_STORAGE;
    return false;
}
esp_err_t network_start(void)
{
    if(network_started)return ESP_OK;
    network_profiles_t loaded={.version=1};
    if(app_load_networks(&loaded)){saved=loaded;have_record=true;}
    memset(&loaded,0,sizeof(loaded));rebuild_candidates();
    if(candidate_count)current=candidates[0];else memset(&current,0,sizeof(current));
    if(!commands)commands=xQueueCreate(4,sizeof(setup_command_t));
    if(!commands)return ESP_ERR_NO_MEM;
    attempt_ms=millis();phase=candidate_count?PC_WIFI_CONNECTING:PC_WIFI_IDLE;
    if(candidate_count)snprintf(screen,sizeof(screen),"Connecting Wi-Fi");
    /* Initialize an idle STA without inventing credentials or a fake SSID. */
    esp_err_t result=terminal_wifi_start(current.ssid,current.password);
    if(result==ESP_OK&&!esp_sntp_enabled()){
        esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
        esp_sntp_setservername(0,"pool.ntp.org");esp_sntp_init();
    }
#ifdef CONFIG_PLANET_DIAGNOSTIC_WIFI_NO_PS
    if(result==ESP_OK)result=esp_wifi_set_ps(WIFI_PS_NONE);
#endif
    if(result==ESP_OK)network_started=true;
    return result;
}
static void setup_prompt(void)
{
    phase=PC_WIFI_PROVISIONING;error=PC_WIFI_ERROR_NONE;
    /* Internal marker only, never a new display string or credential log. */
    screen[0]=0;
}
esp_err_t network_setup_begin(void)
{
    if(active)return ESP_ERR_INVALID_STATE;
    terminal_wifi_pause(true);
    xQueueReset(commands);testing=false;completed=false;connected_saved=false;list_requested=false;connect_pending=false;
    radio_stop_attempts=0;active=true;setup_ms=millis();setup_prompt();
    esp_err_t e=network_blufi_begin();
    if(e!=ESP_OK){network_blufi_end();active=false;rebuild_candidates();phase=PC_WIFI_FAILED;error=PC_WIFI_ERROR_RADIO;return e;}
    (void)network_radio_scan_start();
    ESP_LOGI("network_setup","BLUFI active; free=%u largest=%u",(unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT),
        (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
    return ESP_OK;
}
void network_setup_end(void)
{
    bool keep=active&&connected_saved&&at_current_network();active=false;
    network_blufi_end();radio_stop_attempts=1;radio_stop_ms=millis();network_radio_scan_stop();xQueueReset(commands);
    testing=false;completed=false;list_requested=false;connect_pending=false;rebuild_candidates();
    if(!keep){if(candidate_count)attempt(&candidates[0],millis());else{terminal_wifi_pause(true);phase=PC_WIFI_IDLE;}}
    else {phase=PC_WIFI_SAVED;error=PC_WIFI_ERROR_NONE;}
}
bool network_setup_queue(network_setup_command_t operation,const network_profile_t *profile)
{
    if(!active||!commands||operation>NETWORK_SETUP_FORGET)return false;
    setup_command_t command={.operation=operation};
    if(operation==NETWORK_SETUP_CONNECT){
        if(!network_profile_valid(profile)||atomic_exchange(&connect_pending,true))return false;
        command.profile=*profile;
    }
    bool ok=xQueueSend(commands,&command,0)==pdTRUE;
    if(!ok&&operation==NETWORK_SETUP_CONNECT)connect_pending=false;
    memset(&command,0,sizeof(command));return ok;
}
bool network_setup_forget(void)
{
    if(!active||connect_pending)return false;
    network_profiles_t empty={.version=1};if(!store(&empty))return false;
    terminal_wifi_pause(true);testing=false;connected_saved=false;completed=false;rebuild_candidates();
    setup_prompt();return true;
}
void network_retry_save(void)
{
    if(phase==PC_WIFI_SAVE_FAILED&&at_current_network()){save_attempts=0;save_ms=0;}
}
void network_setup_retry(void)
{
    if(phase==PC_WIFI_SAVE_FAILED){network_retry_save();return;}
    if(active&&phase==PC_WIFI_FAILED){setup_ms=millis();setup_prompt();}
}
static void fail_connection(pc_wifi_error reason)
{
    last_reason=terminal_wifi_status().disconnect_reason;
    terminal_wifi_pause(true);testing=false;connected_saved=false;connect_pending=false;completed=false;
    phase=PC_WIFI_FAILED;error=reason;network_blufi_report(&current,false,false);
    snprintf(screen,sizeof(screen),"Wi-Fi failed");
}
void network_tick(uint32_t now)
{
    if(active){
        if(completed&&network_elapsed(now,complete_ms,3000)){network_setup_end();return;}
        if(!completed&&network_elapsed(now,setup_ms,SETUP_TIMEOUT_MS)){
            /* A failed save never silently restores/discards the pending successful link. */
            if(phase==PC_WIFI_SAVE_FAILED){
                network_blufi_end();radio_stop_attempts=1;radio_stop_ms=millis();network_radio_scan_stop();xQueueReset(commands);
                active=false;connect_pending=false;auto_exhausted=true;return;
            }
            network_setup_end();phase=PC_WIFI_FAILED;error=PC_WIFI_ERROR_SESSION_TIMEOUT;return;
        }
        if(network_radio_scan_tick()&&list_requested){network_blufi_list(network_radio_scan_list());list_requested=false;}
        setup_command_t command={0};
        while(xQueueReceive(commands,&command,0)==pdTRUE){
            switch(command.operation){
            case NETWORK_SETUP_CONNECT:
                network_radio_scan_stop();attempt(&command.profile,now);testing=true;
                network_blufi_report(&current,false,true);break;
            case NETWORK_SETUP_SCAN:
                if(connect_pending){network_blufi_list(network_radio_scan_list());break;}
                list_requested=true;
                if(!network_radio_scanning()&&network_radio_scan_start()!=ESP_OK){list_requested=false;}
                break;
            case NETWORK_SETUP_STATUS:network_blufi_report(&current,connected_saved&&at_current_network(),testing);break;
            case NETWORK_SETUP_DISCONNECT:
                if(!connect_pending){terminal_wifi_pause(true);testing=false;connected_saved=false;completed=false;setup_prompt();}
                break;
            case NETWORK_SETUP_FORGET:(void)network_setup_forget();break;
            }
            memset(&command,0,sizeof(command));
        }
        if((testing||phase==PC_WIFI_SAVE_FAILED)&&at_current_network()){
            testing=false;
            unsigned before_attempts=save_attempts;
            if(save_connected(now)){
                if(!completed){
                    network_blufi_report(&current,true,false);
                    completed=true;complete_ms=now;snprintf(screen,sizeof(screen),"Wi-Fi saved");
                }
            }else if(save_attempts!=before_attempts)network_blufi_report(&current,false,false);
        }else if(testing){
            pc_wifi_status link=terminal_wifi_status();
            if(link.error!=PC_WIFI_ERROR_NONE&&network_elapsed(now,attempt_ms,500))fail_connection(link.error);
            else if(network_elapsed(now,attempt_ms,SETUP_ATTEMPT_MS))fail_connection(link.associated?PC_WIFI_ERROR_DHCP_TIMEOUT:PC_WIFI_ERROR_CONNECT_TIMEOUT);
        }
        return;
    }
    if(network_blufi_transport_running()&&radio_stop_attempts<3&&network_elapsed(now,radio_stop_ms,1000)){
        network_blufi_end();radio_stop_attempts++;radio_stop_ms=now;
    }
    if(at_current_network()){
        failed_candidates=0;
        (void)save_connected(now);
        return;
    }
    if(connected_saved){
        connected_saved=false;rebuild_candidates();
        if(candidate_count)attempt(&candidates[0],now);
    }
    if(auto_exhausted)return;
    pc_wifi_status link=terminal_wifi_status();
    if(candidate_count&&((link.error!=PC_WIFI_ERROR_NONE&&network_elapsed(now,attempt_ms,500))||network_elapsed(now,attempt_ms,ATTEMPT_MS))){
        pc_wifi_error reason=link.error!=PC_WIFI_ERROR_NONE?link.error:link.associated?PC_WIFI_ERROR_DHCP_TIMEOUT:PC_WIFI_ERROR_CONNECT_TIMEOUT;
        failed_candidates++;
        if(failed_candidates>=candidate_count){auto_exhausted=true;fail_connection(reason);return;}
        candidate_index=(candidate_index+1)%candidate_count;attempt(&candidates[candidate_index],now);
    }
}
bool network_setup_active(void){return active;}
const char *network_setup_screen(void){return screen;}
const char *network_origin(void){return CONFIG_PLANET_SERVER_ORIGIN;}
bool network_ready(void){return !active&&connected_saved&&at_current_network();}
const char *network_setup_summary(void)
{
    if(active)return testing?"Testing connection":"Phone provisioning";
    return network_ready()?"Connected":phase==PC_WIFI_FAILED?"Wi-Fi failed":"Not connected";
}
bool network_reconnecting_saved(void){return !active&&!auto_exhausted&&candidate_count>0;}
pc_wifi_status network_status(void)
{
    pc_wifi_status status=terminal_wifi_status();status.phase=phase;
    if(error!=PC_WIFI_ERROR_NONE)status.error=error;
    if(!status.disconnect_reason)status.disconnect_reason=last_reason;
    status.persisted=connected_saved;return status;
}
bool network_clock_ready(void)
{
    /* TLS retains full certificate time validation; no unverified HTTP time bootstrap. */
    return time(NULL)>=1704067200; /* 2024-01-01 UTC; RTC/SNTP, then signed server clock for business. */
}
