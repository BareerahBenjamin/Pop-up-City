#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef enum { PC_SITE_STATUS, PC_SITE_RUNTIME, PC_SITE_READY } pc_site_stage;
typedef struct {pc_site_stage stage;uint32_t since,wait_ms;unsigned failures;bool established;uint32_t recovery_started;} pc_site_gate;
void pc_site_reset(pc_site_gate *gate);
bool pc_site_due(const pc_site_gate *gate,uint32_t now_ms);
void pc_site_failed(pc_site_gate *gate,uint32_t now_ms);
void pc_site_status_verified(pc_site_gate *gate,bool bound);
void pc_site_runtime_verified(pc_site_gate *gate);

/* Normal authenticated handoff has not failed: show existing neutral loading. */
bool pc_site_syncing(const pc_site_gate *gate);

/* Preserve an authenticated screen during bounded transient GET recovery. */
bool pc_site_recovering(const pc_site_gate *,uint32_t now_ms);
