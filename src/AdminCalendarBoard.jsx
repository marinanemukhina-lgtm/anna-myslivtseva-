import React from 'react';
import {dateInZone} from './booking-client.mjs';
import {calendarCells,calendarDayStatus,calendarPeriod,shiftCalendarPeriod} from './calendar-period.mjs';
const DAYS=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
export default function AdminCalendarBoard({anchor,view,selectedDate,settings,timezone,occupancy,onNavigate,onSelectDate,onChangeView}){
 const period=calendarPeriod(anchor,view),cells=calendarCells(anchor,view);
 const move=step=>onNavigate(shiftCalendarPeriod(anchor,view,step));
 return <div className="owner-calendar-board">
  <div className="owner-calendar-controls">
   <div className="owner-calendar-modes" role="group" aria-label="Вид календаря">
    <button type="button" aria-pressed={view==='week'} onClick={()=>onChangeView('week')}>Неделя</button>
    <button type="button" aria-pressed={view==='month'} onClick={()=>onChangeView('month')}>Месяц</button>
   </div>
   <div className="owner-calendar-navigation">
    <button type="button" aria-label="Предыдущий период" onClick={()=>move(-1)}>‹</button>
    <h3 aria-live="polite">{period.label}</h3>
    <button type="button" aria-label="Следующий период" onClick={()=>move(1)}>›</button>
    <button type="button" onClick={()=>onNavigate(dateInZone(timezone||'UTC'))}>Сегодня</button>
   </div>
  </div>
  <div className="calendar-month owner-calendar-grid" role="group" aria-label={'Дни календаря, '+period.label}>
   {DAYS.map(day=><span key={day} className="calendar-weekday">{day}</span>)}
   {cells.map((date,i)=>{
    if(!date)return <span key={'pad-'+i} aria-hidden="true"/>;
    const item=calendarDayStatus(settings,date,occupancy,timezone);
    const occupancyLabel=item.occupiedCount===null?'занятость не загружена':'занятых интервалов '+item.occupiedCount;
    return <button type="button" key={date} className={'calendar-day'+(item.reception?' open':'')} aria-pressed={selectedDate===date}
      aria-label={date+': '+(item.reception?'часы приёма':'приём закрыт')+'; '+occupancyLabel} onClick={()=>onSelectDate(date)}>
      <strong>{Number(date.slice(-2))}</strong><small>{item.reception?'Часы':'Закрыто'}</small>
      {item.occupiedCount>0&&<span className="calendar-count" title={'Занятых интервалов: '+item.occupiedCount}>{item.occupiedCount}</span>}
    </button>;
   })}
  </div>
  <p className="calendar-hint">{occupancy===null?'Занятость пока не загружена. Часы приёма не означают свободное время.':'Цифры показывают занятые интервалы и внутренние резервы, не количество пациентов. Ноль не подтверждает свободное время.'}</p>
 </div>;
}
