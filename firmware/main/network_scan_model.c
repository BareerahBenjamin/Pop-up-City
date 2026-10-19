#include "network_scan_model.h"
#include "network_profiles.h"
#include <string.h>
void network_scan_reset(network_scan_list_t *list){if(list)memset(list,0,sizeof(*list));}
bool network_scan_add(network_scan_list_t *list,const char *ssid,int rssi,unsigned security)
{
    if(!list||!ssid||!*ssid||strlen(ssid)>32||rssi< -127||rssi>0||security>2)return false;
    network_profile_t p={0};strcpy(p.ssid,ssid);if(!network_profile_valid(&p))return false;
    size_t target=list->count;
    for(size_t i=0;i<list->count;i++)if(!strcmp(list->rows[i].ssid,ssid)){target=i;break;}
    if(target<list->count&&list->rows[target].rssi>=rssi)return true;
    if(target==list->count){
        if(list->count==NETWORK_SCAN_MAX){if(rssi<=list->rows[list->count-1].rssi)return true;target=list->count-1;}
        else list->count++;
    }
    network_scan_row_t row={.rssi=(int8_t)rssi,.security=(uint8_t)security};strcpy(row.ssid,ssid);
    list->rows[target]=row;
    for(size_t i=target;i>0&&list->rows[i].rssi>list->rows[i-1].rssi;i--){network_scan_row_t tmp=list->rows[i-1];list->rows[i-1]=list->rows[i];list->rows[i]=tmp;}
    return true;
}
void network_scan_move(network_scan_list_t *list,int direction)
{
    if(!list||!list->count)return;
    if(direction<0)list->selected=list->selected?list->selected-1:list->count-1;
    else if(direction>0)list->selected=(list->selected+1)%list->count;
}
const network_scan_row_t *network_scan_selected(const network_scan_list_t *list)
{
    return list&&list->selected<list->count?&list->rows[list->selected]:NULL;
}
