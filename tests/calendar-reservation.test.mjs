import test from 'node:test';
import assert from 'node:assert/strict';
import {reservableSlot,makeReservationPayload} from '../src/calendar-reservation.mjs';
const date=new Date(Date.now()+10*86400000).toISOString().slice(0,10),start=date+'T07:00:00.000Z';
const sample={version:4,ready:true,validUntil:new Date(Date.now()+60000).toISOString(),slots:[{start,end:date+'T07:45:00.000Z'}]};
test('verification requires current valid future slot',()=>{
 const now=Date.now();assert.equal(reservableSlot(sample,start,now),true);
 for(const v of [{...sample,ready:false},{...sample,version:0},{...sample,slots:[]},{...sample,validUntil:new Date(now-1000).toISOString()}])assert.equal(reservableSlot(v,start,now),false);
 assert.equal(reservableSlot(sample,date+'T08:00:00.000Z',now),false);
 const previous=new Date(now-86400000).toISOString();
 assert.equal(reservableSlot({...sample,slots:[{start:previous}]},previous,now),false);
});
test('reservation payload contains no patient data',()=>{
 const data=makeReservationPayload(sample,'synthetic-service',date,start,'a'.repeat(32));
 assert.deepEqual(Object.keys(data).sort(),['date','expectedVersion','operationKey','serviceId','start']);assert.equal(data.expectedVersion,4);
 assert.throws(()=>makeReservationPayload(sample,'patient name',date,start,'a'.repeat(32)),/INVALID_RESERVATION/);
});
