import React, { useEffect, useRef, useState } from 'react';
import { bookingApi } from './booking-client.mjs';

// Require explicit UTC rather than interpreting an administrator's device zone.
function utc(value) {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) throw new Error('Укажите время в ISO UTC с секундами и Z, например 2026-11-06T09:00:00Z.');
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== text.replace('.000Z', 'Z')) throw new Error('Проверьте дату и время UTC.');
  return date.toISOString();
}
function TimeInput({ label, value, onChange }) {
  return <label className="admin-field"><span>{label}</span><input type="text" required aria-label={label} placeholder="ГГГГ-ММ-ДДTчч:мм:ссZ" value={value} onChange={event => onChange(event.target.value)} autoComplete="off" spellCheck={false} /></label>;
}
export default function AdminOccupancy({ blocked = false, onUnauthenticated, onSaved, onBusyChange }) {
  const [snapshot, setSnapshot] = useState(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [interval, setInterval] = useState({ start: '', end: '' });
  const [coverage, setCoverage] = useState({ start: '', end: '', verifiedUntil: '' }), [attested, setAttested] = useState(false);
  const [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const lock = useRef(false), pending = useRef(null);
  useEffect(() => { onBusyChange?.(busy || uncertain); return () => onBusyChange?.(false); }, [busy, uncertain, onBusyChange]);
  const fail = err => { setError(err.status === 409 ? `Данные изменились или действие конфликтует с расписанием. Обновите занятость и проверьте её. ${err.message}` : err.message); if (err.status === 401) onUnauthenticated?.(); if (err.status === 409) setConflict(true); };
  async function refresh() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const value = await bookingApi('/api/admin/booking/occupancy'); setSnapshot(value); setConflict(false);
      const operation = pending.current;
      if (operation && value.occupancy.records.some(record => record.operationKey === operation.body.operationKey)) {
        pending.current = null; setUncertain(false); setNotice('Операция найдена в сохранённых данных. Проверьте список занятости.');
      } else {
        // A refresh authorizes an explicit retry against the current version,
        // never a new operation key or a changed interval behind the user's back.
        if (operation) operation.body = { ...operation.body, expectedVersion: value.version };
        if (uncertain || conflict) {
          setUncertain(false); setNotice('Данные обновлены. Проверьте список перед повтором или изменением интервала.');
        }
      }
    } catch (err) { fail(err); }
    finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => { refresh(); }, []);
  async function write(url, method, body, reusable = false) {
    if (lock.current || blocked || conflict || !snapshot) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const previousVersion = body.expectedVersion;
    let committed = false;
    try {
      const result = await bookingApi(url, { method, body }); committed = true;
      if (reusable) pending.current = null;
      setUncertain(false);
      // Only the atomic write receipt proves which version this action replaced.
      // A later read may include somebody else's unrelated CMS changes.
      if (result.rebasedFromVersion === previousVersion && result.version === previousVersion + 1 && result.settings) onSaved?.(previousVersion, result);
      const value = await bookingApi('/api/admin/booking/occupancy'); setSnapshot(value);
      setAttested(false); setNotice('Занятость сохранена. Публичная онлайн-запись выключена.');
    } catch (err) {
      fail(err);
      if (committed || !err.status || err.status >= 500) {
        setUncertain(true);
        setError(committed ? 'Изменение сохранено, но обновить список не удалось. Обновите занятость перед следующим действием.' : 'Результат операции неизвестен. Сначала обновите занятость и проверьте список. При повторе интервала будет использован тот же ключ операции.');
      }
    } finally { lock.current = false; setBusy(false); }
  }
  function editInterval(key, value) { pending.current = null; setInterval(current => ({ ...current, [key]: value })); setNotice(''); }
  function addBusy(event) {
    event.preventDefault(); if (lock.current || uncertain) return;
    try {
      const start = utc(interval.start), end = utc(interval.end);
      if (end <= start) throw new Error('Конец занятого интервала должен быть позже начала.');
      if (!pending.current) pending.current = { body: { expectedVersion: snapshot.version, operationKey: crypto.randomUUID().replaceAll('-', ''), intervals: [{ start, end }] } };
      write('/api/admin/booking/busy', 'POST', pending.current.body, true);
    } catch (err) { fail(err); }
  }
  function saveCoverage(event) {
    event.preventDefault(); if (lock.current || uncertain) return;
    try {
      if (!attested) throw new Error('Подтвердите полноту сверки занятости.');
      const start = utc(coverage.start), end = utc(coverage.end), verifiedUntil = utc(coverage.verifiedUntil);
      if (end <= start) throw new Error('Конец проверенного периода должен быть позже начала.');
      const expires = Date.parse(verifiedUntil), now = Date.now();
      if (expires <= now || expires > now + 86400000) throw new Error('Срок актуальности должен быть в будущем и не более 24 часов от текущего момента.');
      write('/api/admin/booking/coverage', 'PUT', { expectedVersion: snapshot.version, start, end, verifiedUntil });
    } catch (err) { fail(err); }
  }
  const disabled = busy || blocked || uncertain || conflict || !snapshot;
  return <section className="admin-card" aria-label="Закрытая подготовка занятости">
    <div className="calendar-card-heading"><h2>Занятость: закрытая подготовка</h2><span className="status-pill">Онлайн-запись выключена</span></div>
    <div className="calendar-warning"><p>Это частная подготовка расписания. Публичная онлайн-запись выключена. Не вводите имена, контакты, заметки или другие данные пациентов.</p><p>Исходный файл .Shifter пока не поддерживается. Переносите только интервалы времени после сверки с исходным расписанием.</p></div>
    <p className="calendar-hint">Все поля и сохранённые интервалы показаны в UTC. Используйте ISO с секундами и суффиксом Z. Часовой пояс устройства не применяется.</p>
    {blocked && <p className="calendar-warning">Сначала сохраните изменения расписания.</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    {notice && <p role="status" className="admin-alert success">{notice}</p>}
    <button type="button" className="text-button" disabled={busy} onClick={refresh}>{busy ? 'Подождите…' : 'Обновить занятость'}</button>
    <form onSubmit={addBusy}><fieldset className="calendar-fieldset" disabled={disabled}><h3>Добавить занятый интервал</h3><div className="admin-fields">
      <TimeInput label="Занято с (ISO UTC)" value={interval.start} onChange={value => editInterval('start', value)} />
      <TimeInput label="Занято до (ISO UTC)" value={interval.end} onChange={value => editInterval('end', value)} />
    </div><button type="submit" className="admin-primary">Добавить занятость</button></fieldset></form>
    <form onSubmit={saveCoverage}><fieldset className="calendar-fieldset" disabled={disabled}><h3>Подтвердить сверенный период</h3>
      <p className="calendar-hint">Подтверждайте только период, для которого перенесена вся занятость из исходного расписания. Подтверждение актуально не более 24 часов.</p>
      <div className="admin-fields">{[['start', 'Проверено с (ISO UTC)'], ['end', 'Проверено до (ISO UTC)'], ['verifiedUntil', 'Актуально до (ISO UTC)']].map(([key, label]) => <TimeInput key={key} label={label} value={coverage[key]} onChange={value => { setCoverage(current => ({ ...current, [key]: value })); setAttested(false); }} />)}</div>
      <label className="publish-toggle"><input type="checkbox" checked={attested} onChange={event => setAttested(event.target.checked)} />Вся занятость за указанный период сверена и перенесена</label>
      <button type="submit" className="admin-primary" disabled={!attested}>Подтвердить сверку</button>
    </fieldset></form>
    <h3>Сохранённая занятость</h3>
    {snapshot ? <><p className="calendar-hint">{snapshot.occupancy.coverage ? `Сверенный период: ${snapshot.occupancy.coverage.start} — ${snapshot.occupancy.coverage.end}. Актуально до: ${snapshot.occupancy.coverage.verifiedUntil}.` : 'Полнота занятости пока не подтверждена.'}</p>
      {!snapshot.occupancy.records.length ? <p>Сохранённых интервалов нет. Это не означает, что время свободно.</p> : <ul>{snapshot.occupancy.records.map(record => <li key={record.id}><p>{record.type === 'reservation' ? 'Внутренний резерв, не подтверждённая запись пациента' : 'Занято'}: {record.occupiedStart || record.start} — {record.occupiedEnd || record.end} · {record.status === 'cancelled' ? 'Отменено' : 'Активно'}</p>{record.status === 'active' && <button type="button" className="text-button" disabled={disabled} aria-label={`Отменить интервал ${record.id}`} onClick={() => { if (window.confirm('Отменить этот интервал занятости? Это изменит расчёт свободного времени.')) write(`/api/admin/booking/records/${encodeURIComponent(record.id)}/cancel`, 'POST', { expectedVersion: snapshot.version }); }}>Отменить интервал</button>}</li>)}</ul>}</> : <p>Список занятости ещё не загружен.</p>}
  </section>;
}
