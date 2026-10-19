#pragma once
#include "cloud_protocol.h"
/* Shared authenticated/signature-checked exchange; result ownership passes to caller. */
pc_cloud_result pc_cloud_call(pc_cloud *,bool,const char *,const cJSON *,cJSON **);
