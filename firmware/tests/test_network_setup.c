/* Exercise the real network_setup.c orchestration, with SDK radio/storage boundaries replaced.
 * This validates control flow, not RF, NVS physical power loss or phone compatibility. */
#include "network_setup.h"
#include "network_blufi.h"
#include "terminal_wifi.h"
#include "network_radio_scan.h"
#include "app_services.h"
#include "freertos/queue.h"
#include "esp_wifi.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
static uint32_t now;
static network_profiles_t disk={.version=1};
static bool have_disk,write_ok=true,bt,scanning;
static unsigned writes,sets,begins,ends,reports;
static network_profile_t target;
static pc_wifi_status link;
static unsigned qcount,qunit,qcap;
static unsigned char queue[4096];
QueueHandle_t xQueueCreate(unsigned n,size_t size){assert(n*size<=sizeof(queue));qcap=n;qunit=(unsigned)size;return queue;}
int xQueueReset(QueueHandle_t q){(void)q;memset(queue,0,sizeof(queue));qcount=0;return 1;}
int xQueueSend(QueueHandle_t q,const void *v,unsigned wait){(void)q;(void)wait;if(qcount==qcap)return 0;memcpy(queue+qcount++*qunit,v,qunit);return 1;}
int xQueueReceive(QueueHandle_t q,void *v,unsigned wait){(void)q;(void)wait;if(!qcount)return 0;memcpy(v,queue,qunit);memmove(queue,queue+qunit,--qcount*qunit);memset(queue+qcount*qunit,0,qunit);return 1;}
int64_t esp_timer_get_time(void){return (int64_t)now*1000;}
bool app_load_networks(network_profiles_t *p){if(!have_disk)return false;*p=disk;return true;}
bool app_save_networks(const network_profiles_t *p){writes++;if(!write_ok)return false;disk=*p;have_disk=true;return true;}
esp_err_t terminal_wifi_start(const char *ssid,const char *password){snprintf(target.ssid,sizeof(target.ssid),"%s",ssid);snprintf(target.password,sizeof(target.password),"%s",password);return ESP_OK;}
esp_err_t terminal_wifi_set_network(const char *ssid,const char *password){sets++;memset(&link,0,sizeof(link));return terminal_wifi_start(ssid,password);}
void terminal_wifi_pause(bool pause){if(pause)memset(&link,0,sizeof(link));}
bool terminal_wifi_is_connected(void){return link.has_ip;}
pc_wifi_status terminal_wifi_status(void){return link;}
esp_err_t esp_wifi_sta_get_ap_info(wifi_ap_record_t *ap){if(!link.associated)return ESP_FAIL;memcpy(ap->ssid,target.ssid,33);return ESP_OK;}
bool esp_sntp_enabled(void){return false;}
void esp_sntp_setoperatingmode(int n){(void)n;}
void esp_sntp_setservername(int n,const char *name){(void)n;assert(name[0]);}
void esp_sntp_init(void){}
esp_err_t network_blufi_begin(void){assert(!bt);bt=true;begins++;return ESP_OK;}
void network_blufi_end(void){bt=false;ends++;}
bool network_blufi_transport_running(void){return bt;}
const char *network_blufi_name(void){return "BLUFI_HS_testonly";}
void network_blufi_report(const network_profile_t *p,bool ok,bool connecting){(void)p;(void)connecting;if(ok){assert(have_disk&&write_ok);reports++;}}
void network_blufi_list(const network_scan_list_t *list){assert(list);}
esp_err_t network_radio_scan_start(void){scanning=true;return ESP_OK;}
void network_radio_scan_stop(void){scanning=false;}
bool network_radio_scanning(void){return scanning;}
bool network_radio_scan_tick(void){return false;}
const network_scan_list_t *network_radio_scan_list(void){static network_scan_list_t list;return &list;}
static void tick(uint32_t ms){now=ms;network_tick(ms);}
static network_profile_t profile(const char *ssid){network_profile_t p={.password="test-password"};snprintf(p.ssid,sizeof(p.ssid),"%s",ssid);return p;}
static void phone_connect(const char *ssid){network_profile_t p=profile(ssid);assert(network_setup_queue(NETWORK_SETUP_CONNECT,&p));tick(now);}
int main(int argc,char **argv){
 assert(argc==2);
 if(!strcmp(argv[1],"five")||!strcmp(argv[1],"save")||!strcmp(argv[1],"fallback")||!strcmp(argv[1],"same")){
  have_disk=true;disk.count=(!strcmp(argv[1],"save")||!strcmp(argv[1],"same"))?1:5;
  for(unsigned i=0;i<disk.count;i++){char name[20];snprintf(name,sizeof(name),"saved-%u",i);disk.profiles[i]=profile(name);}
 }
 if(!strcmp(argv[1],"same"))strcpy(disk.profiles[0].password,"old-password");
 assert(network_start()==ESP_OK);assert(network_start()==ESP_OK);
 if(!strcmp(argv[1],"five")){
  for(unsigned i=1;i<=5;i++)tick(i*15000);
  assert(sets==4&&network_status().phase==PC_WIFI_FAILED&&!network_reconnecting_saved());
  tick(900000);assert(sets==4&&writes==0&&disk.count==5);
 }else if(!strcmp(argv[1],"fallback")){
  tick(15000);assert(!strcmp(target.ssid,"saved-1"));
  link.associated=link.has_ip=true;tick(15050);assert(network_ready()&&writes==1&&!strcmp(disk.profiles[0].ssid,"saved-1")&&disk.count==5);
  link.has_ip=link.associated=false;tick(16000);assert(sets==2&&!network_ready());
 }else{
  if(!strcmp(argv[1],"save")||!strcmp(argv[1],"same")){link.associated=link.has_ip=true;tick(50);assert(network_ready());}
  else assert(!target.ssid[0]&&network_status().phase==PC_WIFI_IDLE&&!network_ready());
  assert(network_setup_begin()==ESP_OK);assert(network_setup_begin()==ESP_ERR_INVALID_STATE&&begins==1);
  if(!strcmp(argv[1],"session")){tick(300000);assert(!network_setup_active()&&!bt&&network_status().error==PC_WIFI_ERROR_SESSION_TIMEOUT);}
  else{
   phone_connect(!strcmp(argv[1],"same")?"saved-0":"new-router");network_profile_t other=profile("other-router");
   assert(!network_setup_queue(NETWORK_SETUP_CONNECT,&other));assert(!strcmp(target.ssid,!strcmp(argv[1],"same")?"saved-0":"new-router"));
   assert(!network_ready()&&network_status().phase==PC_WIFI_CONNECTING);
   if(!strcmp(argv[1],"auth")||!strcmp(argv[1],"same")){
    link.error=PC_WIFI_ERROR_AUTH;link.disconnect_reason=202;tick(now+500);
    assert(network_status().phase==PC_WIFI_FAILED&&network_status().error==PC_WIFI_ERROR_AUTH&&network_status().disconnect_reason==202&&writes==0);
    if(!strcmp(argv[1],"same"))assert(disk.count==1&&!strcmp(disk.profiles[0].password,"old-password"));
    network_setup_retry();assert(network_status().phase==PC_WIFI_PROVISIONING&&begins==1);
    assert(network_setup_queue(NETWORK_SETUP_CONNECT,&other));
   }else if(!strcmp(argv[1],"dhcp")){
    link.associated=true;tick(now+1000);assert(network_status().associated&&!network_status().has_ip);
    tick(now+89000);assert(network_status().phase==PC_WIFI_FAILED&&network_status().error==PC_WIFI_ERROR_DHCP_TIMEOUT&&writes==0);
   }else if(!strcmp(argv[1],"timeout")){
    tick(now+90000);assert(network_status().error==PC_WIFI_ERROR_CONNECT_TIMEOUT&&writes==0);
   }else if(!strcmp(argv[1],"save")){
    write_ok=false;link.associated=link.has_ip=true;tick(100);assert(network_status().phase==PC_WIFI_SAVE_FAILED&&!network_ready());
    for(unsigned t=101;t<1000;t++)tick(t);assert(writes==1);
    tick(1100);tick(3100);tick(10000);assert(writes==3&&!strcmp(disk.profiles[0].ssid,"saved-0"));
    write_ok=true;network_retry_save();tick(10001);assert(writes==4&&!network_ready()&&reports==1);
    tick(13001);assert(network_ready()&&!bt&&disk.count==2&&!strcmp(disk.profiles[0].ssid,"new-router"));
   }else{
    /* Phone can disappear after queuing; successful association still commits. */
    link.associated=link.has_ip=true;tick(100);assert(!network_ready()&&have_disk&&writes==1);
    tick(3100);assert(network_ready()&&!bt&&reports==1);
    link.has_ip=false;tick(3200);assert(!network_ready());
   }
  }
 }
 printf("Actual Wi-Fi orchestration %s: PASS\n",argv[1]);return 0;
}
