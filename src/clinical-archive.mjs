import { parseClinicalJSON } from '../shared/clinical-json.mjs';
// Portable ZIP (stored entries) for the synthetic, browser-local clinical demo.
// No remote transmission or real patient storage.
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const LIMIT=60*1024*1024;
const MIMES={png:'image/png',jpg:'image/jpeg',webp:'image/webp'};
const dataUri=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const allowed=name=>name==='manifest.json'||/^photos\/[0-9]{3,6}\.(png|jpg|webp)$/.test(name);
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^0xffffffff)>>>0;}
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}
function bytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
const put16=(v,i,n)=>v.setUint16(i,n,true);
const put32=(v,i,n)=>v.setUint32(i,n,true);

export function createZip(entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>1000)throw Error('ARCHIVE_FILES');
 let localLength=0,centralLength=0,total=0;
 const files=entries.map(({name,data})=>{
  if(!allowed(name)||!(data instanceof Uint8Array))throw Error('ARCHIVE_ENTRY');
  const filename=enc.encode(name);total+=data.length;if(total>LIMIT)throw Error('ARCHIVE_TOO_LARGE');
  const f={name,filename,data,crc:crc32(data),offset:localLength};
  localLength+=30+filename.length+data.length;centralLength+=46+filename.length;
  return f;
 });
 if(new Set(files.map(f=>f.name)).size!==files.length)throw Error('ARCHIVE_DUPLICATE');
 const out=new Uint8Array(localLength+centralLength+22),v=new DataView(out.buffer);let pos=0;
 for(const f of files){
  put32(v,pos,0x04034b50);put16(v,pos+4,20);put16(v,pos+6,0x0800);put16(v,pos+8,0);
  put32(v,pos+14,f.crc);put32(v,pos+18,f.data.length);put32(v,pos+22,f.data.length);
  put16(v,pos+26,f.filename.length);put16(v,pos+28,0);
  out.set(f.filename,pos+30);out.set(f.data,pos+30+f.filename.length);
  pos+=30+f.filename.length+f.data.length;
 }
 const start=pos;
 for(const f of files){
  put32(v,pos,0x02014b50);put16(v,pos+4,20);put16(v,pos+6,20);put16(v,pos+8,0x0800);put16(v,pos+10,0);
  put32(v,pos+16,f.crc);put32(v,pos+20,f.data.length);put32(v,pos+24,f.data.length);
  put16(v,pos+28,f.filename.length);put32(v,pos+42,f.offset);
  out.set(f.filename,pos+46);pos+=46+f.filename.length;
 }
 put32(v,pos,0x06054b50);put16(v,pos+8,files.length);put16(v,pos+10,files.length);
 put32(v,pos+12,centralLength);put32(v,pos+16,start);
 return out;
}

export function readZip(buffer){
 const input=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
 if(input.length>LIMIT+200000||input.length<22)throw Error('INVALID_ARCHIVE_SIZE');
 const v=new DataView(input.buffer,input.byteOffset,input.byteLength);let end=-1;
 for(let n=input.length-22;n>=Math.max(0,input.length-65557);n--){
  if(v.getUint32(n,true)===0x06054b50&&n+22+v.getUint16(n+20,true)===input.length){end=n;break;}
 }
 if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))throw Error('INVALID_ZIP');
 const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),start=v.getUint32(end+16,true);
 if(!count||count>1000||count!==v.getUint16(end+8,true)||start+size!==end)throw Error('INVALID_ZIP');
 let pos=start,total=0;const result=new Map();
 for(let i=0;i<count;i++){
  if(pos+46>end||v.getUint32(pos,true)!==0x02014b50)throw Error('INVALID_ZIP');
  const method=v.getUint16(pos+10,true),flags=v.getUint16(pos+8,true);
  const crc=v.getUint32(pos+16,true),len=v.getUint32(pos+24,true),zipLen=v.getUint32(pos+20,true);
  const nameLen=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true);
  const offset=v.getUint32(pos+42,true),next=pos+46+nameLen+extra+comment;
  if(next>end||method||zipLen!==len||flags!==0x0800||offset+30>start)throw Error('UNSUPPORTED_ZIP');
  const name=dec.decode(input.subarray(pos+46,pos+46+nameLen));
  if(!allowed(name)||result.has(name))throw Error('UNEXPECTED_ARCHIVE_ENTRY');
  if(v.getUint32(offset,true)!==0x04034b50)throw Error('INVALID_ZIP');
  const localNameLen=v.getUint16(offset+26,true),localExtra=v.getUint16(offset+28,true);
  if(localNameLen!==nameLen||dec.decode(input.subarray(offset+30,offset+30+localNameLen))!==name)throw Error('INVALID_ZIP');
  const from=offset+30+localNameLen+localExtra,to=from+len;
  if(to>start||v.getUint32(offset+14,true)!==crc||v.getUint32(offset+18,true)!==len)throw Error('INVALID_ZIP');
  const raw=input.slice(from,to);if(crc32(raw)!==crc)throw Error('ARCHIVE_CORRUPT');
  total+=len;if(total>LIMIT)throw Error('ARCHIVE_TOO_LARGE');
  result.set(name,raw);pos=next;
 }
 if(pos!==end||!result.has('manifest.json'))throw Error('INVALID_ZIP');
 return result;
}

export function exportClinicalHistory(state,clientId){
 const client=state.clients.find(c=>c.id===clientId);if(!client)throw Error('CLIENT_NOT_FOUND');
 const visits=state.visits.filter(v=>v.clientId===clientId);
 const photos=state.photos.filter(p=>visits.some(v=>v.id===p.visitId));
 const entries=[],metadata=[];
 for(const [i,p] of photos.entries()){
  const m=dataUri.exec(p.data);if(!m)throw Error('INVALID_PHOTO');
  const ext=m[1]==='jpeg'?'jpg':m[1],name='photos/'+String(i+1).padStart(3,'0')+'.'+ext;
  entries.push({name,data:bytes(m[2])});
  metadata.push({id:p.id,visitId:p.visitId,angle:p.angle,name});
 }
 const manifest={format:'anna-synthetic-history-v1',schema:state.schema,client,visits,photos:metadata};
 return createZip([{name:'manifest.json',data:enc.encode(JSON.stringify(manifest))},...entries]);
}

export function importClinicalHistory(buffer){
 const entries=readZip(buffer),manifestBytes=entries.get('manifest.json');
 if(manifestBytes.length>2000000)throw Error('INVALID_MANIFEST');
 const m=parseClinicalJSON(dec.decode(manifestBytes));
 if(!m || Object.keys(m).sort().join(',')!=='client,format,photos,schema,visits' || m?.format!=='anna-synthetic-history-v1'||!Array.isArray(m.visits)||!Array.isArray(m.photos)||!m.client||!m.schema)throw Error('INVALID_MANIFEST');
 if(m.schema!=='anna-open-synthetic-clinical-v2')throw Error('UNSUPPORTED_ARCHIVE_SCHEMA');
 if(entries.size!==m.photos.length+1 || new Set(m.photos.map(p=>p?.name)).size!==m.photos.length)throw Error('UNEXPECTED_ARCHIVE_ENTRY');
 const photos=m.photos.map(p=>{
  if(!p || Object.keys(p).some(k=>!['id','visitId','angle','name'].includes(k)) || typeof p.name!=='string'||!entries.has(p.name))throw Error('INVALID_MANIFEST');
  const ext=p.name.split('.').at(-1),mime=MIMES[ext];if(!mime)throw Error('INVALID_MANIFEST');
  return{...(Object.hasOwn(p,'id')?{id:p.id}:{}),visitId:p.visitId,angle:p.angle,data:'data:'+mime+';base64,'+b64(entries.get(p.name))};
 });
 return{schema:m.schema,clients:[m.client],visits:m.visits,photos};
}
