#include "network_handoff.h"
#include <string.h>
void pc_site_reset(pc_site_gate *g){memset(g,0,sizeof(*g));}
bool pc_site_due(const pc_site_gate *g,uint32_t now){return g->stage!=PC_SITE_READY&&g->failures<5&&(uint32_t)(now-g->since)>=g->wait_ms;}
void pc_site_failed(pc_site_gate *g,uint32_t now){
 if(g->established&&g->stage==PC_SITE_READY)g->recovery_started=now;
 g->stage=PC_SITE_STATUS;g->since=now;
 if(g->failures<5)g->failures++;
 g->wait_ms=g->failures<5?(1000u<<g->failures):30000u;
}
void pc_site_status_verified(pc_site_gate *g,bool bound){g->stage=bound?PC_SITE_RUNTIME:PC_SITE_READY;g->wait_ms=0;if(!bound)g->failures=0;}
void pc_site_runtime_verified(pc_site_gate *g){g->stage=PC_SITE_READY;g->failures=0;g->wait_ms=0;g->established=true;g->recovery_started=0;}

bool pc_site_syncing(const pc_site_gate *g){return g->stage!=PC_SITE_READY&&g->failures==0;}

bool pc_site_recovering(const pc_site_gate *g,uint32_t now){return g->established&&g->stage!=PC_SITE_READY&&g->failures>0&&g->failures<5&&(uint32_t)(now-g->recovery_started)<30000u;}
