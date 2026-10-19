#include "blufi_input.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
int main(void)
{
    blufi_input_t input={0};
    assert(!blufi_input_ready(&input));
    assert(!blufi_input_password(&input,"password",8));
    assert(blufi_input_ssid(&input,"hotspot",7));
    assert(blufi_input_password(&input,"password",8));
    assert(blufi_input_ready(&input));
    assert(!blufi_input_password(&input,"short",5));
    assert(!blufi_input_ready(&input));
    assert(blufi_input_password(&input,"new-password",12));
    assert(blufi_input_ssid(&input,"home",4));
    assert(input.profile.password[0]==0);
    assert(blufi_input_password(&input,NULL,0));
    char full[32];memset(full,'a',sizeof(full));
    assert(blufi_input_ssid(&input,full,sizeof(full)));
    assert(strlen(input.profile.ssid)==32);
    assert(!blufi_input_ssid(&input,full,33));
    assert(!blufi_input_ready(&input));
    assert(!blufi_input_ssid(&input,"a\0b",3));
    assert(blufi_input_ssid(&input,"home",4));
    assert(!blufi_input_password(&input,"password\0x",10));
    assert(!blufi_input_ready(&input));
    char key[64];memset(key,'f',sizeof(key));
    assert(blufi_input_password(&input,key,sizeof(key)));
    key[0]='z';assert(!blufi_input_password(&input,key,sizeof(key)));
    blufi_input_reset(&input);assert(!blufi_input_ready(&input));
    puts("BLUFI credential validation: PASS");
    return 0;
}
