#include "friend_visual.h"
void pc_friend_visual_default(pc_friend_visual *out){
 if(!out)return;
 *out=(pc_friend_visual){.valid=false,.self={PC_HAIR_SHORT,0x4966,0xcf3e,true},.peer={PC_HAIR_SHORT,0x8a86,0xd5bd,true}};
}
static void rect(uint16_t *p,unsigned row,unsigned rows,int x,int y,int w,int h,uint16_t c){
 for(int py=y;py<y+h;py++)if(py>=(int)row&&py<(int)(row+rows)&&py>=0&&py<320)
 for(int px=x;px<x+w;px++)if(px>=0&&px<240)p[(py-(int)row)*240+px]=c;
}
static void block(uint16_t*p,unsigned r,unsigned rs,int x,int y,int w,int h,uint16_t c){rect(p,r,rs,8+2*x,60+2*y,2*w,2*h,c);}
static void person(uint16_t*p,unsigned r,unsigned rs,int x,int y,int step,const pc_friend_person *style,bool left){
 const uint16_t skin=0xf5ef;
 /* Arms are behind the hair; the outer/back side alone carries long hair. */
 block(p,r,rs,x,y+11,2,8,skin);block(p,r,rs,x+10,y+11,2,8,skin);
 if(style->hair_length==PC_HAIR_MEDIUM||style->hair_length==PC_HAIR_LONG){
  int length=style->hair_length==PC_HAIR_LONG?21:13;
  block(p,r,rs,x+(left?0:10),y+2,2,length,style->hair_rgb);
 }
 block(p,r,rs,x+2,y,8,4,skin);block(p,r,rs,x+1,y+3,10,7,skin);
 if(style->hair_length!=PC_HAIR_NONE){
  block(p,r,rs,x+2,y,8,3,style->hair_rgb);
  block(p,r,rs,x+(left?1:9),y+2,2,3,style->hair_rgb);
 }
 /* Face contains eyes only: no front-side long stripe or mouth/moustache. */
 block(p,r,rs,x+4,y+5,1,1,0x0841);block(p,r,rs,x+7,y+5,1,1,0x0841);
 block(p,r,rs,x+2,y+10,8,10,style->shirt_rgb);
 block(p,r,rs,x+2,y+20,3,7+step,0x4250);block(p,r,rs,x+7,y+20,3,7-step,0x4250);
 block(p,r,rs,x+1,y+26+step,4,2,0xa514);block(p,r,rs,x+7,y+26-step,4,2,0xa514);
}
void pc_friend_visual_strip(uint16_t*p,unsigned row,unsigned rows,uint32_t elapsed,const pc_friend_visual *visual){
 if(!visual||!visual->valid)return;
 unsigned frame=elapsed/150;if(frame>15)frame=15;
 for(unsigned y=row;y<row+rows;y++)if(y>=60&&y<235)for(unsigned x=0;x<240;x++)p[(y-row)*240+x]=0;
 int progress=frame<10?(int)frame:10;
 person(p,row,rows,8+progress*3,38,frame<10?(int)(frame%2):0,&visual->self,true);
 person(p,row,rows,92-progress*3,38,frame<10?(int)(frame%2):0,&visual->peer,false);
 if(frame>=10){static const char *heart[]={"01100110","11111111","11111111","01111110","00111100","00011000"};
  for(int y=0;y<6;y++)for(int x=0;x<8;x++)if(heart[y][x]=='1')block(p,row,rows,48+x*2,16+y*2,2,2,0xf3b8);
 }
}
