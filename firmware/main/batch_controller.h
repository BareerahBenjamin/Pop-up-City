#pragma once
#include "cloud_protocol.h"
typedef enum {PC_BATCH_NONE,PC_BATCH_CHECKING,PC_BATCH_WORKING,PC_BATCH_ALL_OK,PC_BATCH_SOME_FAILED,PC_BATCH_ALL_FAILED,PC_BATCH_STOPPED} pc_batch_phase;
typedef struct {
 pc_cloud *cloud;unsigned slot;bool loaded,known;
 pc_batch_phase phase;uint32_t total,signed_count,failed,pending,sequence;
 char operation_id[37],activity_id[37];
} pc_batch_controller;
void pc_batch_init(pc_batch_controller *,pc_cloud *);
pc_cloud_result pc_batch_start(pc_batch_controller *,const char *operation,const char *activity,uint32_t ms);
pc_cloud_result pc_batch_poll(pc_batch_controller *,uint32_t ms);
pc_cloud_result pc_batch_retry(pc_batch_controller *,const char *new_request,uint32_t ms);
/* Only dismiss an authoritative terminal result; no new operation can replace uncertainty. */
pc_cloud_result pc_batch_dismiss(pc_batch_controller *);
