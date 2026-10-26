#pragma once
#include <stdbool.h>
#include <stdint.h>

typedef enum {
 PC_WIFI, PC_BIND, PC_BOUND, PC_HELLO, PC_PLANET, PC_NAME,
 PC_FRIEND_CODE, PC_FRIEND_SAVING, PC_FRIEND_ANIMATION, PC_FRIEND_DONE,
 PC_HOST, PC_SINGLE_SAVING, PC_SINGLE_SUCCESS, PC_SINGLE_FAILED,
 PC_ROSTER, PC_BATCH_RUNNING, PC_BATCH_SUCCESS, PC_BATCH_PARTIAL, PC_BATCH_FAILED,
 PC_RECONCILE, PC_LOADING
} pc_page;
typedef enum { PC_UP, PC_DOWN, PC_OK, PC_POWER } pc_key;
typedef enum {
 PC_NONE, PC_SAVE_HELLO, PC_CHANGE_NETWORK, PC_FRIEND_START, PC_FRIEND_CONFIRM,
 PC_FRIEND_CANCEL, PC_MEMBER_PREVIOUS, PC_MEMBER_NEXT, PC_SINGLE_SUBMIT,
 PC_BATCH_CREATE, PC_BATCH_RETRY, PC_ROSTER_PREVIOUS, PC_ROSTER_NEXT,
 PC_RECONCILE_REQUEST
} pc_action;
typedef struct {
 pc_page page, target, help_source, friend_resume, roster_return;
 bool online, bound, hello_skipped, host_active, unresolved, help, name_paused;
 uint32_t transition_at;
} pc_state;
void pc_init(pc_state *s, bool hello_skipped, bool previously_bound);
/* Authenticated runtime snapshot; must also be called on network loss. */
void pc_facts(pc_state *s, bool online, bool bound, bool host_active, uint32_t ms);
void pc_tick(pc_state *s, uint32_t ms);
pc_action pc_press(pc_state *s, pc_key key, bool long_press, uint32_t ms);
pc_action pc_double_press(pc_state *, pc_key, uint32_t ms);
/* Persist hello_skipped successfully before calling this. Failure leaves Hello looping. */
void pc_hello_saved(pc_state *s, bool saved, uint32_t ms);
void pc_operation_started(pc_state *s, pc_page waiting);
void pc_friend_saved(pc_state *s, uint32_t ms);
void pc_friend_animation_done(pc_state *s);
/* Only authoritative receipt/reconciliation may clear unresolved. */
void pc_resolved(pc_state *s, pc_page result, uint32_t ms);
