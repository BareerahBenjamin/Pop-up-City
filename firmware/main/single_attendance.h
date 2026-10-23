#pragma once
#include "proximity.h"
typedef struct {pc_cloud *cloud;unsigned slot;bool loaded;char completed_peer[37],completed_activity[37];} pc_single_controller;
void pc_single_init(pc_single_controller *,pc_cloud *);
pc_cloud_result pc_single_begin(pc_single_controller *,const char *id,const char *activity,const nearby_participant_t *,uint32_t ms);
pc_cloud_result pc_single_retry(pc_single_controller *,const nearby_participant_t *same_peer,uint32_t ms);
pc_cloud_result pc_single_abandon(pc_single_controller *,uint32_t ms);
/* Always queries the original ID first; a fresh peer proof never changes the intent/ID. */
pc_cloud_result pc_single_recover(pc_single_controller *,const nearby_participant_t *same_peer,uint32_t ms);
