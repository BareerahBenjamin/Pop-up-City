#include "blufi_input.h"
#include <string.h>
void blufi_input_reset(blufi_input_t *in){if(in)memset(in,0,sizeof(*in));}
bool blufi_input_ssid(blufi_input_t *in,const void *data,size_t length)
{
    if(!in)return false;
    blufi_input_reset(in);
    if(!data||!length||length>32||memchr(data,0,length))return false;
    memcpy(in->profile.ssid,data,length);
    in->ssid_valid=network_profile_valid(&in->profile);in->password_valid=true;
    return in->ssid_valid;
}
bool blufi_input_password(blufi_input_t *in,const void *data,size_t length)
{
    if(!in)return false;
    memset(in->profile.password,0,sizeof(in->profile.password));in->password_valid=false;
    if(length>64||(length&&(!data||memchr(data,0,length))))return false;
    if(length)memcpy(in->profile.password,data,length);
    in->password_valid=in->ssid_valid&&network_profile_valid(&in->profile);
    return in->password_valid;
}
bool blufi_input_ready(const blufi_input_t *in)
{
    return in&&in->ssid_valid&&in->password_valid&&network_profile_valid(&in->profile);
}

bool blufi_packet_allowed(const uint8_t *packet,size_t length,bool security_ready)
{
    if(!packet||length<4||length>512)return false;
    size_t expected=4u+packet[3]+((packet[1]&2u)?2u:0u);
    if(length!=expected)return false;
    unsigned type=packet[0]&3u,subtype=packet[0]>>2;
    if(type==1u&&(subtype==2u||subtype==3u))return security_ready&&(packet[1]&1u)!=0;
    return true;
}

bool blufi_fragment_allowed(const uint8_t *packet,size_t length)
{
    if(!packet||length<4)return false;
    if(!(packet[1]&0x10u))return true;
    if(packet[3]<2u||length<4u+packet[3])return false;
    unsigned total=(unsigned)packet[4]|((unsigned)packet[5]<<8);
    return total>0&&total<=1024&&total>=(unsigned)packet[3]-2u;
}
