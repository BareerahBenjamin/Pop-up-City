#include "key_policy.h"
void pc_key_down(pc_key_state *s,pc_key key,uint32_t ms){if(s->held)return;s->held=true;s->emitted=false;s->key=key;s->started=ms;}
pc_key_event pc_key_tick(pc_key_state *s,uint32_t ms){pc_key_event e={0};if(s->held&&!s->emitted&&(uint32_t)(ms-s->started)>=500){s->emitted=true;e.ready=true;e.long_press=true;e.key=s->key;}return e;}
pc_key_event pc_key_up(pc_key_state *s,pc_key key,uint32_t ms){pc_key_event e={0};if(!s->held||key!=s->key)return e;if(!s->emitted){e.ready=true;e.key=key;e.long_press=(uint32_t)(ms-s->started)>=500;}s->held=false;return e;}
void pc_key_block_until_release(pc_key_state *s){if(s->held)s->emitted=true;}
