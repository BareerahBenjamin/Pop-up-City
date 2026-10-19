#pragma once
#include "proximity.h"
#include "friend_visual.h"
typedef struct {
 char state[12],interaction_id[37],device_a[37],device_b[37],nonce[33],code[5];
 uint64_t occurred_at;bool a_confirmed,b_confirmed,proximity_ready;pc_friend_visual visual;
} pc_friend_session;
pc_cloud_result pc_friend_request(pc_cloud *,pc_friend_session *);
pc_cloud_result pc_friend_poll(pc_cloud *,pc_friend_session *);
pc_cloud_result pc_friend_observations(pc_cloud *,const nearby_participants_t *,uint32_t,pc_friend_session *);
/* Persist exact user-confirmed intent before sending; timeout retains it. */
pc_cloud_result pc_friend_confirm(pc_cloud *,const pc_friend_session *displayed,pc_friend_session *);
pc_cloud_result pc_friend_cancel(pc_cloud *,const pc_friend_session *,pc_friend_session *);
/* Resolve only an authenticated saved/cancelled receipt; unknown remains durable.
   On OK, saved differentiates success-animation from safe cancellation. */
pc_cloud_result pc_friend_recover(pc_cloud *,uint32_t ms,bool *saved,pc_friend_session *restored);
/* Read-only original receipt refresh; never re-submit or replay after user exits. */
pc_cloud_result pc_friend_visual_refresh(pc_cloud *,pc_friend_session *);
