import { publicSocialLinks } from '../shared/contact-links.mjs';
import { readFile } from 'node:fs/promises';
import { profileDraft, socialChannels, editorialPlan } from '../shared/anna-materials.mjs';
import { database, readContent } from './db.mjs';
import safety from './marketing-assets/channel-safety.cjs';
const assets={
  workspace: new URL('./marketing-assets/workspace.html',import.meta.url),
  styles: new URL('./marketing-assets/studio-refinement.css',import.meta.url),
  materials: new URL('./marketing-assets/materials.js',import.meta.url),
  safety: new URL('./marketing-assets/channel-safety.cjs',import.meta.url),
};
const topicSources = [
  ['usova-healthy-body', 'Здоровое тело', 'https://usovaosteoschool.ru/'],
  ['usova-spine', 'Позвоночник', 'https://usovaosteoschool.ru/'],
  ['usova-digestion', 'Здоровый ЖКТ', 'https://usovaosteoschool.ru/'],
  ['usova-heart-vessels', 'Сердце и сосуды', 'https://usovaosteoschool.ru/'],
  ['usova-myofascial-trains', 'Анатомические миофасциальные поезда', 'https://usovaosteoschool.ru/'],
  ['usova-mfr', 'МФР', 'https://usovaosteoschool.ru/'],
  ['usova-yin-yang', 'Инь-Янь', 'https://usovaosteoschool.ru/'],
  ['usova-teeth-skull-body', 'ЗУБЫ. ЧЕРЕП. ТЕЛО', 'https://usovaosteoschool.ru/'],
  ['usova-brain-structures', 'Структуры головного мозга', 'https://usovaosteoschool.ru/'],
  ['usova-lungs-bronchi', 'Лёгкие и бронхи', 'https://usovaosteoschool.ru/bronchi'],
  ['usova-inhibitory-balance', 'Ингибиторный баланс: суставы и фасции', 'https://usovaosteoschool.ru/balanceandjoints'],
  ['usova-face-body', 'Лифтинг лица и тела', 'https://usovaosteoschool.ru/face_body'],
];
// Verified program titles, not treatment claims or proof of an individual diploma.
// Existing marketing rows are never replaced by this seed.
export function marketingSeed(){return {
  schemaVersion:4,seedId:'anna-usova-topics-v1',book:'Анна Мысливцева',telegramIdentityAccountId:'',
  chapters:topicSources.map(([id,title,source])=>({
    id,title,distinction:'',habit:'',reveals:'',images:[],tensions:[],recognition:'',
    forbidden:'Не публиковать персональные данные, неподтверждённые медицинские утверждения и гарантии результата.',
    introduces:[],requires:[],factCheck:true,
    factNote:`Источник названия программы: ${source} . Перед упоминанием квалификации сверьте конкретный документ Анны. Название программы не подтверждает эффективность метода.`,
    centralDistinctionStatus:'not_introduced',sourceText:'',
  })),concepts:[],posts:[],measures:[],
};}

function validate(data){
  if(JSON.stringify(data).length>500000)throw Error('План слишком большой.');
  const clean=safety.migrate(data);
  if(clean.telegramIdentityAccountId)throw Error('Подключение аккаунтов в этой версии не поддерживается.');
  // Workspaces are content only. Never accept settings enabling live delivery.
  for(const key of Object.keys(clean))if(!['schemaVersion','seedId','book','telegramIdentityAccountId','chapters','concepts','posts','measures','workingDraft'].includes(key))throw Error('Неизвестное поле базы.');
  return clean;
}
export function registerMarketing(app,requireAdmin,requireWorkspace = requireAdmin){
  app.get('/admin/marketing',requireWorkspace,async(_req,res,next)=>{try{res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}).type('html').send(await readFile(assets.workspace,'utf8'));}catch(e){next(e);}});
  app.get('/api/admin/marketing/assets/:name',requireWorkspace,async(req,res,next)=>{try{if(!['safety','styles','materials'].includes(req.params.name))return res.sendStatus(404);res.type(req.params.name!=='styles'?'application/javascript':'text/css').send(await readFile(assets[req.params.name],'utf8'));}catch(e){next(e);}});
  app.get('/api/admin/marketing/seed',requireWorkspace,(_req,res)=>res.json(marketingSeed()));
  app.get('/api/admin/marketing/materials',requireWorkspace,async(_req,res,next)=>{try{
    const {data}=await readContent();
    res.json({publicSocialLinks:publicSocialLinks(data.profile),profile:{name:data.profile.name,role:data.profile.role,intro:data.profile.intro,about:data.profile.about,qualification:data.profile.qualification,socialUrl:data.profile.socialUrl,socialLinks:data.profile.socialLinks || {}},diplomas:data.diplomas,profileDraft,socialChannels,editorialPlan,publishingEnabled:false});
  }catch(e){next(e);}});
  app.get('/api/admin/marketing',requireWorkspace,async(_req,res,next)=>{try{
    const {query}=await database();
    const [row]=await query('SELECT body,version FROM content WHERE id=$1',['marketing']);res.json({data:row?JSON.parse(row.body):marketingSeed(),version:row?Number(row.version):1,publishingEnabled:false});
  }catch(e){next(e);}});
  app.put('/api/admin/marketing',requireWorkspace,async(req,res,next)=>{try{
    let data;try{if(!Number.isSafeInteger(req.body?.version)||req.body.version<1||Object.keys(req.body).some(k=>!['data','version'].includes(k)))throw Error();data=validate(req.body.data);}catch{return res.status(400).json({error:'База не прошла проверку. Доступы и настройки публикации не принимаются.'});}
    const {query}=await database();
    if(req.body.version===1){const inserted=await query('INSERT INTO content (id,body,version) VALUES ($1,$2,2) ON CONFLICT (id) DO NOTHING RETURNING version',['marketing',JSON.stringify(data)]);if(inserted.length)return res.json({version:2,publishingEnabled:false});}
    const rows=await query('UPDATE content SET body=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING version',[JSON.stringify(data),'marketing',req.body.version]);
    if(!rows.length)return res.status(409).json({error:'Серверная копия изменена в другой вкладке. Экспортируйте локальную базу, затем загрузите серверную.'});
    res.json({version:Number(rows[0].version),publishingEnabled:false});
  }catch(e){next(e);}});
  app.post('/api/admin/marketing/publish',requireAdmin,(_req,res)=>res.status(503).json({code:'PUBLISHING_NOT_CONNECTED',error:'Автопостинг не подключён. Планирование не публикует материалы.'}));
}
