#include "network_profiles.h"
#include <string.h>

bool network_profile_valid(const network_profile_t *p)
{
    if (!p || !memchr(p->ssid,0,sizeof(p->ssid)) || !memchr(p->password,0,sizeof(p->password))) return false;
    size_t ssid=strlen(p->ssid),password=strlen(p->password);
    if (!ssid || ssid>32 || (password && (password<8 || password>64))) return false;
    for(size_t i=0;i<ssid;i++)if((unsigned char)p->ssid[i]<32 || p->ssid[i]==127)return false;
    for(size_t i=0;i<password;i++) {
        unsigned char c=p->password[i];
        if(c<32||c==127)return false;
        if(password==64 && !((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F')))return false;
    }
    return true;
}
bool network_profiles_valid(const network_profiles_t *p)
{
    if(!p||p->version!=1||p->count>NETWORK_PROFILE_COUNT)return false;
    for(uint32_t i=0;i<p->count;i++) {
        if(!network_profile_valid(&p->profiles[i]))return false;
        for(uint32_t j=0;j<i;j++)if(!strcmp(p->profiles[i].ssid,p->profiles[j].ssid))return false;
    }
    return true;
}
bool network_profiles_promote(network_profiles_t *p,const network_profile_t *connected)
{
    if(!network_profiles_valid(p)||!network_profile_valid(connected))return false;
    network_profiles_t next={.version=1,.count=1};next.profiles[0]=*connected;
    for(uint32_t i=0;i<p->count&&next.count<NETWORK_PROFILE_COUNT;i++)
        if(strcmp(p->profiles[i].ssid,connected->ssid))next.profiles[next.count++]=p->profiles[i];
    *p=next;return true;
}
bool network_elapsed(uint32_t now,uint32_t since,uint32_t duration)
{
    return (uint32_t)(now-since)>=duration;
}
