// Verification only; the owner confirms and rechecks the live availability before a CAS write.
export function reservableSlot(availability,candidate,now=Date.now()){
 if(!availability||availability.ready!==true||!Number.isSafeInteger(availability.version)||availability.version<1)return false;
 if(!Number.isFinite(Date.parse(availability.validUntil))||Date.parse(availability.validUntil)<=now)return false;
 if(!Number.isFinite(Date.parse(candidate))||Date.parse(candidate)<=now)return false;
 return Array.isArray(availability.slots)&&availability.slots.some(slot=>slot.start===candidate&&Number.isFinite(Date.parse(slot.start)));
}
export function makeReservationPayload(availability,serviceId,date,start,operationKey){
 if(!reservableSlot(availability,start))throw Error('SLOT_NOT_VERIFIED');
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(serviceId)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^[a-f0-9]{32}$/.test(operationKey))throw Error('INVALID_RESERVATION');
 return{expectedVersion:availability.version,operationKey,serviceId,date,start};
}
