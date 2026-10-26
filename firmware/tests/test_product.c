#include "pop_city.h"
#include "feedback_consumer.h"
#include "key_policy.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static unsigned checks;
#define CHECK(x) do {assert(x);checks++;} while(0)
static void page(pc_state *s,pc_page p){s->page=p;s->online=s->bound=true;s->help=false;}
static pc_feedback_cursor disk;static bool disk_ok=true;
static bool save(const pc_feedback_cursor *c,void *ctx){(void)ctx;if(!disk_ok)return false;disk=*c;return true;}
int main(void){
 pc_state s;pc_init(&s,false,false);CHECK(s.page==PC_WIFI);
 for(int k=PC_UP;k<=PC_POWER;k++)CHECK(pc_press(&s,k,false,0)==PC_NONE&&s.page==PC_WIFI);
 pc_facts(&s,true,false,false,0);CHECK(s.page==PC_BIND);CHECK(pc_press(&s,PC_POWER,false,0)==PC_NONE&&!s.help);
 pc_facts(&s,true,true,false,1);CHECK(s.page==PC_LOADING);pc_tick(&s,300);CHECK(s.page==PC_LOADING);pc_tick(&s,301);CHECK(s.page==PC_BOUND);
 pc_press(&s,PC_DOWN,false,302);CHECK(s.page==PC_BOUND);pc_press(&s,PC_OK,false,302);pc_tick(&s,602);CHECK(s.page==PC_HELLO);pc_tick(&s,10000);CHECK(s.page==PC_HELLO);
 pc_init(&s,false,true);pc_facts(&s,true,true,false,0);pc_tick(&s,300);CHECK(s.page==PC_HELLO);CHECK(pc_press(&s,PC_OK,false,301)==PC_SAVE_HELLO&&!s.help);pc_hello_saved(&s,false,301);CHECK(s.page==PC_HELLO);pc_hello_saved(&s,true,302);pc_tick(&s,602);CHECK(s.hello_skipped&&s.page==PC_PLANET);
 pc_init(&s,true,true);pc_facts(&s,true,true,false,0);pc_tick(&s,300);CHECK(s.page==PC_PLANET);
 CHECK(pc_press(&s,PC_UP,false,301)==PC_NONE);CHECK(pc_double_press(&s,PC_UP,301)==PC_CHANGE_NETWORK);CHECK(pc_press(&s,PC_UP,true,301)==PC_FRIEND_START);
 pc_press(&s,PC_DOWN,false,302);pc_tick(&s,602);CHECK(s.page==PC_NAME);CHECK(pc_press(&s,PC_UP,false,603)==PC_NONE);pc_press(&s,PC_OK,false,603);CHECK(s.name_paused);pc_press(&s,PC_DOWN,false,604);pc_tick(&s,904);CHECK(s.page==PC_PLANET);
 pc_press(&s,PC_OK,true,905);CHECK(s.help);pc_facts(&s,true,true,true,906);pc_tick(&s,1206);CHECK(!s.help&&s.page==PC_HOST);
 CHECK(pc_press(&s,PC_UP,false,1207)==PC_MEMBER_NEXT&&s.page==PC_HOST);CHECK(pc_press(&s,PC_DOWN,false,1208)==PC_MEMBER_PREVIOUS&&s.page==PC_HOST);CHECK(pc_press(&s,PC_UP,true,1209)==PC_BATCH_CREATE);CHECK(pc_press(&s,PC_OK,true,1210)==PC_NONE);
 pc_operation_started(&s,PC_BATCH_RUNNING);for(int k=PC_UP;k<=PC_POWER;k++)CHECK(pc_press(&s,k,false,1211)==PC_NONE);
 pc_facts(&s,false,true,true,1212);CHECK(s.page==PC_WIFI&&s.unresolved);pc_facts(&s,true,true,false,1213);CHECK(s.page==PC_RECONCILE);pc_resolved(&s,PC_BATCH_PARTIAL,1214);pc_tick(&s,1514);CHECK(s.page==PC_PLANET&&!s.unresolved);
 page(&s,PC_FRIEND_CODE);CHECK(pc_press(&s,PC_DOWN,false,1600)==PC_FRIEND_CONFIRM);CHECK(pc_press(&s,PC_UP,false,1600)==PC_FRIEND_CANCEL);CHECK(pc_press(&s,PC_UP,true,1600)==PC_FRIEND_START);pc_operation_started(&s,PC_FRIEND_SAVING);pc_facts(&s,true,true,true,1601);CHECK(s.page==PC_FRIEND_SAVING);pc_friend_saved(&s,1602);CHECK(s.page==PC_FRIEND_ANIMATION);CHECK(pc_press(&s,PC_POWER,false,1603)==PC_NONE&&!s.help);pc_friend_animation_done(&s);pc_facts(&s,true,true,true,1604);CHECK(s.page==PC_FRIEND_DONE);pc_press(&s,PC_OK,false,1605);pc_tick(&s,1905);CHECK(s.page==PC_HOST);
 /* Success stays until short OK; long OK/other keys do not open help or exit.
  * Fresh facts after return must never restore the completed animation. */
 pc_init(&s,true,true);pc_facts(&s,true,true,false,0);pc_friend_saved(&s,1);
 CHECK(pc_press(&s,PC_OK,false,2)==PC_NONE&&s.page==PC_FRIEND_ANIMATION);
 pc_friend_animation_done(&s);CHECK(pc_press(&s,PC_OK,true,3)==PC_NONE&&s.page==PC_FRIEND_DONE&&!s.help);
 pc_press(&s,PC_UP,false,4);pc_press(&s,PC_DOWN,false,5);CHECK(s.page==PC_FRIEND_DONE);
 pc_press(&s,PC_OK,false,6);pc_facts(&s,true,true,false,7);pc_tick(&s,306);CHECK(s.page==PC_PLANET&&s.friend_resume==PC_WIFI);
 pc_facts(&s,true,true,false,307);CHECK(s.page==PC_PLANET);
 page(&s,PC_PLANET);pc_press(&s,PC_DOWN,false,UINT32_MAX-100);pc_tick(&s,198);CHECK(s.page==PC_LOADING);pc_tick(&s,199);CHECK(s.page==PC_NAME);
 pc_init(&s,true,true);pc_facts(&s,true,true,false,0);pc_tick(&s,300);
 CHECK(pc_press(&s,PC_UP,false,301)==PC_NONE&&s.page==PC_PLANET);CHECK(pc_double_press(&s,PC_UP,302)==PC_CHANGE_NETWORK);
 s.help=true;CHECK(pc_double_press(&s,PC_UP,303)==PC_NONE);s.help=false;page(&s,PC_NAME);CHECK(pc_double_press(&s,PC_UP,304)==PC_NONE);page(&s,PC_WIFI);CHECK(pc_double_press(&s,PC_UP,305)==PC_NONE);
 pc_key_state k={0};pc_key_down(&k,PC_UP,100);CHECK(!pc_key_tick(&k,599).ready);pc_key_event e=pc_key_tick(&k,600);CHECK(e.ready&&e.long_press);CHECK(!pc_key_up(&k,PC_UP,1101).ready);pc_key_down(&k,PC_DOWN,1200);e=pc_key_up(&k,PC_DOWN,1250);CHECK(e.ready&&!e.long_press);pc_key_down(&k,PC_OK,1300);pc_key_block_until_release(&k);CHECK(!pc_key_up(&k,PC_OK,1400).ready);
 /* Host facts polling must preserve navigation and help within attendance. */
 const pc_page host_pages[]={PC_HOST,PC_ROSTER,PC_SINGLE_SUCCESS,PC_SINGLE_FAILED,PC_BATCH_SUCCESS,PC_BATCH_PARTIAL,PC_BATCH_FAILED};
 for(unsigned i=0;i<sizeof(host_pages)/sizeof(*host_pages);i++){
  pc_state h;pc_init(&h,true,true);h.online=h.bound=h.host_active=true;h.page=host_pages[i];
  pc_facts(&h,true,true,true,10);CHECK(h.page==host_pages[i]&&!h.help);
  pc_press(&h,PC_OK,true,11);CHECK(h.help);
  for(unsigned t=12;t<100;t++){pc_facts(&h,true,true,true,t);pc_tick(&h,t);CHECK(h.page==host_pages[i]&&h.help);}
  pc_press(&h,PC_OK,true,101);CHECK(h.page==host_pages[i]&&!h.help);
  pc_press(&h,PC_OK,true,102);pc_facts(&h,true,true,false,103);pc_tick(&h,403);CHECK(h.page==PC_PLANET&&!h.help);
 }
 pc_feedback f={0};const char *sid="11111111-1111-1111-1111-111111111111",*sid2="22222222-2222-2222-2222-222222222222";
 CHECK(pc_feedback_open(&f,sid,save,NULL));CHECK(pc_feedback_consume(&f,sid,105,110,100,true)==PC_FEEDBACK_PULSE_ACK);CHECK(disk.consumed==105);CHECK(pc_feedback_consume(&f,sid,105,110,101,true)==PC_FEEDBACK_ACK_ONLY);CHECK(pc_feedback_open(&f,sid,save,NULL));CHECK(f.cursor.consumed==105);
 disk_ok=false;CHECK(pc_feedback_consume(&f,sid,106,110,102,true)==PC_FEEDBACK_STORAGE_FAILED);CHECK(f.cursor.consumed==105);disk_ok=true;CHECK(pc_feedback_consume(&f,sid,106,110,102,true)==PC_FEEDBACK_PULSE_ACK);
 CHECK(pc_feedback_consume(&f,sid,107,110,110,true)==PC_FEEDBACK_ACK_ONLY);CHECK(pc_feedback_consume(&f,sid,108,120,110,false)==PC_FEEDBACK_ACK_ONLY);pc_feedback_disconnect(&f);CHECK(pc_feedback_consume(&f,sid,109,120,111,true)==PC_FEEDBACK_DROP);CHECK(pc_feedback_open(&f,sid2,save,NULL));CHECK(pc_feedback_consume(&f,sid,109,120,111,true)==PC_FEEDBACK_DROP);CHECK(pc_feedback_consume(&f,sid2,109,120,111,true)==PC_FEEDBACK_PULSE_ACK);
 CHECK(pc_feedback_consume(&f,sid2,0,120,111,true)==PC_FEEDBACK_DROP);CHECK(!pc_feedback_open(&f,"bad",save,NULL));

 pc_init(&s,true,true);pc_facts(&s,true,true,false,0);pc_tick(&s,300);page(&s,PC_FRIEND_SAVING);s.unresolved=true;pc_facts(&s,false,true,false,301);pc_friend_saved(&s,302);CHECK(s.page==PC_WIFI);pc_facts(&s,true,true,true,303);CHECK(s.page==PC_FRIEND_ANIMATION);pc_friend_animation_done(&s);pc_facts(&s,false,true,true,304);pc_facts(&s,true,true,true,305);CHECK(s.page==PC_FRIEND_DONE);pc_press(&s,PC_OK,false,306);pc_tick(&s,606);CHECK(s.page==PC_HOST);
 page(&s,PC_BATCH_PARTIAL);CHECK(pc_press(&s,PC_OK,false,607)==PC_BATCH_RETRY);pc_press(&s,PC_DOWN,true,608);pc_tick(&s,908);CHECK(s.page==PC_ROSTER);CHECK(pc_press(&s,PC_UP,false,909)==PC_ROSTER_PREVIOUS);CHECK(pc_press(&s,PC_DOWN,false,910)==PC_ROSTER_NEXT);CHECK(pc_press(&s,PC_OK,false,911)==PC_NONE&&s.page==PC_ROSTER);pc_press(&s,PC_DOWN,true,912);pc_tick(&s,1212);CHECK(s.page==PC_BATCH_PARTIAL);
 k=(pc_key_state){0};pc_key_down(&k,PC_UP,UINT32_MAX-100);e=pc_key_up(&k,PC_UP,899);CHECK(e.ready&&e.long_press);
 pc_feedback restarted={.cursor=disk};CHECK(pc_feedback_open(&restarted,sid2,save,NULL));CHECK(pc_feedback_consume(&restarted,sid2,109,120,112,true)==PC_FEEDBACK_ACK_ONLY);
 page(&s,PC_PLANET);CHECK(pc_press(&s,PC_POWER,false,2000)==PC_NONE&&!s.help);pc_press(&s,PC_OK,true,2001);CHECK(s.help);pc_press(&s,PC_DOWN,false,2002);CHECK(s.page==PC_PLANET);pc_press(&s,PC_OK,true,2003);CHECK(!s.help);
 page(&s,PC_NAME);pc_press(&s,PC_OK,true,2004);CHECK(s.help&&!s.name_paused);pc_press(&s,PC_OK,true,2005);pc_press(&s,PC_OK,false,2006);CHECK(s.name_paused);
 page(&s,PC_FRIEND_DONE);pc_press(&s,PC_OK,true,2007);CHECK(!s.help&&s.page==PC_FRIEND_DONE);pc_press(&s,PC_OK,true,2008);CHECK(!s.help);pc_press(&s,PC_OK,false,2009);pc_tick(&s,2309);CHECK(s.page==PC_HOST);
 /* Mandatory and in-flight screens cannot be escaped by a long press either. */
 const pc_page mandatory[]={PC_WIFI,PC_BIND,PC_LOADING,PC_RECONCILE,PC_SINGLE_SAVING,PC_BATCH_RUNNING,PC_FRIEND_SAVING,PC_FRIEND_ANIMATION};
 for(unsigned i=0;i<sizeof(mandatory)/sizeof(mandatory[0]);i++)for(int key=PC_UP;key<=PC_POWER;key++)for(unsigned hold=0;hold<2;hold++){
  pc_state guarded;pc_init(&guarded,true,true);page(&guarded,mandatory[i]);
  CHECK(pc_press(&guarded,(pc_key)key,hold,3000)==PC_NONE&&guarded.page==mandatory[i]&&!guarded.help);
 }
 /* Any page loses priority to connectivity; controls cannot skip the Wi-Fi gate. */
 for(int visible=PC_WIFI;visible<=PC_LOADING;visible++){
  pc_state offline;pc_init(&offline,true,true);page(&offline,(pc_page)visible);offline.help=true;
  pc_facts(&offline,false,true,true,4000);CHECK(offline.page==PC_WIFI&&!offline.help);
  for(int key=PC_UP;key<=PC_POWER;key++)CHECK(pc_press(&offline,(pc_key)key,true,4001)==PC_NONE&&offline.page==PC_WIFI);
 }
 printf("product core: %u assertions passed\n",checks);
}
