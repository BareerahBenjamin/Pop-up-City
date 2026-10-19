#include "network_worker.h"
#include "identity_setup.h"
#include "app_services.h"
#include "cloud_idf.h"
#include "network_setup.h"
#include "network_blufi.h"
#include "nearby_ble.h"
#include "terminal_wifi.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include <string.h>
#include <stdio.h>
static QueueHandle_t commands,views;static TaskHandle_t task;
static pc_store store;static pc_state state;static pc_cloud cloud;static pc_startup startup;
static pc_net_view view;static pc_batch_controller batch;static pc_single_controller single;static nearby_participants_t nearby;
static pc_friend_flow friendship;
static uint32_t candidate_at;static char proximity_activity[37];
static uint32_t millis(void){return (uint32_t)(esp_timer_get_time()/1000);}
static void publish(void){
 nearby_participant_t chosen;char chosen_id[37]={0};bool live=nearby_selected(&nearby,millis(),&chosen);if(live)pc_device_uuid(chosen.device_id,chosen_id);
 view.candidate_nearby=network_ready()&&state.host_active&&live&&!strcmp(chosen_id,view.candidate.device_id);
 view.candidate_valid=view.candidate_nearby&&(uint32_t)(millis()-candidate_at)<5000;
 view.nearby_count=state.host_active?(uint32_t)nearby_count(&nearby,millis()):0;
 snprintf(view.bluetooth_name,sizeof(view.bluetooth_name),"%s",network_blufi_name());
 snprintf(view.network_message,sizeof(view.network_message),"%s",network_setup_screen());
 snprintf(view.network_summary,sizeof(view.network_summary),"%s",network_setup_summary());
 memcpy(view.member_label_bitmap,startup.member_label_bitmap,sizeof(view.member_label_bitmap));view.member_label_bitmap_valid=startup.member_label_bitmap_valid;memcpy(view.active_title_bitmap,cloud.active_title_bitmap,sizeof(view.active_title_bitmap));view.active_title_valid=cloud.active_title_valid;
 view.personal=cloud.personal;view.friend_flow=friendship;
 view.friend_confirmed=!strcmp(store.data.device_id,friendship.session.device_a)?friendship.session.a_confirmed:friendship.session.b_confirmed;view.single_loaded=single.loaded;view.unresolved=state.unresolved;memcpy(view.active_activity_id,cloud.active_activity_id,37);
 view.batch.loaded=batch.loaded;view.batch.known=batch.known;view.batch.phase=batch.phase;view.batch.total=batch.total;view.batch.signed_count=batch.signed_count;view.batch.failed=batch.failed;view.batch.pending=batch.pending;view.batch.sequence=batch.sequence;
 view.wifi_ready=network_ready();if(!view.wifi_ready||!state.host_active||strcmp(view.roster.activity_id,cloud.active_activity_id))view.roster_valid=false;view.bound=state.bound;view.hello_skipped=store.data.hello_skipped;view.host_active=state.host_active;view.palette=store.data.palette;view.flow_page=state.page;view.flow_target=state.target;view.binding=startup.phase;
 memcpy(view.code,startup.claim_code,sizeof(view.code));memcpy(view.request_id,startup.request_id,37);memcpy(view.member_label,startup.member_label,sizeof(view.member_label));memcpy(view.member_hint,startup.member_hint,sizeof(view.member_hint));
 (void)xQueueOverwrite(views,&view);
}
static void uuid(char out[37]){uint8_t b[16];esp_fill_random(b,sizeof(b));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;static const char hex[]="0123456789abcdef";unsigned n=0;for(unsigned i=0;i<16;i++){if(i==4||i==6||i==8||i==10)out[n++]='-';out[n++]=hex[b[i]>>4];out[n++]=hex[b[i]&15];}out[n]=0;}
static void restore_friend(void){
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++){
  const pc_pending_operation *op=&store.data.pending[i];
  if(op->kind!=PC_PENDING_FRIEND||!pc_cloud_uuid(op->peer_device_id))continue;
  pc_friend_session session={0};strcpy(session.state,"waiting");
  strcpy(session.interaction_id,op->operation_id);strcpy(session.nonce,op->detail.pairing.nonce);strcpy(session.code,op->detail.pairing.code);session.occurred_at=op->occurred_at;
  bool own_first=strcmp(store.data.device_id,op->peer_device_id)<0;
  strcpy(session.device_a,own_first?store.data.device_id:op->peer_device_id);strcpy(session.device_b,own_first?op->peer_device_id:store.data.device_id);
  pc_friend_flow_update(&friendship,&session,millis());friendship.timed_out=true;state.unresolved=true;return;
 }
}
static void pulse(void *context,unsigned duration){(void)context;(void)duration;if(terminal_wifi_is_connected())view.pulse_sequence++;}
static void run(void *unused){
 (void)unused;view.service=PC_NET_STARTING;nearby_init(&nearby);esp_err_t result=pc_store_load(&store);
 if(result!=ESP_OK&&result!=ESP_ERR_NVS_NOT_FOUND){view.service=PC_NET_STORAGE_ERROR;goto stopped;}
 pc_init(&state,store.data.hello_skipped,store.data.member_id[0]!=0);app_services_bind(&store);
 if(!pc_cloud_uuid(store.data.device_id)||!store.data.device_token[0]||!pc_cloud_origin_valid(store.data.server_origin)){view.service=PC_NET_IDENTITY_REQUIRED;publish();if(pc_identity_wait_usb(&store)!=ESP_OK)goto stopped;}
 /* Default NVS is system-only. Failure never triggers erase or replacement of personal saves. */
 if(nvs_flash_init()!=ESP_OK){view.service=PC_NET_STORAGE_ERROR;goto stopped;}
 if(nearby_ble_init()!=ESP_OK||network_start()!=ESP_OK){view.service=PC_NET_RADIO_ERROR;goto stopped;}
 pc_cloud_bind_idf(&cloud,&store,&state);pc_startup_init(&startup,&cloud);pc_batch_init(&batch,&cloud);pc_single_init(&single,&cloud);restore_friend();view.service=PC_NET_READY;
 uint32_t status_at=0,runtime_at=0,feedback_at=0,batch_at=0,radio_at=0,single_at=0,friend_at=0;bool connected=false;
 for(;;){
  uint32_t now=millis();network_tick(now);
  if(!network_ready()){
   if(connected){pc_cloud_disconnect(&cloud,now);if(batch.loaded){batch.known=false;batch.phase=PC_BATCH_CHECKING;state.unresolved=true;}view.roster_valid=false;connected=false;}
   state.online=false;state.page=PC_WIFI;
   if(!network_setup_active()&&!network_reconnecting_saved())(void)network_setup_begin();
  }else{
   if(!connected){connected=true;status_at=runtime_at=feedback_at=batch_at=single_at=now-6000u;}
   if((uint32_t)(now-status_at)>=3000u){view.last_result=pc_startup_poll(&startup,now);status_at=millis();}
   if(state.bound&&(uint32_t)(now-runtime_at)>=5000u){view.last_result=pc_cloud_runtime(&cloud,now,single.loaded?store.data.pending[single.slot].activity_id:NULL);runtime_at=millis();
    if(view.last_result==PC_CLOUD_OK&&state.host_active){
     pc_cloud_result roster_result=pc_cloud_roster(&cloud,cloud.active_activity_id,view.roster_valid?view.roster.offset:0,&view.roster);
     view.roster_valid=roster_result==PC_CLOUD_OK;
    }
   }
   if(state.bound&&cloud.clock_known&&single.loaded&&(uint32_t)(now-single_at)>=2000u){
    nearby_participant_t peer,*found=NULL;const char *target=store.data.pending[single.slot].peer_device_id;
    for(unsigned i=0;i<NEARBY_CAPACITY;i++)if(nearby.entries[i].occupied&&(uint32_t)(millis()-nearby.entries[i].seen_ms)<NEARBY_TTL_MS){char id[37];pc_device_uuid(nearby.entries[i].device_id,id);if(!strcmp(id,target)){peer=nearby.entries[i];found=&peer;break;}}
    view.last_result=pc_single_recover(&single,found,millis());single_at=millis();
   }
   if(state.bound&&cloud.clock_known&&batch.loaded&&(!batch.known||batch.phase==PC_BATCH_WORKING||!state.host_active||strcmp(cloud.active_activity_id,batch.activity_id))&&(uint32_t)(now-batch_at)>=2000u){
    view.last_result=pc_batch_poll(&batch,millis());batch_at=millis();
    if(batch.known&&batch.phase!=PC_BATCH_WORKING&&(!state.host_active||strcmp(cloud.active_activity_id,batch.activity_id))){
     view.last_result=pc_batch_dismiss(&batch);
     if(view.last_result==PC_CLOUD_OK)pc_resolved(&state,PC_PLANET,millis());
     else {state.unresolved=true;state.page=PC_RECONCILE;}
    }
   }
   if(state.bound&&cloud.clock_known){
    if(!cloud.feedback.active){char session[37];uuid(session);view.last_result=pc_cloud_feedback_open(&cloud,session);}
    if(cloud.feedback.active&&(uint32_t)(now-feedback_at)>=2000u){view.last_result=pc_cloud_feedback_poll(&cloud,now,pulse,NULL);feedback_at=millis();if(view.last_result==PC_CLOUD_HTTP&&cloud.http_status==409)pc_feedback_disconnect(&cloud.feedback);}
   }
  }
  if(connected&&state.bound&&(uint32_t)(millis()-friend_at)>=700u){
   bool recovered=false;bool pending_friend=false;for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)pending_friend|=store.data.pending[i].kind==PC_PENDING_FRIEND;
   if(pending_friend){view.last_result=pc_friend_recover(&cloud,millis(),&recovered,&friendship.session);if(view.last_result==PC_CLOUD_OK){if(recovered)friendship.active=false;else{friendship.timed_out=true;state.page=PC_FRIEND_CODE;}recovered=true;}}
   if(friendship.active&&!recovered){
    pc_friend_session session;
    if(pending_friend){
     view.last_result=pc_friend_poll(&cloud,&session);
     if(view.last_result==PC_CLOUD_OK&&!session.interaction_id[0]){
      view.last_result=pc_friend_cancel(&cloud,&friendship.session,&session);
      if(view.last_result==PC_CLOUD_OK){if(!strcmp(session.state,"done")){friendship.session=session;pc_friend_saved(&state,millis());friendship.active=false;}else{friendship.timed_out=true;state.page=PC_FRIEND_CODE;}recovered=true;}
     }else if(view.last_result==PC_CLOUD_OK&&session.interaction_id[0]&&!strcmp(session.interaction_id,friendship.session.interaction_id)&&!strcmp(session.code,friendship.session.code)&&!strcmp(session.nonce,friendship.session.nonce)&&session.occurred_at==friendship.session.occurred_at)pc_friend_flow_update(&friendship,&session,millis());
    }if(!recovered)view.last_result=pc_friend_observations(&cloud,&nearby,millis(),&session);
    if(!recovered&&view.last_result==PC_CLOUD_OK){
     if(!strcmp(session.state,"done")){
      if(!pending_friend){friendship.session=session;pc_friend_saved(&state,millis());friendship.active=false;}
     }else if(!pending_friend||!strcmp(session.interaction_id,friendship.session.interaction_id))pc_friend_flow_update(&friendship,&session,millis());
    }
   }
   if(!friendship.active&&!friendship.session.visual.valid&&(state.friend_resume==PC_FRIEND_ANIMATION||state.friend_resume==PC_FRIEND_DONE)&&!strcmp(friendship.session.state,"done"))view.last_result=pc_friend_visual_refresh(&cloud,&friendship.session);
   pc_friend_flow_tick(&friendship,millis());friend_at=millis();
  }
  uint32_t radio_now=millis();
  if(strcmp(proximity_activity,cloud.active_activity_id)){
   memcpy(proximity_activity,cloud.active_activity_id,37);nearby_init(&nearby);memset(&view.candidate,0,sizeof(view.candidate));candidate_at=0;
  }
  if(!network_setup_active()&&(uint32_t)(radio_now-radio_at)>=4000u){
   uint8_t packet[30];bool fresh=pc_presence_advertisement(&cloud,radio_now,packet);
   (void)nearby_ble_update(fresh?packet:NULL,fresh&&(state.host_active||friendship.active));radio_at=radio_now;
  }
  nearby_participant_t observation;
  while(nearby_ble_receive(&observation))if(connected&&(state.host_active||friendship.active))(void)pc_presence_observe(&nearby,&observation,store.data.device_id,millis(),friendship.active?-68:CONFIG_PLANET_NEARBY_MIN_RSSI);
  nearby_participant_t selected;
  if(connected&&state.host_active&&!state.unresolved&&nearby_selected(&nearby,millis(),&selected)){
   char id[37];pc_device_uuid(selected.device_id,id);
   if(strcmp(id,view.candidate.device_id)||(uint32_t)(millis()-candidate_at)>=1000u){
    pc_host_candidate candidate;pc_cloud_result checked=pc_cloud_host_candidate(&cloud,cloud.active_activity_id,&selected,&candidate);
    if(checked==PC_CLOUD_OK&&(uint32_t)(millis()-selected.seen_ms)<NEARBY_TTL_MS){view.candidate=candidate;candidate_at=millis();}
    else if(checked==PC_CLOUD_HTTP&&cloud.http_status==403){
     nearby.entries[nearby.selected].occupied=false;if(!view.candidate.device_id[0])(void)nearby_move(&nearby,1,millis());
    }
   }
  }
  pc_net_command command;
  while(xQueueReceive(commands,&command,0)==pdTRUE){
   view.command_serial=command.serial;
   switch(command.kind){
   case PC_NET_FRIEND_START:
    if(connected&&friendship.active&&state.unresolved&&command.source_page==PC_FRIEND_CODE){
     /* Retry only the exact durable intent, never replace an uncertain operation. */
     pc_friend_session session;view.last_result=pc_friend_poll(&cloud,&session);
     if(view.last_result==PC_CLOUD_OK&&!strcmp(session.interaction_id,friendship.session.interaction_id)&&!strcmp(session.code,friendship.session.code)){
      view.last_result=pc_friend_confirm(&cloud,&session,&session);
      if(view.last_result==PC_CLOUD_OK){pc_friend_flow_update(&friendship,&session,millis());friendship.shown_ms=millis();friendship.timed_out=false;}
     }
     break;
    }
    if(connected&&state.bound&&!state.host_active&&!state.unresolved&&(command.source_page==PC_PLANET||command.source_page==PC_FRIEND_CODE)){
     if(friendship.active){pc_friend_session cancelled;view.last_result=pc_friend_cancel(&cloud,&friendship.session,&cancelled);if(view.last_result!=PC_CLOUD_OK)break;}
     pc_friend_session session;view.last_result=pc_friend_request(&cloud,&session);
     if(view.last_result==PC_CLOUD_OK){memset(&friendship,0,sizeof(friendship));pc_friend_flow_update(&friendship,&session,millis());state.page=PC_FRIEND_CODE;state.help=false;radio_at=millis()-4000u;}
    }break;
   case PC_NET_FRIEND_CONFIRM:
    if(connected&&friendship.active&&command.source_page==PC_FRIEND_CODE&&!friendship.timed_out&&!strcmp(command.friend_id,friendship.session.interaction_id)&&!strcmp(command.friend_code,friendship.session.code)){
     pc_friend_session session;view.last_result=pc_friend_confirm(&cloud,&friendship.session,&session);
     if(view.last_result==PC_CLOUD_OK)pc_friend_flow_update(&friendship,&session,millis());
    }break;
   case PC_NET_FRIEND_CANCEL:
    if(connected&&friendship.active&&command.source_page==PC_FRIEND_CODE){
     pc_friend_session session;view.last_result=pc_friend_cancel(&cloud,&friendship.session,&session);
     if(view.last_result==PC_CLOUD_OK){friendship.active=false;if(!strcmp(session.state,"done")){friendship.session=session;pc_friend_saved(&state,millis());}else pc_resolved(&state,state.host_active?PC_HOST:PC_PLANET,millis());}
    }break;
   case PC_NET_FRIEND_DONE:
    if(state.friend_resume==PC_FRIEND_ANIMATION){pc_friend_animation_done(&state);}
    if(command.source_page==PC_FRIEND_DONE)(void)pc_press(&state,PC_OK,false,millis());
    break;
   case PC_NET_SINGLE_SUBMIT:
    if(connected&&command.source_page==PC_HOST&&!state.unresolved&&!strcmp(command.activity_id,cloud.active_activity_id)){
     nearby_participant_t peer;if(nearby_selected(&nearby,millis(),&peer)){
      char target[37];pc_device_uuid(peer.device_id,target);
      if(!strcmp(target,command.peer_device_id)&&!strcmp(target,view.candidate.device_id)){
       char id[37];uuid(id);view.last_result=pc_single_begin(&single,id,command.activity_id,&peer,millis());single_at=millis();
      }
     }
    }
    break;
   case PC_NET_MEMBER_PREVIOUS:case PC_NET_MEMBER_NEXT:
    if(connected&&state.host_active&&!state.unresolved&&command.source_page==PC_HOST&&!strcmp(command.activity_id,cloud.active_activity_id)){
     int previous=nearby.selected;
     if(nearby_move(&nearby,command.kind==PC_NET_MEMBER_NEXT?1:-1,millis())){
      nearby_participant_t peer;if(nearby_selected(&nearby,millis(),&peer)){
       pc_host_candidate candidate;pc_cloud_result checked=pc_cloud_host_candidate(&cloud,cloud.active_activity_id,&peer,&candidate);
       if(checked==PC_CLOUD_OK&&(uint32_t)(millis()-peer.seen_ms)<NEARBY_TTL_MS){view.candidate=candidate;candidate_at=millis();}
       else {if(checked==PC_CLOUD_HTTP&&cloud.http_status==403)nearby.entries[nearby.selected].occupied=false;nearby.selected=previous;}
      }
     }
    }
    break;
   case PC_NET_BATCH_START:
    if(connected&&command.source_page==PC_HOST&&!strcmp(command.activity_id,cloud.active_activity_id)){
     char id[37];uuid(id);view.last_result=pc_batch_start(&batch,id,command.activity_id,millis());batch_at=millis();
    }
    break;
   case PC_NET_BATCH_RETRY:
    if(connected&&(command.source_page==PC_BATCH_PARTIAL||command.source_page==PC_BATCH_FAILED)&&!strcmp(command.activity_id,cloud.active_activity_id)){
     char id[37];uuid(id);view.last_result=pc_batch_retry(&batch,id,millis());batch_at=millis();
    }
    break;
   case PC_NET_BATCH_DISMISS:
    if(batch.known&&(command.source_page==PC_BATCH_SUCCESS||command.source_page==PC_BATCH_PARTIAL||command.source_page==PC_BATCH_FAILED)){
     view.last_result=pc_batch_dismiss(&batch);
     if(view.last_result==PC_CLOUD_OK)pc_resolved(&state,state.host_active?PC_HOST:PC_PLANET,millis());
    }
    break;
   case PC_NET_ROSTER_PAGE:
    if(connected&&state.host_active&&command.source_page==PC_ROSTER){
     view.last_result=pc_cloud_roster(&cloud,cloud.active_activity_id,command.roster_offset,&view.roster);
     if(view.last_result==PC_CLOUD_OK)view.roster_valid=true;
    }
    break;
   case PC_NET_REFRESH:status_at=runtime_at=now-6000u;break;
   case PC_NET_SETUP:
    if(command.source_page==PC_PLANET&&state.bound&&!state.unresolved){(void)network_setup_begin();pc_cloud_disconnect(&cloud,millis());connected=false;}
    break;
   case PC_NET_BOUND_CONTINUE:
    if(state.page==PC_BOUND&&command.source_page==PC_BOUND&&(int32_t)(command.pressed_ms-state.transition_at)>=300)(void)pc_press(&state,PC_OK,false,millis());
    break;
   case PC_NET_SAVE_HELLO:
    if(state.page==PC_HELLO&&command.source_page==PC_HELLO&&(int32_t)(command.pressed_ms-state.transition_at)>=300){bool saved=pc_store_skip_hello(&store)==ESP_OK;pc_hello_saved(&state,saved,millis());view.last_result=saved?PC_CLOUD_OK:PC_CLOUD_STORAGE;}break;
   case PC_NET_BIND_ACCEPT:case PC_NET_BIND_REJECT:
    if(connected&&command.source_page==PC_BIND&&!strcmp(command.request_id,startup.request_id))view.last_result=pc_startup_confirm(&startup,command.kind==PC_NET_BIND_ACCEPT,command.pressed_ms);
    break;
   }
  }
  pc_tick(&state,millis());publish();vTaskDelay(pdMS_TO_TICKS(50));
 }
 stopped:publish();for(;;)vTaskDelay(pdMS_TO_TICKS(1000));
}
esp_err_t pc_network_worker_start(void){
 if(task)return ESP_ERR_INVALID_STATE;
 commands=xQueueCreate(8,sizeof(pc_net_command));views=xQueueCreate(1,sizeof(pc_net_view));
 if(!commands||!views){if(commands)vQueueDelete(commands);if(views)vQueueDelete(views);commands=views=NULL;return ESP_ERR_NO_MEM;}
 if(xTaskCreate(run,"popcity_network",12288,NULL,4,&task)!=pdPASS){vQueueDelete(commands);vQueueDelete(views);commands=views=NULL;return ESP_ERR_NO_MEM;}return ESP_OK;
}
bool pc_network_worker_send(const pc_net_command *command){return commands&&command&&command->kind>=PC_NET_REFRESH&&command->kind<=PC_NET_FRIEND_DONE&&xQueueSend(commands,command,0)==pdTRUE;}
bool pc_network_worker_view(pc_net_view *out){return views&&out&&xQueueReceive(views,out,0)==pdTRUE;}
