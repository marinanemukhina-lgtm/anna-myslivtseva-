import { z } from 'zod';
import { dateSchema } from './booking.mjs';
export const PERSONAS = ['Демо-клиент 001', 'Демо-клиент 002', 'Демо-клиент 003'];
export const NOTES = ['Тест: первичное наблюдение', 'Тест: повторная процедура', 'Тест: изменение показателя', 'Тест: без изменений'];
export const PROCEDURES = ['Демонстрационная процедура', 'Повторный тестовый приём'];
const clientSchema = z.object({ id: z.string().uuid(), label: z.enum(PERSONAS) }).strict();
export const visitInput = z.object({ clientId: z.string().uuid(), date: dateSchema,
  procedure: z.enum(PROCEDURES), note: z.enum(NOTES), pain: z.number().int().min(0).max(10),
  mobility: z.number().int().min(0).max(100) }).strict();
export const clinicalStateSchema = z.object({ schema: z.literal('anna-open-synthetic-clinical-v1'),
  clients: z.array(clientSchema).max(3), visits: z.array(visitInput.extend({ id: z.string().uuid() })).max(300) }).strict().superRefine((s, ctx) => {
  if (new Set(s.clients.map(c => c.id)).size !== s.clients.length || new Set(s.clients.map(c => c.label)).size !== s.clients.length || new Set(s.visits.map(v => v.id)).size !== s.visits.length || s.visits.some(v => !s.clients.some(c => c.id === v.clientId))) ctx.addIssue({ code: 'custom', message: 'Invalid synthetic references' });
});
export const emptyClinicalDemo = () => ({ schema: 'anna-open-synthetic-clinical-v1', clients: [], visits: [] });
export function addDemoClient(state, label, uuid = () => crypto.randomUUID()) {
  clinicalStateSchema.parse(state); z.enum(PERSONAS).parse(label);
  if (state.clients.some(c => c.label === label)) throw Error('Такая тестовая карта уже существует.');
  return clinicalStateSchema.parse({ ...state, clients: [...state.clients, { id: uuid(), label }] });
}
export function addDemoVisit(state, input, uuid = () => crypto.randomUUID()) {
  clinicalStateSchema.parse(state); const visit = visitInput.parse(input);
  return clinicalStateSchema.parse({ ...state, visits: [...state.visits, { ...visit, id: uuid() }] });
}
export function exampleClinicalDemo() {
  const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
  return clinicalStateSchema.parse({ ...emptyClinicalDemo(), clients: [{ id: a, label: PERSONAS[0] }, { id: b, label: PERSONAS[1] }],
    visits: [[a,'2026-10-20',6,50],[a,'2026-10-27',4,65],[a,'2026-11-03',3,70],[b,'2026-11-04',5,60]].map(([clientId,date,pain,mobility], i) => ({ id: `00000000-0000-4000-8000-00000000001${i}`, clientId,date,pain,mobility,procedure:PROCEDURES[i ? 1 : 0],note:NOTES[i ? 1 : 0] })) });
}
