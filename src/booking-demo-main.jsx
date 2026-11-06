import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserBookingClient } from './booking-demo-client.mjs';
import '@fontsource/cormorant-garamond/cyrillic-500.css';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-500.css';
import './booking-demo.css';

const messages = {
  SOURCE_NOT_VERIFIED: 'Актуальность занятости не подтверждена. Свободное время не показываем.',
  STALE_VERSION: 'Расписание изменилось. Обновите время и проверьте выбор.',
  WINDOW_BUSY: 'Это время уже занято. Обновите список.',
  TERMINAL_REQUEST: 'Резерв уже отменён или истёк. Создайте новый.',
  HOLD_EXPIRED: 'Срок резерва истёк. Обновите интервалы.',
  SCHEDULE_CHANGED: 'Условия приёма изменились. Отмените резерв и выберите время заново.',
  OUTSIDE_VERIFIED_COVERAGE: 'Выбранный период не сверён с источником занятости.',
  IDEMPOTENCY_CONFLICT: 'Этот запрос уже использован с другим выбором.',
};
const labels = { pending: 'Время зарезервировано', confirmed: 'Демо-запись подтверждена', cancelled: 'Демо-запись отменена', expired: 'Срок резерва истёк' };
const time = value => new Intl.DateTimeFormat('ru', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const key = () => [...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2, '0')).join('');
export function Demo({ transport = 'http' }) {
  const client = React.useRef(null);
  if (transport === 'browser' && !client.current) client.current = createBrowserBookingClient();
  React.useEffect(() => () => client.current?.close(), []);
  const [session, setSession] = React.useState(''), [config, setConfig] = React.useState(null);
  const [mode, setMode] = React.useState('fresh'), [service, setService] = React.useState('demo-60');
  const [persona, setPersona] = React.useState('Демо-клиент 001'), [available, setAvailable] = React.useState(null);
  const [selected, setSelected] = React.useState(''), [receipt, setReceipt] = React.useState(null);
  const [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const [availabilityExpired, setAvailabilityExpired] = React.useState(false);
  const operation = React.useRef(null);
  async function api(path, body, sessionOverride = session) {
    if (transport === 'browser') {
      try { return await client.current.call(path, body, sessionOverride); }
      catch (error) { if (messages[error.code]) error.message = messages[error.code]; throw error; }
    }
    const response = await fetch(`/api/demo/booking/${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Session': sessionOverride }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) { const error = Error(messages[data.code] ?? `Запрос не выполнен (${data.code}).`); error.definite = response.status < 500; throw error; }
    return data;
  }
  async function run(fn) { setBusy(true); setMessage(''); try { await fn(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  React.useEffect(() => { let current = true;
    setSession(''); setConfig(null); setAvailable(null); setReceipt(null); setSelected(''); setUncertain(false); operation.current = null;
    run(async () => { const s = await api('session', { mode }, ''); const c = await api('config', null, s.session); if (current) { setSession(s.session); setConfig(c); } });
    return () => { current = false; };
  }, [mode]);
  React.useEffect(() => {
    setAvailabilityExpired(false);
    if (!available?.ready) return;
    const delay = Math.max(0, Date.parse(available.validUntil) - Date.parse(available.observedAt));
    const timer = setTimeout(() => setAvailabilityExpired(true), delay);
    return () => clearTimeout(timer);
  }, [available]);
  async function refresh() {
    const result = await api(`availability?serviceId=${service}&date=${config.date}`);
    setAvailable(result); setSelected(''); operation.current = null;
    if (receipt) { const state = await api('requests'); const r = state.requests.find(x => x.id === receipt.id); if (r) setReceipt(r); }
    if (!result.ready) setMessage(messages[result.reason] ?? 'Время пока недоступно.');
  }
  async function reserve() {
    if (!operation.current) operation.current = { expectedVersion: available.version, operationKey: key(), persona, serviceId: service, date: config.date, start: selected };
    try { setReceipt(await api('reserve', operation.current)); setUncertain(false); }
    catch (error) {
      if (error.definite) { setUncertain(false); operation.current = null; setAvailable(null); setSelected(''); throw error; }
      setUncertain(true); throw Error(`${error.message} Повторите этот же запрос кнопкой ниже; результат предыдущего запроса пока не подтверждён.`);
    }
  }
  async function change(action) {
    setReceipt(await api(action, { id: receipt.id, expectedVersion: receipt.version })); setAvailable(null); setSelected('');
  }
  const active = ['pending','confirmed'].includes(receipt?.status);
  return <main>
    <header><a href="/">Анна Мысливцева</a><a href="/admin">Админка</a><a href="/admin/patients">Истории · демо</a></header>
    <div className="demo-intro"><h1>Проверяем запись</h1><p>Только вымышленные клиенты и услуги. Эта демонстрация не создаёт настоящий приём.</p></div>
    <section className="demo-workspace" aria-label="Демонстрация записи">
      <div className="demo-controls">
        <h2>Выберите время</h2>
        <label>Состояние источника<select disabled={busy || active || uncertain} value={mode} onChange={e => setMode(e.target.value)}><option value="fresh">Занятость сверена</option><option value="stale">Подтверждение просрочено</option><option value="incomplete">Сведения неполные</option></select></label>
        <label>Тестовый клиент<select disabled={busy || active || uncertain} value={persona} onChange={e => { setPersona(e.target.value); operation.current = null; }}>{(config?.personas ?? [persona]).map(p => <option key={p}>{p}</option>)}</select></label>
        <label>Услуга<select disabled={busy || active || uncertain} value={service} onChange={e => { setService(e.target.value); setAvailable(null); setSelected(''); operation.current = null; }}>{(config?.services ?? []).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <p>7 ноября 2026 · время Москвы<br/>Перерыв после приёма: 15 минут.</p>
        <button className="primary" disabled={busy || !session || uncertain} onClick={() => run(refresh)}>{busy ? 'Проверяем…' : 'Обновить свободное время'}</button>
      </div>
      <div className="demo-result">
        <h2>{receipt ? labels[receipt.status] : 'Свободные интервалы'}</h2>
        {!available && !receipt && <p>Запросите актуальные интервалы. Отсутствие сведений не означает свободное время.</p>}
        {available?.ready && !active && <><p>{availabilityExpired ? 'Список времени устарел. Обновите интервалы.' : `Проверено в ${time(available.observedAt)}. Перед резервом сервер проверит занятость повторно.`}</p><div className="slots" role="group" aria-label="Свободное время">{!availabilityExpired && available.slots.map(s => <button key={s.start} disabled={busy || uncertain} aria-pressed={selected === s.start} onClick={() => { setSelected(s.start); operation.current = null; }}>{time(s.start)}</button>)}</div>{!available.slots.length && <p>В проверенном расписании свободных интервалов нет.</p>}<button className="primary" disabled={!selected || busy || (availabilityExpired && !uncertain)} onClick={() => run(reserve)}>{uncertain ? 'Повторить тот же запрос' : 'Зарезервировать на 5 минут'}</button></>}
        {receipt && <div className="receipt"><p><strong>{receipt.persona}</strong><br/>{time(receipt.start)}–{time(receipt.end)} · 7 ноября</p>{receipt.status === 'pending' && <p>Резерв ожидает вашего подтверждения. Пять минут — тестовое правило этого демо.</p>}<div className="actions">{receipt.status === 'pending' && <button className="primary" disabled={busy} onClick={() => run(() => change('confirm'))}>Подтвердить демо-запись</button>}{active && <button disabled={busy} onClick={() => run(() => change('cancel'))}>Отменить демо-запись</button>}</div>{['cancelled','expired'].includes(receipt.status) && <p>Чтобы выбрать время снова, обновите интервалы.</p>}</div>}
        <p role="status" aria-live="polite" className="status">{message}</p>
      </div>
    </section>
    <footer>{transport === 'browser' ? 'Демо работает только в этой вкладке. Обновление страницы сбросит тестовые записи. Это не проверка общего серверного хранилища. ' : 'Данные хранятся в памяти тестового сервера и исчезают после его перезапуска. '}Условные часы демо: 6 ноября, 09:00 МСК + время работы приложения. Медицинские карты не подключены.</footer>
  </main>;
}
if (window.location.pathname.endsWith('/booking-demo.html')) createRoot(document.getElementById('root')).render(<Demo />);
