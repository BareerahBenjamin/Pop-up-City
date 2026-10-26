#include "friend_flow.h"
#include <string.h>
void pc_friend_flow_update(pc_friend_flow *f,const pc_friend_session *s,uint32_t ms){
 /* An expired server session must not erase the code the user confirmed. */
 if(f->active&&f->session.interaction_id[0]&&!s->interaction_id[0]){f->timed_out=true;return;}
 bool changed=!f->active||strcmp(f->session.interaction_id,s->interaction_id)||strcmp(f->session.code,s->code);
 if(changed){f->shown_ms=ms;f->timed_out=false;f->visible=false;}
 f->session=*s;f->active=true;
}
void pc_friend_flow_tick(pc_friend_flow *f,uint32_t ms){
 if(!f->active||!f->visible||!f->session.interaction_id[0]||!strcmp(f->session.state,"done")||!strcmp(f->session.state,"submitting"))return;
 if((uint32_t)(ms-f->shown_ms)>=10000)f->timed_out=true;
}

void pc_friend_flow_visible(pc_friend_flow *f,const char *id,const char *code,uint32_t ms){
 if(f&&f->active&&!f->visible&&id&&code&&id[0]&&!strcmp(id,f->session.interaction_id)&&!strcmp(code,f->session.code)){f->shown_ms=ms;f->visible=true;f->timed_out=false;}
}
bool pc_friend_flow_accepts_key(const pc_friend_flow *f,const char *id,const char *code,uint32_t ms){
 return f&&f->active&&f->visible&&id&&code&&!strcmp(id,f->session.interaction_id)&&!strcmp(code,f->session.code)&&(uint32_t)(ms-f->shown_ms)<10000u;
}
