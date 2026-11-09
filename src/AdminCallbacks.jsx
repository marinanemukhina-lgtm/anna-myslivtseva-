import React, { useEffect, useRef, useState } from "react";

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
  let body;
  try { body = await response.json(); } catch {
    const error = new Error("Сервис вернул неожиданный ответ. Повторите обновление списка.");
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(body.error || "Не удалось загрузить обращения.");
    error.status = response.status;
    throw error;
  }
  return body;
}
export default function AdminCallbacks({ onUnauthenticated }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(null);
  const active = useRef(true);
  async function load(more = false) {
    if (pending.current) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    pending.current = controller; setBusy(true); setError("");
    try {
      const result = await request("/api/admin/callbacks" + (more && data?.nextCursor ? "?cursor=" + encodeURIComponent(data.nextCursor) : ""), { signal: controller.signal });
      if (active.current) setData(previous => ({ ...result, requests: more ? [...previous.requests, ...result.requests.filter(row => !previous.requests.some(old => old.id === row.id))] : result.requests }));
    } catch (failure) {
      if (active.current && failure.status === 401) onUnauthenticated();
      else if (active.current) setError(failure.name === "AbortError" ? "Загрузка заняла слишком много времени. Повторите обновление списка." : failure instanceof TypeError ? "Не удалось связаться с сервером. Повторите обновление списка." : failure.message);
    } finally { clearTimeout(timeout); if (pending.current === controller) pending.current = null; if (active.current) setBusy(false); }
  }
  useEffect(() => { active.current = true; load(); return () => { active.current = false; pending.current?.abort(); }; }, []);
  async function update(row) {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(""); setNotice("");
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await request("/api/admin/callbacks/" + encodeURIComponent(row.id), {
        method: "PATCH", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: row.status === "new" ? "done" : "new", version: row.version }),
      });
      if (active.current) {
        setData(previous => ({ ...previous, requests: previous.requests.map(value => value.id === row.id ? result.request : value) }));
        setNotice("Статус обращения сохранён.");
      }
    } catch (failure) {
      if (active.current && failure.status === 401) onUnauthenticated();
      else if (active.current) setError(failure.status === 409
        ? "Обращение изменилось в другой вкладке. Обновите список перед следующим действием."
        : "Не удалось подтвердить изменение. Обновите список и проверьте статус, прежде чем повторять.");
    } finally { clearTimeout(timeout); if (pending.current === controller) pending.current = null; if (active.current) setBusy(false); }
  }
  return <section className="admin-card callback-inbox" aria-label="Обращения на обратный звонок">
    <div className="callback-inbox-heading"><h2>Заявки</h2><button className="admin-primary" type="button" disabled={busy} onClick={() => load()}>Обновить список</button></div>
    {data && !data.enabled && <p className="admin-alert">Новые заявки не принимаются. {data.reason}</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!data ? <p role="status">{busy ? "Загружаем обращения…" : "Список пока не загружен."}</p> : <>
      {!data.requests.length && <p className="callback-empty">Заявок на обратный звонок пока нет.</p>}
      <ul className="callback-inbox-list">{data.requests.map(row => <li key={row.id}>
        <div><span className={"callback-status " + row.status}>{row.status === "new" ? "Ждёт звонка" : "Обработано"}</span><a className="callback-number" href={"tel:" + row.phone}>{row.phone}</a><time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString("ru-RU")}</time></div>
        <button className="admin-primary" disabled={busy} type="button" onClick={() => update(row)}>{row.status === "new" ? "Отметить обработанным" : "Вернуть в новые"}</button>
      </li>)}</ul>
      {data.nextCursor && <button type="button" className="admin-primary" disabled={busy} onClick={() => load(true)}>Загрузить ещё</button>}
    </>}
    <details className="callback-inbox-help"><summary>Как обрабатываются заявки</summary><p>Номера хранятся на сервере и доступны только владельцу. Автоматические уведомления и сообщения посетителям не отправляются: проверяйте этот список.</p><p>Обращения удаляются из рабочего списка после 30 дней при следующем обращении к сервису. Не добавляйте сюда медицинские сведения.</p></details>
  </section>;
}
