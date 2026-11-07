import React from 'react';
export default function ClinicalGallery({visits,photos,angle,busy,onAdd,onReplace,onRemove}){
 const key=p=>p.id??`legacy:${p.visitId}:${p.angle}`;
 return <section className="clinical-card clinical-gallery"><h3>Галерея фотографий</h3>
  <p className="clinical-hint">Добавляйте столько тестовых снимков, сколько нужно. Объём ограничен хранилищем этого браузера. Выбранный ракурс: {angle}.</p>
  {[...visits].reverse().map(visit=>{
   const pictures=photos.filter(p=>p.visitId===visit.id);
   return <div className="clinical-gallery-visit" key={visit.id}>
    <h4>{visit.date} · {visit.procedure} · {pictures.length} фото</h4>
    <label className="clinical-photo-upload clinical-gallery-add">＋ Добавить фото<input type="file" accept="image/*" multiple disabled={busy} aria-label={`Добавить фото к посещению ${visit.date}`} onChange={e=>onAdd(e,visit.id,angle)}/></label>
    <div className="clinical-gallery-grid">{pictures.map(p=><figure className="clinical-gallery-photo" key={key(p)}>
     <img src={p.data} alt={`Тестовое фото ${p.angle} от ${visit.date}`} loading="lazy"/><figcaption>{p.angle}</figcaption>
     <label className="clinical-photo-upload">Заменить фото<input type="file" accept="image/*" disabled={busy} aria-label={`Заменить фото ${key(p)}`} onChange={e=>onReplace(e,visit.id,p.angle,p)}/></label>
     <button type="button" className="clinical-secondary" disabled={busy} onClick={()=>onRemove(p)}>Удалить фото</button>
    </figure>)}</div>
   </div>;
  })}
 </section>;
}
