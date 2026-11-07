import React from 'react';
export default function ClinicalPrint({client,visits,photos,showNotes,showPhotos}){
 return <section className="clinical-print-report">
  <div className="clinical-print-header"><p>АННА МЫСЛИВЦЕВА · ДЕМОНСТРАЦИЯ</p><h1>История посещений</h1><p>Только вымышленные данные. Не является медицинской документацией.</p></div>
  <h2>{client.label}</h2>
  {[...visits].reverse().map(v=><article key={v.id}>
   <h3>{v.date} · {v.procedure}</h3>
   {showNotes&&<p>{v.note||'Заметка отсутствует'}</p>}
   {showPhotos&&<div className="clinical-print-photos">{photos.filter(p=>p.visitId===v.id).map((p,i)=><figure key={p.id??p.angle}><img src={p.data} alt={p.angle+' '+v.date}/><figcaption>{p.angle} · фото №{i+1}</figcaption></figure>)}</div>}
  </article>)}
 </section>;
}
