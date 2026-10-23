#include "personal_visual.h"
#include "cjk_name.h"
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

#ifdef ESP_PLATFORM
 const char *style=text(identity,"name_bitmap_style");
 if(!style||strcmp(style,PC_NAME_BITMAP_STYLE)){
  width=pc_pixel_name_width(name,2);
  if(!width||!pc_pixel_name_local(name,next.name_bitmap,sizeof(next.name_bitmap),width,32,2,false,false))return false;
 }
#endif
 next.name_width=(uint16_t)width;next.valid=true;next.palette=(uint8_t)p;next.stage=(uint8_t)stage;next.revision=revision;next.house=cJSON_IsTrue(house);next.lake=cJSON_IsTrue(lake);strcpy(next.name,name);strcpy(next.name_version,version);*out=next;return true;
}
static void dot(unsigned row,unsigned rows,uint16_t *pixels,int x,int y,uint16_t color){if(x>=0&&x<240&&y>=(int)row&&y<(int)(row+rows))pixels[(y-row)*240+x]=color;}
static void authored_dot(unsigned row,unsigned rows,uint16_t *pixels,int x,int y,int w,int h,unsigned rgb,double alpha){
 if(alpha<=0)return;
 if(alpha>1)alpha=1;
 for(int py=y;py<y+h;py++)for(int px=x;px<x+w;px++)if(px>=0&&px<240&&py>=(int)row&&py<(int)(row+rows)){
  uint16_t old=pixels[(py-row)*240+px];unsigned r=(unsigned)(((rgb>>16)&255)*alpha+((old>>11)&31)*255.0/31*(1-alpha));
  unsigned g=(unsigned)(((rgb>>8)&255)*alpha+((old>>5)&63)*255.0/63*(1-alpha));
  unsigned b=(unsigned)((rgb&255)*alpha+(old&31)*255.0/31*(1-alpha));
  pixels[(py-row)*240+px]=(uint16_t)(((r>>3)<<11)|((g>>2)<<5)|(b>>3));
 }
}
void pc_personal_planet_overlay(const pc_personal_visual *v,uint32_t ms,unsigned row,unsigned rows,uint16_t *pixels){
 if(!v||!v->valid||v->palette>3||v->stage>6)return;
 /* Direct port of the archive's 240x300 canvas. Pixel geometry and 2s cycle stay authored. */
 const double pi=3.141592653589793,phase=(ms%2000)/2000.0,wave=(1-cos(phase*pi*2))/2;
 unsigned beat=ms/2000;int lift=-(int)lround(1-cos((ms%2500)*pi*2/2500.0)),top=48+lift;
 static const int stars[5][2]={{37,40},{194,59},{208,206},{25,222},{177,253}};
 for(unsigned i=0;i<5;i++){
  int x=stars[i][0],y=stars[i][1];authored_dot(row,rows,pixels,x,y,2,2,0xa6ba8b,.2+(i==beat%5?.36*wave:0));
  if(i==beat%5&&wave>.7){authored_dot(row,rows,pixels,x-2,y+1,6,1,0xa6ba8b,.17);authored_dot(row,rows,pixels,x+1,y-2,1,6,0xa6ba8b,.17);}
 }
 authored_dot(row,rows,pixels,83,242,74-(int)lround(wave*4),3,0xa6ba8b,.08+.025*(1-wave));
 if(v->house&&beat%3==2){double alpha=sin(phase*pi)*.48;
  authored_dot(row,rows,pixels,24+(30+(int)lround(sin(phase*5)))*3,top+(12-(int)lround(phase*5))*3,6,6,0xa6ba8b,alpha);
  authored_dot(row,rows,pixels,24+(32-(int)lround(phase*2))*3,top+(9-(int)lround(phase*4))*3,3,3,0xa6ba8b,alpha*.7);
 }
 for(unsigned y=row;y<row+rows;y++)for(unsigned x=24;x<216;x++)if((int)y>=top&&(int)y<top+192){
  unsigned sy=(y-top)/3,sx=(x-24)/3;uint16_t c=pc_personal_planets[v->palette][v->stage][v->lake?1:0][sy*64+sx];if(c)pixels[(y-row)*240+x]=c;
 }
 if(beat%3==0&&phase>.12&&phase<.88){double u=(phase-.12)/.76,alpha=sin(u*pi)*.9;int dx=(int)lround(sin(u*pi*1.5)*3),dy=(int)lround(u*10);
  authored_dot(row,rows,pixels,24+(18+dx)*3,top+(20+dy)*3,3,3,0xa5be62,alpha);
  authored_dot(row,rows,pixels,24+(19+dx)*3,top+(19+dy)*3,3,3,0x789a46,alpha);
 }
 if(v->lake&&beat%3==1){
  authored_dot(row,rows,pixels,24+44*3,top+32*3,6,3,0xd3e9d7,wave*.85);
  authored_dot(row,rows,pixels,24+48*3,top+35*3,6,3,0xd3e9d7,fmax(0,sin((phase-.2)*pi))*.6);
 }
}
void pc_personal_name_overlay(const pc_personal_visual *v,uint32_t ms,unsigned row,unsigned rows,uint16_t *pixels){
 if(!v||!v->valid||v->palette>3||!pixels)return;
 /* Approved name screen: large nickname, fixed size even for long names.
  * Scale the bounded 32px source directly into the display strip; no expanded bitmap. */
 /* Same RGB565 primary tones as website planet-palettes.js; no separate name palette. */
 static const uint16_t colors[]={0xdf34,0xf679,0xcf3e,0xfed5};
 enum { scale=3, left=12, top=116, viewport=216, gap=48, step_ms=40 };
 unsigned width=v->name_width;if(!width||width>768||width%8)return;
 unsigned rendered=width*scale,offset=(unsigned)(((uint64_t)ms*scale/step_ms)%(rendered+gap));

 for(unsigned py=row;py<row+rows;py++){
  if(py<top||py>=top+32*scale)continue;
  unsigned sy=(py-top)/scale;
  for(unsigned dx=0;dx<viewport;dx++){
   unsigned position=(dx+offset)%(rendered+gap);
   if(position>=rendered)continue;
   unsigned sx=position/scale;
   if(v->name_bitmap[sy*(width/8)+sx/8]&(128>>(sx%8)))dot(row,rows,pixels,left+(int)dx,(int)py,colors[v->palette]);
  }
 }
}

void pc_personal_planet_at(const pc_personal_visual *v,uint32_t ms,unsigned row,unsigned rows,uint16_t *pixels,int left,int top,unsigned size){
 if(!v||!v->valid||v->palette>3||v->stage>6||!size)return;
 int lift=-(int)lround(1.0-cos((ms%2500)*3.141592653589793/1250.0));
 for(unsigned y=row;y<row+rows;y++)for(unsigned x=0;x<240;x++)if((int)x>=left&&(int)x<left+(int)size&&(int)y>=top+lift&&(int)y<top+lift+(int)size){unsigned sx=(x-left)*64/size,sy=(y-top-lift)*64/size;uint16_t c=pc_personal_planets[v->palette][v->stage][v->lake?1:0][sy*64+sx];if(c)pixels[(y-row)*240+x]=c;}
 unsigned phase=ms%2000,step=phase/250;
 if(v->house&&phase<1500)dot(row,rows,pixels,left+(29+(int)(step%3))*size/64,top+(14-(int)step)*size/64+lift,0xad75);
 if(v->lake&&phase<1250)for(int a=-1;a<=1;a++)dot(row,rows,pixels,left+(44+(int)(step%4))*size/64+a,top+32*size/64+lift,0xffff);
 if(phase<1750)dot(row,rows,pixels,left+(18+(int)step*2)*size/64,top+(19+(int)step*3)*size/64+lift,0xae47);
}
