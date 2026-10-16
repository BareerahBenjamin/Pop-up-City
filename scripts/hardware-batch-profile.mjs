// One private firmware profile for the whole event batch; no per-member credentials.
import {readFileSync,writeFileSync} from 'node:fs';
const output=process.argv[2];if(!output)throw Error('Usage: node scripts/hardware-batch-profile.mjs /private/path/batch.defaults < /private/path/batch.json');
const data=JSON.parse(readFileSync(0,'utf8')),origin=new URL(data.origin);
if(origin.protocol!=='https:'||origin.origin!==data.origin)throw Error('origin must be an HTTPS origin without a trailing slash');
if(typeof data.enrollment_key!=='string'||!/^[a-f0-9]{64}$/.test(data.enrollment_key))throw Error('enrollment_key must be 64 lowercase hex characters');
const line=(key,value)=>`CONFIG_PLANET_${key}=${JSON.stringify(value)}\n`;
let content='# Private shared event profile. Do not publish firmware containing the batch key.\n# CONFIG_PLANET_ALLOW_LOCAL_HTTP is not set\n# CONFIG_PLANET_IS_STATION is not set\n';
content+=line('SERVER_ORIGIN',data.origin)+line('ENROLLMENT_KEY',data.enrollment_key)+'CONFIG_PLANET_HTTP_TIMEOUT_MS=8000\n';
for(const name of ['DEVICE_ID','DEVICE_TOKEN','MEMBER_ID','STATION_ID','ACTIVITY_ID'])content+=line(name,'');
content+=line('DEVICE_LABEL','USER');
if(data.wifi_ssid!==undefined){if(typeof data.wifi_ssid!=='string'||Buffer.byteLength(data.wifi_ssid)>32)throw Error('Invalid Wi-Fi SSID');content+=line('WIFI_SSID',data.wifi_ssid);}
if(data.wifi_password!==undefined){if(typeof data.wifi_password!=='string'||Buffer.byteLength(data.wifi_password)>63)throw Error('Invalid Wi-Fi password');content+=line('WIFI_PASSWORD',data.wifi_password);}
writeFileSync(output,content,{flag:'wx',mode:0o600});console.log('Private shared profile created. Each board generates its own persistent identity.');
