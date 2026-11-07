// Date-only UTC arithmetic keeps calendar navigation independent of device timezone.
const check=s=>{const n=Date.parse(s+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==s)throw Error('INVALID_DATE');return new Date(n);};
const iso=d=>d.toISOString().slice(0,10);
const offset=(s,n)=>{const d=check(s);d.setUTCDate(d.getUTCDate()+n);return iso(d);};
const monday=s=>offset(s,-((check(s).getUTCDay()+6)%7));
export function shiftCalendarPeriod(date,view,n){
 if(!Number.isInteger(n)||Math.abs(n)>12)throw Error('INVALID_SHIFT');
 if(view==='week')return offset(date,n*7);
 if(view!=='month')throw Error('INVALID_VIEW');
 const a=check(date),day=a.getUTCDate(),d=new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth()+n,1,12));
 const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
 d.setUTCDate(Math.min(day,max));return iso(d);
}
export function calendarPeriod(date,view){
 if(view==='week'){
  const from=monday(date),to=offset(from,6),p=s=>new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(check(s));
  return{from,to,label:p(from)+' — '+p(to)};
 }
 if(view!=='month')throw Error('INVALID_VIEW');
 const d=check(date.slice(0,7)+'-01'),from=iso(d),to=iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)));
 const x=new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',year:'numeric',month:'long'}).format(d);
 return{from,to,label:x[0].toUpperCase()+x.slice(1)};
}
export const selectedPeriod=calendarPeriod;
export function calendarCells(date,view){
 const p=calendarPeriod(date,view);
 if(view==='week')return Array.from({length:7},(_,i)=>offset(p.from,i));
 const pad=(check(p.from).getUTCDay()+6)%7;
 return [...Array(pad).fill(null),...Array.from({length:check(p.to).getUTCDate()},(_,i)=>offset(p.from,i))];
}
export function calendarDayStatus(settings,date,records,zone){
 const dow=check(date).getUTCDay(),rule=settings?.overrides?.find(x=>x.date===date);
 const windows=rule?(rule.closed?[]:rule.windows):settings?.weeklyHours?.[String(dow)];
 const reception=Array.isArray(windows)&&windows.some(w=>typeof w.start==='string'&&typeof w.end==='string'&&w.start<w.end);
 if(!Array.isArray(records)||!zone)return{reception,occupiedCount:null};
 let f;try{f=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});}catch{return{reception,occupiedCount:null};}
 const day=n=>{const p=Object.fromEntries(f.formatToParts(n).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;};
 return{reception,occupiedCount:records.filter(r=>{
  if(r.status!=='active')return false;
  const a=Date.parse(r.occupiedStart||r.start),b=Date.parse(r.occupiedEnd||r.end);
  return Number.isFinite(a)&&Number.isFinite(b)&&b>a&&day(a)<=date&&day(b-1)>=date;
 }).length};
}
