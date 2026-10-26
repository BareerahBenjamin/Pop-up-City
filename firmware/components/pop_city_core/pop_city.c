#include "pop_city.h"
#include <string.h>
static pc_page home(const pc_state *s){return s->host_active?PC_HOST:PC_PLANET;}
static void go(pc_state *s,pc_page target,uint32_t ms){if(target==PC_ROSTER)s->roster_return=s->page;s->help=false;s->page=PC_LOADING;s->target=target;s->transition_at=ms;}
void pc_init(pc_state *s,bool skipped,bool known_bound){memset(s,0,sizeof(*s));s->page=PC_WIFI;s->hello_skipped=skipped;s->bound=known_bound;}
void pc_facts(pc_state *s,bool online,bool bound,bool host,uint32_t ms){
 bool was_online=s->online,was_bound=s->bound;
 s->online=online;s->bound=bound;s->host_active=host;
 if(!online){s->page=PC_WIFI;s->help=false;return;}
 if(!bound){s->page=PC_BIND;s->help=false;return;}
 if(s->unresolved){if(s->page!=PC_FRIEND_SAVING&&s->page!=PC_SINGLE_SAVING&&s->page!=PC_BATCH_RUNNING)s->page=PC_RECONCILE;return;}
 if(s->friend_resume==PC_FRIEND_ANIMATION||s->friend_resume==PC_FRIEND_DONE){s->page=s->friend_resume;return;}
 if(!was_bound){go(s,PC_BOUND,ms);return;}
 if(!was_online||s->page==PC_WIFI||s->page==PC_BIND){go(s,s->hello_skipped?home(s):PC_HELLO,ms);return;}
 pc_page visible=s->page==PC_LOADING?s->target:s->page;
 if(visible==PC_FRIEND_ANIMATION||visible==PC_FRIEND_DONE||visible==PC_BOUND||visible==PC_HELLO)return;
 if(host&&(visible==PC_PLANET||visible==PC_NAME)){go(s,PC_HOST,ms);return;}
 if(!host&&(visible==PC_HOST||visible==PC_ROSTER||visible==PC_SINGLE_SUCCESS||visible==PC_SINGLE_FAILED||visible==PC_BATCH_SUCCESS||visible==PC_BATCH_PARTIAL||visible==PC_BATCH_FAILED))go(s,PC_PLANET,ms);
}
void pc_tick(pc_state *s,uint32_t ms){if(s->page==PC_LOADING&&(uint32_t)(ms-s->transition_at)>=300)s->page=s->target;}
static bool locked(pc_page p){return p==PC_WIFI||p==PC_BIND||p==PC_LOADING||p==PC_RECONCILE||p==PC_SINGLE_SAVING||p==PC_BATCH_RUNNING||p==PC_FRIEND_SAVING||p==PC_FRIEND_ANIMATION;}
pc_action pc_press(pc_state *s,pc_key key,bool hold,uint32_t ms){
 if(key==PC_POWER)return PC_NONE;
 if(!s->online||!s->bound||locked(s->page))return PC_NONE;
 if(s->page==PC_BOUND){if(key==PC_OK&&!hold)go(s,s->hello_skipped?home(s):PC_HELLO,ms);return PC_NONE;}
 if(s->page==PC_HELLO)return PC_SAVE_HELLO;
 if(s->page==PC_FRIEND_DONE&&hold)return PC_NONE;
 if(key==PC_OK&&hold){s->help=!s->help;s->help_source=s->page;return PC_NONE;}
 if(s->help)return PC_NONE;
 if(s->page==PC_FRIEND_DONE){if(key==PC_OK&&!hold){s->friend_resume=PC_WIFI;go(s,home(s),ms);}return PC_NONE;}
 switch(s->page){
 case PC_PLANET:
  if(key==PC_UP)return hold?PC_FRIEND_START:PC_NONE;
  if(key==PC_DOWN&&!hold)go(s,PC_NAME,ms);
  break;
 case PC_NAME:
  if(key==PC_DOWN&&!hold)go(s,home(s),ms);
  if(key==PC_OK&&!hold)s->name_paused=!s->name_paused;
  break;
 case PC_FRIEND_CODE:
  if(key==PC_UP)return hold?PC_FRIEND_START:PC_FRIEND_CANCEL;
  if(key==PC_DOWN&&!hold)return PC_FRIEND_CONFIRM;
  break;
 case PC_HOST:
  if(key==PC_UP)return hold?PC_BATCH_CREATE:PC_MEMBER_NEXT;
  if(key==PC_DOWN){if(hold)go(s,PC_ROSTER,ms);else return PC_MEMBER_PREVIOUS;}
  if(key==PC_OK&&!hold)return PC_SINGLE_SUBMIT;
  break;
 case PC_ROSTER:
  if(key==PC_DOWN&&hold)go(s,s->host_active&&(s->roster_return==PC_BATCH_SUCCESS||s->roster_return==PC_BATCH_PARTIAL||s->roster_return==PC_BATCH_FAILED)?s->roster_return:home(s),ms);
  if(key==PC_UP&&!hold)return PC_ROSTER_PREVIOUS;
  if(key==PC_DOWN&&!hold)return PC_ROSTER_NEXT;
  break;
 case PC_SINGLE_FAILED:
  if(!hold&&(key==PC_UP||key==PC_DOWN))return key==PC_UP?PC_MEMBER_NEXT:PC_MEMBER_PREVIOUS;
  if(key==PC_OK&&!hold)return PC_SINGLE_SUBMIT;
  break;
 case PC_SINGLE_SUCCESS:
  if(!hold&&(key==PC_UP||key==PC_DOWN)){s->page=PC_HOST;return key==PC_UP?PC_MEMBER_NEXT:PC_MEMBER_PREVIOUS;}
  if(key==PC_OK&&!hold)go(s,home(s),ms);
  break;
 case PC_BATCH_PARTIAL:case PC_BATCH_FAILED:
  if(key==PC_OK&&!hold&&s->host_active)return PC_BATCH_RETRY;
  if(key==PC_UP&&!hold)go(s,home(s),ms);
  if(key==PC_DOWN&&hold)go(s,PC_ROSTER,ms);
  break;
 case PC_BATCH_SUCCESS:
  if(key==PC_OK&&!hold)go(s,home(s),ms);
  if(key==PC_DOWN&&hold)go(s,PC_ROSTER,ms);
  break;
 default:break;
 }
 return PC_NONE;
}
void pc_hello_saved(pc_state *s,bool saved,uint32_t ms){if(saved&&s->page==PC_HELLO){s->hello_skipped=true;go(s,home(s),ms);}}
void pc_operation_started(pc_state *s,pc_page waiting){s->unresolved=true;s->help=false;s->page=waiting;}
void pc_friend_saved(pc_state *s,uint32_t ms){(void)ms;s->unresolved=false;s->help=false;s->friend_resume=PC_FRIEND_ANIMATION;if(s->online&&s->bound)s->page=PC_FRIEND_ANIMATION;}
void pc_friend_animation_done(pc_state *s){if(s->page==PC_FRIEND_ANIMATION){s->page=PC_FRIEND_DONE;s->friend_resume=PC_FRIEND_DONE;}}
void pc_resolved(pc_state *s,pc_page result,uint32_t ms){s->unresolved=false;if(!s->online||!s->bound)return;go(s,(!s->host_active&&result>=PC_HOST&&result<=PC_BATCH_FAILED)?PC_PLANET:result,ms);}

pc_action pc_double_press(pc_state *s,pc_key key,uint32_t ms){
 (void)ms;return s&&s->online&&s->bound&&!s->unresolved&&!s->help&&s->page==PC_PLANET&&key==PC_UP?PC_CHANGE_NETWORK:PC_NONE;
}
