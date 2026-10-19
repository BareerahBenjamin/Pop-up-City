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
