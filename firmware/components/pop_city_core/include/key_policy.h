#pragma once
#include "pop_city.h"
typedef struct { bool held,emitted; pc_key key; uint32_t started; } pc_key_state;
typedef struct { bool ready,long_press; pc_key key; } pc_key_event;
void pc_key_down(pc_key_state *s,pc_key key,uint32_t ms);
pc_key_event pc_key_tick(pc_key_state *s,uint32_t ms);
pc_key_event pc_key_up(pc_key_state *s,pc_key key,uint32_t ms);
/* Call when changing pages; held entry keys must release before new actions. */
void pc_key_block_until_release(pc_key_state *s);
