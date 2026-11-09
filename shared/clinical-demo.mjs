import { z } from 'zod';
import { dateSchema } from './booking.mjs';
export const PERSONAS = ['Демо-клиент 001', 'Демо-клиент 002', 'Демо-клиент 003'];
export const NOTES = ['Тест: первичное наблюдение', 'Тест: повторная процедура', 'Тест: изменение показателя', 'Тест: без изменений'];
export const PROCEDURES = ['Демонстрационная процедура', 'Повторный тестовый приём'];
export const ANGLES = ['Спереди', 'Сбоку', 'Сзади'];
const clientSchema = z.object({ id: z.string().uuid(), label: z.enum(PERSONAS) }).strict();
export const visitInput = z.object({ clientId: z.string().uuid(), date: dateSchema,
  procedure: z.enum(PROCEDURES), note: z.string().max(4000) }).strict();
const photoSchema = z.object({ id: z.string().uuid().optional(), visitId: z.string().uuid(), angle: z.enum(ANGLES),
  data: z.string().max(1400000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/) }).strict();
export const clinicalStateSchema = z.object({ schema: z.literal('anna-open-synthetic-clinical-v2'),
  clients: z.array(clientSchema).max(3), visits: z.array(visitInput.extend({ id: z.string().uuid() })).max(300),
  photos: z.array(photoSchema) }).strict().superRefine((s, ctx) => {
  if (new Set(s.clients.map(c => c.id)).size !== s.clients.length || new Set(s.clients.map(c => c.label)).size !== s.clients.length || new Set(s.visits.map(v => v.id)).size !== s.visits.length || s.visits.some(v => !s.clients.some(c => c.id === v.clientId)) || s.photos.some(p => !s.visits.some(v => v.id === p.visitId)) || new Set(s.photos.map(p => p.id ? `id:${p.id}` : `legacy:${p.visitId}:${p.angle}`)).size !== s.photos.length) ctx.addIssue({ code: 'custom', message: 'Invalid synthetic references' });
});
export const emptyClinicalDemo = () => ({ schema: 'anna-open-synthetic-clinical-v2', clients: [], visits: [], photos: [] });
export function restoreClinicalDemo(value) {
  if (value?.schema === 'anna-open-synthetic-clinical-v1') {
    const old = z.object({schema:z.literal('anna-open-synthetic-clinical-v1'), clients:z.array(clientSchema), visits:z.array(visitInput.extend({id:z.string().uuid(),pain:z.number().int().min(0).max(10),mobility:z.number().int().min(0).max(100)}))}).strict().parse(value);
    return clinicalStateSchema.parse({...old,schema:'anna-open-synthetic-clinical-v2',photos:[],visits:old.visits.map(({pain,mobility,...v})=>v)});
  }
  return clinicalStateSchema.parse(value);
}
export function addDemoClient(state, label, uuid = () => crypto.randomUUID()) {
  clinicalStateSchema.parse(state); z.enum(PERSONAS).parse(label);
  if (state.clients.some(c => c.label === label)) throw Error('Такая тестовая карта уже существует.');
  return clinicalStateSchema.parse({ ...state, clients: [...state.clients, { id: uuid(), label }] });
}
export function addDemoVisit(state, input, uuid = () => crypto.randomUUID()) {
  clinicalStateSchema.parse(state); const visit = visitInput.parse(input);
  return clinicalStateSchema.parse({ ...state, visits: [...state.visits, { ...visit, id: uuid() }] });
}
export function setDemoPhoto(state, input) {
  clinicalStateSchema.parse(state); const photo = photoSchema.parse(input);
  return clinicalStateSchema.parse({...state,photos:[...state.photos.filter(p=>p.id || p.visitId!==photo.visitId || p.angle!==photo.angle),photo]});
}
export function addDemoPhoto(state, input, uuid = () => crypto.randomUUID()) {
  clinicalStateSchema.parse(state);
  const photo = photoSchema.parse({...input, id:uuid()});
  return clinicalStateSchema.parse({...state,photos:[...state.photos,photo]});
}
function photoIndex(state, photo) {
  return state.photos.findIndex(p=>photo.id
    ? p.id===photo.id
    : !p.id && p.visitId===photo.visitId && p.angle===photo.angle);
}
export function updateDemoPhoto(state, photo, data) {
  clinicalStateSchema.parse(state);
  const index=photoIndex(state,photo);
  if(index<0)throw Error('PHOTO_NOT_FOUND');
  const photos=state.photos.map((p,i)=>i===index?{...p,data}:p);
  return clinicalStateSchema.parse({...state,photos});
}
export function deleteDemoPhoto(state, photo) {
  clinicalStateSchema.parse(state);
  const index=photoIndex(state,photo);
  if(index<0)throw Error('PHOTO_NOT_FOUND');
  return clinicalStateSchema.parse({...state,photos:state.photos.filter((_,i)=>i!==index)});
}
export function deleteDemoClient(state, clientId) {
  clinicalStateSchema.parse(state);
  if(!state.clients.some(c=>c.id===clientId))throw Error('CLIENT_NOT_FOUND');
  const visits=state.visits.filter(v=>v.clientId!==clientId);
  return clinicalStateSchema.parse({...state,clients:state.clients.filter(c=>c.id!==clientId),visits,photos:state.photos.filter(p=>visits.some(v=>v.id===p.visitId))});
}
export function exampleClinicalDemo() {
  const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
  return clinicalStateSchema.parse({ ...emptyClinicalDemo(), clients: [{ id: a, label: PERSONAS[0] }, { id: b, label: PERSONAS[1] }],
    visits: [[a,'2026-10-20'],[a,'2026-10-27'],[a,'2026-11-03'],[b,'2026-11-04']].map(([clientId,date], i) => ({ id: `00000000-0000-4000-8000-00000000001${i}`, clientId,date,procedure:PROCEDURES[i ? 1 : 0],note:NOTES[i ? 1 : 0] })) });
}
