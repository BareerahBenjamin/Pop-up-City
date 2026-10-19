/* Product integration entry. Not a release until product-readiness gates pass. */
#include "network_worker.h"
#include "panel_renderer.h"
#include "terminal_wifi.h"
#include "personal_visual.h"
#include "friend_visual.h"
#include "display_status.h"
#include "bsp_display.h"
#include "esp_wifi.h"
#include "bsp_button.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "generated/pixel_glyphs.h"
#include "generated/welcome_frames.h"
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
typedef struct {pc_key key;bool hold;uint32_t ms,epoch;} input_event;
static QueueHandle_t inputs;
static atomic_uint epoch;
static uint32_t press_epoch[3],press_ms[3];
static bool held_long[3];
static uint32_t animation_at;
static unsigned animation_frame;
static uint32_t command_serial,awaiting_batch,roster_offset,last_render;
static uint32_t pulse_at,last_pulse,status_at,name_elapsed,name_tick,visual_tick,render_elapsed;
static bool pulse_active,feedback_initialized,offline_latched;
static int battery=-1,wifi_strength;
static char played_friend_id[37];
static pc_state ui;
static pc_net_view current;
static uint32_t millis(void){return (uint32_t)(esp_timer_get_time()/1000);}
static void button(bsp_btn_t key,bsp_btn_ev_t event,void *unused){
 (void)unused;if((unsigned)key>=3)return;
 if(event==BSP_BTN_PRESS){press_epoch[key]=atomic_load(&epoch);press_ms[key]=millis();held_long[key]=false;return;}
 if(event!=BSP_BTN_LONG&&event!=BSP_BTN_CLICK)return;
 if(event==BSP_BTN_CLICK&&held_long[key])return;
 if(event==BSP_BTN_LONG)held_long[key]=true;
 input_event input={.key=(pc_key)key,.hold=event==BSP_BTN_LONG,.ms=press_ms[key],.epoch=press_epoch[key]};
 (void)xQueueSend(inputs,&input,0);
}
static void text(uint16_t *pixels,unsigned row,unsigned rows,int x,int y,const char *string,unsigned scale){
 for(unsigned n=0;string[n];n++){
  unsigned char c=(unsigned char)string[n];if(c>=128)c='?';
  for(unsigned gy=0;gy<7;gy++)for(unsigned gx=0;gx<5;gx++)if(pixel_glyphs[c][gy]&(1u<<(4-gx)))
   for(unsigned sy=0;sy<scale;sy++)for(unsigned sx=0;sx<scale;sx++){
    int px=x+(int)((n*6+gx)*scale+sx),py=y+(int)(gy*scale+sy);
    if(px>=0&&px<240&&py>=(int)row&&py<(int)(row+rows))pixels[(py-(int)row)*240+px]=current.service==PC_NET_READY?(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0]:0xffff;
   }
 }
}
static void bitmap(uint16_t *pixels,unsigned row,unsigned rows,int x,int y,unsigned width,unsigned height,const uint8_t *bits){
 uint16_t color=(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0];
 for(unsigned gy=0;gy<height;gy++)if(y+(int)gy>=(int)row&&y+(int)gy<(int)(row+rows))for(unsigned gx=0;gx<width;gx++)if(x+(int)gx>=0&&x+(int)gx<240&&(bits[gy*(width/8)+gx/8]&(128u>>(gx%8))))pixels[(y+(int)gy-(int)row)*240+x+(int)gx]=color;
}
static void erase(uint16_t *pixels,unsigned row,unsigned rows,unsigned top,unsigned bottom){
 for(unsigned y=row;y<row+rows;y++)if(y>=top&&y<bottom)memset(pixels+(y-row)*240,0,480);
}
static void overlay(void *unused,unsigned row,unsigned rows,uint16_t *pixels){
 (void)unused;
 if(current.service!=PC_NET_READY){
  const char *message=current.service==PC_NET_IDENTITY_REQUIRED?"DEVICE SETUP REQUIRED":current.service==PC_NET_STORAGE_ERROR?"SAVE ERROR":current.service==PC_NET_RADIO_ERROR?"RADIO ERROR":"STARTING";
  text(pixels,row,rows,10,125,message,1);return;
 }
 if(ui.help){
  erase(pixels,row,rows,0,320);
  text(pixels,row,rows,48,43,"KEY GUIDE",2);
  const char *lines[5]={0};
  switch(ui.page){
   case PC_PLANET:lines[0]="UP: CHANGE WI-FI";lines[1]="HOLD UP: ADD FRIEND";lines[2]="DOWN: NAME";break;
   case PC_NAME:lines[0]="DOWN: BACK TO PLANET";lines[1]="OK: PAUSE / RESUME";break;
   case PC_FRIEND_CODE:lines[0]="DOWN: CONFIRM CODE";lines[1]="UP: CANCEL";lines[2]="HOLD UP: RETRY";lines[3]=current.unresolved?"CHECKING SAVED RESULT":current.friend_flow.timed_out?"TIMED OUT - CODE KEPT":"BOTH MUST CONFIRM";break;
   case PC_FRIEND_DONE:lines[0]="OK: BACK TO PLANET";break;
   case PC_HOST:lines[0]="UP: PREVIOUS MEMBER";lines[1]="DOWN: NEXT MEMBER";lines[2]="OK: CHECK IN MEMBER";lines[3]="HOLD UP: CHECK IN ALL";lines[4]="HOLD DOWN: ROSTER";break;
   case PC_ROSTER:lines[0]="UP: SCROLL UP";lines[1]="DOWN: SCROLL DOWN";lines[2]="HOLD DOWN: RETURN";break;
   case PC_BATCH_SUCCESS:lines[0]="OK: RETURN";lines[1]="HOLD DOWN: ROSTER";break;
   case PC_BATCH_PARTIAL:case PC_BATCH_FAILED:lines[0]="OK: RETRY UNSAVED";lines[1]="UP: RETURN";lines[2]="HOLD DOWN: ROSTER";break;
   case PC_SINGLE_SUCCESS:case PC_SINGLE_FAILED:lines[0]="OK: RETURN";break;
   default:break;
  }
  for(unsigned i=0;i<5;i++)if(lines[i])text(pixels,row,rows,12,95+(int)i*31,lines[i],1);
  text(pixels,row,rows,12,291,"HOLD OK: CLOSE GUIDE",1);
  char percentage[8];
  snprintf(percentage,sizeof(percentage),battery>=0?"%d%%":"--%%",battery);
  text(pixels,row,rows,174,7,percentage,1);
  for(unsigned py=row;py<row+rows;py++)for(unsigned px=0;px<240;px++){
   bool icon=px>=210&&px<=231&&py>=5&&py<=17&&(px==210||px==231||py==5||py==17);
   icon|=px>=232&&px<=234&&py>=9&&py<=13;
   if(battery>=0)icon|=px>=213&&px<(unsigned)(213+battery*16/100)&&py>=8&&py<=14;
   for(int bar=0;bar<4;bar++)icon|=bar<wifi_strength&&px>=(unsigned)(8+bar*5)&&px<(unsigned)(11+bar*5)&&py>= (unsigned)(17-bar*3)&&py<=19;
   if(icon)pixels[(py-row)*240+px]=0xffff;
  }
  return;
 }
 if(ui.page==PC_LOADING){erase(pixels,row,rows,0,320);text(pixels,row,rows,60,153,"loading...",2);return;}
 if(ui.page==PC_PLANET){if(!current.personal.valid){text(pixels,row,rows,60,150,"loading...",2);return;}pc_personal_planet_overlay(&current.personal,render_elapsed,row,rows,pixels);return;}
 if(ui.page==PC_NAME){if(!current.personal.valid){text(pixels,row,rows,60,150,"loading...",2);return;}pc_personal_name_overlay(&current.personal,name_elapsed,row,rows,pixels);return;}
 if(ui.page==PC_FRIEND_ANIMATION||ui.page==PC_FRIEND_DONE){
  erase(pixels,row,rows,0,320);
  const pc_friend_visual *visual=&current.friend_flow.session.visual;
  if(visual->valid){pc_friend_visual_strip(pixels,row,rows,ui.page==PC_FRIEND_DONE?PC_FRIEND_ANIMATION_MS:render_elapsed,visual);}
  else {text(pixels,row,rows,36,110,"FRIEND ADDED",2);text(pixels,row,rows,18,150,"SYNCING APPEARANCE...",1);}
  if(ui.page==PC_FRIEND_DONE){text(pixels,row,rows,48,252,"FRIEND ADDED",2);text(pixels,row,rows,18,294,"OK: BACK TO PLANET",1);}
  return;
 }
 if(ui.page==PC_WIFI){
  erase(pixels,row,rows,235,320);
  text(pixels,row,rows,12,246,"USE PHONE BLUETOOTH",1);
  text(pixels,row,rows,12,263,current.bluetooth_name[0]?current.bluetooth_name:"STARTING BLUETOOTH",1);
  text(pixels,row,rows,12,279,"USE 2.4GHz WI-FI",1);
  /* Never render raw provisioning summaries: they may include credentials. */
  text(pixels,row,rows,12,291,terminal_wifi_is_connected()?"SYNCING SERVER...":"WAITING FOR NETWORK",1);
 }

 if(ui.page==PC_HOST||ui.page==PC_SINGLE_SAVING||ui.page==PC_SINGLE_SUCCESS||ui.page==PC_SINGLE_FAILED){
  erase(pixels,row,rows,45,95);if(current.active_title_valid)bitmap(pixels,row,rows,24,52,192,32,current.active_title_bitmap);
  erase(pixels,row,rows,225,320);
  if(current.candidate.device_id[0]){
   text(pixels,row,rows,5,239,">",2);text(pixels,row,rows,225,239,"<",2);
   for(unsigned py=row;py<row+rows;py++)if(py>=228&&py<260)for(unsigned px=0;px<192;px++)if(current.candidate.name_bitmap[(py-228)*24+px/8]&(128u>>(px%8)))pixels[(py-row)*240+px+24]=(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0];
   if(ui.page==PC_HOST&&!current.candidate_nearby)text(pixels,row,rows,30,282,"MEMBER LEFT",2);
   else if(ui.page==PC_HOST&&!current.candidate_valid)text(pixels,row,rows,36,282,"VERIFYING",2);
  }
  if(ui.page==PC_SINGLE_SAVING)text(pixels,row,rows,48,282,"SAVING...",2);
  if(ui.page==PC_SINGLE_SUCCESS)text(pixels,row,rows,42,282,"CHECKED IN",2);
  if(ui.page==PC_SINGLE_FAILED)text(pixels,row,rows,36,282,"NOT SAVED",2);
  if(ui.page==PC_HOST){char count[32];snprintf(count,sizeof(count),"%u NEARBY",(unsigned)current.nearby_count);text(pixels,row,rows,30,264,count,2);}
 }
 if(ui.page==PC_RECONCILE&&!current.batch.loaded){
  erase(pixels,row,rows,0,320);text(pixels,row,rows,24,120,"CHECKING RESULT",2);
  text(pixels,row,rows,24,165,"DO NOT RESUBMIT",1);
  if(current.single_loaded)text(pixels,row,rows,24,195,"KEEP MEMBER NEARBY",1);
  return;
 }
 if(ui.page==PC_BATCH_RUNNING||ui.page==PC_BATCH_SUCCESS||ui.page==PC_BATCH_PARTIAL||ui.page==PC_BATCH_FAILED||ui.page==PC_RECONCILE){
  char line[40];erase(pixels,row,rows,45,85);if(current.active_title_valid)bitmap(pixels,row,rows,24,48,192,32,current.active_title_bitmap);
  erase(pixels,row,rows,185,320);
  snprintf(line,sizeof(line),"%u SIGNED",(unsigned)current.batch.signed_count);text(pixels,row,rows,20,202,line,2);
  snprintf(line,sizeof(line),"%u NOT SAVED",(unsigned)current.batch.failed);text(pixels,row,rows,20,236,line,2);
  if(ui.page==PC_BATCH_RUNNING){snprintf(line,sizeof(line),"%u REMAINING",(unsigned)current.batch.pending);text(pixels,row,rows,20,270,line,1);}
 }
 if(ui.page==PC_ROSTER){
  erase(pixels,row,rows,40,320);
  if(current.roster_valid){for(unsigned i=0;i<current.roster.count;i++){if(current.roster.members[i].name_bitmap_valid)bitmap(pixels,row,rows,10,65+(int)i*30,192,16,current.roster.members[i].name_bitmap);text(pixels,row,rows,208,70+(int)i*30,current.roster.members[i].signed_in?"OK":"--",1);}
   char range[40];snprintf(range,sizeof(range),"%u-%u / %u",(unsigned)(current.roster.total?current.roster.offset+1:0),(unsigned)(current.roster.offset+current.roster.count),(unsigned)current.roster.total);text(pixels,row,rows,20,280,range,2);
  }
  else text(pixels,row,rows,10,130,"SYNCING ROSTER",2);
 }
 if(ui.page==PC_BIND){
  if(current.binding==PC_BIND_WAITING){erase(pixels,row,rows,132,190);text(pixels,row,rows,62,142,current.code,4);erase(pixels,row,rows,240,285);}
  else if(current.binding==PC_BIND_CONFIRM){text(pixels,row,rows,15,75,"BIND ACCOUNT",2);if(current.member_label_bitmap_valid)bitmap(pixels,row,rows,24,110,192,32,current.member_label_bitmap);text(pixels,row,rows,15,180,"OK: CONFIRM",2);text(pixels,row,rows,15,220,"HOLD OK: REJECT",1);}
  else {erase(pixels,row,rows,0,320);text(pixels,row,rows,15,75,"BIND ACCOUNT",2);
   const char *status=current.binding==PC_BIND_CHECKING?"CHECKING ACCOUNT...":current.binding==PC_BIND_REVOKED?"BINDING REVOKED":current.binding==PC_BIND_STORAGE_ERROR?"SAVE ERROR":"SERVICE UNAVAILABLE";
   text(pixels,row,rows,12,140,status,1);text(pixels,row,rows,12,180,current.binding==PC_BIND_REVOKED?"CONTACT WEBSITE SUPPORT":"WAITING TO RETRY",1);
  }
 }

 if(ui.page==PC_FRIEND_CODE){
  erase(pixels,row,rows,90,320);
  const pc_friend_session *session=&current.friend_flow.session;
  text(pixels,row,rows,72,140,session->code[0]?session->code:"----",4);
  const char *status=current.unresolved?"CHECKING RESULT":current.friend_flow.timed_out?"HOLD UP: RETRY":!session->code[0]?"SEARCHING...":current.friend_confirmed?"WAITING FOR PEER":"DOWN: CONFIRM";
  text(pixels,row,rows,20,240,status,2);
 }
 if(ui.page==PC_FRIEND_DONE)text(pixels,row,rows,18,294,"OK: BACK TO PLANET",1);

 if(ui.page==PC_BOUND)text(pixels,row,rows,36,298,"OK: CONTINUE",2);
}
static const pc_screen_asset *themed(const char *title){
 static const char *colors[]={"草绿","粉色","天蓝","杏色"};char key[128];snprintf(key,sizeof(key),"%s|%s",title,colors[current.palette<4?current.palette:0]);return pc_screen_find(key);
}
static const pc_screen_asset *screen(void){
 if(current.service!=PC_NET_READY)return NULL;
 if(ui.help){
  const char *guide=ui.page==PC_PLANET?"星球页按键说明":ui.page==PC_NAME?"修正后的名字按键说明":ui.page==PC_FRIEND_CODE?"交友核对页按键说明":ui.page==PC_FRIEND_DONE?"交友成功停留按键说明":ui.page==PC_ROSTER?"总名单按键说明":ui.page==PC_BATCH_SUCCESS?"全部成功按键说明":(ui.page==PC_BATCH_PARTIAL||ui.page==PC_BATCH_FAILED)?"部分成功/失败按键说明":"等待成员按键说明";
  return themed(guide);
 }
 if(ui.page==PC_FRIEND_CODE)return themed("核对码");
 if(ui.page==PC_FRIEND_DONE)return NULL;
 if(ui.page==PC_LOADING||ui.page==PC_FRIEND_ANIMATION)return NULL;
 if(ui.page==PC_HOST)return themed(current.candidate.device_id[0]?(current.candidate_nearby?"选择成员":"当前成员离开"):"等待成员");
 if(ui.page==PC_SINGLE_SAVING)return themed("保存中");
 if(ui.page==PC_SINGLE_SUCCESS)return themed("签到成功");
 if(ui.page==PC_SINGLE_FAILED)return themed("保存失败");
 if(ui.page==PC_BATCH_RUNNING)return themed("批量处理中");
 if(ui.page==PC_BATCH_SUCCESS)return themed("全部成功");
 if(ui.page==PC_BATCH_PARTIAL)return themed("部分成功");
 if(ui.page==PC_BATCH_FAILED)return themed("全部失败");
 if(ui.page==PC_RECONCILE)return themed("重连后核对");
 if(ui.page==PC_ROSTER)return themed("总名单首屏");
 if(ui.page==PC_WIFI)return pc_screen_find("Wi-Fi 配网|中性色");
 if(ui.page==PC_BIND&&current.binding==PC_BIND_WAITING)return pc_screen_find("官网绑定码|中性色");
 if(ui.page==PC_BOUND){static const char *keys[]={"绑定成功|草绿","绑定成功|粉色","绑定成功|天蓝","绑定成功|杏色"};return pc_screen_find(keys[current.palette<4?current.palette:0]);}
 if(ui.page==PC_HELLO)return pc_screen_find(welcome_frames[current.palette<4?current.palette:0][animation_frame].key);
 return NULL;
}
static bool send(pc_net_command_kind kind,pc_page page,uint32_t pressed){
 pc_net_command command={.kind=kind,.source_page=page,.pressed_ms=pressed,.serial=++command_serial,.roster_offset=roster_offset};memcpy(command.activity_id,current.active_activity_id,37);memcpy(command.peer_device_id,current.candidate.device_id,37);memcpy(command.request_id,current.request_id,37);memcpy(command.friend_id,current.friend_flow.session.interaction_id,37);memcpy(command.friend_code,current.friend_flow.session.code,5);
 if(!pc_network_worker_send(&command)){ESP_LOGW("popcity","Network command queue full");return false;}
 if(kind==PC_NET_BATCH_START||kind==PC_NET_BATCH_RETRY||kind==PC_NET_SINGLE_SUBMIT)awaiting_batch=command.serial;
 return true;
}
void app_main(void){
 inputs=xQueueCreate(12,sizeof(input_event));
 if(!inputs||pc_panel_start()!=ESP_OK){ESP_LOGE("popcity","Display/input queue initialization failed");return;}
 if(bsp_button_init(button,NULL)!=ESP_OK){ESP_LOGE("popcity","Button initialization failed");return;}
 if(pc_network_worker_start()!=ESP_OK){ESP_LOGE("popcity","Worker initialization failed");return;}
 (void)pc_display_status_start();
 bool initialized=false,dirty=true;pc_page drawn=PC_WIFI;bool previous_help=false;
 for(;;){
  bool previous_friend_active=current.friend_flow.active,previous_batch_known=current.batch.known;
  pc_batch_phase previous_batch_phase=current.batch.phase;
  if(pc_network_worker_view(&current)){
   bool friend_closed=previous_friend_active&&!current.friend_flow.active;
   bool batch_changed=previous_batch_phase!=current.batch.phase||previous_batch_known!=current.batch.known;
   dirty=true;
   if(!feedback_initialized){last_pulse=current.pulse_sequence;feedback_initialized=true;}
   else if(last_pulse!=current.pulse_sequence){last_pulse=current.pulse_sequence;if(terminal_wifi_is_connected()){pulse_at=millis();pulse_active=true;bsp_display_backlight(100);}}
   if(current.wifi_ready&&terminal_wifi_is_connected())offline_latched=false;

   if(awaiting_batch&&current.command_serial==awaiting_batch)awaiting_batch=0;
   if(!initialized&&current.service==PC_NET_READY){pc_init(&ui,current.hello_skipped,current.bound);initialized=true;}
   if(initialized&&!offline_latched){if(ui.page==PC_HELLO&&current.hello_skipped)pc_hello_saved(&ui,true,millis());pc_facts(&ui,current.wifi_ready,current.bound,current.host_active,millis());
    if(!awaiting_batch&&current.wifi_ready&&current.bound){
     if(current.flow_page==PC_FRIEND_ANIMATION&&ui.friend_resume!=PC_FRIEND_ANIMATION&&ui.friend_resume!=PC_FRIEND_DONE&&current.friend_flow.session.interaction_id[0]&&strcmp(played_friend_id,current.friend_flow.session.interaction_id)){memcpy(played_friend_id,current.friend_flow.session.interaction_id,37);pc_friend_saved(&ui,millis());}

     if(current.unresolved){ui.unresolved=true;ui.help=false;ui.page=current.friend_flow.active?PC_FRIEND_CODE:current.flow_page==PC_BATCH_RUNNING?PC_BATCH_RUNNING:current.flow_page==PC_SINGLE_SAVING?PC_SINGLE_SAVING:PC_RECONCILE;}
     else if(current.friend_flow.active){ui.unresolved=false;if(ui.page!=PC_FRIEND_CODE){ui.help=false;ui.page=PC_FRIEND_CODE;}}
     else if(ui.unresolved||(friend_closed&&current.flow_page!=PC_FRIEND_ANIMATION&&current.flow_page!=PC_FRIEND_DONE)||(batch_changed&&current.batch.loaded&&current.batch.known)){
      pc_resolved(&ui,current.flow_page==PC_LOADING?current.flow_target:current.flow_page,millis());
     }
    }
   }
  }
  if(initialized&&!terminal_wifi_is_connected()){
   if(!offline_latched){offline_latched=true;atomic_fetch_add(&epoch,1);dirty=true;}
   pc_facts(&ui,false,current.bound,current.host_active,millis());
  }
  if(pulse_active&&((uint32_t)(millis()-pulse_at)>=1000||!terminal_wifi_is_connected())){pulse_active=false;bsp_display_backlight(80);}
  if((uint32_t)(millis()-status_at)>=5000){status_at=millis();int soc=pc_display_battery();wifi_ap_record_t ap;int strength=0;
   if(esp_wifi_sta_get_ap_info(&ap)==ESP_OK)strength=ap.rssi>=-55?4:ap.rssi>=-65?3:ap.rssi>=-75?2:1;
   dirty|=soc!=battery||strength!=wifi_strength;battery=soc;wifi_strength=strength;
  }
  uint32_t now=millis();
  if(ui.page==PC_NAME&&!ui.help&&!ui.name_paused)name_elapsed+=(uint32_t)(now-name_tick);
  name_tick=now;
  pc_tick(&ui,now);
  if(ui.page==PC_FRIEND_ANIMATION&&drawn==PC_FRIEND_ANIMATION&&(!current.friend_flow.session.visual.valid||(uint32_t)(millis()-animation_at)>=PC_FRIEND_ANIMATION_MS)){pc_friend_animation_done(&ui);(void)send(PC_NET_FRIEND_DONE,PC_FRIEND_ANIMATION,millis());dirty=true;}
  if(!ui.help&&(ui.page==PC_FRIEND_ANIMATION||ui.page==PC_PLANET||(ui.page==PC_NAME&&!ui.name_paused))&&(uint32_t)(now-visual_tick)>=100){visual_tick=now;dirty=true;}

  if(ui.page==PC_HELLO){
   unsigned palette=current.palette<4?current.palette:0,total=0;
   for(unsigned i=0;i<42;i++)total+=welcome_frames[palette][i].duration;
   unsigned elapsed=(uint32_t)(millis()-animation_at)%total,frame=0;
   while(frame<41&&elapsed>=welcome_frames[palette][frame].duration){elapsed-=welcome_frames[palette][frame].duration;frame++;}
   if(animation_frame!=frame){animation_frame=frame;dirty=true;}
  }
  if(drawn!=ui.page||previous_help!=ui.help){if(drawn!=ui.page){animation_at=millis();animation_frame=0;if(ui.page==PC_NAME)name_elapsed=0;}atomic_fetch_add(&epoch,1);drawn=ui.page;previous_help=ui.help;dirty=true;}
  input_event input;
  while(xQueueReceive(inputs,&input,0)==pdTRUE){
   if(!initialized||offline_latched||!terminal_wifi_is_connected()||input.epoch!=atomic_load(&epoch))continue;
   if(ui.page==PC_BIND){if(current.binding==PC_BIND_CONFIRM&&input.key==PC_OK)send(input.hold?PC_NET_BIND_REJECT:PC_NET_BIND_ACCEPT,PC_BIND,input.ms);continue;}
   pc_page source=ui.page;pc_action action=pc_press(&ui,input.key,input.hold,millis());
   if(source==PC_BOUND&&input.key==PC_OK&&!input.hold)send(PC_NET_BOUND_CONTINUE,source,input.ms);
   if(action==PC_SAVE_HELLO)send(PC_NET_SAVE_HELLO,source,input.ms);
   if(action==PC_FRIEND_START)send(PC_NET_FRIEND_START,source,input.ms);
   if(action==PC_FRIEND_CONFIRM)send(PC_NET_FRIEND_CONFIRM,source,input.ms);
   if(action==PC_FRIEND_CANCEL)send(PC_NET_FRIEND_CANCEL,source,input.ms);
   if(source==PC_FRIEND_DONE&&ui.page==PC_LOADING)send(PC_NET_FRIEND_DONE,source,input.ms);
   if(action==PC_CHANGE_NETWORK)send(PC_NET_SETUP,source,input.ms);
   if(action==PC_SINGLE_SUBMIT&&current.candidate_valid){if(send(PC_NET_SINGLE_SUBMIT,source,input.ms))pc_operation_started(&ui,PC_SINGLE_SAVING);}
   if(action==PC_MEMBER_PREVIOUS||action==PC_MEMBER_NEXT)(void)send(action==PC_MEMBER_PREVIOUS?PC_NET_MEMBER_PREVIOUS:PC_NET_MEMBER_NEXT,source,input.ms);
   if(action==PC_BATCH_CREATE||action==PC_BATCH_RETRY){if(send(action==PC_BATCH_CREATE?PC_NET_BATCH_START:PC_NET_BATCH_RETRY,source,input.ms))pc_operation_started(&ui,PC_BATCH_RUNNING);}
   if((source==PC_BATCH_SUCCESS||source==PC_BATCH_PARTIAL||source==PC_BATCH_FAILED)&&ui.page==PC_LOADING)(void)send(PC_NET_BATCH_DISMISS,source,input.ms);
   if(action==PC_ROSTER_PREVIOUS||action==PC_ROSTER_NEXT){
    if(action==PC_ROSTER_PREVIOUS&&roster_offset)roster_offset--;
    if(action==PC_ROSTER_NEXT&&current.roster_valid&&roster_offset+PC_ROSTER_PAGE_SIZE<current.roster.total)roster_offset++;
    (void)send(PC_NET_ROSTER_PAGE,PC_ROSTER,input.ms);
   }
   if(ui.page==PC_LOADING&&ui.target==PC_ROSTER){roster_offset=0;(void)send(PC_NET_ROSTER_PAGE,PC_ROSTER,input.ms);}
   if(action!=PC_NONE&&action!=PC_SAVE_HELLO&&action!=PC_CHANGE_NETWORK&&action!=PC_BATCH_CREATE&&action!=PC_BATCH_RETRY&&action!=PC_ROSTER_PREVIOUS&&action!=PC_ROSTER_NEXT&&action!=PC_MEMBER_PREVIOUS&&action!=PC_MEMBER_NEXT&&action!=PC_SINGLE_SUBMIT&&action!=PC_FRIEND_START&&action!=PC_FRIEND_CONFIRM&&action!=PC_FRIEND_CANCEL)ESP_LOGW("popcity","Integration action pending: %d",(int)action);
   if(source!=ui.page){atomic_fetch_add(&epoch,1);drawn=ui.page;animation_at=millis();animation_frame=0;if(ui.page==PC_NAME)name_elapsed=0;}dirty=true;
  }
  if(dirty){render_elapsed=millis()-animation_at;if(pc_panel_present(screen(),overlay,NULL)!=ESP_OK){ESP_LOGE("popcity","Display transfer failed; stopped to protect DMA buffer");return;}dirty=false;}
  vTaskDelay(pdMS_TO_TICKS(20));
 }
}
