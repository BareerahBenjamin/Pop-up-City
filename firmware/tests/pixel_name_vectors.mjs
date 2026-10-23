import fs from 'node:fs';import {pixelNameRender} from '../../hardware-cloud/name-bitmap.mjs';
const names=['RAE','Rae','海椰','Rae 海椰','𠮷','中文名字测试中文名字测试中文名字测试中文名字测试中文名字测试中文'];
const rows=[];for(const name of names){for(const config of [{width:192,height:32,scale:1,center:true,wrap:true},{width:128,height:24,scale:1,center:false,wrap:false},{width:192,height:16,scale:1,center:false,wrap:false},{width:Math.ceil([...name].length*24/8)*8,height:32,scale:2,center:false,wrap:false}])rows.push({name,...config,bits:pixelNameRender(name,config).toString('hex')});}
fs.writeFileSync(process.argv[2],JSON.stringify(rows));
