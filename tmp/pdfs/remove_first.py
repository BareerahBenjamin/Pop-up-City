from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader,PdfWriter
from io import BytesIO
p='output/pdf/AI_Passport_两页使用手册_简明版.pdf'
r=PdfReader(p); W,H=map(float,(r.pages[0].mediabox.width,r.pages[0].mediabox.height))
im=Image.open('tmp/pdfs/before-remove-1.png'); sx=im.width/849;sy=im.height/1200
b=BytesIO();c=canvas.Canvas(b,pagesize=(W,H));c.scale(W/849,H/1200)
c.setFillColorRGB(245/255,246/255,239/255);c.rect(0,0,849,1200,fill=1,stroke=0)
def strip(y,h,newy):
 a=im.crop((0,round(y*sy),im.width,round((y+h)*sy)))
 c.drawImage(ImageReader(a),0,1200-newy-h,width=849,height=h)
strip(0,245,0);strip(539,225,275);strip(800,260,650);strip(1075,125,1075)
pdfmetrics.registerFont(TTFont('Manual','/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
c.setFillColorRGB(245/255,246/255,239/255);c.rect(44,1200-150,750,30,fill=1,stroke=0)
c.setFont('Manual',14);c.setFillColorRGB(.38,.48,.45);c.drawString(47,1200-143,'设备联网并绑定后，可以换 Wi-Fi、查看名字、交朋友和参加活动签到。')
for y,num in [(275+543-539,'01'),(650+805-800,'02')]:
 c.setFillColorRGB(36/255,118/255,95/255);c.roundRect(46,1200-y-35,34,35,10,fill=1,stroke=0)
 c.setFillColorRGB(1,1,1);c.setFont('Manual',17);c.drawString(53,1200-y-24,num)
c.save();b.seek(0);out=PdfWriter();out.add_page(PdfReader(b).pages[0]);out.add_page(r.pages[1]);
with open(p,'wb') as f:out.write(f)
