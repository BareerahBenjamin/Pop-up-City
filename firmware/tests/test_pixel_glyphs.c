#include "generated/pixel_glyphs.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
int main(void){
 const char *required="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_@.*-";
 for(unsigned i=0;required[i];i++){unsigned used=0;for(unsigned y=0;y<7;y++){assert(pixel_glyphs[(unsigned char)required[i]][y]<32);used|=pixel_glyphs[(unsigned char)required[i]][y];}assert(used);}
 const char *name="BLUFI_HS_abcdef09";
 assert(strlen(name)*6*2-2<=240);
 puts("Pixel glyphs: all letters, hex IDs and Bluetooth name fit PASS");return 0;
}
