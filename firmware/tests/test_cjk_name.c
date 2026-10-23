#include "cjk_name.h"
#include "cJSON.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc,char **argv){
 assert(argc==2||argc==3);FILE *f=fopen(argv[1],"rb");assert(f);assert(!fseek(f,0,SEEK_END));long length=ftell(f);assert(length>8);rewind(f);uint8_t *font=malloc((size_t)length);assert(font&&fread(font,1,(size_t)length,f)==(size_t)length);fclose(f);
 /* Activity titles must resolve actual ROM glyphs, never the replacement box. */
 const unsigned required[]={0x7761,0x89c9,0x6d3b,0x52a8,0x7b7e,0x5230};
 for(unsigned k=0;k<sizeof(required)/sizeof(*required);k++){
  bool found=false;for(size_t at=8;at+36<=(size_t)length;at+=36){unsigned cp=(unsigned)font[at]|(unsigned)font[at+1]<<8|(unsigned)font[at+2]<<16|(unsigned)font[at+3]<<24;if(cp==required[k]){found=true;break;}}assert(found);
 }
 uint8_t guarded[770];memset(guarded,0,sizeof guarded);guarded[0]=0x12;guarded[769]=0x34;uint8_t previous[768]={0};
 const char *names[]={"海椰","小雨","张三","𠮷","Rae 海椰","中文名字测试中文名字测试中文名字测试中文名字测试中文名字测试中文"};
 for(unsigned n=0;n<sizeof(names)/sizeof(*names);n++){assert(pc_cjk_name_bitmap(font,(size_t)length,names[n],guarded+1));assert(guarded[0]==0x12&&guarded[769]==0x34);unsigned nonzero=0;for(unsigned i=1;i<769;i++)nonzero|=guarded[i];assert(nonzero);if(n)assert(memcmp(previous,guarded+1,768));memcpy(previous,guarded+1,768);}
 assert(!pc_cjk_name_bitmap(font,4,"中文",guarded+1));assert(!pc_cjk_name_bitmap(font,(size_t)length,"\xc0\xaf",guarded+1));assert(!pc_cjk_name_bitmap(font,(size_t)length,"\xed\xa0\x80",guarded+1));assert(!pc_cjk_name_bitmap(font,(size_t)length,"",guarded+1));
 if(argc==3){
  FILE *v=fopen(argv[2],"rb");assert(v);assert(!fseek(v,0,SEEK_END));long n=ftell(v);rewind(v);char *json=calloc(1,(size_t)n+1);assert(json&&fread(json,1,(size_t)n,v)==(size_t)n);fclose(v);cJSON *vectors=cJSON_Parse(json);assert(cJSON_IsArray(vectors));
  for(int i=0;i<cJSON_GetArraySize(vectors);i++){
   cJSON *item=cJSON_GetArrayItem(vectors,i);const char *name=cJSON_GetObjectItem(item,"name")->valuestring,*hex=cJSON_GetObjectItem(item,"bits")->valuestring;
   unsigned width=(unsigned)cJSON_GetObjectItem(item,"width")->valueint,height=(unsigned)cJSON_GetObjectItem(item,"height")->valueint,scale=(unsigned)cJSON_GetObjectItem(item,"scale")->valueint;
   uint8_t buffer[3074];memset(buffer,0xa5,sizeof(buffer));size_t bytes=(size_t)(width/8)*height;
   assert(pc_pixel_name_render(font,(size_t)length,name,buffer+1,3072,width,height,scale,cJSON_IsTrue(cJSON_GetObjectItem(item,"center")),cJSON_IsTrue(cJSON_GetObjectItem(item,"wrap"))));
   assert(buffer[0]==0xa5&&buffer[bytes+1]==0xa5&&strlen(hex)==bytes*2);
   for(size_t b=0;b<bytes;b++){unsigned value;assert(sscanf(hex+2*b,"%2x",&value)==1&&buffer[b+1]==value);}
  }
  cJSON_Delete(vectors);free(json);puts("Website/firmware pixel names: 24 bitmap vectors byte-identical, guards intact");
 }
 uint16_t strip[240*10+2];memset(strip,0,sizeof(strip));strip[0]=0x1234;strip[240*10+1]=0x4321;
 assert(pc_pixel_line_strip(font,(size_t)length,"Rae 很长的活动名称abcdefghijklmnopqrstuv",9000,24,100,192,100,10,strip+1,0xffff));
 assert(strip[0]==0x1234&&strip[240*10+1]==0x4321);
 for(unsigned y=0;y<10;y++)for(unsigned x=0;x<240;x++)if(x<24||x>=216)assert(strip[1+y*240+x]==0);
 assert(!pc_pixel_line_strip(font,(size_t)length,"\xc0\xaf",0,24,100,192,100,10,strip+1,0xffff));
 memset(strip+1,0,240*10*sizeof(uint16_t));
 assert(pc_pixel_line_strip(font,(size_t)length,"中文 Wi-Fi",0,24,88,192,88,10,strip+1,0xffff));
 unsigned ssid_pixels=0;for(unsigned i=1;i<=240*10;i++)ssid_pixels+=strip[i]!=0;assert(ssid_pixels);
 memset(strip+1,0,240*10*sizeof(uint16_t));assert(pc_pixel_line_strip(font,(size_t)length,"中文 Wi-Fi",0,24,88,192,128,10,strip+1,0xffff));
 for(unsigned i=1;i<=240*10;i++)assert(strip[i]==0); /* Wi-Fi icon rows untouched. */
 free(font);puts("CJK ROM fallback: Chinese/rare/mixed/32-character names, strict UTF-8 and strip guards PASS");return 0;
}
