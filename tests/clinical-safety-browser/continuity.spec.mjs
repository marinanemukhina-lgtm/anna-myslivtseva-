// Pending browser execution. Every test uses Playwright's fresh context and local
// qa-server fixture. Never point this suite at production or an existing profile.
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {emptyClinicalDemo,addDemoClient,addDemoVisit,PERSONAS,PROCEDURES} from '../../shared/clinical-demo.mjs';
import {exportClinicalHistory} from '../../src/clinical-archive.mjs';
import {CLINICAL_KEY as KEY,encodeRawClinicalBackup,decodeRawClinicalBackup} from '../../src/clinical-storage.mjs';
const make=n=>{
 let s=addDemoClient(emptyClinicalDemo(),PERSONAS[n]);
 return addDemoVisit(s,{clientId:s.clients[0].id,date:'2026-11-09',procedure:PROCEDURES[0],note:'Synthetic browser fixture only'});
};
async function seed(page,raw){
 await page.addInitScript(({key,raw})=>{
  if(!sessionStorage.getItem('synthetic-fixture-seeded')){
   localStorage.setItem(key,raw);sessionStorage.setItem('synthetic-fixture-seeded','yes');
  }
 },{key:KEY,raw});
}
async function download(page,name){
 const [file]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name,exact:true}).click()]);
 return readFile(await file.path(),'utf8');
}
test('invalid opening blocks ordinary export but downloads exact raw envelope',async({page})=>{
 const raw='{corrupt\ud800';await seed(page,raw);await page.goto('/demo/patients');
 await expect(page.getByRole('button',{name:'Скачать все тестовые истории (JSON)'})).toBeDisabled();
 const text=await download(page,'Скачать запись при открытии страницы');
 expect(decodeRawClinicalBackup(text).raw).toBe(raw);
 expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(raw);
});
test('other tab write blocks stale write but current JSON export stays available',async({page,context})=>{
 const s=make(0);await seed(page,JSON.stringify(s));await page.goto('/demo/patients');
 await expect(page.getByRole('button',{name:'Сохранить процедуру'})).toBeEnabled();
 const b=await context.newPage();await b.goto('/demo/patients');
 await b.getByRole('button',{name:'Сохранить процедуру'}).click();
 await expect(b.getByRole('status')).toContainText('Сохранено в этом браузере');
 await expect(page.getByRole('button',{name:'Сохранить процедуру'})).toBeDisabled();
 expect(JSON.parse(await download(page,'Скачать все тестовые истории (JSON)'))).toEqual(s);
 await page.reload();await expect(page.locator('.clinical-visit')).toHaveCount(2);
});
test('ZIP append preserves original client and visits through reload; repeated import rejects',async({page})=>{
 const a=make(0),b=make(1);await seed(page,JSON.stringify(a));await page.goto('/demo/patients');
 const file={name:'synthetic.zip',mimeType:'application/zip',buffer:Buffer.from(exportClinicalHistory(b,b.clients[0].id))};
 page.once('dialog',d=>d.accept());await page.getByLabel('Загрузить архив ZIP',{exact:true}).setInputFiles(file);
 await expect(page.getByRole('status')).toContainText('добавлена из ZIP');
 await page.reload();
 const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
 expect(stored.clients).toEqual([...a.clients,...b.clients]);expect(stored.visits).toEqual([...a.visits,...b.visits]);
 await page.getByLabel('Загрузить архив ZIP',{exact:true}).setInputFiles(file);
 await expect(page.getByRole('status')).toContainText('Архив не добавлен');
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY)).toEqual(stored);
});
test('raw restore into absent key readbacks exact corruption; ordinary exports wait for reload',async({page})=>{
 await page.goto('/demo/patients');const raw='{corrupt\ud800';
 page.once('dialog',d=>d.accept());
 await page.getByLabel('Восстановить исходную копию',{exact:true}).setInputFiles({name:'raw.json',mimeType:'application/json',buffer:Buffer.from(encodeRawClinicalBackup(raw))});
 await expect(page.getByRole('status')).toContainText('Исходная строка восстановлена');
 await expect(page.getByRole('button',{name:'Скачать все тестовые истории (JSON)'})).toBeDisabled();
 expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(raw);
 await page.reload();await expect(page.getByRole('button',{name:'Скачать все тестовые истории (JSON)'})).toBeDisabled();
 expect(decodeRawClinicalBackup(await download(page,'Скачать запись при открытии страницы')).raw).toBe(raw);
});
test('missing Web Locks disables modifications but valid state remains exportable',async({page})=>{
 const s=make(0);await seed(page,JSON.stringify(s));
 await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));
 await page.goto('/demo/patients');
 await expect(page.getByRole('button',{name:'Сохранить процедуру'})).toBeDisabled();
 expect(JSON.parse(await download(page,'Скачать все тестовые истории (JSON)'))).toEqual(s);
});

for (const reject of [false,true]) {
 test(`pending save warns until ${reject ? 'failure' : 'verified commit'}`,async({page})=>{
  const original=JSON.stringify(make(0));
  await seed(page,original);
  await page.addInitScript(()=>{
   const original=navigator.locks.request.bind(navigator.locks);
   navigator.locks.request=(...args)=>new Promise((resolve,reject)=>{
    window.releaseSyntheticLock=()=>original(...args).then(resolve,reject);
    window.rejectSyntheticLock=()=>reject(new Error('Synthetic lock failure'));
   });
  });
  await page.goto('/demo/patients');
  const unloadPrevented=()=>page.evaluate(()=>{
   const event=new Event('beforeunload',{cancelable:true});
   window.dispatchEvent(event);return event.defaultPrevented;
  });
  expect(await unloadPrevented()).toBe(false);
  const field=page.getByRole('textbox',{name:'Заметка к посещению'});
  await field.fill('Synthetic delayed write');
  await page.getByRole('button',{name:'Сохранить процедуру'}).click();
  await expect(page.getByRole('status')).toContainText('Сохраняем… Не закрывайте страницу до подтверждения.');
  await expect(field).toHaveValue('Synthetic delayed write');
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(original);
  await expect.poll(unloadPrevented).toBe(true);
  await page.evaluate(reject=>reject?window.rejectSyntheticLock():window.releaseSyntheticLock(),reject);
  if(reject) {
   await expect(page.getByRole('status')).toContainText('Сохранение не подтверждено');
   await expect(field).toHaveValue('Synthetic delayed write');
   expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(original);
  } else {
   await expect(page.getByRole('status')).toContainText('Сохранено в этом браузере.');
   await expect(field).toHaveValue('');
  }
  await expect.poll(unloadPrevented).toBe(false);
  if(!reject) {
   await page.reload();
   await expect(page.locator('.clinical-visit').first()).toContainText('Synthetic delayed write');
  }
 });
}
