import test from 'node:test';
import assert from 'node:assert/strict';
import {reservableSlot,makeReservationPayload} from '../src/calendar-reservation.mjs';
const start='2026-11-10T07:00:00.000Z',sample={version:4,ready:true,validUntil:'2026-11-10T06:00:00.000Z',slots:[{start,end:'2026-11-10T07:45:00.000Z'}]};
test('verification requires current fresh slot',()=>{
 const now=Date.parse('2026-11-09T12:00:00.000Z');assert.equal(reservableSlot(sample,start,now),true);
 for(const v of [{...sample,ready:false},{...sample,version:0},{...sample,slots:[]},{...sample,validUntil:'2026-11-08T09:00:00.000Z'}])assert.equal(reservableSlot(v,start,now),false);
 assert.equal(reservableSlot(sample,'2026-11-10T08:00:00.000Z',now),false);
});
test('reservation payload contains no patient data',()=>{
 const future={...sample,validUntil:new Date(Date.now()+60000).toISOString()};
 const data=makeReservationPayload(future,'synthetic-service','2026-11-10',start,'a'.repeat(32));
 assert.deepEqual(Object.keys(data).sort(),['date','expectedVersion','operationKey','serviceId','start']);assert.equal(data.expectedVersion,4);
 assert.throws(()=>makeReservationPayload(future,'patient name','2026-11-10',start,'a'.repeat(32)),/INVALID_RESERVATION/);
});
