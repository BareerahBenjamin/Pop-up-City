#pragma once
#include "cloud_protocol.h"
#include "nearby_participants.h"
typedef struct {char device_id[37],label[129];uint8_t name_bitmap[768];} pc_host_candidate;
bool pc_presence_advertisement(pc_cloud *,uint32_t ms,uint8_t out[30]);
void pc_device_uuid(const uint8_t bytes[16],char out[37]);
bool pc_presence_observe(nearby_participants_t *,const nearby_participant_t *,const char *own_id,uint32_t ms,int8_t threshold);
pc_cloud_result pc_cloud_host_candidate(pc_cloud *,const char *activity,const nearby_participant_t *,pc_host_candidate *);
