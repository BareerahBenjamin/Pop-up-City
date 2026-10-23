/* Product integration entry. Not a release until product-readiness gates pass. */
#include "network_worker.h"
#include "memory_report.h"
#include "panel_renderer.h"
#include "terminal_wifi.h"
#include "personal_visual.h"
#include "cjk_name.h"
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
typedef struct {pc_key key;bool hold,double_click;uint32_t ms,epoch;} input_event;
typedef struct {uint32_t ms,epoch;uint8_t key,event;} diag_key_event;
static QueueHandle_t inputs,diag_keys;
static atomic_uint diag_key_dropped;


static atomic_uint epoch;
static uint32_t press_epoch[3],press_ms[3];
static bool held_long[3];
static uint32_t animation_at,memory_at;
static unsigned animation_frame;
static uint32_t command_serial,awaiting_batch,roster_offset;
static uint32_t pulse_at,last_pulse,status_at,name_elapsed,name_tick,visual_tick,render_elapsed;
static bool pulse_active,feedback_initialized,offline_latched;
static int battery=-1,wifi_strength;
static char played_friend_id[37];
static pc_state ui;
static void diag_page(pc_page before,const char *reason){if(before!=ui.page)ESP_LOGI("pc_diag_page","from=%d to=%d target=%d reason=%s",before,ui.page,ui.target,reason);}
static pc_net_view current;
static uint32_t millis(void){return (uint32_t)(esp_timer_get_time()/1000);}
static void button(bsp_btn_t key,bsp_btn_ev_t event,void *unused){
 (void)unused;if((unsigned)key>=3)return;
 diag_key_event diagnostic={.ms=millis(),.epoch=atomic_load(&epoch),.key=(uint8_t)key,.event=(uint8_t)event};
 if(diag_keys&&xQueueSend(diag_keys,&diagnostic,0)!=pdTRUE)atomic_fetch_add(&diag_key_dropped,1);
 if(event==BSP_BTN_PRESS){press_epoch[key]=atomic_load(&epoch);press_ms[key]=millis();held_long[key]=false;return;}
 if(event!=BSP_BTN_LONG&&event!=BSP_BTN_CLICK&&event!=BSP_BTN_DOUBLE)return;
 if(event==BSP_BTN_DOUBLE&&key!=BSP_BTN_UP)return;
 if((event==BSP_BTN_CLICK||event==BSP_BTN_DOUBLE)&&held_long[key])return;
 if(event==BSP_BTN_LONG)held_long[key]=true;
 input_event input={.key=(pc_key)key,.hold=event==BSP_BTN_LONG,.double_click=event==BSP_BTN_DOUBLE,.ms=press_ms[key],.epoch=press_epoch[key]};
 (void)xQueueSend(inputs,&input,0);
}
static int clip_left=0,clip_right=240;
static void text(uint16_t *pixels,unsigned row,unsigned rows,int x,int y,const char *string,unsigned scale){
 for(unsigned n=0;string[n];n++){
  unsigned char c=(unsigned char)string[n];if(c>=128)c='?';
  for(unsigned gy=0;gy<7;gy++)for(unsigned gx=0;gx<5;gx++)if(pixel_glyphs[c][gy]&(1u<<(4-gx)))
   for(unsigned sy=0;sy<scale;sy++)for(unsigned sx=0;sx<scale;sx++){
    int px=x+(int)((n*6+gx)*scale+sx),py=y+(int)(gy*scale+sy);
    if(px>=clip_left&&px<clip_right&&py>=(int)row&&py<(int)(row+rows))pixels[(py-(int)row)*240+px]=ui.help?0xffff:ui.page==PC_WIFI?(y==238?63422u:38131u):ui.page==PC_BIND?(y==141||y==121||y==110?63422u:38131u):current.service==PC_NET_READY?(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0]:0xffff;
   }
 }
}
static void centered_text(uint16_t *pixels,unsigned row,unsigned rows,int y,const char *value,unsigned scale){
 int width=(int)(strlen(value)*6*scale)-(int)scale;
 text(pixels,row,rows,(240-width)/2,y,value,scale);
}
static void bitmap(uint16_t *,unsigned,unsigned,int,int,unsigned,unsigned,const uint8_t *);
/* Approved fixed text window: retain font size and scroll inside it. */
static unsigned scroll_offset(unsigned width,unsigned window,uint32_t ms){
 if(width<=window)return 0;
 unsigned phase=ms%(800+(width+24)*40);return phase<800?0:(phase-800)/40;
}
static void window_text(uint16_t *pixels,unsigned row,unsigned rows,int left,int top,unsigned window,const char *value,unsigned scale){
 unsigned width=(unsigned)strlen(value)*6*scale;
 clip_left=left;clip_right=left+(int)window;
 int x=width<=window?left+((int)window-(int)width+(int)scale)/2:left-(int)scroll_offset(width,window,render_elapsed);
 text(pixels,row,rows,x,top,value,scale);
 if(width>window)text(pixels,row,rows,x+(int)width+24,top,value,scale);
 clip_left=0;clip_right=240;
}
static void binding_name(uint16_t *pixels,unsigned row,unsigned rows,int top){
 unsigned width=current.member_label_width?current.member_label_width:192;
 if(width<=192){bitmap(pixels,row,rows,25,top,192,32,current.member_label_bitmap);return;}
 unsigned offset=scroll_offset(width,192,render_elapsed);
 for(unsigned y=0;y<16;y++)if(top+8+(int)y>=(int)row&&top+8+(int)y<(int)(row+rows))for(unsigned x=0;x<192;x++){
  unsigned sx=(x+offset)%(width+24);if(sx<width&&(current.member_label_bitmap[y*(width/8)+sx/8]&(128u>>(sx%8))))pixels[(top+8+y-row)*240+25+x]=63422u;
 }
}
static void bitmap(uint16_t *pixels,unsigned row,unsigned rows,int x,int y,unsigned width,unsigned height,const uint8_t *bits){
 uint16_t color=ui.page==PC_BIND?63422u:(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0];
 for(unsigned gy=0;gy<height;gy++)if(y+(int)gy>=(int)row&&y+(int)gy<(int)(row+rows))for(unsigned gx=0;gx<width;gx++)if((ui.page!=PC_ROSTER||gx<96)&&x+(int)gx>=0&&x+(int)gx<240&&(bits[gy*(width/8)+gx/8]&(128u>>(gx%8))))pixels[(y+(int)gy-(int)row)*240+x+(int)gx]=color;
}
static void bitmap_half(uint16_t *pixels,unsigned row,unsigned rows,int left,int top,unsigned width,unsigned height,const uint8_t *bits){
 uint16_t color=(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0];
 for(unsigned y=0;y<height/2;y++)for(unsigned x=0;x<width/2;x++){
  bool on=false;for(unsigned dy=0;dy<2;dy++)for(unsigned dx=0;dx<2;dx++)on|=(bits[(y*2+dy)*(width/8)+(x*2+dx)/8]&(128u>>((x*2+dx)%8)))!=0;
  if(on&&left+(int)x>=0&&left+(int)x<240&&top+(int)y>=(int)row&&top+(int)y<(int)(row+rows))pixels[(top+y-row)*240+left+x]=color;
 }
}
extern const uint8_t pc_cjk_start[] asm("_binary_cjk_font_bin_start");
extern const uint8_t pc_cjk_end[] asm("_binary_cjk_font_bin_end");
static void activity_title(uint16_t *pixels,unsigned row,unsigned rows,int top){
 if(current.active_title[0]){(void)pc_pixel_line_strip(pc_cjk_start,(size_t)(pc_cjk_end-pc_cjk_start),current.active_title,render_elapsed,24,top,192,row,rows,pixels,(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0]);}
 else if(current.active_title_valid)bitmap_half(pixels,row,rows,72,top,192,32,current.active_title_bitmap);
}
static void erase(uint16_t *pixels,unsigned row,unsigned rows,unsigned top,unsigned bottom){
 for(unsigned y=row;y<row+rows;y++)if(y>=top&&y<bottom)memset(pixels+(y-row)*240,0,480);
}
static void overlay(void *unused,unsigned row,unsigned rows,uint16_t *pixels){
 (void)unused;
 if(current.service!=PC_NET_READY)return;
 if(current.wifi_ready&&!current.backend_ready&&current.backend_syncing)return;
 if(ui.help){
  for(unsigned y=row;y<row+rows;y++)if(y>=18&&y<32)for(unsigned x=160;x<198;x++)pixels[(y-row)*240+x]=0x0041;
  char percentage[8];
  snprintf(percentage,sizeof(percentage),battery>=0?"%d%%":"--%%",battery);
  text(pixels,row,rows,168,21,percentage,1);
  /* Signal and battery outlines use the exact source guide artwork. */

  return;
 }
 if(current.change_network!=PC_CHANGE_NONE){
  if(current.change_network==PC_CHANGE_READY){erase(pixels,row,rows,80,112);(void)pc_pixel_line_strip(pc_cjk_start,(size_t)(pc_cjk_end-pc_cjk_start),current.current_ssid[0]?current.current_ssid:"----",render_elapsed,24,88,192,row,rows,pixels,(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0]);}
  return;
 }
 if(ui.page==PC_LOADING)return;
 if(ui.page==PC_PLANET){if(!current.personal.valid){text(pixels,row,rows,60,150,"loading...",2);return;}pc_personal_planet_overlay(&current.personal,render_elapsed,row,rows,pixels);
  char owner[144],display_name[129];size_t cut=0;unsigned count=0;
  for(size_t i=0;current.personal.name[i];i++)if(((unsigned char)current.personal.name[i]&0xc0)!=0x80){if(count==4)cut=i;count++;}
  if(count>7){memcpy(display_name,current.personal.name,cut);memcpy(display_name+cut,"...",4);}else snprintf(display_name,sizeof(display_name),"%s",current.personal.name);
  snprintf(owner,sizeof(owner),"%s'S PLANET",display_name);
  for(char *c=owner;*c;c++)if(*c>='a'&&*c<='z')*c=(char)(*c-'a'+'A');
  (void)pc_pixel_line_strip(pc_cjk_start,(size_t)(pc_cjk_end-pc_cjk_start),owner,0,24,274,192,row,rows,pixels,(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.personal.palette]);return;}
 if(ui.page==PC_NAME){centered_text(pixels,row,rows,36,"HELLO",2);if(!current.personal.valid){text(pixels,row,rows,60,150,"loading...",2);return;}pc_personal_name_overlay(&current.personal,name_elapsed,row,rows,pixels);return;}
 if(ui.page==PC_FRIEND_ANIMATION||ui.page==PC_FRIEND_DONE){
  erase(pixels,row,rows,0,320);
  if(ui.page==PC_FRIEND_ANIMATION&&render_elapsed<300){
   int rise=(int)(render_elapsed/25);centered_text(pixels,row,rows,66-rise,"FRIEND PAIRING",2);centered_text(pixels,row,rows,106-rise,"SAME CODE?",2);
   centered_text(pixels,row,rows,145-rise,current.friend_flow.session.code[0]?current.friend_flow.session.code:"----",4);
   unsigned brightness=300-render_elapsed;for(unsigned i=0;i<rows*240;i++){uint16_t c=pixels[i];pixels[i]=(uint16_t)(((((c>>11)&31)*brightness/300)<<11)|((((c>>5)&63)*brightness/300)<<5)|((c&31)*brightness/300));}
   return;
  }
  pc_friend_visual effective;pc_friend_visual_effective(&current.friend_flow.session.visual,&effective);
  const pc_friend_visual *visual=&effective;
  {pc_friend_visual_strip_tinted(pixels,row,rows,ui.page==PC_FRIEND_DONE?PC_FRIEND_ANIMATION_MS:render_elapsed-300,visual,(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0]);}
  centered_text(pixels,row,rows,66,"FRIEND ADDED",2);
  if(ui.page==PC_FRIEND_DONE)centered_text(pixels,row,rows,294,"OK TO RETURN TO PLANET",1);

  return;
 }
 if(ui.page==PC_WIFI){
  if(current.network.phase==PC_WIFI_PROVISIONING){
   erase(pixels,row,rows,290,304);
   if(current.bluetooth_name[0]&&strlen(current.bluetooth_name)<=20)centered_text(pixels,row,rows,290,current.bluetooth_name,2);
  }
  return;
 }

 if(ui.page==PC_HOST||ui.page==PC_SINGLE_SAVING||ui.page==PC_SINGLE_SUCCESS||ui.page==PC_SINGLE_FAILED){
  erase(pixels,row,rows,65,92);activity_title(pixels,row,rows,72);
  erase(pixels,row,rows,95,225);if(current.personal.valid)pc_personal_planet_at(&current.personal,render_elapsed,row,rows,pixels,56,94,128);
  erase(pixels,row,rows,228,320);
  if(current.candidate.device_id[0]){
   bitmap(pixels,row,rows,24,228,192,32,current.candidate.name_bitmap);
   if(ui.page==PC_HOST){text(pixels,row,rows,54,238,">",2);text(pixels,row,rows,174,238,"<",2);}
   if(ui.page==PC_HOST&&!current.candidate_nearby)centered_text(pixels,row,rows,264,"OUT OF RANGE",2);
   else if(ui.page==PC_HOST){char count[24];snprintf(count,sizeof(count),"%u NEARBY",(unsigned)current.nearby_count);centered_text(pixels,row,rows,264,count,2);}
  }else if(ui.page==PC_HOST){centered_text(pixels,row,rows,238,"WAITING...",2);centered_text(pixels,row,rows,264,"0 NEARBY",2);}
  if(ui.page==PC_SINGLE_SAVING)centered_text(pixels,row,rows,264,"SAVING...",2);
  if(ui.page==PC_SINGLE_SUCCESS)centered_text(pixels,row,rows,264,"CHECKED IN!",2);
  if(ui.page==PC_SINGLE_FAILED)centered_text(pixels,row,rows,264,"NOT SAVED",2);
 }
 if(ui.page==PC_BATCH_RUNNING||ui.page==PC_BATCH_SUCCESS||ui.page==PC_BATCH_PARTIAL||ui.page==PC_BATCH_FAILED||ui.page==PC_RECONCILE){
  unsigned shift=ui.page==PC_BATCH_SUCCESS?24u:0u;
  char line[40];erase(pixels,row,rows,43+shift,82+shift);activity_title(pixels,row,rows,52+(int)shift);
  erase(pixels,row,rows,82+shift,180+shift);if(current.personal.valid)pc_personal_planet_at(&current.personal,render_elapsed,row,rows,pixels,72,80+(int)shift,96);
  erase(pixels,row,rows,185+shift,320);
  if(ui.page==PC_RECONCILE){centered_text(pixels,row,rows,201,"CHECKING...",2);centered_text(pixels,row,rows,233,"PLEASE WAIT",2);}
  else if(ui.page==PC_BATCH_RUNNING){
   centered_text(pixels,row,rows,201,"SAVING...",2);
   unsigned processed=current.batch.total>current.batch.pending?current.batch.total-current.batch.pending:0;
   snprintf(line,sizeof(line),"%u/%u PROCESSED",processed,(unsigned)current.batch.total);centered_text(pixels,row,rows,233,line,2);
   unsigned filled=current.batch.total?154u*processed/current.batch.total:0;
   for(unsigned y=row;y<row+rows;y++)for(unsigned x=42;x<198;x++)if(y>=267&&y<=275&&(y==267||y==275||x==42||x==197||(y>=270&&y<=272&&x<43+filled)))pixels[(y-row)*240+x]=(const uint16_t[]){0xdf34,0xf679,0xcf3e,0xfed5}[current.palette<4?current.palette:0];
  }else if(ui.page==PC_BATCH_SUCCESS){centered_text(pixels,row,rows,225,"ALL SIGNED",2);snprintf(line,sizeof(line),"%u/%u",(unsigned)current.batch.signed_count,(unsigned)current.batch.total);centered_text(pixels,row,rows,256,line,3);}
  else {snprintf(line,sizeof(line),"%u SIGNED",(unsigned)current.batch.signed_count);centered_text(pixels,row,rows,201,line,2);snprintf(line,sizeof(line),"%u NOT SAVED",(unsigned)current.batch.failed);centered_text(pixels,row,rows,233,line,2);}
 }
 if(ui.page==PC_ROSTER){
  /* Title ends before ROSTER; never erase the ROSTER heading. */
  erase(pixels,row,rows,31,64);activity_title(pixels,row,rows,40);
  erase(pixels,row,rows,104,288);
  if(current.roster_valid){for(unsigned i=0;i<current.roster.count;i++){if(current.roster.members[i].name_bitmap_valid)bitmap(pixels,row,rows,18,110+(int)i*26,192,16,current.roster.members[i].name_bitmap);text(pixels,row,rows,138,110+(int)i*26,current.roster.members[i].signed_in?"SIGNED":"PENDING",2);}
   char range[40];erase(pixels,row,rows,295,320);snprintf(range,sizeof(range),"%u-%u / %u",(unsigned)(current.roster.total?current.roster.offset+1:0),(unsigned)(current.roster.offset+current.roster.count),(unsigned)current.roster.total);centered_text(pixels,row,rows,302,range,2);
  }else centered_text(pixels,row,rows,150,"SYNCING...",2);
 }

 if(ui.page==PC_BIND){
  if(current.binding==PC_BIND_REJECTED)return;
  if(current.binding==PC_BIND_WAITING){
   if((uint32_t)(millis()-current.binding_updated_ms)/1000>=current.binding_valid_seconds)return;
   erase(pixels,row,rows,132,190);centered_text(pixels,row,rows,141,current.code[0]?current.code:"----",5);
   erase(pixels,row,rows,240,266);
   uint32_t elapsed=(uint32_t)(millis()-current.binding_updated_ms)/1000;
   unsigned remaining=current.binding_valid_seconds>elapsed?current.binding_valid_seconds-elapsed:0;
   char validity[24];snprintf(validity,sizeof(validity),"VALID %02u:%02u",remaining/60,remaining%60);
   centered_text(pixels,row,rows,245,validity,2);
  }else if(current.binding==PC_BIND_CONFIRM||current.binding==PC_BIND_CHECKING){
   bool checking=current.binding==PC_BIND_CHECKING;
   erase(pixels,row,rows,checking?100:110,checking?140:171);
   if(current.member_label_bitmap_valid)binding_name(pixels,row,rows,checking?100:112);
   else {
    bool latin=current.member_label[0]!=0;for(const unsigned char *c=(const unsigned char *)current.member_label;*c;c++)if(*c<32||*c>=127)latin=false;
    const char *label=latin?current.member_label:"SYNCING NAME";
    centered_text(pixels,row,rows,checking?110:121,label,strlen(label)<=18?2:1);
   }
   if(!checking){window_text(pixels,row,rows,24,154,192,current.member_hint,1);erase(pixels,row,rows,198,224);char code[16];snprintf(code,sizeof(code),"CODE %s",current.code[0]?current.code:"----");centered_text(pixels,row,rows,205,code,2);}

  }
 }


 if(ui.page==PC_FRIEND_CODE){
  erase(pixels,row,rows,138,178);const pc_friend_session *session=&current.friend_flow.session;
  centered_text(pixels,row,rows,145,current.friend_flow.active&&session->code[0]?session->code:"----",4);

 }


 /* Binding success uses the supplied BOUND! / YOUR PLANET! artwork; OK still continues. */
}
static const pc_screen_asset *themed(const char *title){
 static const char *colors[]={"草绿","粉色","天蓝","杏色"};char key[128];snprintf(key,sizeof(key),"%s|%s",title,colors[current.palette<4?current.palette:0]);return pc_screen_find(key);
}
static const pc_screen_asset *screen(void){
 if(current.service!=PC_NET_READY)return pc_screen_find("官网暂不可用|中性色");
 if(current.wifi_ready&&!current.backend_ready&&current.backend_syncing)return pc_screen_find("加载页|中性色");
 if(current.change_network!=PC_CHANGE_NONE){
  if(ui.help)return themed("换网按键说明");
  const char *title=current.change_network==PC_CHANGE_READY?"准备换网":current.change_network==PC_CHANGE_CONNECTING?"连接新网络":current.change_network==PC_CHANGE_SUCCESS?"换网成功":current.change_network==PC_CHANGE_FAILED?"换网失败":"恢复旧网络";
  return themed(title);
 }
 if(ui.help){
  const char *guide=ui.page==PC_PLANET?"星球页按键说明":ui.page==PC_NAME?"修正后的名字按键说明":ui.page==PC_FRIEND_CODE?"交友核对页按键说明":ui.page==PC_HOST?"签到页按键说明":ui.page==PC_ROSTER?"总名单按键说明":ui.page==PC_BATCH_SUCCESS?"全部成功按键说明":(ui.page==PC_BATCH_PARTIAL||ui.page==PC_BATCH_FAILED)?"部分成功/失败按键说明":"签到页按键说明";
  return themed(guide);
 }
 if(ui.page==PC_FRIEND_CODE)return themed(current.friend_flow.active&&current.friend_flow.session.code[0]?"核对码":"交友寻找中");
 if(ui.page==PC_FRIEND_DONE)return NULL;
 if(ui.page==PC_LOADING)return current.bound?themed("加载页"):pc_screen_find("加载页|中性色");
 if(ui.page==PC_FRIEND_ANIMATION)return NULL;
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
 if(ui.page==PC_WIFI){
  /* Credentials are saved; wait for BLUFI teardown, clock and HTTPS on loading. */
  if(current.network.phase==PC_WIFI_SAVED&&current.network.has_ip&&current.network.persisted)return pc_screen_find("加载页|中性色");
  const char *key=current.network.phase==PC_WIFI_PROVISIONING?"配网蓝牙已开启|中性色":current.network.phase==PC_WIFI_CONNECTING?"正在连接|中性色":(current.network.phase==PC_WIFI_FAILED||current.network.phase==PC_WIFI_SAVE_FAILED)?"连接失败|中性色":"Wi-Fi 配网|中性色";
  return pc_screen_find(key);
 }
 if(ui.page==PC_BIND){
  const char *key=current.binding==PC_BIND_WAITING?((uint32_t)(millis()-current.binding_updated_ms)/1000>=current.binding_valid_seconds?"绑定码过期|中性色":"官网绑定码|中性色"):current.binding==PC_BIND_REJECTED?"拒绝绑定|中性色":current.binding==PC_BIND_CONFIRM?"核对绑定账号|中性色":current.binding==PC_BIND_CHECKING?"正在确认绑定|中性色":(current.binding==PC_BIND_SERVICE_ERROR||current.binding==PC_BIND_REVOKED||current.binding==PC_BIND_STORAGE_ERROR)?"官网暂不可用|中性色":NULL;
  return key?pc_screen_find(key):NULL;
 }
 if(ui.page==PC_BOUND){static const char *keys[]={"绑定成功|草绿","绑定成功|粉色","绑定成功|天蓝","绑定成功|杏色"};return pc_screen_find(keys[current.palette<4?current.palette:0]);}
 if(ui.page==PC_HELLO)return pc_screen_find(welcome_frames[current.palette<4?current.palette:0][animation_frame].key);
 return NULL;
}
static bool send(pc_net_command_kind kind,pc_page page,uint32_t pressed){
 pc_net_command command={.kind=kind,.source_page=page,.pressed_ms=pressed,.serial=++command_serial,.roster_offset=roster_offset};memcpy(command.activity_id,current.active_activity_id,37);memcpy(command.peer_device_id,current.candidate.device_id,37);memcpy(command.request_id,current.request_id,37);memcpy(command.friend_id,current.friend_flow.session.interaction_id,37);memcpy(command.friend_code,current.friend_flow.session.code,5);
 if(!pc_network_worker_send(&command)){ESP_LOGW("popcity","Network command queue full");return false;}
 ESP_LOGI("pc_diag_key","command=%d source=%d serial=%u",kind,page,(unsigned)command.serial);
 if(kind==PC_NET_BATCH_START||kind==PC_NET_BATCH_RETRY||kind==PC_NET_SINGLE_SUBMIT)awaiting_batch=command.serial;
 return true;
}
void app_main(void){
 /* Rendering is short and DMA-blocking; keep TLS CPU work below UI priority. */
 vTaskPrioritySet(NULL,5);
 inputs=xQueueCreate(12,sizeof(input_event));diag_keys=xQueueCreate(12,sizeof(diag_key_event));
 if(!inputs||!diag_keys||pc_panel_start()!=ESP_OK){ESP_LOGE("popcity","Display/input queue initialization failed");return;}
 if(bsp_button_init(button,NULL)!=ESP_OK){ESP_LOGE("popcity","Button initialization failed");return;}
 if(pc_network_worker_start()!=ESP_OK){ESP_LOGE("popcity","Worker initialization failed");return;}
 (void)pc_display_status_start();
 bool initialized=false,dirty=true,bound_continue_requested=false;
 pc_page rendered_page=(pc_page)-1;bool rendered_help=false;unsigned rendered_palette=4;
 const pc_screen_asset *rendered_asset=NULL;char rendered_name_version[65]={0};char shown_friend_id[37]={0},shown_friend_code[5]={0};
 uint32_t render_stats_at=0,render_count=0,render_total_us=0,render_max_us=0;pc_page drawn=PC_WIFI;bool previous_help=false;
 for(;;){
  diag_key_event diagnostic;while(xQueueReceive(diag_keys,&diagnostic,0)==pdTRUE)ESP_LOGI("pc_diag_key","raw key=%u event=%u ms=%u epoch=%u",diagnostic.key,diagnostic.event,(unsigned)diagnostic.ms,(unsigned)diagnostic.epoch);
  unsigned dropped=atomic_exchange(&diag_key_dropped,0);if(dropped)ESP_LOGW("pc_diag_key","dropped=%u",dropped);
  pc_page before_snapshot=ui.page;
  bool previous_friend_active=current.friend_flow.active,previous_batch_known=current.batch.known;
  pc_batch_phase previous_batch_phase=current.batch.phase;
  pc_change_network_phase previous_change=current.change_network;
  if(pc_network_worker_view(&current)){
   if(previous_change!=current.change_network){ui.help=false;atomic_fetch_add(&epoch,1);}
   bool friend_closed=previous_friend_active&&!current.friend_flow.active;
   bool batch_changed=previous_batch_phase!=current.batch.phase||previous_batch_known!=current.batch.known;
   dirty=true;
   if(!feedback_initialized){last_pulse=current.pulse_sequence;feedback_initialized=true;}
   else if(last_pulse!=current.pulse_sequence){last_pulse=current.pulse_sequence;if(terminal_wifi_is_connected()){pulse_at=millis();pulse_active=true;bsp_display_backlight(100);}}
   if(current.wifi_ready&&terminal_wifi_is_connected())offline_latched=false;

   if(awaiting_batch&&current.command_serial==awaiting_batch)awaiting_batch=0;
   if(!current.binding_success_pending)bound_continue_requested=false;
   if(!initialized&&current.service==PC_NET_READY){pc_init(&ui,current.hello_skipped,current.bound);initialized=true;}
   if(initialized&&current.wifi_ready&&!current.backend_ready&&!current.backend_recovering){ui.page=PC_BIND;ui.help=false;}
   else if(initialized&&!offline_latched){if(ui.page==PC_HELLO&&current.hello_skipped)pc_hello_saved(&ui,true,millis());pc_facts(&ui,current.wifi_ready,current.bound,current.host_active,millis());
    if(!awaiting_batch&&current.wifi_ready&&current.bound){
     if(ui.page==PC_SINGLE_FAILED&&!current.single_loaded&&!current.unresolved){
      if(current.flow_page==PC_HOST)ui.page=PC_HOST;
      else if(current.flow_page==PC_LOADING&&current.flow_target==PC_SINGLE_SUCCESS)pc_resolved(&ui,PC_SINGLE_SUCCESS,millis());
     }
     if(current.flow_page==PC_FRIEND_ANIMATION&&ui.friend_resume!=PC_FRIEND_ANIMATION&&ui.friend_resume!=PC_FRIEND_DONE&&current.friend_flow.session.interaction_id[0]&&strcmp(played_friend_id,current.friend_flow.session.interaction_id)){memcpy(played_friend_id,current.friend_flow.session.interaction_id,37);pc_friend_saved(&ui,millis());}

     if(current.unresolved){ui.unresolved=true;ui.help=false;ui.page=current.friend_flow.active?PC_FRIEND_CODE:current.flow_page==PC_BATCH_RUNNING?PC_BATCH_RUNNING:current.flow_page==PC_SINGLE_SAVING?PC_SINGLE_SAVING:PC_RECONCILE;}
     else if(current.friend_flow.active){ui.unresolved=false;if(ui.page!=PC_FRIEND_CODE){ui.help=false;ui.page=PC_FRIEND_CODE;}}
     else if(ui.unresolved||(friend_closed&&current.flow_page!=PC_FRIEND_ANIMATION&&current.flow_page!=PC_FRIEND_DONE)||(batch_changed&&current.batch.loaded&&current.batch.known)){
      pc_resolved(&ui,current.flow_page==PC_LOADING?current.flow_target:current.flow_page,millis());
     }
    }
   }
  }
  /* A late first UI snapshot or runtime retry must not skip the newly-bound
   * success artwork. Show it only after the authoritative palette is ready. */
  if(initialized&&current.backend_ready&&current.wifi_ready&&current.bound&&current.binding_success_pending&&!bound_continue_requested){ui.page=PC_BOUND;ui.help=false;}
  diag_page(before_snapshot,"network_snapshot");
  pc_page before_offline=ui.page;
  if(initialized&&!terminal_wifi_is_connected()){
   if(!offline_latched){offline_latched=true;atomic_fetch_add(&epoch,1);dirty=true;}
   pc_facts(&ui,false,current.bound,current.host_active,millis());
  }
  diag_page(before_offline,"wifi_lost");
  if((uint32_t)(millis()-memory_at)>=30000u){memory_at=millis();pc_memory_report("ui");}
  if(pulse_active&&((uint32_t)(millis()-pulse_at)>=1000||!terminal_wifi_is_connected())){pulse_active=false;bsp_display_backlight(80);}
  if((uint32_t)(millis()-status_at)>=5000){status_at=millis();int soc=pc_display_battery();wifi_ap_record_t ap;int strength=0;
   if(esp_wifi_sta_get_ap_info(&ap)==ESP_OK)strength=ap.rssi>=-55?4:ap.rssi>=-65?3:ap.rssi>=-75?2:1;
   dirty|=soc!=battery||strength!=wifi_strength;battery=soc;wifi_strength=strength;
  }
  uint32_t now=millis();
  if(ui.page==PC_NAME&&!ui.help&&!ui.name_paused)name_elapsed+=(uint32_t)(now-name_tick);
  name_tick=now;
  pc_page before_tick=ui.page;pc_tick(&ui,now);diag_page(before_tick,"transition_timer");
  if(ui.page==PC_FRIEND_ANIMATION&&drawn==PC_FRIEND_ANIMATION&&((uint32_t)(millis()-animation_at)>=PC_FRIEND_ANIMATION_MS+300u)){pc_friend_animation_done(&ui);(void)send(PC_NET_FRIEND_DONE,PC_FRIEND_ANIMATION,millis());dirty=true;}
  if(!ui.help&&(ui.page==PC_FRIEND_ANIMATION||ui.page==PC_BIND||ui.page==PC_HOST||ui.page==PC_ROSTER||ui.page==PC_BATCH_RUNNING||ui.page==PC_BATCH_SUCCESS||ui.page==PC_BATCH_PARTIAL||ui.page==PC_BATCH_FAILED||ui.page==PC_PLANET||(ui.page==PC_NAME&&!ui.name_paused))&&(uint32_t)(now-visual_tick)>=(ui.page==PC_NAME?20u:100u)){visual_tick=now;dirty=true;}

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
   ESP_LOGI("pc_diag_key","dispatch key=%d hold=%d page=%d change=%d eligible=%d epoch=%u pressed_epoch=%u",input.key,input.hold,ui.page,current.change_network,initialized&&input.epoch==atomic_load(&epoch),(unsigned)atomic_load(&epoch),(unsigned)input.epoch);
   if(!initialized||input.epoch!=atomic_load(&epoch))continue;
   if(input.double_click&&(ui.page!=PC_PLANET||current.change_network!=PC_CHANGE_NONE||ui.help))continue;
   if(current.change_network!=PC_CHANGE_NONE){
    bool interactive=current.change_network==PC_CHANGE_READY||current.change_network==PC_CHANGE_FAILED;
    if(interactive&&input.key==PC_OK&&input.hold){ui.help=!ui.help;dirty=true;continue;}
    if(!interactive||ui.help)continue;
    if(input.key==PC_UP&&!input.hold)send(PC_NET_CHANGE_CANCEL,PC_PLANET,input.ms);
    if(input.key==PC_OK&&!input.hold)send(PC_NET_CHANGE_START,PC_PLANET,input.ms);
    continue;
   }
   if(ui.page==PC_WIFI){if(input.key==PC_UP&&!input.hold&&current.network.phase!=PC_WIFI_CONNECTING)send(PC_NET_SETUP,PC_WIFI,input.ms);continue;}
   if(offline_latched||!terminal_wifi_is_connected())continue;
   if(ui.page==PC_BIND){if(current.binding==PC_BIND_SERVICE_ERROR&&input.key==PC_UP&&!input.hold)send(PC_NET_REFRESH,PC_BIND,input.ms);if(current.binding==PC_BIND_CONFIRM&&input.key==PC_OK)send(input.hold?PC_NET_BIND_REJECT:PC_NET_BIND_ACCEPT,PC_BIND,input.ms);continue;}
   if(ui.page==PC_FRIEND_DONE){
    /* Queue the exact completed-session dismissal before changing local UI.
     * A full queue must not silently lose the worker's return command. */
    if(input.key==PC_OK&&!input.hold&&send(PC_NET_FRIEND_DONE,PC_FRIEND_DONE,input.ms)){
     pc_press(&ui,PC_OK,false,millis());atomic_fetch_add(&epoch,1);drawn=ui.page;animation_at=millis();dirty=true;
    }
    continue;
   }
   if(ui.page==PC_SINGLE_SUCCESS&&!ui.help&&input.key==PC_OK&&!input.hold&&!input.double_click){
    if(send(PC_NET_ATTENDANCE_RETURN,PC_SINGLE_SUCCESS,input.ms)){pc_press(&ui,PC_OK,false,millis());dirty=true;}
    continue;
   }
   pc_page source=ui.page;pc_action action=input.double_click?pc_double_press(&ui,input.key,millis()):pc_press(&ui,input.key,input.hold,millis());
   diag_page(source,"key");ESP_LOGI("pc_diag_key","action=%d help=%d",action,ui.help);
   if(source==PC_BOUND&&input.key==PC_OK&&!input.hold)bound_continue_requested=send(PC_NET_BOUND_CONTINUE,source,input.ms)!=0;
   if(action==PC_SAVE_HELLO)send(PC_NET_SAVE_HELLO,source,input.ms);
   if(action==PC_FRIEND_START&&send(PC_NET_FRIEND_START,source,input.ms)){ui.help=false;ui.page=PC_FRIEND_CODE;}
   if(action==PC_FRIEND_CONFIRM)send(PC_NET_FRIEND_CONFIRM,source,input.ms);
   if(action==PC_FRIEND_CANCEL)send(PC_NET_FRIEND_CANCEL,source,input.ms);
   if(action==PC_CHANGE_NETWORK)send(PC_NET_CHANGE_PREPARE,PC_PLANET,input.ms);
   if(action==PC_SINGLE_SUBMIT&&current.candidate_valid){if(send(PC_NET_SINGLE_SUBMIT,source,input.ms))pc_operation_started(&ui,PC_SINGLE_SAVING);}
   if(action==PC_MEMBER_PREVIOUS||action==PC_MEMBER_NEXT)(void)send(action==PC_MEMBER_PREVIOUS?PC_NET_MEMBER_PREVIOUS:PC_NET_MEMBER_NEXT,source,input.ms);
   if(action==PC_BATCH_CREATE||action==PC_BATCH_RETRY){if(send(action==PC_BATCH_CREATE?PC_NET_BATCH_START:PC_NET_BATCH_RETRY,source,input.ms))pc_operation_started(&ui,PC_BATCH_RUNNING);}
   if((source==PC_BATCH_SUCCESS||source==PC_BATCH_PARTIAL||source==PC_BATCH_FAILED)&&ui.page==PC_LOADING&&ui.target!=PC_ROSTER)(void)send(PC_NET_BATCH_DISMISS,source,input.ms);
   if(action==PC_ROSTER_PREVIOUS||action==PC_ROSTER_NEXT){
    if(action==PC_ROSTER_PREVIOUS&&roster_offset)roster_offset--;
    if(action==PC_ROSTER_NEXT&&current.roster_valid&&roster_offset+PC_ROSTER_PAGE_SIZE<current.roster.total)roster_offset++;
    (void)send(PC_NET_ROSTER_PAGE,PC_ROSTER,input.ms);
   }
   if(ui.page==PC_LOADING&&ui.target==PC_ROSTER){roster_offset=0;(void)send(PC_NET_ROSTER_PAGE,PC_ROSTER,input.ms);}
   if(action!=PC_NONE&&action!=PC_SAVE_HELLO&&action!=PC_CHANGE_NETWORK&&action!=PC_BATCH_CREATE&&action!=PC_BATCH_RETRY&&action!=PC_ROSTER_PREVIOUS&&action!=PC_ROSTER_NEXT&&action!=PC_MEMBER_PREVIOUS&&action!=PC_MEMBER_NEXT&&action!=PC_SINGLE_SUBMIT&&action!=PC_FRIEND_START&&action!=PC_FRIEND_CONFIRM&&action!=PC_FRIEND_CANCEL)ESP_LOGW("popcity","Integration action pending: %d",(int)action);
   if(source!=ui.page){atomic_fetch_add(&epoch,1);drawn=ui.page;animation_at=millis();animation_frame=0;if(ui.page==PC_NAME)name_elapsed=0;}dirty=true;
  }
  if(dirty){static int shown_change=-1;static pc_page shown_page=(pc_page)-1;if(shown_change!=(int)current.change_network||shown_page!=ui.page){const pc_screen_asset *asset=screen();ESP_LOGI("pc_diag_page","visible page=%d change=%d asset=%s",ui.page,current.change_network,asset?asset->key:"overlay");shown_change=(int)current.change_network;shown_page=ui.page;}render_elapsed=millis()-animation_at;
   const pc_screen_asset *asset=screen();unsigned top=0,bottom=320;
   bool same=rendered_page==ui.page&&rendered_help==ui.help&&rendered_palette==current.palette&&current.backend_ready;
   bool unchanged_hello=same&&ui.page==PC_HELLO&&rendered_asset==asset;
   if(same&&!ui.help&&current.change_network==PC_CHANGE_NONE){
    if(ui.page==PC_NAME&&current.personal.valid&&!strcmp(rendered_name_version,current.personal.name_version)){top=116;bottom=212;}
    if(ui.page==PC_HELLO){top=PC_WELCOME_DIRTY_TOP;bottom=PC_WELCOME_DIRTY_BOTTOM;}
   }
   if(!unchanged_hello){
    int64_t started=esp_timer_get_time();
    if(pc_panel_present_region(asset,overlay,NULL,top,bottom)!=ESP_OK){ESP_LOGE("popcity","Display transfer failed; stopped to protect DMA buffer");return;}
    uint32_t took=(uint32_t)(esp_timer_get_time()-started);render_count++;render_total_us+=took;if(took>render_max_us)render_max_us=took;
   }
   if(ui.page==PC_FRIEND_CODE&&current.friend_flow.active&&current.friend_flow.session.code[0]&&
      (strcmp(shown_friend_id,current.friend_flow.session.interaction_id)||strcmp(shown_friend_code,current.friend_flow.session.code))){
    if(send(PC_NET_FRIEND_SHOWN,PC_FRIEND_CODE,millis())){snprintf(shown_friend_id,sizeof(shown_friend_id),"%s",current.friend_flow.session.interaction_id);snprintf(shown_friend_code,sizeof(shown_friend_code),"%s",current.friend_flow.session.code);}
   }
   rendered_page=ui.page;rendered_help=ui.help;rendered_palette=current.palette;rendered_asset=asset;
   snprintf(rendered_name_version,sizeof(rendered_name_version),"%s",current.personal.name_version);
   if((uint32_t)(millis()-render_stats_at)>=5000u&&render_count){ESP_LOGI("pc_diag_render","page=%d frames=%u mean_us=%u max_us=%u rows=%u",ui.page,(unsigned)render_count,(unsigned)(render_total_us/render_count),(unsigned)render_max_us,bottom-top);render_stats_at=millis();render_count=render_total_us=render_max_us=0;}
   dirty=false;}
  vTaskDelay(pdMS_TO_TICKS(20));
 }
}
