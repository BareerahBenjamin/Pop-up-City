#pragma once
#include "startup.h"
#include "batch_controller.h"
#include "proximity.h"
#include "single_attendance.h"
#include "friend_flow.h"
typedef enum {PC_NET_REFRESH,PC_NET_SETUP,PC_NET_BOUND_CONTINUE,PC_NET_SAVE_HELLO,PC_NET_BIND_ACCEPT,PC_NET_BIND_REJECT,PC_NET_ROSTER_PAGE,PC_NET_BATCH_START,PC_NET_BATCH_RETRY,PC_NET_BATCH_DISMISS,PC_NET_MEMBER_PREVIOUS,PC_NET_MEMBER_NEXT,PC_NET_SINGLE_SUBMIT,PC_NET_FRIEND_START,PC_NET_FRIEND_CONFIRM,PC_NET_FRIEND_CANCEL,PC_NET_FRIEND_DONE} pc_net_command_kind;
typedef struct {pc_net_command_kind kind;pc_page source_page;char request_id[37];uint32_t pressed_ms;uint32_t roster_offset;uint32_t serial;char activity_id[37],peer_device_id[37],friend_id[37],friend_code[5];} pc_net_command;
typedef enum {PC_NET_STARTING,PC_NET_READY,PC_NET_STORAGE_ERROR,PC_NET_IDENTITY_REQUIRED,PC_NET_RADIO_ERROR} pc_net_service_state;
/* Immutable copies cross the task boundary; consumers never access worker-owned pc_store/pc_cloud. */
typedef struct {
 pc_net_service_state service;bool wifi_ready,bound,hello_skipped,host_active;
 uint8_t palette;pc_page flow_page,flow_target;pc_binding_phase binding;
 char code[5],request_id[37],member_label[129],member_hint[129];
 uint8_t member_label_bitmap[768],active_title_bitmap[768];bool member_label_bitmap_valid,active_title_valid;
 char network_message[240],network_summary[160],bluetooth_name[32];
 pc_roster_page roster;bool roster_valid;
 struct {bool loaded,known;pc_batch_phase phase;uint32_t total,signed_count,failed,pending,sequence;} batch;
 bool unresolved,single_loaded;uint32_t command_serial;char active_activity_id[37];
 pc_host_candidate candidate;bool candidate_valid,candidate_nearby;uint32_t nearby_count;
 pc_friend_flow friend_flow;bool friend_confirmed;
 pc_personal_visual personal;
 uint32_t pulse_sequence;pc_cloud_result last_result;
} pc_net_view;
esp_err_t pc_network_worker_start(void);
bool pc_network_worker_send(const pc_net_command *command);
bool pc_network_worker_view(pc_net_view *view);
