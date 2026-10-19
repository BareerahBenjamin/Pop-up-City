#include "personal_visual.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
int main(void){
 char bits[1537];memset(bits,'0',1536);bits[1536]=0;bits[0]='8';char json[4096];
 snprintf(json,sizeof(json),"{\"identity\":{\"name_bitmap_width\":192,\"member_name\":\"小雨\",\"name_version\":\"%064d\",\"name_bitmap\":\"%s\"},\"planet\":{\"palette_id\":\"blue\",\"revision\":3,\"ai_stage\":0,\"house_unlocked\":false,\"lake_unlocked\":false}}",0,bits);
 cJSON *r=cJSON_Parse(json);pc_personal_visual v={0};assert(pc_personal_visual_decode(r,&v));assert(v.valid&&v.palette==2&&v.stage==0&&!strcmp(v.name,"小雨"));
 uint16_t pixels[240*10]={0};pc_personal_name_overlay(&v,0,140,10,pixels);assert(pixels[4*240+24]!=0);
 uint16_t a[240*10]={0},b[240*10]={0};pc_personal_planet_overlay(&v,0,140,10,a);pc_personal_planet_overlay(&v,2000,140,10,b);assert(memcmp(a,b,sizeof(a))==0); /* complete 2s effects repeat; breathing same at t=0 and 2000 */
 pc_personal_visual old=v;cJSON_ReplaceItemInObject(cJSON_GetObjectItem(r,"planet"),"house_unlocked",cJSON_CreateTrue());assert(!pc_personal_visual_decode(r,&v));assert(memcmp(&old,&v,sizeof(v))==0);cJSON_Delete(r);
 puts("personal visual decode/name/planet validation passed");return 0;
}
