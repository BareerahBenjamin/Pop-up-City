import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
process.umask(0o077);
const [mode,path,output,reference]=process.argv.slice(2);
const hash=value=>createHash('sha256').update(value).digest('hex');
const db=new DatabaseSync(path,{readOnly:true});
try {
 db.exec('PRAGMA foreign_keys=ON; BEGIN');
 assert.equal(db.prepare('PRAGMA application_id').get().application_id,1213219633);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 const schema=JSON.parse(JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()));
 const tables={};
 for(const {name} of schema.filter(x=>x.type==='table')){
  const hashes=[];
  for(const row of db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').iterate()){
   hashes.push(hash(JSON.stringify(row,(_key,value)=>value instanceof Uint8Array?{blobSha256:hash(value),bytes:value.length}:value)));
  }
  hashes.sort();tables[name]={rows:hashes.length,sha256:hash(hashes.join('\n'))};
 }
 const migrations=JSON.parse(JSON.stringify(db.prepare('SELECT name,checksum FROM schema_migrations ORDER BY name').all()));
 db.exec('COMMIT');
 const result={applicationId:1213219633,tables,schema,migrations};
 if(reference){
  const before=JSON.parse(readFileSync(reference,'utf8'));
  const additions=['game_jam_apps','game_jam_projects','game_jam_reviews'];
  for(const [name,value] of Object.entries(before.tables)){
   if(mode==='upgrade' && name==='schema_migrations')continue;
   assert.deepEqual(tables[name],value,'Existing data changed: '+name);
  }
  for(const item of before.schema)assert.deepEqual(schema.find(x=>x.name===item.name),item,'Existing schema changed: '+item.name);
  if(mode==='upgrade'){
   assert.equal(migrations.length,11);assert.equal(before.migrations.length,10);
   assert.deepEqual(migrations.slice(0,10),before.migrations);
   assert.equal(migrations[10].name,'0011_game_jam.sql');
   assert.deepEqual(Object.keys(tables).filter(x=>!(x in before.tables)).sort(),additions.sort());
   for(const name of additions)assert.equal(tables[name].rows,0);
  }else{assert.deepEqual(migrations,before.migrations);assert.deepEqual(schema,before.schema);assert.deepEqual(tables,before.tables);}
 }
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({mode,integrity:'ok',foreignKeys:'ok',tables:Object.keys(tables).length,migrations:migrations.length,existingDataPreserved:!!reference}));
}finally{db.close()}
