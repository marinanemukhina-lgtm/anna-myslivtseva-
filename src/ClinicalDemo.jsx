import { commercialDemo, summarizeCommercial } from "./clinicalCommercialDemo.mjs";
import React, { useState } from "react";

// Synthetic demonstration only. No patient data is persisted or transmitted.
const patients = [
  { id: "DEMO-001", name: "Пациент 001", since: "2023", visits: 6, scores: [7, 6, 5, 5, 3, 4], dates: ["Янв", "Мар", "Май", "Июл", "Сен", "Окт"], notes: ["Первичное наблюдение", "Повторное наблюдение", "Контроль динамики"] },
  { id: "DEMO-002", name: "Пациент 002", since: "2024", visits: 4, scores: [6, 5, 4, 3], dates: ["Фев", "Апр", "Июн", "Окт"], notes: ["Первичное наблюдение", "Повторный приём"] },
  { id: "DEMO-003", name: "Пациент 003", since: "2025", visits: 5, scores: [4, 4, 5, 3, 3], dates: ["Янв", "Мар", "Июн", "Авг", "Окт"], notes: ["Наблюдение", "Контрольный приём"] },
];
function Trend({ patient }) {
  const width = 520, height = 180, pad = 28;
  const points = patient.scores.map((v, i) => ({ x: pad + i * (width - 2 * pad) / Math.max(1, patient.scores.length - 1), y: height - pad - v * (height - 2 * pad) / 10, v }));
  return <svg role="img" aria-label={"Демонстрационный график оценок по шкале от 0 до 10: " + patient.scores.join(", ")} viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", maxWidth: 700 }}>
    {[0, 5, 10].map(n => <g key={n}><line x1={pad} x2={width-pad} y1={height-pad-n*(height-2*pad)/10} y2={height-pad-n*(height-2*pad)/10} stroke="#ded9d0"/><text x={3} y={height-pad-n*(height-2*pad)/10+4} fontSize="12" fill="#6e665c">{n}</text></g>)}
    <polyline fill="none" stroke="#76644d" strokeWidth="3" points={points.map(p => `${p.x},${p.y}`).join(" ")}/>
    {points.map((p,i) => <g key={i}><circle cx={p.x} cy={p.y} r="5" fill="#76644d"/><text x={p.x} y={height-7} fontSize="12" textAnchor="middle" fill="#6e665c">{patient.dates[i]}</text></g>)}
  </svg>;
}
export default function ClinicalDemo() {
  const [selected, setSelected] = useState(patients[0].id);
  const [tab, setTab] = useState("timeline");
  const [showCommercial, setShowCommercial] = useState(false);
  const patient = patients.find(p => p.id === selected);
  const commercial = commercialDemo[selected];
  const kpi = summarizeCommercial(commercial);
  const rub = n => new Intl.NumberFormat("ru-RU", {style:"currency",currency:"RUB",maximumFractionDigits:0}).format(n);
  return <main style={{minHeight:"100vh",background:"#f7f5f0",color:"#292620",fontFamily:"Inter,Arial,sans-serif",padding:"clamp(20px,5vw,64px)"}}>
    <div style={{maxWidth:1120,margin:"auto"}}>
      <a href="/" style={{color:"#675744"}}>← Вернуться на сайт</a> · <a href="/planner-demo" style={{color:"#675744"}}>Календарь и аналитика →</a>
      <p style={{fontSize:12,letterSpacing:2,textTransform:"uppercase",marginTop:36}}>Анна Мысливцева · концепт кабинета остеопата</p>
      <h1 style={{fontFamily:"Georgia,serif",fontSize:"clamp(32px,5vw,56px)",fontWeight:400,margin:"12px 0"}}>История наблюдений</h1>
      <p style={{maxWidth:760,lineHeight:1.7}}>Демонстрационная версия на вымышленных данных. Никакие медицинские сведения не загружаются, не сохраняются и не передаются серверу. Функция не предназначена для реальных пациентов.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:20,marginTop:32}}>
        <aside style={{background:"#ebe6dc",padding:24,borderRadius:18}}>
          <h2 style={{fontSize:17}}>Демонстрационные пациенты</h2>
          {patients.map(p=><button key={p.id} type="button" onClick={()=>{setSelected(p.id);setTab("timeline");}} style={{display:"block",width:"100%",textAlign:"left",padding:"14px",marginTop:10,borderRadius:10,border:p.id===selected?"2px solid #76644d":"1px solid #d6cfc2",background:p.id===selected?"#fff":"transparent",cursor:"pointer"}}><strong>{p.name}</strong><br/><small>{p.visits} наблюдений · с {p.since} года</small></button>)}
        </aside>
        <section style={{background:"#fff",padding:"clamp(20px,3vw,36px)",borderRadius:18,gridColumn:"span 2",minWidth:0}}>
          <p style={{fontSize:12,color:"#72695d"}}>{patient.id} · ТОЛЬКО ДЕМО</p>
          <h2 style={{fontFamily:"Georgia,serif",fontSize:32,fontWeight:400}}>{patient.name}</h2>
          <div style={{display:"flex",gap:20,flexWrap:"wrap",padding:"18px 0",borderBottom:"1px solid #ddd6cd"}}><span>Посещений: <b>{patient.visits}</b></span><span>Последняя оценка: <b>{patient.scores.at(-1)}/10</b></span><span>Наблюдение: <b>с {patient.since}</b></span></div>
          <div role="tablist" aria-label="Разделы карты" style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:24}}>
            {[["timeline","Динамика"],["notes","Записи"],["photos","Фотографии"],["commercial","Финансы и отношения"]].map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)} style={{padding:"10px 16px",borderRadius:24,border:"1px solid #d2c9bb",background:tab===id?"#302d29":"#fff",color:tab===id?"#fff":"#302d29",cursor:"pointer"}}>{label}</button>)}
          </div>
          {tab==="timeline"&&<div><h3>Оценка по шкале 0–10</h3><Trend patient={patient}/><p style={{fontSize:13,color:"#71685f"}}>Иллюстративные значения. Изменения показателя не доказывают эффективность процедуры.</p></div>}
          {tab==="notes"&&<div><h3>История посещений</h3>{patient.notes.map((n,i)=><p key={i} style={{borderBottom:"1px solid #eee",padding:"12px 0"}}><b>Запись {i+1}</b> · {n}<br/><small>Текст является демонстрационным. Реальных медицинских записей нет.</small></p>)}</div>}
          {tab==="commercial"&&<div><h3>Коммерческая история · демонстрация</h3><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:12}}>{[["Оплачено",rub(kpi.revenue)],["Средний чек",rub(kpi.average)],["Скидки",rub(kpi.discount)],["Прямые затраты",rub(kpi.directCosts)],["Маржинальный доход",rub(kpi.contribution)]].map(([label,value])=><div key={label} style={{background:"#f5f1ea",borderRadius:12,padding:14}}><small>{label}</small><div style={{fontSize:20,marginTop:8}}>{value}</div></div>)}</div><p style={{fontSize:13,color:"#71685f"}}>Маржинальный доход = фактически оплачено − прямые затраты. Общие расходы, налоги и стоимость времени Анны не учтены; это не чистая прибыль.</p><h3>История оплат</h3><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}><thead><tr><th>Визит</th><th>Стоимость</th><th>Оплата</th><th>Акция</th></tr></thead><tbody>{commercial.paid.map((paid,i)=><tr key={i} style={{borderTop:"1px solid #eee"}}><td style={{padding:9}}>{i+1}</td><td>{rub(commercial.prices[i])}</td><td>{rub(paid)}</td><td>{commercial.discounts[i]}</td></tr>)}</tbody></table></div><h3>Предпочтения и связь</h3><p><b>Удобное время:</b> {commercial.preference}</p><p><b>Заметка:</b> {commercial.note}</p><p><b>Отмены:</b> {commercial.cancellations}</p><p style={{fontSize:13,color:"#71685f"}}>Личные предпочтения — только добровольно сообщённые и относящиеся к обслуживанию сведения. Не использовать медицинские признаки для автоматического ранжирования клиентов.</p></div>}
          {tab==="photos"&&<div><h3>Сравнение фотографий</h3><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{["До","После"].map(s=><div key={s} style={{aspectRatio:"4/5",background:"#eeeae4",display:"grid",placeItems:"center",borderRadius:12,color:"#766f65"}}>{s} · место для снимка</div>)}</div><p style={{fontSize:13}}>Загрузка файлов отключена до создания защищённого хранилища и проверки правовых оснований.</p></div>}
        </section>
      </div>
    </div>
  </main>;
}
