import React, { useState, useEffect } from 'react';
import { PERSONAS, PROCEDURES, ANGLES, restoreClinicalDemo, emptyClinicalDemo, exampleClinicalDemo, addDemoClient, addDemoVisit, setDemoPhoto, addDemoPhoto, updateDemoPhoto, deleteDemoPhoto, deleteDemoClient } from '../shared/clinical-demo.mjs';
import './clinical-demo.css';
import VoiceNote from './VoiceNote.jsx';
import { encodeClinicalPhoto } from './clinical-photo.mjs';
import ClinicalGallery from './ClinicalGallery.jsx';
import ClinicalPrint from './ClinicalPrint.jsx';
import { exportClinicalHistory, importClinicalHistory } from './clinical-archive.mjs';
import { CLINICAL_KEY, LEGACY_BACKUP_KEY, openClinicalStorage, mergeClinicalArchive, encodeRawClinicalBackup, restoreRawClinicalBackup } from './clinical-storage.mjs';
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
  const [session] = useState(() => openClinicalStorage({
    storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
    locks: navigator.locks, restore: restoreClinicalDemo, empty: emptyClinicalDemo, example: exampleClinicalDemo,
  }));
  const [state, setState] = useState(session.state), [selected, setSelected] = useState(() => session.state.clients[0]?.id ?? '');
  const [storageBlocked, setStorageBlocked] = useState(session.blocked), [saving, setSaving] = useState(false);
  useEffect(() => {
    const changed = event => {
      if (event.storageArea === window.localStorage && (event.key === CLINICAL_KEY || event.key === null)) {
        session.invalidate(); setStorageBlocked(true);
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [session]);
  const [day, setDay] = useState('2026-11-06'), [procedure, setProcedure] = useState(PROCEDURES[0]), [drafts, setDrafts] = useState({});
  const [message, setMessage] = useState(''), [photoBusy,setBusy] = useState(false), [angle,setAngle] = useState(ANGLES[0]);
  const [beforeId,setBeforeId] = useState(''), [afterId,setAfterId] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [importBusy,setImportBusy]=useState(false),[printPhotos,setPrintPhotos]=useState(true),[printNotes,setPrintNotes]=useState(true);
  const [beforePicture,setBeforePicture]=useState(''),[afterPicture,setAfterPicture]=useState('');
  const busy = photoBusy || voiceBusy || importBusy || saving || storageBlocked, note = drafts[selected] ?? '';
  const setNote = value => setDrafts(current => ({...current, [selected]: value}));
  const client = state.clients.find(c => c.id === selected), visits = state.visits.filter(v => v.clientId === selected).sort((a,b)=>a.date.localeCompare(b.date));
  const before = visits.find(v=>v.id===beforeId) ?? visits[0], after = visits.find(v=>v.id===afterId) ?? visits.at(-1);
  const photosFor=visit=>state.photos.filter(p=>p.visitId===visit?.id && p.angle===angle);
  const photoKey=p=>p ? p.id ?? `legacy:${p.visitId}:${p.angle}` : '';
  const beforePhotos=photosFor(before), afterPhotos=photosFor(after);
  const beforePhoto=beforePhotos.find(p=>photoKey(p)===beforePicture)??beforePhotos[0];
  const afterPhoto=afterPhotos.find(p=>photoKey(p)===afterPicture)??afterPhotos[0];
  const unused = PERSONAS.filter(p => !state.clients.some(c => c.label === p));
  async function save(next, notice) {
    setSaving(true);
    try {
      const saved = await session.save(next);
      setState(saved); setMessage(notice + ' Сохранено в этом браузере.'); return true;
    } catch (error) {
      setStorageBlocked(session.blocked);
      setMessage('Сохранение не подтверждено. Не закрывайте страницу и не очищайте хранилище. Скачайте запись при открытии и текущие истории этой вкладки. При конфликте сохраните копии из обеих вкладок.');
      return false;
    } finally { setSaving(false); }
  }
  function downloadOriginal(legacy = false) {
    let raw;
    try { raw = legacy ? session.legacyRaw() : session.raw(); }
    catch { setMessage('Не удалось прочитать исходную копию. Не очищайте данные браузера.'); return; }
    if (typeof raw !== 'string') { setMessage(legacy ? 'Сохранённая исходная копия v1 в этом браузере не найдена.' : 'Исходную запись не удалось прочитать. Не очищайте данные браузера.'); return; }
    const url = URL.createObjectURL(new Blob([encodeRawClinicalBackup(raw, legacy ? LEGACY_BACKUP_KEY : CLINICAL_KEY)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url;
    link.download = legacy ? 'anna-original-v1-raw-backup.json' : 'anna-opening-raw-backup.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Началось скачивание исходной строки в JSON-конверте без изменения её символов. Проверьте файл; это не проверка пригодности карточек или восстановления. Обычный JSON историй не содержит прежние шкалы v1.');
  }
  async function restoreOriginal(event) {
    const input = event.currentTarget, file = input.files?.[0]; input.value = ''; if (!file) return;
    if (file.size > 130 * 1024 * 1024) { setMessage('Файл исходной копии слишком большой.'); return; }
    setImportBusy(true);
    try {
      const text = await file.text();
      if (!confirm('Восстановить исходную строку в пустое хранилище этого браузера? Это не импорт ZIP. Даже повреждённая строка будет восстановлена без исправлений.')) return;
      session.invalidate({ exports: true }); setStorageBlocked(true);
      await restoreRawClinicalBackup({
        storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
        locks: navigator.locks,
      }, text);
      session.invalidate(); setStorageBlocked(true);
      setMessage('Исходная строка восстановлена и прочитана обратно без изменения. Перезагрузите страницу, чтобы проверить карточки. Это не подтверждает их корректность.');
    } catch {
      setMessage('Восстановление не подтверждено. Оно возможно только при отсутствии основной записи и поддержке блокировки. Ничего не очищайте; сохраните исходный файл.');
    } finally { setImportBusy(false); }
  }
  function choose(id) { setSelected(id);setBeforeId('');setAfterId('');setBeforePicture('');setAfterPicture('');setMessage(''); }
  async function create() {
    try { const next = addDemoClient(state, unused[0]); if(await save(next, 'Тестовая карта создана.')) {setSelected(next.clients.at(-1).id);setBeforeId('');setAfterId('');} }
    catch { setMessage('Не удалось добавить тестовую карту. Проверьте список.'); }
  }
  async function visit(event) {
    event.preventDefault();
    if (busy) return;
    try { const next=addDemoVisit(state, { clientId: selected, date: day, procedure, note }); if(await save(next, 'Тестовая процедура добавлена.')) { setAfterId(next.visits.at(-1).id); setDrafts(current => current[selected] === note ? {...current, [selected]: ''} : current); } }
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
      await save(next,replacingPhoto?'Тестовое фото заменено.':'Тестовое фото добавлено.');
    }catch(error){setMessage('Не удалось обработать фото. Старое фото не изменено. Попробуйте JPG или PNG из галереи.');}
    finally{setBusy(false);}
  }
  async function uploadMany(event,visitId,photoAngle){
    const input=event.currentTarget,files=[...(input.files||[])];input.value='';if(!files.length)return;
    setBusy(true);
    try{
      let next=state;
      for(const file of files)next=addDemoPhoto(next,{visitId,angle:photoAngle,data:await processPhoto(file)});
      await save(next,`Добавлено тестовых фото: ${files.length}.`);
    }catch(error){setMessage('Не удалось добавить фотографии. Прежние снимки сохранены. Попробуйте выбрать меньше фото или освободить место.');}
    finally{setBusy(false);}
  }
  async function removePhoto(photo){
    if(!confirm('Удалить этот тестовый снимок? Остальные фото останутся.'))return;
    try{await save(deleteDemoPhoto(state,photo),'Тестовый снимок удалён.');}
    catch{setMessage('Не удалось удалить снимок.');}
  }
  async function example() { if(!confirm('Заменить все тестовые карты и фотографии примером? Сначала скачайте все истории.'))return; const next=exampleClinicalDemo();if(await save(next,'Пример восстановлен.')){setSelected(next.clients[0].id);setBeforeId('');setAfterId('');} }
  async function clear() { if(!confirm('Очистить только тестовые карты и фотографии в этом браузере?'))return;if(await save(emptyClinicalDemo(),'Тестовые карты очищены.')) { choose(''); setDrafts({}); } }
  function download() {
    if (!session.exportAllowed) return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(session.currentExport(state),null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='anna-synthetic-histories.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function downloadSelectedArchive(){
    if(!client || !session.exportAllowed)return;
    try{
      const zip=exportClinicalHistory(session.currentExport(state),client.id);
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
      const incoming=restoreClinicalDemo(importClinicalHistory(await file.arrayBuffer()));
      const next=mergeClinicalArchive(state,incoming,restoreClinicalDemo);
      if(!confirm('Добавить карту из ZIP, сохранив существующие карты? Совпадающие карты и превышение лимита не импортируются.'))return;
      if(await save(next,'Демонстрационная история добавлена из ZIP.')){setSelected(next.clients[0]?.id??'');setBeforeId('');setAfterId('');}
    }catch{setMessage('Архив не добавлен: проверьте формат, совпадения карт и лимит в 3 карты. Существующие данные не изменены.');}
    finally{setImportBusy(false);}
  }
  async function removeSelectedClient(){
    if(!client||!confirm('Удалить выбранную тестовую карту и ВСЕ её посещения и фотографии из этого браузера? Убедитесь, что внешний архив сохранён.'))return;
    try{
      const next=deleteDemoClient(state,client.id);
      if(await save(next,'Выбранная тестовая карта удалена.')){setSelected(next.clients[0]?.id??'');setBeforeId('');setAfterId('');setDrafts(current=>({...current,[client.id]:''}));}
    }catch{setMessage('Не удалось удалить тестовую карту.');}
  }
  return <main className="clinical-shell">
    <nav className="clinical-nav" aria-label="Разделы демонстрации"><a href="/">Сайт Анны</a><a href="/admin">Админка</a><a href="/demo/booking">Онлайн-запись · демо</a></nav>
    <h1>Пациенты и истории</h1>
    <p className="clinical-lead">Карта пациента, посещения и фотографии до и после.</p>
    <p className="clinical-demo-note">Открытый пример с вымышленными картами. Используйте только вымышленные заметки и тестовые изображения. Карты и фото сохраняются в этом браузере и не отправляются на сервер.</p>
    {session.sourceIsLegacy && <p role="note">Открыт прежний формат v1. Шкалы боли и подвижности не отображаются и не входят в обычные JSON, ZIP и PDF. Для сохранения исходных значений скачайте запись при открытии страницы в JSON-конверте. Перед первой записью сохраняется отдельная исходная копия v1 в этом же браузере; она не заменяет внешний файл.</p>}
    {storageBlocked && <p role="alert">Запись заблокирована: данные не удалось безопасно открыть, они изменились в другой вкладке или браузер не поддерживает безопасную блокировку. Изменения заблокированы. Сначала скачайте исходную копию. Не очищайте хранилище браузера.</p>}
    <div className="clinical-actions">
      <button className="clinical-secondary" onClick={()=>downloadOriginal()}>Скачать запись при открытии страницы</button>
      <button className="clinical-secondary" onClick={()=>downloadOriginal(true)}>Скачать сохранённую исходную копию v1 (без проверки)</button>
      {unused.length>0 && <button className="admin-primary" disabled={busy} onClick={create}>Создать {unused[0]}</button>}
      <button className="clinical-secondary" disabled={!session.exportAllowed} onClick={download}>Скачать все тестовые истории (JSON)</button>
      {session.raw() === null && <label className="clinical-photo-upload">Восстановить исходную копию в пустое хранилище<input type="file" accept=".json,application/json" disabled={busy} aria-label="Восстановить исходную копию" onChange={restoreOriginal}/></label>}
      <label className="clinical-photo-upload clinical-archive-upload">Загрузить архив ZIP<input type="file" accept=".zip,application/zip" disabled={busy} aria-label="Загрузить архив ZIP" onChange={restoreSelectedArchive}/></label>
      {client && <>
        <button className="clinical-secondary" disabled={!session.exportAllowed} onClick={downloadSelectedArchive}>Скачать архив карты (ZIP)</button>
        <button className="clinical-secondary" disabled={!session.exportAllowed} onClick={()=>window.print()}>Печать / Сохранить PDF</button>
        <button className="clinical-secondary clinical-delete-client" disabled={busy} onClick={removeSelectedClient}>Удалить выбранную тестовую карту</button>
      </>}
      <button className="clinical-secondary" disabled={busy} onClick={clear}>Начать с пустого кабинета</button>
      {!state.clients.length && <button className="clinical-secondary" disabled={busy} onClick={example}>Показать пример истории</button>}
    </div>
    {client && <div className="clinical-print-options"><label><input type="checkbox" checked={printNotes} onChange={e=>setPrintNotes(e.target.checked)}/> Заметки в PDF</label><label><input type="checkbox" checked={printPhotos} onChange={e=>setPrintPhotos(e.target.checked)}/> Фото в PDF</label><p>PDF создаётся через меню печати устройства. Архив ZIP не удаляет карту автоматически.</p></div>}
    <p role="status" className="clinical-status">{photoBusy ? 'Сохраняем тестовое фото…' : message}</p>
    <div className="clinical-grid">
      <aside className="clinical-people"><h2>Карты</h2>{state.clients.map(c=><button key={c.id} disabled={photoBusy || voiceBusy || importBusy || saving} className={selected===c.id?'active':''} onClick={()=>choose(c.id)}>{c.label}</button>)}{!state.clients.length && <p>Кабинет пуст. Создайте тестовую карту.</p>}</aside>
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
          <VoiceNote key={selected} value={note} onChange={setNote} disabled={photoBusy || importBusy || saving || storageBlocked} onBusy={setVoiceBusy}/>
          <button className="admin-primary" disabled={busy} type="submit">Сохранить процедуру</button>
        </form></section>
      </> : <section className="clinical-card"><h2>Начните с тестовой карты</h2><p>Здесь появятся история посещений и фотографии до и после.</p></section>}</div>
    </div>
    {client && <ClinicalPrint client={client} visits={visits} photos={state.photos} showNotes={printNotes} showPhotos={printPhotos}/>}
  </main>;
}
