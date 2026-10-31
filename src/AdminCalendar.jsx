import React, { useEffect, useRef, useState } from 'react';
import { bookingApi, dateInZone, formatAppointment, prepareScheduleDraft } from './booking-client.mjs';
import './calendar.css';
const weekdays = [[1, 'Понедельник'], [2, 'Вторник'], [3, 'Среда'], [4, 'Четверг'], [5, 'Пятница'], [6, 'Суббота'], [0, 'Воскресенье']];
const monthBounds = month => {
  const [year, number] = month.split('-').map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}` };
};
function Field({ label, value, onChange, type = 'text', min, max, hint, required = false }) {
  return <label className="admin-field"><span>{label}</span><input aria-label={label} type={type} value={value ?? ''} required={required} min={min} max={max} onChange={event => onChange(type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />{hint && <small>{hint}</small>}</label>;
}
function Windows({ value, onChange, label }) {
  const update = (index, key, next) => onChange(value.map((item, i) => i === index ? { ...item, [key]: next } : item));
  return <div className="calendar-windows"><p className="calendar-window-label">{label}</p>{!value.length && <p className="calendar-hint">Приём закрыт</p>}{value.map((window, index) => <div className="calendar-interval" key={index}>
    <div className="calendar-window">
      <label><span className="visually-hidden">{label}: начало {index + 1}</span><input type="time" required value={window.start} onChange={event => update(index, 'start', event.target.value)} /></label>
      <span aria-hidden="true">—</span><label><span className="visually-hidden">{label}: конец {index + 1}</span><input type="time" required disabled={window.end === '24:00'} value={window.end === '24:00' ? '' : window.end} onChange={event => update(index, 'end', event.target.value)} /></label>
      <button type="button" className="calendar-remove" onClick={() => onChange(value.filter((_, i) => i !== index))} aria-label={`${label}: убрать интервал ${index + 1}`}>Убрать</button>
    </div>
    <label className="calendar-endofday"><input type="checkbox" checked={window.end === '24:00'} onChange={event => update(index, 'end', event.target.checked ? '24:00' : '')} />До конца дня (24:00)<span className="visually-hidden">: {label}, интервал {index + 1}</span></label>
  </div>)}<button type="button" className="text-button" onClick={() => onChange([...value, { start: '', end: '' }])}>Добавить интервал<span className="visually-hidden">: {label}</span></button></div>;
}
export default function AdminCalendar({ services, onDirtyChange, onUnauthenticated, onSaved, onBusyChange }) {
  const [snapshot, setSnapshot] = useState(null), [settings, setSettings] = useState(null), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [month, setMonth] = useState(dateInZone('UTC').slice(0, 7)), [selectedDate, setSelectedDate] = useState('');
  const [previewService, setPreviewService] = useState(''), [previewSlots, setPreviewSlots] = useState([]), [previewTimezone, setPreviewTimezone] = useState(''), [slotsLoading, setSlotsLoading] = useState(false), [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const handleError = err => { setError(err.message); if (err.status === 401) onUnauthenticated(); };
  const read = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { const value = await bookingApi('/api/admin/booking'); setSnapshot(value); setSettings(value.settings); setDirty(false); setError(''); setNotice(''); setRefresh(current => current + 1); }
    catch (err) { handleError(err); }
    finally { lock.current = false; setBusy(false); }
  };
  useEffect(() => { read(); }, []);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => {
    setPreviewSlots([]); setPreviewTimezone(''); setSlotsLoading(false);
    if (!previewService || !selectedDate || dirty) return;
    const controller = new AbortController(); setSlotsLoading(true);
    bookingApi(`/api/admin/booking/availability?${new URLSearchParams({ serviceId: previewService, date: selectedDate })}`, { signal: controller.signal })
      .then(value => { setPreviewSlots(value.slots); setPreviewTimezone(value.timezone); }).catch(err => { if (err.name !== 'AbortError') handleError(err); })
      .finally(() => { if (!controller.signal.aborted) setSlotsLoading(false); });
    return () => controller.abort();
  }, [previewService, selectedDate, dirty, refresh]);
  function edit(update) { setSettings(current => { const next = structuredClone(current); update(next); return next; }); setDirty(true); setNotice(''); }
  async function save(event) {
    event.preventDefault(); if (lock.current) return;
    setError(''); setNotice('');
    let validated;
    try {
      validated = prepareScheduleDraft(settings);
    } catch (err) { setError(err.message); return; }
    lock.current = true; setBusy(true);
    try {
      const value = await bookingApi('/api/admin/booking', { method: 'PUT', body: { settings: validated, version: snapshot.version } });
      setSnapshot(current => ({ ...current, ...value })); setSettings(value.settings); setDirty(false);
      setNotice('Расписание сохранено. Онлайн-запись остаётся закрытой.'); setRefresh(value => value + 1); onSaved?.(snapshot.version, value);
    } catch (err) { handleError(err); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!settings) return <section className="admin-card">{error ? <><p role="alert" className="admin-error">{error}</p><button type="button" className="text-button" onClick={read}>Повторить загрузку</button></> : <p role="status">Загрузка календаря…</p>}</section>;
  const catalog = snapshot.serviceCatalog || services;
  const override = settings.overrides.find(item => item.date === selectedDate);
  const overrideMode = !override ? 'weekly' : override.closed ? 'closed' : 'custom';
  const days = monthBounds(month).to.slice(-2) * 1;
  const offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const updateOverride = (mode, windows = []) => edit(next => { next.overrides = next.overrides.filter(item => item.date !== selectedDate); if (mode !== 'weekly') next.overrides.push({ date: selectedDate, closed: mode === 'closed', windows: mode === 'closed' ? [] : windows }); });
  return <div className="admin-calendar">
    {error && <div className="admin-alert admin-error" role="alert">{error}{dirty && <button type="button" className="text-button" onClick={() => { if (confirm('Загрузить сохранённое расписание? Несохранённые изменения будут потеряны.')) read(); }}>Загрузить сохранённое расписание</button>}</div>}
    {notice && <p className="admin-alert success" role="status">{notice}</p>}

    <form onSubmit={save}>
      <fieldset disabled={busy} className="calendar-fieldset">
        <section className="admin-card">
          <div className="calendar-card-heading"><h2>Онлайн-запись</h2><span className="status-pill">Запись закрыта</span></div>
          <div className="calendar-warning"><p>Здесь можно подготовить расписание. Приём клиентских записей пока закрыт: способ записи и безопасное хранение данных ещё не настроены.</p><p>Сохранение часов не включает запись и не создаёт бронирований.</p></div>
          <div className="admin-fields"><Field label="Часовой пояс" value={settings.timezone} onChange={value => edit(next => { next.timezone = value; })} hint="Укажите IANA-пояс места приёма, например Europe/Moscow. Он не выбран автоматически." />
            <Field label="Запись вперёд, дней" type="number" min={1} max={365} value={settings.horizonDays} onChange={value => edit(next => { next.horizonDays = value; })} />
            <Field label="Шаг времени, минут" type="number" min={5} max={120} value={settings.slotStepMinutes} onChange={value => edit(next => { next.slotStepMinutes = value; })} />
            <Field label="Минимум до приёма, минут" type="number" min={0} max={43200} value={settings.minNoticeMinutes} onChange={value => edit(next => { next.minNoticeMinutes = value; })} />
</div>
        </section>
        <section className="admin-card"><h2>Услуги для записи</h2><p className="calendar-hint">Название и публикация услуги задаются во вкладке «Услуги и цены». Длительность приёма и перерыв укажите здесь в минутах.</p>
          {!catalog.length && <p>Сначала добавьте настоящие услуги во вкладке «Услуги и цены».</p>}
          {catalog.map(service => {
            const config = settings.services.find(item => item.serviceId === service.id) || { serviceId: service.id, durationMinutes: '', bufferMinutes: 0, enabled: false };
            const update = (key, value) => edit(next => { let target = next.services.find(item => item.serviceId === service.id); if (!target) { target = { ...config }; next.services.push(target); } target[key] = value; });
            return <div className="calendar-service" key={service.id}><h3>{service.title || "Услуга без названия"}{!service.published && <small className="calendar-draft"> · Черновик</small>}</h3><label className="publish-toggle"><input type="checkbox" checked={config.enabled} onChange={event => update('enabled', event.target.checked)} />Включить в расписание</label><div className="admin-fields"><Field label={`Длительность: ${service.title}`} type="number" min={5} max={720} value={config.durationMinutes} required={config.enabled} onChange={value => update('durationMinutes', value)} /><Field label={`Перерыв после: ${service.title}`} type="number" min={0} max={240} value={config.bufferMinutes} onChange={value => update('bufferMinutes', value)} /></div></div>;
          })}
        </section>
        <section className="admin-card"><h2>Обычная неделя</h2><p className="calendar-hint">Оставьте выходные без интервалов. Если приём только в отдельные дни, оставьте всю неделю закрытой и откройте нужные даты ниже.</p><div className="calendar-week">{weekdays.map(([day, label]) => <Windows key={day} label={label} value={settings.weeklyHours[day] || []} onChange={value => edit(next => { next.weeklyHours[day] = value; })} />)}</div></section>
        <section className="admin-card"><h2>Отдельные дни</h2><p className="calendar-hint">Выберите дату, чтобы закрыть её или оставить только удобные часы. Эти правила заменяют обычную неделю только для выбранной даты.</p>
          <Field label="Месяц календаря" type="month" value={month} onChange={value => { if (/^\d{4}-\d{2}$/.test(value)) { setMonth(value); setSelectedDate(''); } }} />
          <div className="calendar-month" role="group" aria-label="Дни месяца">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}{Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: days }, (_, index) => {
            const date = `${month}-${String(index + 1).padStart(2, '0')}`, rule = settings.overrides.find(item => item.date === date);
            const day = new Date(`${date}T12:00:00Z`).getUTCDay(), open = rule ? !rule.closed && rule.windows.length > 0 : !!settings.weeklyHours[day]?.length;
            return <button type="button" key={date} aria-pressed={selectedDate === date} aria-label={`${date}, ${open ? 'приём открыт' : 'выходной'}`} className={open ? 'calendar-day open' : 'calendar-day'} onClick={() => setSelectedDate(date)}><strong>{index + 1}</strong><small>{open ? 'Приём' : 'Закрыто'}</small></button>;
          })}</div>
          <Field label="Выбранная дата" type="date" value={selectedDate} onChange={value => { setSelectedDate(value); if (value) setMonth(value.slice(0, 7)); }} />
          {selectedDate && <div className="calendar-date-editor"><label className="admin-field"><span>Режим дня</span><select value={overrideMode} onChange={event => updateOverride(event.target.value)}><option value="weekly">По обычной неделе</option><option value="closed">Выходной: закрыть день</option><option value="custom">Только выбранные часы</option></select></label>{overrideMode === 'custom' && <Windows label={`Приём ${selectedDate}`} value={override.windows} onChange={value => updateOverride('custom', value)} />}</div>}
        </section>
        <div className="calendar-save"><span>{dirty ? 'Расписание ещё не сохранено' : 'Расписание сохранено'}</span><button type="submit" className="admin-primary" disabled={!dirty || busy}>{busy ? 'Сохраняем…' : 'Сохранить расписание'}</button></div>
      </fieldset>
    </form>
    <section className="admin-card calendar-preview"><h2>Проверить свободное время</h2><p className="calendar-hint">Предварительный расчёт по сохранённому расписанию. Это не запись: клиентские данные не собираются, время не бронируется.</p>
      <label className="admin-field"><span>Услуга для проверки</span><select value={previewService} onChange={event => setPreviewService(event.target.value)}><option value="">Выберите услугу</option>{catalog.filter(service => settings.services.some(item => item.serviceId === service.id && item.enabled)).map(service => <option key={service.id} value={service.id}>{service.title}</option>)}</select></label>
      <p className="calendar-hint">Дата: {selectedDate || 'выберите день в календаре выше'}. Часовой пояс: {previewTimezone || settings.timezone || 'не задан'}.</p>
      {previewTimezone && previewTimezone !== settings.timezone && <div className="calendar-warning" role="alert">Часовой пояс был изменён в другой вкладке. Предпросмотр показан в {previewTimezone}. <button type="button" className="text-button" onClick={read}>Загрузить сохранённое расписание</button></div>}
      {dirty ? <p>Сначала сохраните расписание, чтобы проверить время.</p> : slotsLoading ? <p role="status">Рассчитываем время…</p> : !previewService || !selectedDate ? <p>Выберите услугу и дату.</p> : previewSlots.length ? <ul className="calendar-preview-slots">{previewSlots.map(slot => <li key={slot.start}>{formatAppointment(slot.start, previewTimezone || settings.timezone)}</li>)}</ul> : <p>На эту дату нет доступных интервалов. Проверьте часы, длительность услуги и минимальное время до приёма.</p>}
    </section>
  </div>;
}
