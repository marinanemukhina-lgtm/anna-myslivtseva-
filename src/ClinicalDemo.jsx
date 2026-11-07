import React, { useState } from 'react';
import { PERSONAS, PROCEDURES, ANGLES, restoreClinicalDemo, emptyClinicalDemo, exampleClinicalDemo, addDemoClient, addDemoVisit, setDemoPhoto, addDemoPhoto, updateDemoPhoto, deleteDemoPhoto, deleteDemoClient } from '../shared/clinical-demo.mjs';
import './clinical-demo.css';
import VoiceNote from './VoiceNote.jsx';
import { encodeClinicalPhoto } from './clinical-photo.mjs';
import ClinicalGallery from './ClinicalGallery.jsx';
import ClinicalPrint from './ClinicalPrint.jsx';
import { exportClinicalHistory, importClinicalHistory } from './clinical-archive.mjs';
const STORAGE = 'anna-open-synthetic-clinical-v1';
function initial() {
  try { const saved = localStorage.getItem(STORAGE); return saved ? restoreClinicalDemo(JSON.parse(saved)) : exampleClinicalDemo(); }
  catch { return exampleClinicalDemo(); }
}
function PhotoPanel({ label, visit, visits, angle, photo, photos, photoKey, busy, onSelect, onPhoto, onPick }) {
  return <div className="clinical-photo-panel">
    <div className="clinical-photo-title"><h3>{label}</h3><label>{label}: посещение<select value={visit?.id ?? ''} disabled={busy || !visits.length} onChange={e=>onSelect(e.target.value)}>{!visits.length && <option value="">Нет посещений</option>}{visits.map(v=><option key={v.id} value={v.id}>{v.date} · {v.procedure}</option>)}</select></label></div>
    {photos.length>1 && <label>Снимок для сравнения<select aria-label={`Снимок ${label}`} value={photoKey(photo)} disabled={busy} onChange={e=>onPick(e.target.value)}>{photos.map((p,i)=><option key={photoKey(p)} value={photoKey(p)}>Фото №{i+1}</option>)}</select></label>}
    <div className="clinical-photo-frame">{photo ? <img src={photo.data} alt={`Фото ${label.toLowerCase()} · ${angle} · ${visit.date}`}/> : <p>Фото пока не добавлено<span>{angle} · {visit?.date ?? 'Добавьте посещение'}</span></p>}</div>
    <label className={'clinical-photo-upload clinical-camera-button' + (busy || !visit ? ' disabled' : '')}>Снять фото «{label}»<input type="file" accept="image/*" capture="environment" aria-label={`Снять фото ${label}`} disabled={busy || !visit} onChange={e=>onPhoto(e,visit.id,angle,photo)}/></label>
    <label className={'clinical-photo-upload' + (busy || !visit ? ' disabled' : '')}>{photo ? 'Заменить' : 'Добавить'} фото «{label}»<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" aria-label={`Добавить фото ${label}`} disabled={busy || !visit} onChange={e=>onPhoto(e,visit.id,angle,photo)}/></label>
  </div>;
}
export default function ClinicalDemo() {
  const [state, setState] = useState(initial), [selected, setSelected] = useState(() => initial().clients[0]?.id ?? '');
  const [day, setDay] = useState('2026-11-06'), [procedure, setProcedure] = useState(PROCEDURES[0]), [drafts, setDrafts] = useState({});
  const [message, setMessage] = useState(''), [photoBusy,setBusy] = useState(false), [angle,setAngle] = useState(ANGLES[0]);
  const [beforeId,setBeforeId] = useState(''), [afterId,setAfterId] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [importBusy,setImportBusy]=useState(false),[printPhotos,setPrintPhotos]=useState(true),[printNotes,setPrintNotes]=useState(true);
  const [beforePicture,setBeforePicture]=useState(''),[afterPicture,setAfterPicture]=useState('');
  const busy = photoBusy || voiceBusy || importBusy, note = drafts[selected] ?? '';
  const setNote = value => setDrafts(current => ({...current, [selected]: value}));
  const client = state.clients.find(c => c.id === selected), visits = state.visits.filter(v => v.clientId === selected).sort((a,b)=>a.date.localeCompare(b.date));
  const before = visits.find(v=>v.id===beforeId) ?? visits[0], after = visits.find(v=>v.id===afterId) ?? visits.at(-1);
  const photosFor=visit=>state.photos.filter(p=>p.visitId===visit?.id && p.angle===angle);
  const photoKey=p=>p ? p.id ?? `legacy:${p.visitId}:${p.angle}` : '';
  const beforePhotos=photosFor(before), afterPhotos=photosFor(after);
  const beforePhoto=beforePhotos.find(p=>photoKey(p)===beforePicture)??beforePhotos[0];
  const afterPhoto=afterPhotos.find(p=>photoKey(p)===afterPicture)??afterPhotos[0];
  const unused = PERSONAS.filter(p => !state.clients.some(c => c.label === p));
  function save(next, notice) {
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); }
    catch { setMessage('Не удалось сохранить в хранилище браузера. Старое фото осталось без изменений. Скачайте тестовые истории или освободите место кнопкой «Начать с пустого кабинета».'); return false; }
    setState(next); setMessage(notice + ' Сохранено в этом браузере.'); return true;
  }
  function choose(id) { setSelected(id);setBeforeId('');setAfterId('');setBeforePicture('');setAfterPicture('');setMessage(''); }
  function create() {
    try { const next = addDemoClient(state, unused[0]); if(save(next, 'Тестовая карта создана.')) {setSelected(next.clients.at(-1).id);setBeforeId('');setAfterId('');} }
    catch { setMessage('Не удалось добавить тестовую карту. Проверьте список.'); }
  }
  function visit(event) {
    event.preventDefault();
    if (busy) return;
    try { const next=addDemoVisit(state, { clientId: selected, date: day, procedure, note }); if(save(next, 'Тестовая процедура добавлена.')) { setAfterId(next.visits.at(-1).id); setNote(''); } }
    catch { setMessage('Проверьте дату и тестовые поля.'); }
  }
  async function processPhoto(file){
    if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.type)||file.size>20*1024*1024)throw Error('INVALID_PHOTO');
    const raw=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('PHOTO_READ_FAILED'));reader.readAsDataURL(file);});
    const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('PHOTO_DECODE_FAILED'));image.src=raw;});
    return encodeClinicalPhoto(img);
  }
  async function upload(event,visitId,photoAngle,replacingPhoto){
    const input=event.currentTarget,file=input.files?.[0];input.value='';if(!file)return;
    setBusy(true);
    try{
      const data=await processPhoto(file);
      const next=replacingPhoto?updateDemoPhoto(state,replacingPhoto,data):setDemoPhoto(state,{visitId,angle:photoAngle,data});
      save(next,replacingPhoto?'Тестовое фото заменено.':'Тестовое фото добавлено.');
    }catch(error){setMessage('Не удалось обработать фото. Старое фото не изменено. Попробуйте JPG или PNG из галереи.');}
    finally{setBusy(false);}
  }
  async function uploadMany(event,visitId,photoAngle){
    const input=event.currentTarget,files=[...(input.files||[])];input.value='';if(!files.length)return;
    setBusy(true);
    try{
      let next=state;
      for(const file of files)next=addDemoPhoto(next,{visitId,angle:photoAngle,data:await processPhoto(file)});
      save(next,`Добавлено тестовых фото: ${files.length}.`);
    }catch(error){setMessage('Не удалось добавить фотографии. Прежние снимки сохранены. Попробуйте выбрать меньше фото или освободить место.');}
    finally{setBusy(false);}
  }
  function removePhoto(photo){
    if(!confirm('Удалить этот тестовый снимок? Остальные фото останутся.'))return;
    try{save(deleteDemoPhoto(state,photo),'Тестовый снимок удалён.');}
    catch{setMessage('Не удалось удалить снимок.');}
  }
  function example() { const next=exampleClinicalDemo();if(save(next,'Пример восстановлен.')){setSelected(next.clients[0].id);setBeforeId('');setAfterId('');} }
  function clear() { if(!confirm('Очистить только тестовые карты и фотографии в этом браузере?'))return;if(save(emptyClinicalDemo(),'Тестовые карты очищены.')) { choose(''); setDrafts({}); } }
  function download() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='anna-synthetic-histories.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function downloadSelectedArchive(){
    if(!client)return;
    try{
      const zip=exportClinicalHistory(state,client.id);
      const url=URL.createObjectURL(new Blob([zip],{type:'application/zip'}));
      const link=document.createElement('a');link.href=url;link.download='anna-demo-history-'+client.label.replace(/[^0-9]/g,'')+'.zip';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage('Началась загрузка ZIP. Проверьте, что файл сохранён и открывается, прежде чем удалять карту.');
    }catch{setMessage('Не удалось подготовить архив. Ничего не удалено.');}
  }
  async function restoreSelectedArchive(event){
    const input=event.currentTarget,file=input.files?.[0];input.value='';if(!file)return;
    if(file.size>60*1024*1024+200000){setMessage('Архив слишком большой.');return;}
    setImportBusy(true);
    try{
      const next=restoreClinicalDemo(importClinicalHistory(await file.arrayBuffer()));
      if(!confirm('Заменить ВСЕ тестовые карты этого браузера данными из выбранного ZIP? Это не затронет фотографии телефона.'))return;
      if(save(next,'Демонстрационная история восстановлена из ZIP.')){setSelected(next.clients[0]?.id??'');setBeforeId('');setAfterId('');}
    }catch{setMessage('Не удалось восстановить архив. Данные кабинета не изменены.');}
    finally{setImportBusy(false);}
  }
  function removeSelectedClient(){
    if(!client||!confirm('Удалить выбранную тестовую карту и ВСЕ её посещения и фотографии из этого браузера? Убедитесь, что внешний архив сохранён.'))return;
    try{
      const next=deleteDemoClient(state,client.id);
      if(save(next,'Выбранная тестовая карта удалена.')){setSelected(next.clients[0]?.id??'');setBeforeId('');setAfterId('');setDrafts(current=>({...current,[client.id]:''}));}
    }catch{setMessage('Не удалось удалить тестовую карту.');}
  }
  return <main className="clinical-shell">
    <nav className="clinical-nav" aria-label="Разделы демонстрации"><a href="/">Сайт Анны</a><a href="/admin">Админка</a><a href="/demo/booking">Онлайн-запись · демо</a></nav>
    <h1>Пациенты и истории</h1>
    <p className="clinical-lead">Карта пациента, посещения и фотографии до и после.</p>
    <p className="clinical-demo-note">Открытый пример с вымышленными картами. Используйте только вымышленные заметки и тестовые изображения. Карты и фото сохраняются в этом браузере и не отправляются на сервер.</p>
    <div className="clinical-actions">
      {unused.length>0 && <button className="admin-primary" disabled={busy} onClick={create}>Создать {unused[0]}</button>}
      <button className="clinical-secondary" onClick={download}>Скачать все тестовые истории (JSON)</button>
      {client && <>
        <button className="clinical-secondary" disabled={busy} onClick={downloadSelectedArchive}>Скачать архив карты (ZIP)</button>
        <button className="clinical-secondary" disabled={busy} onClick={()=>window.print()}>Печать / Сохранить PDF</button>
        <label className="clinical-photo-upload clinical-archive-upload">Загрузить архив ZIP<input type="file" accept=".zip,application/zip" disabled={busy} aria-label="Загрузить архив ZIP" onChange={restoreSelectedArchive}/></label>
        <button className="clinical-secondary clinical-delete-client" disabled={busy} onClick={removeSelectedClient}>Удалить выбранную тестовую карту</button>
      </>}
      <button className="clinical-secondary" disabled={busy} onClick={clear}>Начать с пустого кабинета</button>
      {!state.clients.length && <button className="clinical-secondary" onClick={example}>Показать пример истории</button>}
    </div>
    {client && <div className="clinical-print-options"><label><input type="checkbox" checked={printNotes} onChange={e=>setPrintNotes(e.target.checked)}/> Заметки в PDF</label><label><input type="checkbox" checked={printPhotos} onChange={e=>setPrintPhotos(e.target.checked)}/> Фото в PDF</label><p>PDF создаётся через меню печати устройства. Архив ZIP не удаляет карту автоматически.</p></div>}
    <p role="status" className="clinical-status">{photoBusy ? 'Сохраняем тестовое фото…' : message}</p>
    <div className="clinical-grid">
      <aside className="clinical-people"><h2>Карты</h2>{state.clients.map(c=><button key={c.id} disabled={busy} className={selected===c.id?'active':''} onClick={()=>choose(c.id)}>{c.label}</button>)}{!state.clients.length && <p>Кабинет пуст. Создайте тестовую карту.</p>}</aside>
      <div className="clinical-main">{client ? <>
        <section className="clinical-card clinical-comparison"><span className="clinical-label">Карта пациента · демо</span><h2>{client.label}</h2><p className="clinical-visit-summary">Посещений: {visits.length}{visits.length ? ` · Последнее: ${visits.at(-1).date}` : ''}</p>
          <div className="clinical-comparison-heading"><h3>Фото до и после</h3><label>Ракурс<select value={angle} disabled={busy} onChange={e=>setAngle(e.target.value)}>{ANGLES.map(a=><option key={a}>{a}</option>)}</select></label></div>
          <p className="clinical-hint">Выберите две даты и одинаковый ракурс для сравнения.</p>
          <div className="clinical-comparison-grid"><PhotoPanel label="До" visit={before} visits={visits} angle={angle} photo={beforePhoto} photos={beforePhotos} photoKey={photoKey} busy={busy} onSelect={id=>{setBeforeId(id);setBeforePicture('');}} onPick={setBeforePicture} onPhoto={upload}/><PhotoPanel label="После" visit={after} visits={visits} angle={angle} photo={afterPhoto} photos={afterPhotos} photoKey={photoKey} busy={busy} onSelect={id=>{setAfterId(id);setAfterPicture('');}} onPick={setAfterPicture} onPhoto={upload}/></div>
          {before && after && before.id===after.id && <p className="clinical-hint">Выбрано одно посещение. Добавьте или выберите другую дату для сравнения.</p>}
        </section>
        <ClinicalGallery visits={visits} photos={state.photos} angle={angle} busy={busy} onAdd={uploadMany} onReplace={upload} onRemove={removePhoto}/>
        <section className="clinical-card"><h3>История процедур</h3>{[...visits].reverse().map(v=><article className="clinical-visit" key={v.id}><div><strong>{v.date}</strong><span>{v.procedure}</span></div><p>{v.note}</p><div className="clinical-photos">{state.photos.filter(p=>p.visitId===v.id).map(p=><figure key={photoKey(p)}><img src={p.data} alt={`Фото посещения ${v.date} · ${p.angle}`} loading="lazy"/><figcaption>{p.angle}</figcaption></figure>)}</div></article>)}{!visits.length && <p>Пока нет процедур.</p>}</section>
        <section className="clinical-card"><h3>Добавить процедуру</h3><form onSubmit={visit} className="clinical-form">
          <label>Дата<input type="date" value={day} required disabled={busy} onChange={e=>setDay(e.target.value)}/></label>
          <label>Процедура<select value={procedure} disabled={busy} onChange={e=>setProcedure(e.target.value)}>{PROCEDURES.map(x=><option key={x}>{x}</option>)}</select></label>
          <VoiceNote key={selected} value={note} onChange={setNote} disabled={photoBusy} onBusy={setVoiceBusy}/>
          <button className="admin-primary" disabled={busy} type="submit">Сохранить процедуру</button>
        </form></section>
      </> : <section className="clinical-card"><h2>Начните с тестовой карты</h2><p>Здесь появятся история посещений и фотографии до и после.</p></section>}</div>
    </div>
    {client && <ClinicalPrint client={client} visits={visits} photos={state.photos} showNotes={printNotes} showPhotos={printPhotos}/>}
  </main>;
}
