// Read one device's private enrollment JSON from stdin; never echo credentials.
import { readFileSync, writeFileSync } from 'node:fs';
const output=process.argv[2];
if(!output)throw Error('Usage: node scripts/hardware-profile.mjs /private/path/cloud.defaults < /private/path/device.json');
const data=JSON.parse(readFileSync(0,'utf8'));
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const origin=new URL(data.origin);
if(origin.protocol!=='https:'||origin.origin!==data.origin)throw Error('origin must be an HTTPS origin without a trailing slash');
if(!uuid(data.device_id)||!uuid(data.member_id)||typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token))throw Error('Valid device_id, member_id and token are required');
if(!['user','checkin'].includes(data.role))throw Error('role must be user or checkin');
if(data.role==='user'&&!uuid(data.station_device_id))throw Error('User profile needs the configured station_device_id for signed check-in confirmation');
const line=(name,value)=>`CONFIG_PLANET_${name}=${JSON.stringify(value)}\n`;
let text='# Private per-device configuration. Never commit or publish.\n# CONFIG_PLANET_ALLOW_LOCAL_HTTP is not set\n';
text+=line('SERVER_ORIGIN',data.origin)+line('DEVICE_ID',data.device_id)+line('MEMBER_ID',data.member_id)+line('DEVICE_TOKEN',data.token)+line('DEVICE_LABEL',data.role==='checkin'?'CHECK-IN':'USER');
text+=data.role==='checkin'?'CONFIG_PLANET_IS_STATION=y\n':'# CONFIG_PLANET_IS_STATION is not set\n';
text+=line('STATION_ID',data.role==='checkin'?data.device_id:data.station_device_id)+'CONFIG_PLANET_HTTP_TIMEOUT_MS=8000\n';
writeFileSync(output,text,{mode:0o600,flag:'wx'});
console.log('Private firmware profile created. Wi-Fi can be provisioned with the existing phone setup.');
