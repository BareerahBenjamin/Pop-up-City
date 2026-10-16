export function friendListPage(records, offset=0){
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw Error('INVALID_OFFSET');
 if(!Array.isArray(records?.connections))throw Error('INVALID_RECORDS');
 const rows=records.connections;
 if(rows.some(r=>typeof r.member_id!=='string'||typeof r.nickname!=='string'||!Number.isSafeInteger(r.connected_at)))throw Error('INVALID_FRIEND');
 const index=rows.length?Math.min(offset,rows.length-1):0;
 return{state:'friends',total:rows.length,offset:index,friends:rows.length?[rows[index]]:[]};
}
