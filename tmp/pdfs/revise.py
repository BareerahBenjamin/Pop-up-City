from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader,PdfWriter
from io import BytesIO
pdfmetrics.registerFont(TTFont('Manual', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
src=PdfReader('/Users/yeyutong/Desktop/AI_Passport_两页使用手册.pdf')
w=PdfWriter()
bg='#F5F6EF'; ink='#193D37'; green='#24765F'
for i,p in enumerate(src.pages):
 W,H=float(p.mediabox.width),float(p.mediabox.height)
 b=BytesIO(); c=canvas.Canvas(b,pagesize=(W,H)); c.scale(W/849,H/1200)
 def box(x,y,width,height,lines,size=14,leading=27,color=ink,fill=bg):
  c.setFillColor(fill);c.rect(x,1200-y-height,width,height,fill=1,stroke=0)
  c.setFillColor(color);c.setFont('Manual',size)
  for j,line in enumerate(lines):c.drawString(x+2,1200-y-size-j*leading,line)
 if i==0:
  box(60,195,710,30,['按键：UP = 上键，DOWN = 下键，OK = 确认键；短按点一下，长按按住半秒。'],15,fill='#E4EBDD')
  box(427,312,374,175,['1  看到 WI-FI SETUP，短按 UP 开始配网。','2  连上网后，打开 herstory.net.cn，登录账号。','    在网站绑定设备，输入屏幕上的绑定码。','3  确认屏幕上是你的账号，短按 OK。','4  看到绑定成功，再短按 OK 进入个人星球。'],14,28)
  box(57,488,730,30,['账号不是你的？长按 OK 拒绝，再用自己的账号重新申请绑定。'],14)
  box(321,595,480,162,['1  在个人星球页，短按 UP 更换 Wi-Fi。','2  按提示选好网络后，短按 OK 开始连接。','3  连上后，设备会自动回到主页。','还没开始连接？短按 UP 就能返回。','换网失败怎么办？看第 2 页。'],14,29)
  box(321,858,480,201,['1  让设备保持联网，走近活动发起者。','2  请发起者在名单中选中你，帮你签到。','3  签到成功，你的星球会亮一下（约 1 秒）。','','你不用按 OK，等发起者确认就好。','没看到亮起？请发起者查一下签到名单。','断网期间的签到，之后同步时不会再亮。'],14,27)
  box(57,1080,740,54,['查看名字：短按 DOWN；在名字页按 OK 暂停 / 继续，再按 DOWN 返回。','交朋友：在星球页长按 UP 进入，按屏幕提示操作；长按 OK 查看按键说明。'],13,24)
 else:
  box(425,241,380,183,['1  活动开始后，让参加者带着设备靠近你。','2  短按 UP / DOWN，选中要签到的人。','3  短按 OK，帮对方签到。','4  看到 CHECKED IN!，就说明签到成功了。','','查总名单：长按 DOWN 打开，上下键翻看；','再长按 DOWN，回到签到页。'],14,25)
  box(425,488,380,164,['1  在签到页长按 UP，为附近成员批量签到。','2  等进度走完，再看签到结果。','3  全部成功：短按 OK 返回。','4  有人没成功：短按 OK，只重试这些人。','长按 DOWN 可查总名单；短按 UP 可返回。','活动取消后不再继续，已成功的签到会保留。'],14,27)
  box(136,773,260,56,['短按 UP，重新设置 Wi-Fi。','先连上网，才能继续绑定。'],14,23)
  box(513,773,285,56,['短按 OK 再试一次；','短按 UP，改回原来的 Wi-Fi。'],14,23)
  box(136,898,263,58,['等屏幕更新，再重新申请绑定。','短按 UP 可回到配网页。'],14,23)
  box(513,898,285,58,['稍等一会儿，设备会尝试重连。','短按 UP 可回到配网页。'],14,23)
  box(60,1012,728,91,['没亮起来：请发起者查名单；看到 OUT OF RANGE（距离太远），就靠近一些。','正在处理：SAVING 是正在保存，CHECKING 是正在核对，等结果出来再操作。','没签到成功：NOT SAVED 表示未保存；按 OK 返回后重新签到。批量失败按 OK 重试。'],13,28,green,'#E4EBDD')
 box(44,1140,660,25,['功能说明稿 · 2026.10 | 沿用原稿屏幕示意，设备功能以现场开放版本为准'],11,20,color='#617A72')
 c.save(); b.seek(0);p.merge_page(PdfReader(b).pages[0]);w.add_page(p)
with open('output/pdf/AI_Passport_两页使用手册_简明版.pdf','wb') as f:w.write(f)
