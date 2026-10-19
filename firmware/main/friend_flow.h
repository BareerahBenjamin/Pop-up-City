#pragma once
#include "friend_protocol.h"
typedef struct {bool active,timed_out;uint32_t shown_ms;pc_friend_session session;} pc_friend_flow;
/* Local waiting timeout never claims that an in-flight save failed. */
void pc_friend_flow_update(pc_friend_flow *,const pc_friend_session *,uint32_t ms);
void pc_friend_flow_tick(pc_friend_flow *,uint32_t ms);
