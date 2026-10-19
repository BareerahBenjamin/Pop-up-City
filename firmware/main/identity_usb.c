#include "identity_setup.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include <stdio.h>
#include <string.h>
esp_err_t pc_identity_wait_usb(pc_store *store){
 if(!usb_serial_jtag_is_driver_installed()){
  usb_serial_jtag_driver_config_t config={.tx_buffer_size=2048,.rx_buffer_size=2048};
  esp_err_t result=usb_serial_jtag_driver_install(&config);if(result!=ESP_OK)return result;
  usb_serial_jtag_vfs_use_driver();
 }
 uint8_t mac[6],random[16];if(esp_read_mac(mac,ESP_MAC_WIFI_STA)!=ESP_OK)return ESP_FAIL;esp_fill_random(random,sizeof(random));
 char board[13],nonce[33];for(unsigned i=0;i<6;i++)snprintf(board+2*i,3,"%02x",mac[i]);for(unsigned i=0;i<16;i++)snprintf(nonce+2*i,3,"%02x",random[i]);
 char line[640];size_t used=0;bool overflow=false;int64_t announced=-3000000;
 for(;;){
  int64_t now=esp_timer_get_time();if(now-announced>=2000000){printf("\nPC_INIT_READY %s %s\n",nonce,board);fflush(stdout);announced=now;}
  uint8_t input[64];int count=usb_serial_jtag_read_bytes(input,sizeof(input),pdMS_TO_TICKS(100));
  for(int i=0;i<count;i++){
   if(input[i]=='\n'){
    line[used]=0;
    if(!overflow&&used>8&&!strncmp(line,"PC_INIT ",8)){
     pc_cloud_result result=pc_identity_apply(store,line+8,nonce,board);memset(line,0,sizeof(line));used=0;
     if(result==PC_CLOUD_OK){printf("\nPC_INIT_OK %s\n",store->data.device_id);fflush(stdout);return ESP_OK;}
     printf("\nPC_INIT_ERROR %u\n",(unsigned)result);fflush(stdout);
    }
    memset(line,0,sizeof(line));used=0;overflow=false;
   }else if(input[i]!='\r'){if(used+1<sizeof(line))line[used++]=(char)input[i];else overflow=true;}
  }
 }
}
