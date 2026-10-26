#!/usr/bin/env python3
"""Compile genuine BDF pixels plus approved ASCII to a flash-only shared name font.
No automatic scaling or antialiasing. Rare legacy glyphs retain fixed-grid coverage; save schema is unrelated.
"""
from pathlib import Path
import struct,hashlib,json,re,argparse
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--member-names',type=Path,help='Private exported member names; only codepoints are retained')
args=parser.parse_args()
subset_path=root/'assets/fonts/name-codepoints.json'
if args.member_names:
    exported=json.loads(args.member_names.read_text())
    if exported.get('format')!='popcity-member-names-v1' or not isinstance(exported.get('names'),list):raise ValueError('Invalid member-name export')
    points=sorted({ord(c) for name in exported['names'] for c in name})
    subset_path.write_text(json.dumps({'format':'popcity-name-codepoints-v1','codepoints':points},indent=2)+'\n')
source=root/'assets/fonts/fusion-pixel/fusion-pixel-12px-monospaced-zh_hans.bdf'
raw=source.read_bytes();blocks=raw.decode().split('STARTCHAR ')[1:];glyphs={}
for block in blocks:
    cp=int(re.search(r'^ENCODING (-?\d+)$',block,re.M).group(1))
    if cp<0 or cp>0x10ffff or 0xd800<=cp<=0xdfff:continue
    w,h,xoff,yoff=map(int,re.search(r'^BBX (\S+) (\S+) (\S+) (\S+)$',block,re.M).groups())
    lines=block.split('BITMAP\n',1)[1].split('ENDCHAR',1)[0].strip().splitlines()
    bits=bytearray(32)
    for y,line in enumerate(lines):
        value=int(line,16);rowbits=len(line)*4
        for x in range(w):
            px=xoff+x;py=2+10-h-yoff+y
            if 0<=px<12 and 0<=py<16 and value&(1<<(rowbits-1-x)):bits[py*2+px//8]|=128>>(px%8)
    glyphs[cp]=bits
# Preserve previously supported rare CJK characters absent from the pixel source.
# Rasterize supplements once at native 12px, monochrome, never at runtime.
from PIL import Image,ImageDraw,ImageFont
legacy=root/'assets/fonts/NotoSansCJKsc-Regular.otf';legacy_raw=legacy.read_bytes()
u16=lambda p:struct.unpack_from('>H',legacy_raw,p)[0]
u32=lambda p:struct.unpack_from('>I',legacy_raw,p)[0]
tables={legacy_raw[12+i*16:16+i*16].decode():u32(20+i*16) for i in range(u16(4))}
cmap=tables['cmap'];subtables=[cmap+u32(cmap+8+i*8) for i in range(u16(cmap+2))];table=next(t for t in subtables if u16(t)==12)
legacy_points=set()
for i in range(u32(table+12)):
    start,end,gid=struct.unpack_from('>III',legacy_raw,table+16+i*12)
    for cp in range(start,end+1):
        if gid+cp-start and (32<=cp<=126 or 0x3000<=cp<=0x30ff or 0x3400<=cp<=0x9fff or 0xff00<=cp<=0xffef or 0x20000<=cp<=0x323af):legacy_points.add(cp)
supplement_count=0;legacy_font=ImageFont.truetype(str(legacy),12)
for cp in sorted(legacy_points-set(glyphs)):
    image=Image.new('1',(12,12));d=ImageDraw.Draw(image);d.fontmode='1';box=legacy_font.getbbox(chr(cp))
    d.text(((12-(box[2]-box[0]))//2-box[0],(12-(box[3]-box[1]))//2-box[1]),chr(cp),font=legacy_font,fill=1)
    bits=bytearray(32)
    for y in range(12):
        for x in range(12):
            if image.getpixel((x,y)):bits[(y+2)*2+x//8]|=128>>(x%8)
    glyphs[cp]=bits;supplement_count+=1
# Exact 5x7 ASCII used by the approved design, integer scale 2 in the same 12x16 cell.
for match in re.finditer(r'^\s*\[(\d+)\]=\{([^}]+)\}',(root/'firmware/main/generated/pixel_glyphs.h').read_text(),re.M):
    cp=int(match[1]);rows=list(map(int,match[2].split(',')))
    if not 32<=cp<=126:continue
    bits=bytearray(32)
    for y,row in enumerate(rows):
        for x in range(5):
            if row&(1<<(4-x)):
                for dy in range(2):
                    for dx in range(2):
                        px=x*2+dx;py=1+y*2+dy;bits[py*2+px//8]|=128>>(px%8)
    glyphs[cp]=bits
# Unsupported Unicode uses a visible standard missing-glyph box, never a different font.
if 0xfffd not in glyphs:
    bits=bytearray(32)
    for y in range(2,14):
        for x in range(1,11):
            if y in (2,13) or x in (1,10):bits[y*2+x//8]|=128>>(x%8)
    glyphs[0xfffd]=bits
# User-approved native pixel rendition of U+1F31F; same 12x16 cell.
star_rows=[
    '000001000000',
    '010001000100',
    '001011101000',
    '000011100000',
    '111111111110',
    '001111111000',
    '000111110000',
    '000111110000',
    '001110111000',
    '001100011000',
    '010000000100',
    '000000000000',
]
star=bytearray(32)
for y,row in enumerate(star_rows):
    for x,pixel in enumerate(row):
        if pixel=='1':star[(y+2)*2+x//8]|=128>>(x%8)
glyphs[0x1f31f]=star
subset=json.loads(subset_path.read_text()) if subset_path.exists() else None
missing=[]
if subset:
    requested=set(subset['codepoints'])|set(range(32,127))|{0xfffd}
    # Shared ROM font serves arbitrary activity titles and SSIDs, not only names.
    common=set()
    for lead in range(0xb0,0xf8):
        for trail in range(0xa1,0xff):
            try: common.add(ord(bytes((lead,trail)).decode('gb2312')))
            except UnicodeDecodeError: pass
    assert len(common)==6763
    requested |= common | set(range(0x3000,0x3040)) | set(range(0xff01,0xff60))
    missing=sorted(requested-set(glyphs))
    glyphs={cp:bits for cp,bits in glyphs.items() if cp in requested}
out=bytearray(b'PCP1'+struct.pack('<I',len(glyphs)))
for cp,bits in sorted(glyphs.items()):out.extend(struct.pack('<I',cp));out.extend(bits)
for path in [root/'firmware/main/generated/cjk_font.bin',root/'assets/fonts/popcity-pixel-name.bin']:path.write_bytes(out)
metadata={'name':'Pop City Pixel Names v1','style':'popcity-pixel-v1','source':str(source.relative_to(root)),'source_url':'https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.09.01','source_sha256':hashlib.sha256(raw).hexdigest(),'ascii_source':'firmware/main/generated/pixel_glyphs.h; approved design 5x7 at integer scale 2','cell_width':12,'cell_height':16,'glyphs':len(glyphs),'bytes':len(out),'sha256':hashlib.sha256(out).hexdigest(),'license':'SIL OFL 1.1 and included upstream notices; assets/fonts/fusion-pixel/','rare_sample_20bb7_present':0x20bb7 in glyphs,'legacy_supplements':supplement_count,'legacy_supplement_source':'NotoSansCJKsc-Regular.otf; build-time 12px monochrome only; preserves prior CJK coverage','missing_glyph':'U+FFFD pixel box only for unsupported Unicode; no runtime font substitution'}
metadata.update({'subset_source':'GB2312 6763 Han + punctuation + assets/fonts/name-codepoints.json' if subset else None,'common_han_count':6763 if subset else None,'missing_requested_codepoints':missing,'rare_sample_20bb7_present':0x20bb7 in glyphs})
for path in [root/'firmware/main/generated/cjk_font.json',root/'assets/fonts/popcity-pixel-name.json']:path.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
licenses=['Original rare-glyph supplement license\n'+(root/'assets/fonts/OFL.txt').read_text()]
for path in sorted((root/'assets/fonts/fusion-pixel').rglob('*.txt')):licenses.append(str(path.relative_to(root))+'\n'+path.read_text())
(root/'assets/fonts/PIXEL_FONT_LICENSE.txt').write_text('\n\n'.join(licenses))
print(json.dumps(metadata,ensure_ascii=False))
