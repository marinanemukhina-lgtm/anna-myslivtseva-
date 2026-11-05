import {createHash} from 'node:crypto';
import {z} from 'zod';
import {database, readContent} from './db.mjs';
import {createPrivateBookingManager} from './private-booking-state.mjs';

const manager = createPrivateBookingManager({readContent, query:async (...args)=>(await database()).query(...args)});
const instant = z.string().datetime({offset:true}).transform(value=>new Date(value).toISOString());
const importSchema = z.object({
  expectedVersion:z.number().int().positive(),
  sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),
  intervals:z.array(z.object({start:instant,end:instant}).strict().refine(value=>value.start<value.end)).min(1).max(100),
}).strict();
const applySchema = z.object({
  expectedVersion:z.number().int().positive(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),
  intervals:importSchema.shape.intervals, previewDigest:z.string().regex(/^[a-f0-9]{64}$/),
  confirmed:z.literal(true),operationKey:z.string().regex(/^[a-f0-9]{32,64}$/),
}).strict();
const descriptions = {
  INVALID_INPUT:'Проверьте даты, время и состав полей. Имена и заметки здесь не принимаются.',
  STALE_VERSION:'Расписание изменилось. Обновите его и проверьте выбранное действие ещё раз.',
  WINDOW_BUSY:'Это время пересекается с действующей записью или занятым интервалом.',
  IDEMPOTENCY_CONFLICT:'Этот идентификатор запроса уже использован для другого действия.',
  SOURCE_NOT_VERIFIED:'Сначала подтвердите актуальную занятость на выбранный период.',
  OUTSIDE_VERIFIED_COVERAGE:'Время находится вне проверенного периода занятости.',
  INVALID_VERIFICATION_EXPIRY:'Подтверждение должно истекать в будущем, не позднее чем через 24 часа.',
  SCHEDULE_UNAVAILABLE:'Рабочие часы пока не настроены.',
  SERVICE_UNAVAILABLE:'Услуга не опубликована или не включена в расписание.',
  WINDOW_UNAVAILABLE:'Такого времени нет в текущем расписании.',
  RECORD_NOT_FOUND:'Интервал не найден.',
  STORAGE_UNAVAILABLE:'Хранилище не подтвердило результат. Обновите список перед повтором; не создавайте новый запрос вслепую.',
  STORAGE_INVALID:'Данные занятости требуют проверки. Изменения остановлены.',
};
function errorResponse(error,res){
 const code=Object.hasOwn(descriptions,error.code)?error.code:'STORAGE_UNAVAILABLE';
 const status=code.startsWith('STORAGE')?503:code==='RECORD_NOT_FOUND'?404:['STALE_VERSION','WINDOW_BUSY','IDEMPOTENCY_CONFLICT'].includes(code)?409:400;
 return res.status(status).json({code,error:descriptions[code]});
}
const run = action => async(req,res)=>{try{res.json(await action(req));}catch(error){errorResponse(error,res);}};
const parse = (schema,value)=>{const result=schema.safeParse(value);if(!result.success)throw Object.assign(Error('INVALID_INPUT'),{code:'INVALID_INPUT'});return result.data;};
const digest = value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalizedImport=value=>{
 const parsed=parse(importSchema,value);
 parsed.intervals.sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
 return parsed;
};

// All handlers use real administrator authentication. Temporary content-only
// access never passes this middleware. No public booking route is added.
export function registerPrivateBooking(app, requireAdmin){
 app.get('/api/admin/booking/occupancy',requireAdmin,run(()=>manager.snapshot()));
 app.get('/api/admin/booking/free-availability',requireAdmin,run(req=>manager.available(req.query)));
 app.put('/api/admin/booking/coverage',requireAdmin,run(req=>manager.setCoverage(req.body)));
 app.post('/api/admin/booking/busy',requireAdmin,run(req=>manager.addBusy(req.body)));
 app.post('/api/admin/booking/reservations',requireAdmin,run(req=>manager.reserve(req.body)));
 app.post('/api/admin/booking/records/:id/cancel',requireAdmin,run(req=>manager.cancel({...req.body,id:req.params.id})));
 app.post('/api/admin/booking/import/preview',requireAdmin,run(async req=>{
  const input=normalizedImport(req.body),current=await manager.snapshot();
  if(current.version!==input.expectedVersion)throw Object.assign(Error('STALE_VERSION'),{code:'STALE_VERSION'});
  return {...input,previewDigest:digest(input),applied:false,requiresConfirmation:true,message:'Проверьте каждый интервал и значение смен. Это только предварительный просмотр, занятость не изменена.'};
 }));
 app.post('/api/admin/booking/import/apply',requireAdmin,run(async req=>{
  const input=parse(applySchema,req.body),normalized=normalizedImport({expectedVersion:input.expectedVersion,sourceSha256:input.sourceSha256,intervals:input.intervals});
  if(digest(normalized)!==input.previewDigest)throw Object.assign(Error('INVALID_INPUT'),{code:'INVALID_INPUT'});
  return manager.addBusy({expectedVersion:input.expectedVersion,operationKey:input.operationKey,intervals:normalized.intervals});
 }));
}
