import {test,expect} from '@playwright/test';
const date=new Date(Date.now()+10*86400000).toISOString().slice(0,10),start=date+'T07:00:00.000Z',serviceId='test-service';
const settings={timezone:'Europe/Moscow',services:[{serviceId,durationMinutes:45,bufferMinutes:15,enabled:true}],weeklyHours:{0:[],1:[],2:[],3:[],4:[],5:[],6:[]},overrides:[{date,closed:false,windows:[{start:'10:00',end:'12:00'}]}],slotStepMinutes:15,minNoticeMinutes:0,horizonDays:60};
async function setup(page,{stale=false}={}){
 await page.goto('/admin');
 await page.getByLabel('Пароль',{exact:true}).fill('browser-fixture-only-password');
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await expect(page.getByLabel('Специализация',{exact:true})).toBeVisible();
 const writes=[];let reads=0;
 const config={version:1,settings,serviceCatalog:[{id:serviceId,title:'Тестовая услуга',published:true}]};
 await page.route('**/api/admin/booking',route=>route.fulfill({json:config}));
 await page.route('**/api/admin/booking/occupancy',route=>route.fulfill({json:{...config,occupancy:{schemaVersion:1,coverage:null,records:[]}}}));
 await page.route('**/api/admin/booking/free-availability?*',route=>{
  reads++;return route.fulfill({json:{version:stale&&reads>1?2:1,timezone:'Europe/Moscow',ready:true,observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),slots:[{start,end:date+'T07:45:00.000Z'}]}});
 });
 await page.route('**/api/admin/booking/reservations',async route=>{
  const payload=route.request().postDataJSON();writes.push(payload);
  await route.fulfill({json:{version:2,rebasedFromVersion:1,settings,records:[{operationKey:payload.operationKey,type:'reservation',status:'active',start}]}});
 });
 await page.getByRole('button',{name:'Календарь и запись',exact:true}).click();
 await page.getByLabel('Выбранная дата',{exact:true}).fill(date);
 await page.getByRole('combobox',{name:'Услуга для проверки'}).selectOption(serviceId);
 await expect(page.locator('.calendar-preview-slots li')).toHaveCount(1);
 return{writes};
}
test('owner confirmation creates one anonymous internal reserve',async({page})=>{
 const {writes}=await setup(page),reserve=page.getByRole('button',{name:'Внутренний резерв',exact:true});
 page.once('dialog',dialog=>dialog.dismiss());await reserve.click();expect(writes).toHaveLength(0);
 page.once('dialog',dialog=>dialog.accept());await reserve.click();
 await expect(page.getByText('Внутренний резерв подтверждён сервером. Это не запись клиента.')).toBeVisible();
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({expectedVersion:1,serviceId,date,start});
 expect(writes[0].operationKey).toMatch(/^[a-f0-9]{32}$/);
 expect(Object.keys(writes[0]).sort()).toEqual(['date','expectedVersion','operationKey','serviceId','start']);
});
test('stale availability refuses reservation and refreshes preview',async({page})=>{
 const {writes}=await setup(page,{stale:true});
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Внутренний резерв',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Резерв не создан');
 expect(writes).toHaveLength(0);
});
