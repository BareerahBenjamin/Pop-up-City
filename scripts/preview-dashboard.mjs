// Local review only: no .env, persistent database, mailer or production accounts.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDatabase,migrate} from '../database.js';
import {loadConfig} from '../config.js';
import {createApplication} from '../server.js';
const port=Number(process.env.DASHBOARD_PREVIEW_PORT||3342),origin=`http://127.0.0.1:${port}`;
const config=loadConfig({PORT:String(port),PUBLIC_ORIGIN:origin,AUTH_PEPPER:randomBytes(32).toString('hex')});
const db=openDatabase(':memory:');migrate(db);
const now=Math.floor(Date.now()/1000),member=randomUUID(),token=randomBytes(32).toString('hex');
db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,'member','active',?,?)").run(member,'preview@example.test','预览邻居',now,now);
db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),member,now+86400,now);
const admin=randomUUID(),adminToken=randomBytes(32).toString('hex');
db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,'admin','active',?,?)").run(admin,'preview-admin@example.test','预览管理员',now,now);
db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(adminToken).digest('hex'),admin,now+86400,now);

const day=new Date((now+8*3600)*1000).toISOString().slice(0,10),midnight=Date.parse(`${day}T00:00:00+08:00`)/1000;
const samples=[['把灵感捏进一只杯子','共创','C栋2层 · 公共活动区',1,10],['一起写下城市的新故事','学习','E栋2层 · 课程教室',1,10],['带着电脑，一起做点有趣的事','科技','C栋2层 · 公共活动区',1,14],['在晚餐前，散步认识新邻居','连接','迎新点',1,17],['从一杯咖啡开始聊聊','连接','街角咖啡',2,9],['让你的第一个小游戏诞生','科技','C栋2层 · 公共活动区',2,11],['用一顿饭交换家乡的味道','生活','公共厨房',2,18],['把一天的好奇心画下来','共创','共同客厅',0,15],['一次开放的创作分享','学习','E栋2层 · 课程教室',0,19],['一起为市集做准备','共创','陶溪川广场',3,14]];
for(const [index,[title,category,location,offset,hour]] of samples.entries()){
  const id=randomUUID(),start=midnight+offset*86400+hour*3600;
  db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,volunteer_capacity,host_id,official,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,12,2,?,?,'published',?,?)").run(id,title,'本地预览示例活动。欢迎带上好奇心，一起学习、链接、创造、玩。',category,location,start,start+5400,member,index%3===0?1:0,now,now);
  if([0,2,6].includes(index))db.raw.prepare('INSERT INTO event_interests VALUES(?,?,?)').run(id,member,now);
  if(index===2)db.raw.prepare("INSERT INTO event_registrations VALUES(?,?,'attendee',?)").run(id,member,now);
}
// Include ongoing, future and ended long activities for reviewing discovery grouping.
for(const [title,start,end] of [['城市共创驻留计划',now-7*86400,now+10*86400],['邻里开放工作坊',now+5*86400,now+12*86400],['上周的开放分享',now-8*86400,now-8*86400+5400]]){
  db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,30,?,'published',?,?)").run(randomUUID(),title,'本地分组展示示例，具体参与安排请查看活动详情。','共创','共同客厅',start,end,member,now,now);
}
const server=createApplication(config,{db,mailer:null});
const [application]=server.listeners('request');server.removeAllListeners('request');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8').replace('<body class="site-layout">','<body class="site-layout"><p class="preview-notice" role="status">本地交互预览 · 全部为示例数据 · 重启即清空 · 不发送邮件</p>');
server.on('request',(req,res)=>{
  if(req.method==='GET'&&['/','/?guest=1','/?admin=1'].includes(req.url)){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Set-Cookie':req.url.includes('guest=1')?'popup_city_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0':`popup_city_session=${req.url.includes('admin=1')?adminToken:token}; Path=/; HttpOnly; SameSite=Lax`});res.end(html);
  }else application(req,res);
});
server.listen(port,'127.0.0.1',()=>console.log(`Local dashboard preview: ${origin}\nAnonymous preview: ${origin}/?guest=1\nAdmin preview: ${origin}/?admin=1#admin\nIn-memory sample data only. Press Ctrl+C to stop.`));
const shutdown=()=>server.close(()=>{db.close();process.exit(0)});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
