import test from 'node:test';
import assert from 'node:assert/strict';
import {filterAvailableSlots, instant} from '../shared/booking-busy.mjs';
const at = time => `2026-11-06T${time}:00Z`;
const now = Date.parse('2026-11-05T12:00:00Z');
const policy = () => ({now,maxAgeMilliseconds:3600000,bufferBeforeMinutes:0,bufferAfterMinutes:0});
const snapshot = intervals => ({from:at('00:00'),to:'2026-11-07T00:00:00Z',observedAt:'2026-11-05T11:30:00Z',complete:true,intervals});
const slot = (start,end) => ({start:at(start),end:at(end)});
test('busy intervals exclude partial and full overlaps while adjacent boundaries remain valid',()=>{
 const candidates=[slot('09:00','10:00'),slot('09:30','10:30'),slot('10:00','11:00'),slot('10:30','11:30'),slot('11:00','12:00')];
 const result=filterAvailableSlots(candidates,snapshot([slot('10:00','11:00')]),policy());
 assert.deepEqual(result.slots.map(x=>x.start),[at('09:00').replace('Z','.000Z'),at('11:00').replace('Z','.000Z')]);
});
test('buffers exclude occupied time before and after the appointment',()=>{
 const result=filterAvailableSlots([slot('09:00','10:00'),slot('11:00','12:00')],snapshot([slot('10:00','11:00')]),{...policy(),bufferBeforeMinutes:15,bufferAfterMinutes:15});
 assert.deepEqual(result.slots,[]);
});
test('missing, incomplete, stale or future snapshot fails closed',()=>{
 for(const value of [null,{...snapshot([]),complete:false},{...snapshot([]),observedAt:'2026-11-04T00:00:00Z'},{...snapshot([]),observedAt:'2026-11-05T13:00:00Z'}]){
  const result=filterAvailableSlots([slot('09:00','10:00')],value,policy());assert.equal(result.ready,false);assert.deepEqual(result.slots,[]);
 }
});
test('snapshot does not imply availability beyond its explicit coverage',()=>{
 const result=filterAvailableSlots([slot('09:00','10:00'),slot('10:00','11:00')],{...snapshot([]),from:at('09:00'),to:at('11:00')},{...policy(),bufferAfterMinutes:15});
 assert.equal(result.slots.length,1);
});
test('identifying metadata and invalid dates are rejected rather than copied',()=>{
 assert.equal(filterAvailableSlots([slot('09:00','10:00')],snapshot([{...slot('10:00','11:00'),title:'synthetic private note'}]),policy()).ready,false);
 assert.equal(filterAvailableSlots([{...slot('09:00','10:00'),name:'synthetic'}],snapshot([]),policy()).ready,false);
 for(const value of ['2026-02-30T09:00:00Z','2026-11-06T24:00:00Z','2026-11-06T09:00:00','2026-11-06T09:00:00+15:00']) assert.ok(Number.isNaN(instant(value)));
});
test('offsets and overnight intervals compare as instants',()=>{
 const source={...snapshot([]),from:'2026-11-06T00:00:00Z',to:'2026-11-08T00:00:00Z',intervals:[{start:'2026-11-07T02:30:00+03:00',end:'2026-11-07T04:00:00+03:00'}]};
 const result=filterAvailableSlots([{start:'2026-11-06T23:00:00Z',end:'2026-11-07T00:00:00Z'}],source,policy());assert.deepEqual(result.slots,[]);
});
test('input objects remain unchanged and duplicate candidates are removed',()=>{
 const candidates=[slot('09:00','10:00'),slot('09:00','10:00')],source=snapshot([]);const before=JSON.stringify({candidates,source});
 assert.equal(filterAvailableSlots(candidates,source,policy()).slots.length,1);assert.equal(JSON.stringify({candidates,source}),before);
});
test('invalid policy is never treated as an empty occupied calendar',()=>{
 assert.equal(filterAvailableSlots([slot('09:00','10:00')],snapshot([]),{...policy(),bufferAfterMinutes:-1}).ready,false);
});
