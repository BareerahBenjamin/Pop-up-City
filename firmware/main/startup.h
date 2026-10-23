#pragma once
#include "cloud_protocol.h"
typedef enum { PC_BIND_WAITING,PC_BIND_CONFIRM,PC_BIND_CHECKING,PC_BIND_REVOKED,PC_BIND_SERVICE_ERROR,PC_BIND_STORAGE_ERROR,PC_BIND_REJECTED } pc_binding_phase;
typedef struct {
 pc_cloud *cloud;pc_binding_phase phase;
 char claim_code[5],request_id[37],member_label[129],member_hint[129];
 uint8_t member_label_bitmap[768];uint16_t member_label_width;bool member_label_bitmap_valid;
 uint32_t valid_seconds,updated_ms;
 uint64_t expires_at;uint32_t shown_ms;bool new_binding,reset_ready;
} pc_startup;
void pc_startup_init(pc_startup *,pc_cloud *);
/* Network worker only. Shows binding success only after durable member-ID save. */
pc_cloud_result pc_startup_poll(pc_startup *,uint32_t ms);
pc_cloud_result pc_startup_confirm(pc_startup *,bool accept,uint32_t key_ms);
