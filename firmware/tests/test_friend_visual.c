#include "friend_visual.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint16_t canvas[240*320+2];
static pc_friend_visual visual={true,{PC_HAIR_LONG,0x07e0,0x001f,false},{PC_HAIR_SHORT,0xf800,0xffe0,false}};
static uint16_t at(int x,int y){return canvas[1+(60+2*y)*240+8+2*x];}
static void render(uint32_t elapsed){
 memset(canvas,0,sizeof(canvas));canvas[0]=0x1234;canvas[240*320+1]=0xabcd;
 for(unsigned row=0;row<320;row+=10)pc_friend_visual_strip(canvas+1+row*240,row,10,elapsed,&visual);
 assert(canvas[0]==0x1234&&canvas[240*320+1]==0xabcd);
 for(unsigned y=0;y<320;y++)if(y<60||y>=235)for(unsigned x=0;x<240;x++)assert(!canvas[1+y*240+x]);
}
static unsigned left_shirt_center(void){unsigned sum=0,count=0;for(unsigned i=1;i<=240*320;i++)if(canvas[i]==0x001f){sum+=(i-1)%240;count++;}assert(count);return sum/count;}
static unsigned hearts(void){unsigned n=0;for(unsigned i=1;i<=240*320;i++)n+=canvas[i]==0xf3b8;return n;}
int main(void){
 render(0);unsigned start=left_shirt_center();assert(!hearts());
 /* Different website hair colors AND silhouettes, self-left and peer-right. */
 assert(at(10,38)==0x07e0);assert(at(94,38)==0xf800);
 assert(at(8,56)==0x07e0);assert(at(103,56)!=0xf800);
 assert(at(12,53)==0x001f);assert(at(96,53)==0xffe0);
 /* Inner/front face never has a colored hair stripe or moustache. */
 assert(at(17,46)==0xf5ef);assert(at(93,46)==0xf5ef);
 assert(at(13,46)==0xf5ef);assert(at(97,46)==0xf5ef);
 visual.self.hair_length=PC_HAIR_MEDIUM;render(0);assert(at(8,50)==0x07e0);assert(at(8,56)!=0x07e0);
 visual.self.hair_length=PC_HAIR_NONE;render(0);assert(at(10,38)==0xf5ef);assert(at(8,56)!=0x07e0);
 visual.self.hair_length=PC_HAIR_LONG;
 render(1350);assert(left_shirt_center()>start);assert(!hearts());
 render(1500);assert(hearts()>0);
 render(2400);uint16_t last[240*10];memcpy(last,canvas+1+100*240,sizeof last);
 render(UINT32_MAX);assert(!memcmp(last,canvas+1+100*240,sizeof last));
 for(unsigned frame=0;frame<16;frame++)render(frame*150);
 pc_friend_visual_default(&visual);assert(!visual.valid&&visual.self.fallback&&visual.peer.fallback);
 render(0);for(unsigned i=1;i<=240*320;i++)assert(!canvas[i]);
 puts("friend visual: per-person hair length/colors, no front stripes, movement, hold, unavailable avatar and strip bounds passed");return 0;
}
