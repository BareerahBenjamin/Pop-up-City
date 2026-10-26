#include "network_handoff.h"
#include "blufi_input.h"
#include <assert.h>
#include <stdio.h>
int main(void){
 pc_site_gate g;pc_site_reset(&g);assert(pc_site_due(&g,0)&&pc_site_syncing(&g));
 pc_site_status_verified(&g,true);assert(g.stage==PC_SITE_RUNTIME&&pc_site_due(&g,0)&&pc_site_syncing(&g));
 pc_site_failed(&g,100);assert(!pc_site_syncing(&g)&&g.stage==PC_SITE_STATUS&&!pc_site_due(&g,2099)&&pc_site_due(&g,2100));
 const unsigned expected[]={4000,8000,16000,30000,30000};
 for(unsigned i=0;i<5;i++){pc_site_failed(&g,100);assert(g.wait_ms==expected[i]);}
 assert(!pc_site_due(&g,999999));pc_site_reset(&g);assert(pc_site_due(&g,0));
 pc_site_reset(&g);pc_site_status_verified(&g,false);assert(g.stage==PC_SITE_READY&&!pc_site_due(&g,999999));
 pc_site_reset(&g);pc_site_status_verified(&g,true);pc_site_runtime_verified(&g);assert(g.stage==PC_SITE_READY&&g.failures==0&&!pc_site_syncing(&g));
 pc_site_failed(&g,0xfffffff0u);assert(!pc_site_due(&g,10)&&pc_site_due(&g,0x800u));
 /* Initial failure is visible; only a previously verified session gets grace. */
 pc_site_reset(&g);pc_site_failed(&g,10);assert(!pc_site_recovering(&g,11));
 pc_site_reset(&g);pc_site_runtime_verified(&g);pc_site_failed(&g,100);
 assert(pc_site_recovering(&g,100)&&pc_site_recovering(&g,30099)&&!pc_site_recovering(&g,30100));
 pc_site_failed(&g,2100);assert(g.recovery_started==100&&pc_site_recovering(&g,2200));
 pc_site_runtime_verified(&g);assert(!pc_site_recovering(&g,2300));
 pc_site_failed(&g,0xfffffff0u);assert(pc_site_recovering(&g,10));
 for(unsigned i=0;i<4;i++)pc_site_failed(&g,20+i);assert(!pc_site_recovering(&g,25));
 pc_site_reset(&g);assert(!g.established&&!pc_site_recovering(&g,30));
 uint8_t credential[]={0x0d,1,0,1,'x'};assert(blufi_packet_allowed(credential,5,true));
 assert(!blufi_packet_allowed(credential,5,false));credential[1]=0;assert(!blufi_packet_allowed(credential,5,true));
 credential[0]=0x09;assert(!blufi_packet_allowed(credential,5,true));credential[1]=1;assert(blufi_packet_allowed(credential,5,true));
 uint8_t handshake[]={1,0,0,0};assert(blufi_packet_allowed(handshake,4,false));
 assert(!blufi_packet_allowed(handshake,3,true)&&!blufi_packet_allowed(NULL,4,true));
 uint8_t checksum[]={0x0d,3,0,1,'x',0,0};assert(blufi_packet_allowed(checksum,7,true));assert(!blufi_packet_allowed(checksum,6,true));
 uint8_t fragment[]={1,0x10,0,3,0,4,0};assert(blufi_fragment_allowed(fragment,7));
 fragment[5]=5;assert(!blufi_fragment_allowed(fragment,7));fragment[5]=0;fragment[4]=0;assert(!blufi_fragment_allowed(fragment,7));
 fragment[3]=1;assert(!blufi_fragment_allowed(fragment,7));
 puts("Backend handoff/backoff/wraparound and encrypted BLUFI credential frame guards: PASS");
}
