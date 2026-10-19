#include "feedback_consumer.h"
#include <string.h>
static bool uuid(const char *s){if(!s||strlen(s)!=36)return false;for(unsigned i=0;i<36;i++){if(i==8||i==13||i==18||i==23){if(s[i]!='-')return false;}else if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return false;}return true;}
bool pc_feedback_open(pc_feedback *f,const char *session,pc_cursor_save save,void *context){
 f->active=false;if(!uuid(session)||!save)return false;
 pc_feedback_cursor c={0};memcpy(c.session_id,session,37);
 /* Same-session retry must preserve its consumed cursor. */
 if(!strcmp(f->cursor.session_id,session))c.consumed=f->cursor.consumed;
 if(!save(&c,context))return false;
 f->cursor=c;f->save=save;f->context=context;f->active=true;return true;
}
void pc_feedback_disconnect(pc_feedback *f){f->active=false;}
pc_feedback_action pc_feedback_consume(pc_feedback *f,const char *session,uint64_t id,uint64_t expires,uint64_t now,bool valid){
 if(!f->active||!session||strcmp(session,f->cursor.session_id)||!id||id>9007199254740991ULL)return PC_FEEDBACK_DROP;
 if(id<=f->cursor.consumed)return PC_FEEDBACK_ACK_ONLY;
 pc_feedback_cursor next=f->cursor;next.consumed=id;
 if(!f->save(&next,f->context))return PC_FEEDBACK_STORAGE_FAILED;
 f->cursor=next;
 return valid&&now<expires?PC_FEEDBACK_PULSE_ACK:PC_FEEDBACK_ACK_ONLY;
}
