#include "personal_visual.h"
#include <string.h>
#include <math.h>
#include "generated/personal_planets.h"
static const char *text(const cJSON *v,const char *key){const cJSON *x=cJSON_GetObjectItemCaseSensitive(v,key);return cJSON_IsString(x)?x->valuestring:NULL;}
static bool number(const cJSON *v,const char *key,unsigned *out){const cJSON *x=cJSON_GetObjectItemCaseSensitive(v,key);if(!cJSON_IsNumber(x)||!isfinite(x->valuedouble)||x->valuedouble<0||x->valuedouble>UINT32_MAX||floor(x->valuedouble)!=x->valuedouble)return false;*out=(unsigned)x->valuedouble;return true;}
static int hex(char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;}
bool pc_personal_visual_decode(const cJSON *r,pc_personal_visual *out){
 const cJSON *identity=cJSON_GetObjectItemCaseSensitive(r,"identity"),*planet=cJSON_GetObjectItemCaseSensitive(r,"planet");
 const char *name=text(identity,"member_name"),*version=text(identity,"name_version"),*bits=text(identity,"name_bitmap"),*palette=text(planet,"palette_id");
 const cJSON *house=cJSON_GetObjectItemCaseSensitive(planet,"house_unlocked"),*lake=cJSON_GetObjectItemCaseSensitive(planet,"lake_unlocked");
 pc_personal_visual next={0};unsigned stage,revision,width;
 static const char *names[]={"green","pink","blue","apricot"};unsigned p=0;while(p<4&&(!palette||strcmp(palette,names[p])))p++;
 if(!name||!name[0]||strlen(name)>=sizeof(next.name)||!version||strlen(version)!=64||!bits||!number(identity,"name_bitmap_width",&width)||width<8||width>768||width%8||strlen(bits)!=width*8||p==4||!number(planet,"ai_stage",&stage)||stage>6||!number(planet,"revision",&revision)||!cJSON_IsBool(house)||!cJSON_IsBool(lake)||cJSON_IsTrue(house)!=(stage>=1))return false;
 for(unsigned i=0;i<64;i++)if(hex(version[i])<0)return false;
 for(unsigned i=0;i<width*4;i++){int a=hex(bits[2*i]),b=hex(bits[2*i+1]);if(a<0||b<0)return false;next.name_bitmap[i]=(uint8_t)((a<<4)|b);}
 next.name_width=(uint16_t)width;next.valid=true;next.palette=(uint8_t)p;next.stage=(uint8_t)stage;next.revision=revision;next.house=cJSON_IsTrue(house);next.lake=cJSON_IsTrue(lake);strcpy(next.name,name);strcpy(next.name_version,version);*out=next;return true;
}
static void dot(unsigned row,unsigned rows,uint16_t *pixels,int x,int y,uint16_t color){if(x>=0&&x<240&&y>=(int)row&&y<(int)(row+rows))pixels[(y-row)*240+x]=color;}
void pc_personal_planet_overlay(const pc_personal_visual *v,uint32_t ms,unsigned row,unsigned rows,uint16_t *pixels){
 if(!v||!v->valid||v->palette>3||v->stage>6)return;
 /* Original 64px authored sprite at exact integer scale 3; centered, 2.5s gentle breathing. */
 unsigned breathing=ms%2500;int lift=breathing>=625&&breathing<1875?-1:0;
 for(unsigned y=row;y<row+rows;y++)for(unsigned x=0;x<240;x++)if(x>=24&&x<216&&(int)y>=64+lift&&(int)y<256+lift){unsigned sy=(y-64-lift)/3,sx=(x-24)/3;uint16_t color=pc_personal_planets[v->palette][v->stage][v->lake?1:0][sy*64+sx];if(color)pixels[(y-row)*240+x]=color;}
 unsigned phase=ms%2000,step=phase/250;
 if(v->house&&phase<1500){int x=24+29*3+(int)(step%3),y=64+14*3-(int)step*3+lift;for(int a=0;a<3;a++)dot(row,rows,pixels,x+a,y,0xad75);}
 if(v->lake&&phase<1250){int x=24+(44+(int)(step%4))*3,y=64+(32+(int)(step%2))*3+lift;for(int a=-3;a<=3;a++)dot(row,rows,pixels,x+a,y,0xffff);}
 if(phase<1750){int x=24+(18+(int)step*2)*3,y=64+(19+(int)step*3)*3+lift;dot(row,rows,pixels,x,y,0xae47);dot(row,rows,pixels,x+1,y,0xae47);dot(row,rows,pixels,x,y+1,0xae47);}
}
void pc_personal_name_overlay(const pc_personal_visual *v,uint32_t ms,unsigned row,unsigned rows,uint16_t *pixels){
 if(!v||!v->valid||v->palette>3)return;
 static const uint16_t colors[]={0x9d72,0xe536,0x8538,0xe4b0};
 unsigned width=v->name_width;if(!width||width>768)return;unsigned offset=0;if(width>192){unsigned range=width-192,phase=ms%((range*2+40)*40);unsigned step=phase/40;offset=step<20?0:step<range+20?step-20:step<range+40?range:range*2+40-step;}
 for(unsigned y=0;y<32;y++)for(unsigned x=0;x<(width<192?width:192);x++)if(v->name_bitmap[y*(width/8)+(x+offset)/8]&(128>>((x+offset)%8)))dot(row,rows,pixels,(width<192?(240-(int)width)/2:24)+(int)x,144+(int)y,colors[v->palette]);
}
