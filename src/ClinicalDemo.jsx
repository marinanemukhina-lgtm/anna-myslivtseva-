import React, { useState } from 'react';
import { PERSONAS, NOTES, PROCEDURES, clinicalStateSchema, emptyClinicalDemo, exampleClinicalDemo, addDemoClient, addDemoVisit } from '../shared/clinical-demo.mjs';
import './clinical-demo.css';
const STORAGE = 'anna-open-synthetic-clinical-v1';
function initial() {
  try { const saved = localStorage.getItem(STORAGE); return saved ? clinicalStateSchema.parse(JSON.parse(saved)) : exampleClinicalDemo(); }
  catch { return exampleClinicalDemo(); }
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

export default function ClinicalDemo() {
  const [state, setState] = useState(initial), [selected, setSelected] = useState(() => initial().clients[0]?.id ?? '');
  const [day, setDay] = useState('2026-11-06'), [procedure, setProcedure] = useState(PROCEDURES[0]), [note, setNote] = useState(NOTES[0]);
  const [pain, setPain] = useState(4), [mobility, setMobility] = useState(65), [message, setMessage] = useState('');
  const client = state.clients.find(c => c.id === selected), visits = state.visits.filter(v => v.clientId === selected);
  const unused = PERSONAS.filter(p => !state.clients.some(c => c.label === p));
  function save(next, notice) {
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); setMessage(notice + ' Сохранено в этом браузере.'); }
    catch { setMessage(notice + ' Память браузера недоступна: после закрытия страницы изменения исчезнут.'); }
    setState(next);
  }
  function create() {
    try { const next = addDemoClient(state, unused[0]); save(next, 'Тестовая карта создана.'); setSelected(next.clients.at(-1).id); }
    catch { setMessage('Не удалось добавить тестовую карту. Проверьте список.'); }
  }
  function visit(event) {
    event.preventDefault();
    try { save(addDemoVisit(state, { clientId: selected, date: day, procedure, note, pain: Number(pain), mobility: Number(mobility) }), 'Тестовая процедура добавлена.'); }
    catch { setMessage('Проверьте дату и показатели. Допускаются только тестовые данные.'); }
  }
  function example() { const next = exampleClinicalDemo(); save(next, 'Пример восстановлен.'); setSelected(next.clients[0].id); }
  function clear() { if (!confirm('Очистить только тестовые карты в этом браузере?')) return; save(emptyClinicalDemo(), 'Тестовые карты очищены.'); setSelected(''); }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type:'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'anna-synthetic-histories.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="clinical-shell">
    <nav className="clinical-nav" aria-label="Разделы демонстрации"><a href="/">Сайт Анны</a><a href="/admin">Админка</a><a href="/demo/booking">Онлайн-запись · демо</a></nav>
    <h1>Пациенты и истории</h1>
    <p className="clinical-lead">Открытый демонстрационный кабинет. Все карты и показатели вымышлены. Пароль не нужен.</p>
    <div className="clinical-banner">Здесь можно посмотреть пример, добавить тестовую карту и вести историю процедур. Изменения сохраняются только в этом браузере и не передаются на сервер. Это отдельный пример работы кабинета, не общая база пациентов.</div>
    <div className="clinical-actions">
      {unused.length > 0 && <button className="admin-primary" onClick={create}>Создать {unused[0]}</button>}
      <button className="clinical-secondary" onClick={download}>Скачать тестовые истории</button>
      <button className="clinical-secondary" onClick={clear}>Начать с пустого кабинета</button>
      {!state.clients.length && <button className="clinical-secondary" onClick={example}>Показать пример истории</button>}
    </div>
    <p role="status" className="clinical-status">{message}</p>
    <div className="clinical-grid">
      <aside className="clinical-people"><h2>Карты</h2>{state.clients.map(c => <button key={c.id} className={selected === c.id ? 'active' : ''} onClick={() => { setSelected(c.id); setMessage(''); }}>{c.label}</button>)}{!state.clients.length && <p>Кабинет пуст. Создайте тестовую карту.</p>}</aside>
      <div className="clinical-main">{client ? <>
        <section className="clinical-card"><h2>{client.label}</h2><p>Вымышленный пример истории посещений</p><Metrics visits={visits}/><h3>Динамика наблюдений</h3><Trend visits={visits}/></section>
        <section className="clinical-card"><h3>Добавить процедуру</h3><form onSubmit={visit} className="clinical-form">
          <label>Дата<input type="date" value={day} required onChange={e => setDay(e.target.value)}/></label>
          <label>Процедура<select value={procedure} onChange={e => setProcedure(e.target.value)}>{PROCEDURES.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Наблюдение<select value={note} onChange={e => setNote(e.target.value)}>{NOTES.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Боль: {pain}/10<input type="range" min="0" max="10" value={pain} onChange={e => setPain(e.target.value)}/></label>
          <label>Подвижность: {mobility}%<input type="range" min="0" max="100" value={mobility} onChange={e => setMobility(e.target.value)}/></label>
          <button className="admin-primary" type="submit">Сохранить процедуру</button>
        </form></section>
        <section className="clinical-card"><h3>История процедур</h3>{[...visits].sort((a,b) => b.date.localeCompare(a.date)).map(v => <article className="clinical-visit" key={v.id}><div><strong>{v.date}</strong><span>{v.procedure}</span></div><p>{v.note}. Боль: {v.pain}/10; подвижность: {v.mobility}%.</p></article>)}{!visits.length && <p>Пока нет процедур.</p>}</section>
      </> : <section className="clinical-card"><h2>Начните с тестовой карты</h2><p>После добавления процедуры здесь появятся история и графики.</p></section>}</div>
    </div>
  </main>;
}
