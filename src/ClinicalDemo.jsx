import React, { useEffect, useMemo, useState } from "react";
import "./clinical-demo.css";
const PERSONAS = ["Демо-клиент 001", "Демо-клиент 002", "Демо-клиент 003"];
const NOTES = ["Тест: первичное наблюдение", "Тест: повторная процедура", "Тест: изменение показателя", "Тест: без изменений"];
const PROCEDURES = ["Демонстрационная процедура", "Повторный тестовый приём"];

async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await res.json();
  if (!res.ok) throw new Error(value.error || "Ошибка запроса.");
  return value;
}
function formatDate(iso) {
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}
function Trend({ visits }) {
  const ordered = [...visits].sort((a, b) => a.date.localeCompare(b.date));
  const w = 480, h = 144, pad = 18;
  const point = (v, i, max) => ({
    x: pad + i * (w - 2 * pad) / Math.max(1, ordered.length - 1),
    y: h - pad - v * (h - 2 * pad) / max,
  });
  const line = (key, max) => ordered.map((v, i) => {
    const p = point(v[key], i, max);
    return String(p.x) + "," + String(p.y);
  }).join(" ");
  if (!ordered.length) return <p className="clinical-hint">Показатели появятся после первой тестовой процедуры.</p>;
  return <div className="clinical-chart">
    <div className="clinical-chart-legend"><span className="clinical-pain">● Боль (0–10)</span><span className="clinical-mobility">● Подвижность (0–100%)</span></div>
    <svg role="img" aria-label="График показателей боли и подвижности по посещениям" viewBox="0 0 480 144" preserveAspectRatio="xMidYMid meet">
      {[0, 0.5, 1].map(v => <line key={v} x1={pad} x2={w-pad} y1={pad+(h-2*pad)*v} y2={pad+(h-2*pad)*v} stroke="#dce2e8" strokeWidth="1"/>)}
      {ordered.length > 1 && <><polyline points={line("pain", 10)} fill="none" stroke="#bd755f" strokeWidth="3" strokeLinejoin="round"/><polyline points={line("mobility", 100)} fill="none" stroke="#457e79" strokeWidth="3" strokeLinejoin="round"/></>}
      {ordered.map((visit,i) => <g key={visit.id}><circle cx={point(visit.pain,i,10).x} cy={point(visit.pain,i,10).y} r="4" fill="#bd755f"/><circle cx={point(visit.mobility,i,100).x} cy={point(visit.mobility,i,100).y} r="4" fill="#457e79"/></g>)}
    </svg>
    <p className="clinical-hint">Показатели вводятся вручную и не являются медицинской оценкой. Количество наблюдений: {ordered.length}.</p>
  </div>;
}
function Metrics({ visits }) {
  const sorted = [...visits].sort((a,b)=>a.date.localeCompare(b.date));
  const first=sorted[0], last=sorted.at(-1);
  return <div className="clinical-metrics">
    <div><strong>{visits.length}</strong><span>Процедур</span></div>
    <div><strong>{last ? String(last.pain) + "/10" : "—"}</strong><span>Боль на последнем визите</span></div>
    <div><strong>{last ? String(last.mobility) + "%" : "—"}</strong><span>Подвижность</span></div>
    <div><strong>{first && last && visits.length > 1 ? (last.pain-first.pain > 0 ? "+" : "") + String(last.pain-first.pain) : "—"}</strong><span>Изменение боли от первого визита</span></div>
  </div>;
}
export function ClinicalAdmin() {
  const [clients,setClients]=useState([]), [selected,setSelected]=useState(""),
    [card,setCard]=useState(null), [requests,setRequests]=useState([]),
    [note,setNote]=useState(NOTES[0]), [procedure,setProcedure]=useState(PROCEDURES[0]),
    [pain,setPain]=useState(4), [mobility,setMobility]=useState(65),
    [day,setDay]=useState(new Date().toISOString().slice(0,10)),
    [loading,setLoading]=useState(true), [error,setError]=useState(""), [notice,setNotice]=useState("");
  async function refresh() {
    try {
      const [c,r]=await Promise.all([api("/api/admin/clinical/clients"),api("/api/admin/clinical/requests")]);
      setClients(c.clients);setRequests(r.requests);
      const next=selected || c.clients[0]?.id || "";
      if(next){setSelected(next);setCard(await api("/api/admin/clinical/clients/"+next));}
      else setCard(null);
      setError("");
    } catch(e){setError(e.message);} finally{setLoading(false);}
  }
  useEffect(()=>{refresh();},[]);
  async function choose(id){setSelected(id);setError("");setNotice("");try{setCard(await api("/api/admin/clinical/clients/"+id));}catch(e){setError(e.message);}}
  async function create(label) {
    try { const c=await api("/api/admin/clinical/clients","POST",{label});await refresh();await choose(c.id);setNotice("Тестовая карта создана.");}
    catch(e){setError(e.message);}
  }
  async function saveVisit(e) {
    e.preventDefault(); if(!selected)return;
    try {
      await api("/api/admin/clinical/visits","POST",{clientId:selected,date:day,procedure,note,pain:Number(pain),mobility:Number(mobility)});
      await choose(selected);setNotice("Тестовая процедура добавлена.");
    } catch(e){setError(e.message);}
  }
  async function photoUpload(event, visitId) {
    const file=event.target.files?.[0];
    if(!file)return;
    if(file.size>1024*1024){setError("Фотография должна быть меньше 1 МБ.");return;}
    try{
      const raw=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("Не удалось прочитать файл."));reader.readAsDataURL(file);});
      await api("/api/admin/clinical/photos","POST",{clientId:selected,visitId,mime:file.type,base64:String(raw).split(",")[1]});
      await choose(selected);setNotice("Тестовое изображение сохранено.");
    }catch(e){setError(e.message);}finally{event.target.value="";}
  }
  async function changeStatus(id,status){
    try{await api("/api/admin/clinical/requests/"+id,"PATCH",{status});await refresh();setNotice("Статус тестовой заявки обновлён.");}
    catch(e){setError(e.message);}
  }
  async function exportBackup(){
    try{
      const data=await api("/api/admin/clinical/export");
      const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download="anna-clinical-demo-backup.json";a.click();URL.revokeObjectURL(url);
      setNotice("Архив синтетических данных выгружен. Проверьте сохранение файла.");
    }catch(e){setError(e.message);}
  }
  const unused=PERSONAS.filter(p=>!clients.some(c=>c.label===p));
  const visits=card?.visits||[];
  return <section className="clinical-root" aria-label="Демонстрационные карты клиентов">
    <div className="clinical-banner"><strong>Синтетический прототип</strong><p>Только демонстрационные персоны и показатели. Не вводите сведения реальных пациентов. Карты, изображения и экспорт закрыты авторизацией.</p></div>
    {loading&&<p role="status">Загрузка демоданных…</p>}
    {error&&<p role="alert" className="clinical-error">{error}</p>}
    {notice&&<p role="status" className="clinical-notice">{notice}</p>}
    <div className="clinical-actions">
      {unused.length>0&&<button className="admin-primary" onClick={()=>create(unused[0])}>Создать {unused[0]}</button>}
      <button type="button" onClick={exportBackup} className="clinical-secondary">Экспорт / резервная копия JSON</button>
      <a className="clinical-secondary" href="/demo/booking">Открыть тестовую запись</a>
    </div>
    <div className="clinical-grid">
      <aside className="clinical-people"><h2>Карты</h2>{clients.map(c=><button key={c.id} className={selected===c.id?"active":""} onClick={()=>choose(c.id)}>{c.label}</button>)}{clients.length===0&&<p className="clinical-hint">Создайте первую тестовую карту.</p>}</aside>
      <div className="clinical-main">
        {card?<><div className="clinical-card"><span className="clinical-label">Персональная карта · закрыто</span><h2>{card.client.label}</h2><Metrics visits={visits}/><h3>Динамика наблюдений</h3><Trend visits={visits}/></div>
          <div className="clinical-card"><h3>Добавить процедуру</h3><form onSubmit={saveVisit} className="clinical-form">
            <label>Дата<input type="date" required value={day} onChange={e=>setDay(e.target.value)}/></label>
            <label>Процедура<select value={procedure} onChange={e=>setProcedure(e.target.value)}>{PROCEDURES.map(x=><option key={x}>{x}</option>)}</select></label>
            <label>Наблюдение<select value={note} onChange={e=>setNote(e.target.value)}>{NOTES.map(x=><option key={x}>{x}</option>)}</select></label>
            <label>Боль: {pain}/10<input type="range" min="0" max="10" value={pain} onChange={e=>setPain(e.target.value)}/></label>
            <label>Подвижность: {mobility}%<input type="range" min="0" max="100" value={mobility} onChange={e=>setMobility(e.target.value)}/></label>
            <button type="submit" className="admin-primary">Сохранить процедуру</button>
          </form></div>
          <div className="clinical-card"><h3>История процедур</h3>{[...visits].reverse().map(v=><article className="clinical-visit" key={v.id}><div><strong>{v.date}</strong><span>{v.procedure}</span></div><p>{v.note}. Боль: {v.pain}/10; подвижность: {v.mobility}%.</p><label className="clinical-photo-button">Добавить тестовое фото<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>photoUpload(e,v.id)}/></label><div className="clinical-photos">{card.photos.filter(p=>p.visit_id===v.id).map(p=><img key={p.id} src={"/api/admin/clinical/photos/"+p.id} alt="Синтетическое фото процедуры" loading="lazy"/>)}</div></article>)}{!visits.length&&<p className="clinical-hint">Пока нет процедур.</p>}</div>
        </>:<div className="clinical-card"><p>Выберите тестовую карту в списке.</p></div>}
      </div>
    </div>
    <div className="clinical-card"><h2>Запросы на запись</h2>{requests.length?<div className="clinical-request-list">{requests.map(r=><div className="clinical-request" key={r.id}><div><strong>{r.persona}</strong><p>{formatDate(r.starts_at)} · {r.service_id}</p></div><label>Статус<select value={r.status} onChange={e=>changeStatus(r.id,e.target.value)}><option value="pending">Запрос</option><option value="confirmed">Подтверждён</option><option value="cancelled">Отменён</option></select></label></div>)}</div>:<p className="clinical-hint">Заявок пока нет. В демонстрационном режиме создайте запрос через форму записи.</p>}</div>
  </section>;
}

export function ClinicalPublic() {
  const [cfg,setCfg]=useState(null),[service,setService]=useState(""),[persona,setPersona]=useState(PERSONAS[0]),
    [day,setDay]=useState(""),[slots,setSlots]=useState([]),[selected,setSelected]=useState(""),
    [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{api("/api/demo/booking/config").then(c=>{setCfg(c);setService(c.services?.[0]?.id||"");}).catch(()=>setCfg({enabled:false}));},[]);
  useEffect(()=>{
    if(!cfg?.enabled||!service||!day){setSlots([]);return;}
    let active=true;setSelected("");
    api("/api/demo/booking/availability?"+new URLSearchParams({serviceId:service,date:day}))
      .then(data=>{if(active){setSlots(data.slots||[]);setError("");}})
      .catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[service,day,cfg?.enabled]);
  const time=s=>new Intl.DateTimeFormat("ru-RU",{timeZone:cfg?.timezone||"Europe/Moscow",hour:"2-digit",minute:"2-digit"}).format(new Date(s));
  async function submit(e){
    e.preventDefault();if(!selected)return;setBusy(true);setError("");setNotice("");
    try{
      await api("/api/demo/booking/requests","POST",{persona,serviceId:service,start:selected});
      setNotice("Тестовый запрос принят. Он не является реальной записью.");
      setSelected("");setSlots(current=>current.filter(x=>x.start!==selected));
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="clinical-booking"><span className="clinical-label">Анна Мысливцева · синтетический прототип</span><h1>Выберите время.</h1>
    <p className="clinical-lead">Проверка календаря и записи без передачи настоящих личных сведений. Все имена и услуги здесь вымышлены.</p>
    {cfg?.enabled===false?<p className="clinical-error">Демонстрационный модуль отключён на этом сервере.</p>:!cfg?<p role="status">Загрузка доступного времени…</p>:
    <form className="clinical-form" onSubmit={submit}>
      <label>Тестовая услуга<select value={service} onChange={e=>setService(e.target.value)}>{cfg.services.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      <label>Дата приёма<input type="date" required value={day} onChange={e=>setDay(e.target.value)} /></label>
      <label>Демонстрационная персона<select value={persona} onChange={e=>setPersona(e.target.value)}>{PERSONAS.map(p=><option key={p}>{p}</option>)}</select></label>
      <fieldset className="clinical-slots"><legend>Доступные часы ({cfg.timezone})</legend><div>{slots.map(s=><button type="button" key={s.start} className={selected===s.start?"chosen":""} aria-pressed={selected===s.start} onClick={()=>setSelected(s.start)}>{time(s.start)}</button>)}</div>{day&&!slots.length&&<p className="clinical-hint">На эту дату свободного времени нет.</p>}</fieldset>
      <button className="admin-primary" disabled={busy||!selected}>{busy?"Создание…":"Создать тестовую заявку"}</button>
    </form>}
    {error&&<p role="alert" className="clinical-error">{error}</p>}
    {notice&&<p role="status" className="clinical-notice">{notice}</p>}
    <p><a href="/contact">Вернуться к контактам</a></p>
  </section>;
}
