#include "network_worker.h"
#include "memory_report.h"
#include "esp_log.h"
#include "identity_setup.h"
#include "legacy_import.h"
#include "app_services.h"
#include "cloud_idf.h"
#include "network_setup.h"
#include "network_blufi.h"
#include "network_handoff.h"
#include "nearby_ble.h"
#include "terminal_wifi.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include <string.h>
#include <stdio.h>
static QueueHandle_t commands;static TaskHandle_t task;
/* C3 is single-core. Publish the worker-owned view only between iterations;
 * a bounded critical copy prevents writer preemption without a second 11KiB
 * queue buffer competing with TLS. Never expose an in-progress HTTP update. */
static portMUX_TYPE view_mux=portMUX_INITIALIZER_UNLOCKED;
static bool view_ready;
static void unpublish(void){portENTER_CRITICAL(&view_mux);view_ready=false;portEXIT_CRITICAL(&view_mux);}
static pc_store store;static pc_state state;static pc_cloud cloud;static pc_startup startup;
static pc_net_view view;static pc_batch_controller batch;static pc_single_controller single;static nearby_participants_t nearby;
static pc_friend_flow friendship;
static uint32_t change_at;static bool change_synced;
static unsigned host_probe;static uint32_t candidate_at;static char proximity_activity[37];
static uint32_t millis(void){return (uint32_t)(esp_timer_get_time()/1000);}
static void publish(void){
 if(single.completed_peer[0]){
  if(!strcmp(single.completed_activity,cloud.active_activity_id))for(unsigned i=0;i<NEARBY_CAPACITY;i++){char id[37];pc_device_uuid(nearby.entries[i].device_id,id);if(!strcmp(id,single.completed_peer)){nearby.entries[i].checked_in=true;nearby.entries[i].host_eligible=true;nearby.entries[i].host_checked_ms=millis();}}
  single.completed_peer[0]=0;
 }
 if(state.page==PC_HOST&&nearby_prune_checked_selection(&nearby,millis())){memset(&view.candidate,0,sizeof(view.candidate));candidate_at=0;}

 nearby_participant_t chosen;char chosen_id[37]={0};bool live=nearby_selected(&nearby,millis(),&chosen);if(live)pc_device_uuid(chosen.device_id,chosen_id);
 view.candidate_nearby=network_ready()&&state.host_active&&live&&chosen.host_eligible&&(uint32_t)(millis()-chosen.host_checked_ms)<5000u&&!strcmp(chosen_id,view.candidate.device_id);
 view.candidate_valid=view.candidate_nearby&&(uint32_t)(millis()-candidate_at)<5000;
 view.nearby_count=state.host_active?(uint32_t)nearby_host_count(&nearby,millis()):0;
 view.nearby_position=0;unsigned rank=0;
 for(int i=0;i<NEARBY_CAPACITY;i++)if(nearby.entries[i].occupied&&(uint32_t)(millis()-nearby.entries[i].seen_ms)<NEARBY_TTL_MS){rank++;if(i==nearby.selected)view.nearby_position=rank;}
 snprintf(view.bluetooth_name,sizeof(view.bluetooth_name),"%s",network_blufi_name());
 snprintf(view.network_message,sizeof(view.network_message),"%s",network_setup_screen());
 snprintf(view.network_summary,sizeof(view.network_summary),"%s",network_setup_summary());
 memcpy(view.member_label_bitmap,startup.member_label_bitmap,sizeof(view.member_label_bitmap));view.member_label_bitmap_valid=startup.member_label_bitmap_valid;view.member_label_width=startup.member_label_width;memcpy(view.active_title,cloud.active_title,sizeof(view.active_title));memcpy(view.active_title_bitmap,cloud.active_title_bitmap,sizeof(view.active_title_bitmap));view.active_title_valid=cloud.active_title_valid;
 view.personal=cloud.personal;view.friend_flow=friendship;
 view.friend_confirmed=!strcmp(store.data.device_id,friendship.session.device_a)?friendship.session.a_confirmed:friendship.session.b_confirmed;view.single_loaded=single.loaded;view.unresolved=state.unresolved;memcpy(view.active_activity_id,cloud.active_activity_id,37);
 view.batch.loaded=batch.loaded;view.batch.known=batch.known;view.batch.phase=batch.phase;view.batch.total=batch.total;view.batch.signed_count=batch.signed_count;view.batch.failed=batch.failed;view.batch.pending=batch.pending;view.batch.sequence=batch.sequence;
 view.binding_valid_seconds=startup.valid_seconds;view.binding_updated_ms=startup.updated_ms;
 view.network=network_status();view.clock_ready=network_clock_ready();
 view.transport_error=pc_cloud_transport_last_error();view.backend_http_status=cloud.http_status;
 view.wifi_ready=network_ready();if(!view.wifi_ready||!state.host_active||strcmp(view.roster.activity_id,cloud.active_activity_id))view.roster_valid=false;view.binding_success_pending=startup.new_binding;view.bound=state.bound;view.hello_skipped=store.data.hello_skipped;view.host_active=state.host_active;view.palette=store.data.palette;view.flow_page=state.page;view.flow_target=state.target;view.binding=view.wifi_ready&&!view.backend_ready&&!view.backend_syncing?PC_BIND_SERVICE_ERROR:startup.phase;
 memcpy(view.code,startup.claim_code,sizeof(view.code));memcpy(view.request_id,startup.request_id,37);memcpy(view.member_label,startup.member_label,sizeof(view.member_label));memcpy(view.member_hint,startup.member_hint,sizeof(view.member_hint));
 static int last_result=-1,last_ready=-1,last_change=-1,last_flow=-1;
 if(last_result!=(int)view.last_result||last_ready!=(int)view.backend_ready||last_change!=(int)view.change_network||last_flow!=(int)view.flow_page){ESP_LOGI("pc_diag_net","result=%d http=%d transport=%d wifi=%d backend=%d bound=%d flow=%d change=%d",view.last_result,view.backend_http_status,view.transport_error,view.wifi_ready,view.backend_ready,view.bound,view.flow_page,view.change_network);last_result=(int)view.last_result;last_ready=(int)view.backend_ready;last_change=(int)view.change_network;last_flow=(int)view.flow_page;}
 portENTER_CRITICAL(&view_mux);view_ready=true;portEXIT_CRITICAL(&view_mux);
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
 /* Initialize default NVS without erasing it, then import this old product's
  * own records once. event_save corruption already stopped above. */
 if(nvs_flash_init()!=ESP_OK){view.service=PC_NET_STORAGE_ERROR;goto stopped;}
 if(pc_legacy_import(&store,CONFIG_PLANET_SERVER_ORIGIN)!=ESP_OK){view.service=PC_NET_STORAGE_ERROR;goto stopped;}
 pc_init(&state,store.data.hello_skipped,store.data.member_id[0]!=0);app_services_bind(&store);
 if(!pc_cloud_uuid(store.data.device_id)||!store.data.device_token[0]||!pc_cloud_origin_valid(store.data.server_origin)){view.service=PC_NET_IDENTITY_REQUIRED;publish();if(pc_identity_wait_usb(&store)!=ESP_OK)goto stopped;unpublish();}

 if(nearby_ble_init()!=ESP_OK||network_start()!=ESP_OK){view.service=PC_NET_RADIO_ERROR;goto stopped;}
 pc_cloud_bind_idf(&cloud,&store,&state);pc_startup_init(&startup,&cloud);pc_batch_init(&batch,&cloud);pc_single_init(&single,&cloud);restore_friend();view.service=PC_NET_READY;
 unsigned background_turn=0;
 uint32_t status_at=0,runtime_at=0,feedback_at=0,batch_at=0,radio_at=0,single_at=0,friend_at=0;bool connected=false,link_up=false;pc_site_gate site;pc_site_reset(&site);
 for(;;){
  unpublish();uint32_t now=millis();network_tick(now);pc_cloud_transport_reuse(state.bound&&network_ready()&&!network_setup_active());bool io_taken=false;
  unsigned background_slot=background_turn++%5;bool command_waiting=uxQueueMessagesWaiting(commands)>0;
  bool friend_due=friendship.active&&(uint32_t)(now-friend_at)>=500u;
  if(view.change_network==PC_CHANGE_CONNECTING){
   pc_wifi_status net=network_status();
   if(net.phase==PC_WIFI_FAILED||net.phase==PC_WIFI_SAVE_FAILED)view.change_network=PC_CHANGE_FAILED;
   else if(net.phase==PC_WIFI_SAVED||network_ready()){
    view.change_network=PC_CHANGE_SUCCESS;change_at=now;
   }else if(!network_setup_active())view.change_network=PC_CHANGE_FAILED;
  }
  if(view.change_network==PC_CHANGE_READY&&!network_ready())view.change_network=PC_CHANGE_NONE;
  if(view.change_network==PC_CHANGE_RESTORING&&!network_ready()&&!network_reconnecting_saved())view.change_network=PC_CHANGE_NONE;
  if((view.change_network==PC_CHANGE_SUCCESS||view.change_network==PC_CHANGE_RESTORING)&&network_ready()&&change_synced&&(uint32_t)(now-change_at)>=1000u)view.change_network=PC_CHANGE_NONE;
  if(!network_ready()||view.change_network==PC_CHANGE_FAILED||view.change_network==PC_CHANGE_CONNECTING){
   link_up=false;view.backend_ready=false;pc_site_reset(&site);
   if(connected){pc_cloud_disconnect(&cloud,now);if(batch.loaded){batch.known=false;batch.phase=PC_BATCH_CHECKING;state.unresolved=true;}view.roster_valid=false;connected=false;}
   state.online=false;state.page=PC_WIFI;
   /* The approved idle page says PRESS UP; start phone provisioning only on UP. */
  }else{
   if(!link_up){link_up=true;status_at=runtime_at=feedback_at=batch_at=single_at=now-6000u;}
   /* One bounded initial HTTPS operation per iteration; publish between status and runtime. */
   if(!network_clock_ready()||network_blufi_transport_running()){view.backend_ready=false;connected=false;}
   else if(site.stage!=PC_SITE_READY){
    if(!command_waiting&&pc_site_due(&site,now)){
     io_taken=true;
     if(site.stage==PC_SITE_STATUS){
      view.last_result=pc_startup_poll(&startup,now);status_at=millis();
      if(view.last_result==PC_CLOUD_OK)pc_site_status_verified(&site,state.bound);
      else pc_site_failed(&site,millis());
     }else{
      view.last_result=pc_cloud_runtime(&cloud,now,single.loaded?store.data.pending[single.slot].activity_id:NULL);runtime_at=millis();
      if(view.last_result==PC_CLOUD_OK&&cloud.personal.valid){pc_site_runtime_verified(&site);change_synced=true;}
      else {if(view.last_result==PC_CLOUD_OK)view.last_result=PC_CLOUD_INVALID;pc_site_failed(&site,millis());}
     }
    }
    view.backend_ready=site.stage==PC_SITE_READY;connected=view.backend_ready;
   }else{
   view.backend_ready=true;connected=true;
   if(!friend_due&&!command_waiting&&background_slot==0&&(uint32_t)(now-status_at)>=3000u){
    io_taken=true;
    view.last_result=pc_startup_poll(&startup,now);status_at=millis();
    if(view.last_result!=PC_CLOUD_OK){pc_site_failed(&site,millis());view.backend_ready=false;connected=false;}
   }
   if(!friend_due&&!command_waiting&&background_slot==1&&connected&&state.bound&&(uint32_t)(now-runtime_at)>=5000u){io_taken=true;view.last_result=pc_cloud_runtime(&cloud,now,single.loaded?store.data.pending[single.slot].activity_id:NULL);runtime_at=millis();
    if(view.last_result==PC_CLOUD_OK)change_synced=true;
    else {pc_site_failed(&site,millis());view.backend_ready=false;connected=false;}
    if(view.last_result==PC_CLOUD_OK&&state.host_active){
     pc_cloud_result roster_result=pc_cloud_roster(&cloud,cloud.active_activity_id,view.roster_valid?view.roster.offset:0,&view.roster);
     view.roster_valid=roster_result==PC_CLOUD_OK;
    }
   }
   if(!friend_due&&!command_waiting&&background_slot==2&&connected&&state.bound&&cloud.clock_known&&single.loaded&&(state.unresolved||!state.host_active||strcmp(cloud.active_activity_id,store.data.pending[single.slot].activity_id))&&(uint32_t)(now-single_at)>=2000u){
    io_taken=true;nearby_participant_t peer,*found=NULL;const char *target=store.data.pending[single.slot].peer_device_id;
    for(unsigned i=0;i<NEARBY_CAPACITY;i++)if(nearby.entries[i].occupied&&(uint32_t)(millis()-nearby.entries[i].seen_ms)<NEARBY_TTL_MS){char id[37];pc_device_uuid(nearby.entries[i].device_id,id);if(!strcmp(id,target)){peer=nearby.entries[i];found=&peer;break;}}
    view.last_result=pc_single_recover(&single,found,millis());single_at=millis();
   }
   if(!friend_due&&!command_waiting&&background_slot==3&&connected&&state.bound&&cloud.clock_known&&batch.loaded&&(!batch.known||batch.phase==PC_BATCH_WORKING||!state.host_active||strcmp(cloud.active_activity_id,batch.activity_id))&&(uint32_t)(now-batch_at)>=2000u){
    io_taken=true;view.last_result=pc_batch_poll(&batch,millis());batch_at=millis();
    if(batch.known&&batch.phase!=PC_BATCH_WORKING&&(!state.host_active||strcmp(cloud.active_activity_id,batch.activity_id))){
     view.last_result=pc_batch_dismiss(&batch);
     if(view.last_result==PC_CLOUD_OK)pc_resolved(&state,PC_PLANET,millis());
     else {state.unresolved=true;state.page=PC_RECONCILE;}
    }
   }
   if(!friend_due&&!command_waiting&&background_slot==4&&connected&&state.bound&&cloud.clock_known){
    io_taken=true;
    if(!cloud.feedback.active){char session[37];uuid(session);view.last_result=pc_cloud_feedback_open(&cloud,session);}
    if(uxQueueMessagesWaiting(commands)==0&&cloud.feedback.active&&(uint32_t)(now-feedback_at)>=2000u){view.last_result=pc_cloud_feedback_poll(&cloud,now,pulse,NULL);feedback_at=millis();if(view.last_result==PC_CLOUD_HTTP&&cloud.http_status==409)pc_feedback_disconnect(&cloud.feedback);}
   }
  }
  }
  nearby_participant_t fresh_observation;
  while(nearby_ble_receive(&fresh_observation))if(connected&&(state.host_active||friendship.active))(void)pc_presence_observe(&nearby,&fresh_observation,store.data.device_id,millis(),friendship.active?-68:CONFIG_PLANET_NEARBY_MIN_RSSI);
  if(!command_waiting&&!io_taken&&connected&&state.bound&&(friendship.active||state.unresolved)&&(uint32_t)(millis()-friend_at)>=500u){
   io_taken=true;
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
   pc_friend_flow_tick(&friendship,millis());friend_at=millis();
  }
  uint32_t radio_now=millis();
  if(strcmp(proximity_activity,cloud.active_activity_id)){
   memcpy(proximity_activity,cloud.active_activity_id,37);nearby_init(&nearby);memset(&view.candidate,0,sizeof(view.candidate));candidate_at=0;
  }
  if(!network_setup_active()&&view.change_network!=PC_CHANGE_FAILED&&view.change_network!=PC_CHANGE_CONNECTING&&(uint32_t)(radio_now-radio_at)>=4000u){
   uint8_t packet[30];bool fresh=pc_presence_advertisement(&cloud,radio_now,packet);
   (void)nearby_ble_update(fresh?packet:NULL,fresh&&(state.host_active||friendship.active));radio_at=radio_now;
  }
  nearby_participant_t observation;
  while(nearby_ble_receive(&observation))if(connected&&(state.host_active||friendship.active))(void)pc_presence_observe(&nearby,&observation,store.data.device_id,millis(),friendship.active?-68:CONFIG_PLANET_NEARBY_MIN_RSSI);
  /* Validate all nearby participants, not raw BLE broadcasts, for the counter.
   * One bounded request on the existing worker; selected identity stays stable. */
  if(!command_waiting&&!io_taken&&connected&&state.host_active&&!state.unresolved){
   int slot=-1;uint32_t check_now=millis();
   for(unsigned n=0;n<NEARBY_CAPACITY;n++){unsigned i=(host_probe+n)%NEARBY_CAPACITY;if(nearby.entries[i].occupied&&(uint32_t)(check_now-nearby.entries[i].seen_ms)<NEARBY_TTL_MS&&(!nearby.entries[i].host_eligible||(uint32_t)(check_now-nearby.entries[i].host_checked_ms)>=2000u)){slot=(int)i;host_probe=(i+1)%NEARBY_CAPACITY;break;}}
   if(slot>=0){
    nearby_participant_t selected=nearby.entries[slot];pc_host_candidate candidate;
    pc_cloud_result checked=pc_cloud_host_candidate(&cloud,cloud.active_activity_id,&selected,&candidate);io_taken=true;
    nearby.entries[slot].host_checked_ms=millis();
    if(checked==PC_CLOUD_OK&&(uint32_t)(millis()-selected.seen_ms)<NEARBY_TTL_MS){
     if(candidate.signed_status_known)nearby.entries[slot].checked_in=candidate.signed_in;
     nearby.entries[slot].host_eligible=true;
     if(slot==nearby.selected&&!nearby.entries[slot].checked_in){view.candidate=candidate;candidate_at=millis();}
    }else{nearby.entries[slot].host_eligible=false;
     if(checked==PC_CLOUD_HTTP&&cloud.http_status==403){nearby.entries[slot].occupied=false;if(slot==nearby.selected&&!view.candidate.device_id[0])(void)nearby_move(&nearby,1,millis());}
    }
   }
  }
  pc_net_command command;
  while(xQueueReceive(commands,&command,0)==pdTRUE){
   view.command_serial=command.serial;
   switch(command.kind){
   case PC_NET_COMMAND_COUNT:break; /* Sentinel is rejected by queue validation. */
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
     uint8_t early_packet[30];uint32_t early_now=millis();
     if(pc_presence_advertisement(&cloud,early_now,early_packet)){(void)nearby_ble_update(early_packet,true);radio_at=early_now;}
     pc_cloud_transport_reuse(true);pc_friend_session session;view.last_result=pc_friend_request(&cloud,&session);
     if(view.last_result==PC_CLOUD_OK){memset(&friendship,0,sizeof(friendship));pc_friend_flow_update(&friendship,&session,millis());state.page=PC_FRIEND_CODE;state.help=false;radio_at=millis()-4000u;friend_at=millis()-500u;}
    }break;
   case PC_NET_FRIEND_SHOWN:
    pc_friend_flow_visible(&friendship,command.friend_id,command.friend_code,command.pressed_ms);break;
   case PC_NET_FRIEND_CONFIRM:
    ESP_LOGI("pc_diag_friend","confirm connected=%d active=%d visible=%d timed_out=%d key_valid=%d near=%d",connected,friendship.active,friendship.visible,friendship.timed_out,pc_friend_flow_accepts_key(&friendship,command.friend_id,command.friend_code,command.pressed_ms),friendship.session.proximity_ready);
    if(connected&&command.source_page==PC_FRIEND_CODE&&pc_friend_flow_accepts_key(&friendship,command.friend_id,command.friend_code,command.pressed_ms)){
     pc_friend_session session;view.last_result=pc_friend_confirm(&cloud,&friendship.session,&session);
     if(view.last_result==PC_CLOUD_OK)pc_friend_flow_update(&friendship,&session,millis());
    }break;
   case PC_NET_FRIEND_CANCEL:
    if(connected&&friendship.active&&command.source_page==PC_FRIEND_CODE){
     pc_friend_session session;view.last_result=pc_friend_cancel(&cloud,&friendship.session,&session);
     if(view.last_result==PC_CLOUD_OK){friendship.active=false;if(!strcmp(session.state,"done")){friendship.session=session;pc_friend_saved(&state,millis());}else pc_resolved(&state,state.host_active?PC_HOST:PC_PLANET,millis());}
    }break;
   case PC_NET_FRIEND_DONE:
    if(!state.unresolved&&!strcmp(command.friend_id,friendship.session.interaction_id)&&!strcmp(friendship.session.state,"done")){
     if(state.friend_resume==PC_FRIEND_ANIMATION)pc_friend_animation_done(&state);
     if(command.source_page==PC_FRIEND_DONE){friendship.active=false;state.page=PC_FRIEND_DONE;state.friend_resume=PC_FRIEND_DONE;(void)pc_press(&state,PC_OK,false,millis());}
    }
    break;
   case PC_NET_ATTENDANCE_RETURN:
    if(command.source_page==PC_SINGLE_SUCCESS&&!strcmp(command.activity_id,cloud.active_activity_id)&&!state.unresolved&&!single.loaded&&(state.page==PC_SINGLE_SUCCESS||(state.page==PC_LOADING&&state.target==PC_SINGLE_SUCCESS)))state.page=state.host_active?PC_HOST:PC_PLANET;
    break;
   case PC_NET_SINGLE_SUBMIT:
    if(connected&&(command.source_page==PC_HOST||command.source_page==PC_SINGLE_FAILED)&&!state.unresolved&&!strcmp(command.activity_id,cloud.active_activity_id)){
     nearby_participant_t peer;if(nearby_selected(&nearby,millis(),&peer)){
      char target[37];pc_device_uuid(peer.device_id,target);
      if(!strcmp(target,command.peer_device_id)&&!strcmp(target,view.candidate.device_id)){
       char id[37];uuid(id);view.last_result=single.loaded?pc_single_retry(&single,&peer,millis()):pc_single_begin(&single,id,command.activity_id,&peer,millis());single_at=millis();
      }
     }
    }
    break;
   case PC_NET_MEMBER_PREVIOUS:case PC_NET_MEMBER_NEXT:
    if(connected&&state.host_active&&!state.unresolved&&(command.source_page==PC_HOST||command.source_page==PC_SINGLE_SUCCESS||command.source_page==PC_SINGLE_FAILED)&&!strcmp(command.activity_id,cloud.active_activity_id)){
     if(single.loaded){view.last_result=pc_single_abandon(&single,millis());if(view.last_result!=PC_CLOUD_OK||single.loaded||(state.page==PC_LOADING&&state.target==PC_SINGLE_SUCCESS))break;}
     state.page=PC_HOST;
     int previous=nearby.selected;
     if(nearby_move(&nearby,command.kind==PC_NET_MEMBER_NEXT?1:-1,millis())){
      nearby_participant_t peer;if(nearby_selected(&nearby,millis(),&peer)){
       pc_host_candidate candidate;pc_cloud_result checked=pc_cloud_host_candidate(&cloud,cloud.active_activity_id,&peer,&candidate);
       if(checked==PC_CLOUD_OK&&(uint32_t)(millis()-peer.seen_ms)<NEARBY_TTL_MS){if(candidate.signed_status_known)nearby.entries[nearby.selected].checked_in=candidate.signed_in;if(!nearby.entries[nearby.selected].checked_in){view.candidate=candidate;candidate_at=millis();}}
       else {if(checked==PC_CLOUD_HTTP&&cloud.http_status==403)nearby.entries[nearby.selected].occupied=false;nearby.selected=previous;}
      }
     }
    }
    break;
   case PC_NET_BATCH_START:
    if(connected&&(command.source_page==PC_HOST||command.source_page==PC_SINGLE_SUCCESS||command.source_page==PC_SINGLE_FAILED)&&!strcmp(command.activity_id,cloud.active_activity_id)){
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
   case PC_NET_REFRESH:
    if(network_ready()&&!view.backend_ready)pc_site_reset(&site);
    status_at=runtime_at=now-6000u;break;
   case PC_NET_CHANGE_PREPARE:
    if(command.source_page==PC_PLANET&&connected&&state.bound&&!state.unresolved&&view.change_network==PC_CHANGE_NONE){
     wifi_ap_record_t ap={0};
     memset(view.current_ssid,0,sizeof(view.current_ssid));
     if(esp_wifi_sta_get_ap_info(&ap)==ESP_OK)memcpy(view.current_ssid,ap.ssid,32);
     view.change_network=PC_CHANGE_READY;change_at=millis();
    }break;
   case PC_NET_CHANGE_START:
    if(command.source_page==PC_PLANET&&(view.change_network==PC_CHANGE_READY||view.change_network==PC_CHANGE_FAILED)){
     if(network_setup_active())network_setup_end();
     pc_cloud_transport_reuse(false);esp_err_t begun=network_setup_begin();
     pc_cloud_disconnect(&cloud,millis());connected=false;change_synced=false;view.roster_valid=false;
     view.change_network=begun==ESP_OK?PC_CHANGE_CONNECTING:PC_CHANGE_FAILED;change_at=millis();
    }break;
   case PC_NET_CHANGE_CANCEL:
    if(command.source_page==PC_PLANET&&view.change_network==PC_CHANGE_READY)view.change_network=PC_CHANGE_NONE;
    else if(command.source_page==PC_PLANET&&view.change_network==PC_CHANGE_FAILED){
     network_setup_end();view.change_network=PC_CHANGE_RESTORING;change_at=millis();change_synced=false;
     pc_cloud_disconnect(&cloud,millis());connected=false;
    }break;
   case PC_NET_SETUP:
    if(command.source_page==PC_WIFI&&!network_ready()){
     if(network_status().phase==PC_WIFI_SAVE_FAILED||network_setup_active())network_setup_retry();
     else (void)network_setup_begin();
    }
    break;
   case PC_NET_BOUND_CONTINUE:
    if(startup.new_binding&&state.bound&&command.source_page==PC_BOUND){state.page=PC_BOUND;(void)pc_press(&state,PC_OK,false,millis());startup.new_binding=false;}
    break;
   case PC_NET_SAVE_HELLO:
    if(state.page==PC_HELLO&&command.source_page==PC_HELLO&&(int32_t)(command.pressed_ms-state.transition_at)>=300){bool saved=pc_store_skip_hello(&store)==ESP_OK;pc_hello_saved(&state,saved,millis());view.last_result=saved?PC_CLOUD_OK:PC_CLOUD_STORAGE;}break;
   case PC_NET_BIND_ACCEPT:case PC_NET_BIND_REJECT:
    if(connected&&command.source_page==PC_BIND&&!strcmp(command.request_id,startup.request_id)){
     view.last_result=pc_startup_confirm(&startup,command.kind==PC_NET_BIND_ACCEPT,command.pressed_ms);
     if(view.last_result==PC_CLOUD_OK&&state.bound){pc_site_status_verified(&site,true);view.backend_ready=false;connected=false;}
    }
    break;
   }
  }
  pc_tick(&state,millis());view.backend_syncing=network_ready()&&pc_site_syncing(&site);view.backend_recovering=network_ready()&&state.bound&&startup.phase!=PC_BIND_REVOKED&&cloud.http_status!=401&&cloud.http_status!=403&&pc_site_recovering(&site,millis());publish();vTaskDelay(pdMS_TO_TICKS(50));
 }
 stopped:pc_memory_report("worker_stopped");publish();for(;;)vTaskDelay(pdMS_TO_TICKS(1000));
}
esp_err_t pc_network_worker_start(void){
 if(task)return ESP_ERR_INVALID_STATE;
 commands=xQueueCreate(8,sizeof(pc_net_command));
 if(!commands)return ESP_ERR_NO_MEM;
 if(xTaskCreate(run,"popcity_network",12288,NULL,4,&task)!=pdPASS){vQueueDelete(commands);commands=NULL;return ESP_ERR_NO_MEM;}return ESP_OK;
}
bool pc_network_worker_send(const pc_net_command *command){return commands&&command&&pc_net_command_valid(command->kind)&&xQueueSend(commands,command,0)==pdTRUE;}
bool pc_network_worker_view(pc_net_view *out){
 if(!out)return false;
 bool ready;
 portENTER_CRITICAL(&view_mux);ready=view_ready;if(ready){memcpy(out,&view,sizeof(view));view_ready=false;}portEXIT_CRITICAL(&view_mux);
 return ready;
}
