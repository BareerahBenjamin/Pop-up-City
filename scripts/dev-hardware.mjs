// Isolated hardware lab only. Never import this launcher in the production server.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {networkInterfaces} from 'node:os';
import {fileURLToPath} from 'node:url';
import {openDatabase,migrate} from '../database.js';
import {createApplication} from '../server.js';
process.umask(0o077);
const lan=process.argv.includes('--lan'),port=3340,origin=`http://127.0.0.1:${port}`;
const directory=fileURLToPath(new URL('../data/hardware-lab/',import.meta.url));mkdirSync(directory,{recursive:true,mode:0o700});
const secretFile=directory+'private.json';
if(!existsSync(secretFile))writeFileSync(secretFile,JSON.stringify({pepper:randomBytes(32).toString('hex'),enrollmentKey:randomBytes(32).toString('hex')}),{mode:0o600,flag:'wx'});
const secrets=JSON.parse(readFileSync(secretFile,'utf8'));
if(!/^[a-f0-9]{64}$/.test(secrets.pepper)||!/^[a-f0-9]{64}$/.test(secrets.enrollmentKey))throw Error('Invalid isolated lab configuration; preserve the file and investigate');
const db=openDatabase(directory+'lab.sqlite');migrate(db);const stamp=Math.floor(Date.now()/1000),people={};
for(const [name,nickname,role] of [['admin','本地测试管理员','admin'],['user1','硬件测试用户1','member'],['user2','硬件测试用户2','member']]){
 const email=name+'@hardware-lab.example.test';let person=db.raw.prepare('SELECT * FROM members WHERE email=?').get(email);
 if(!person){const id=randomUUID();db.raw.prepare("INSERT INTO members(id,email,nickname,role,is_super_admin,status,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?)").run(id,email,nickname,role,Number(name==='admin'),stamp,stamp);person=db.raw.prepare('SELECT * FROM members WHERE id=?').get(id);}people[name]=person;
}
const addresses=Object.values(networkInterfaces()).flat().filter(r=>r.family==='IPv4'&&!r.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(r.address)).map(r=>r.address);
const config={origin,pepper:secrets.pepper,deviceEnrollmentKey:secrets.enrollmentKey,secureCookies:false};
const server=createApplication(config,{db,mailer:null});const handler=server.listeners('request')[0];server.removeAllListeners('request');
server.on('request',(req,res)=>{
 if(req.url?.startsWith('/__hardware-lab/login')){
  const remote=req.socket.remoteAddress?.replace(/^::ffff:/,'');
  if(req.method!=='GET'||remote!=='127.0.0.1'||req.headers.host!==`127.0.0.1:${port}`){req.resume();res.writeHead(403);res.end('Local lab sign-in is available on this computer only');return;}
  const name=new URL(req.url,origin).searchParams.get('member')||'admin',person=people[name];
  if(!person){res.writeHead(404);res.end();return;}
  const token=randomBytes(32).toString('hex'),time=Math.floor(Date.now()/1000);
  db.raw.prepare('DELETE FROM sessions WHERE expires_at<=?').run(time);
  db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),person.id,time+86400,time);
  res.writeHead(303,{'Set-Cookie':`popup_city_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,Location:name==='admin'?'/#admin':'/#me','Cache-Control':'no-store'});res.end();return;
 }
 handler(req,res);
});
if(lan&&addresses[0]){
 const line=(name,value)=>`CONFIG_PLANET_${name}=${JSON.stringify(value)}\n`;
 let profile='# Private isolated LAN test profile. Never publish or use in production.\nCONFIG_PLANET_ALLOW_LOCAL_HTTP=y\n# CONFIG_PLANET_ENABLE_LAN_DISCOVERY is not set\n# CONFIG_PLANET_IS_STATION is not set\n';
 profile+=line('SERVER_ORIGIN',`http://${addresses[0]}:${port}`)+line('ENROLLMENT_KEY',secrets.enrollmentKey)+'CONFIG_PLANET_HTTP_TIMEOUT_MS=8000\n';
 for(const name of ['DEVICE_ID','DEVICE_TOKEN','MEMBER_ID','STATION_ID','ACTIVITY_ID'])profile+=line(name,'');
 writeFileSync(directory+'lan.defaults',profile,{mode:0o600});
}
server.once('error',error=>{console.error(error.code==='EADDRINUSE'?'Lab port is occupied; no existing service was stopped':'Lab startup failed');db.close();process.exitCode=1;});
server.listen(port,lan?'0.0.0.0':'127.0.0.1',()=>{console.log('Local hardware lab: '+origin+'/__hardware-lab/login');if(lan)for(const address of addresses)console.log('Hardware endpoint: http://'+address+':'+port);console.log('Uses only data/hardware-lab/lab.sqlite; production data is not loaded.');});
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(stopping)return;stopping=true;server.closeAllConnections();server.close(()=>db.close());});
