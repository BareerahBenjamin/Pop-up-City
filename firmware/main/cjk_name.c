#include "cjk_name.h"
#include <string.h>
static uint32_t little(const uint8_t *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static bool decode(const unsigned char **text,uint32_t *out){
 const unsigned char *p=*text;uint32_t cp;unsigned extra;
 if(*p<128){*out=*p;*text=p+1;return true;}
 if(*p>=0xc2&&*p<=0xdf){cp=*p&31;extra=1;}else if(*p>=0xe0&&*p<=0xef){cp=*p&15;extra=2;}else if(*p>=0xf0&&*p<=0xf4){cp=*p&7;extra=3;}else return false;
 p++;for(unsigned i=0;i<extra;i++){if(!*p||(*p&0xc0)!=0x80)return false;cp=cp<<6|(*p++&63);}
 if((extra==2&&cp<0x800)||(extra==3&&cp<0x10000)||(cp>=0xd800&&cp<=0xdfff)||cp>0x10ffff)return false;
 *text=p;*out=cp;return true;
}
static const uint8_t *glyph(const uint8_t *font,uint32_t count,uint32_t cp){
 uint32_t left=0,right=count;
 while(left<right){uint32_t mid=left+(right-left)/2,value=little(font+8+(size_t)mid*36);if(value<cp)left=mid+1;else right=mid;}
 return left<count&&little(font+8+(size_t)left*36)==cp?font+12+(size_t)left*36:NULL;
}
bool pc_pixel_name_render(const uint8_t *font,size_t bytes,const char *name,uint8_t *out,size_t capacity,unsigned width,unsigned height,unsigned scale,bool center,bool wrap){
 if(!font||!name||!out||bytes<8||memcmp(font,"PCP1",4)||!width||width>768||width%8||!height||height>32||!scale||scale>2||capacity<(size_t)(width/8)*height)return false;
 uint32_t count=little(font+4);if(count>(bytes-8)/36||bytes!=8+(size_t)count*36)return false;
 const uint8_t *letters[32];unsigned length=0;const unsigned char *p=(const unsigned char *)name;
 while(*p){uint32_t cp;if(length==32||!decode(&p,&cp))return false;letters[length]=glyph(font,count,cp);if(!letters[length])letters[length]=glyph(font,count,0xfffd);if(!letters[length++])return false;}
 if(!length)return false;
 unsigned advance=12*scale,columns=wrap?width/advance:length;if(!columns)return false;
 unsigned lines=(length+columns-1)/columns;if(lines*16*scale>height)return false;
 memset(out,0,(size_t)(width/8)*height);
 for(unsigned i=0;i<length;i++){
  unsigned line=i/columns,in_line=length-line*columns;if(in_line>columns)in_line=columns;
  int left=(center?((int)width-(int)(in_line*advance))/2:0)+(int)((i%columns)*advance);
  unsigned top=(height-lines*16*scale)/2+line*16*scale;
  for(unsigned y=0;y<16;y++)for(unsigned x=0;x<12;x++)if(letters[i][y*2+x/8]&(128>>(x%8)))for(unsigned dy=0;dy<scale;dy++)for(unsigned dx=0;dx<scale;dx++){
   int px=left+(int)(x*scale+dx);unsigned py=top+y*scale+dy;
   if(px>=0&&px<(int)width&&py<height)out[py*(width/8)+(unsigned)px/8]|=128>>((unsigned)px%8);
  }
 }
 return true;
}
unsigned pc_pixel_name_width(const char *name,unsigned scale){
 if(!name||!scale||scale>2)return 0;
 const unsigned char *p=(const unsigned char *)name;unsigned count=0;
 while(*p){uint32_t cp;if(count==32||!decode(&p,&cp))return 0;count++;}
 return count?((count*12*scale+7)/8)*8:0;
}
bool pc_cjk_name_bitmap(const uint8_t *font,size_t bytes,const char *name,uint8_t out[768]){
 return pc_pixel_name_render(font,bytes,name,out,768,192,32,1,true,true);
}
#ifdef ESP_PLATFORM
extern const uint8_t pc_cjk_start[] asm("_binary_cjk_font_bin_start");
extern const uint8_t pc_cjk_end[] asm("_binary_cjk_font_bin_end");
bool pc_pixel_name_local(const char *name,uint8_t *out,size_t capacity,unsigned width,unsigned height,unsigned scale,bool center,bool wrap){
 return pc_pixel_name_render(pc_cjk_start,(size_t)(pc_cjk_end-pc_cjk_start),name,out,capacity,width,height,scale,center,wrap);
}
#endif
bool pc_pixel_line_strip(const uint8_t *font,size_t bytes,const char *name,uint32_t ms,int left,int top,unsigned window,unsigned row,unsigned rows,uint16_t *pixels,uint16_t color){
 if(!font||!name||!pixels||bytes<8||memcmp(font,"PCP1",4)||!window||left<0||(unsigned)left+window>240||row>320||rows>320-row)return false;
 uint32_t count=little(font+4);if(count>(bytes-8)/36||bytes!=8+(size_t)count*36)return false;
 const unsigned char *p=(const unsigned char *)name;unsigned length=0;
 while(*p){uint32_t cp;if(length==256||!decode(&p,&cp))return false;length++;}
 if(!length)return false;
 if(top+16<=(int)row||top>=(int)(row+rows))return true;
 unsigned width=length*12,offset=0;
 if(width>window){unsigned phase=ms%(800+(width+24)*40);offset=phase<800?0:(phase-800)/40;}
 p=(const unsigned char *)name;
 for(unsigned i=0;i<length;i++){
  uint32_t cp;if(!decode(&p,&cp))return false;const uint8_t *g=glyph(font,count,cp);if(!g)g=glyph(font,count,0xfffd);if(!g)return false;
  for(unsigned copy=0;copy<(width>window?2u:1u);copy++){
   int x=left+(width<=window?((int)window-(int)width)/2:-(int)offset)+(int)i*12+(int)copy*(int)(width+24);
   if(x+12<=left||x>=left+(int)window)continue;
   for(unsigned y=0;y<16;y++)if(top+(int)y>=(int)row&&top+(int)y<(int)(row+rows))for(unsigned dx=0;dx<12;dx++)if(x+(int)dx>=left&&x+(int)dx<left+(int)window&&(g[y*2+dx/8]&(128u>>(dx%8))))pixels[(top+y-row)*240+x+dx]=color;
  }
 }
 return true;
}
