#include "network_scan_model.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
int main(void)
{
    network_scan_list_t list;network_scan_reset(&list);assert(!network_scan_selected(&list));network_scan_move(&list,1);
    assert(network_scan_add(&list,"Phone hotspot",-55,1));assert(network_scan_add(&list,"Home",-70,1));
    assert(network_scan_add(&list,"Phone hotspot",-80,1));assert(list.count==2&&list.rows[0].rssi==-55);
    assert(network_scan_add(&list,"Home",-40,1));assert(list.count==2&&!strcmp(list.rows[0].ssid,"Home"));
    assert(network_scan_add(&list,"家里的网络",-45,1));assert(!strcmp(list.rows[1].ssid,"家里的网络"));
    network_scan_move(&list,-1);assert(list.selected==2);network_scan_move(&list,1);assert(list.selected==0);
    assert(!network_scan_add(&list,"",-40,1));assert(!network_scan_add(&list,"bad\nssid",-40,1));
    assert(!network_scan_add(&list,"too strong",1,1));
    for(size_t i=0;i<30;i++){char name[33];snprintf(name,sizeof(name),"network-%u",(unsigned)i);assert(network_scan_add(&list,name,-60,0));}
    assert(list.count==16);assert(network_scan_add(&list,"strongest",-20,1));assert(!strcmp(list.rows[0].ssid,"strongest"));
    for(size_t i=1;i<list.count;i++)assert(list.rows[i-1].rssi>=list.rows[i].rssi);
    puts("Nearby Wi-Fi list: strongest-first, duplicate SSIDs, bounded results, Chinese names and selection wrap: PASS");
}
