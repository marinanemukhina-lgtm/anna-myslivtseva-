import React, { useEffect, useRef, useState } from "react";
import "./admin-setup.css";
import "./owner-claim.css";

const uncertainMessage = "Не удалось подтвердить результат. Пароль мог сохраниться. Сначала попробуйте войти в панель с выбранным паролем. Не отправляйте приглашение повторно, пока результат не выяснен.";

export default function OwnerClaim() {
  const [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const fields = useRef([]);
  const working = useRef(false);
  const sequence = useRef(0);
  const unresolved = useRef(false);
  const submission = useRef(null);

  function clearFields() {
    for (const field of fields.current) if (field) field.value = "";
  }

  function cancel() {
    clearFields();
    setError("");
    if (working.current || unresolved.current) {
      sequence.current += 1;
      submission.current?.abort();
      unresolved.current = true;
      working.current = false;
      setBusy(false);
      setOutcome("uncertain");
    }
  }

  useEffect(() => {
    let disposed = false;
    let statusRequest = 0;
    async function readStatus() {
      const request = ++statusRequest;
      setStatus("loading");
      try {
        const response = await fetch("/api/owner-handoff", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("status unavailable");
        const value = await response.json();
        if (disposed || request !== statusRequest) return;
        setStatus(value.enabled === true && value.configured === true && typeof value.complete === "boolean" ? (value.complete ? "complete" : "ready") : "unavailable");
      } catch {
        if (!disposed && request === statusRequest) setStatus("unavailable");
      }
    }
    function hide() {
      cancel();
      statusRequest += 1;
    }
    function restore(event) {
      clearFields();
      if (event.persisted && !unresolved.current) readStatus();
    }
    clearFields();
    readStatus();
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      disposed = true;
      sequence.current += 1;
      submission.current?.abort();
      clearFields();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, []);

  async function redeem() {
    if (working.current || unresolved.current || status !== "ready" || outcome) return;
    setError("");
    const invitation = fields.current[0].value.trim().toLowerCase();
    const password = fields.current[1].value;
    const confirmation = fields.current[2].value;
    if (!/^[a-f0-9]{64}$/i.test(invitation)) {
      setError("Введите код приглашения из 64 символов: цифр и букв от a до f.");
      return;
    }
    if (password.length < 12 || password.length > 256) {
      setError("В пароле должно быть от 12 до 256 символов.");
      return;
    }
    if (password !== confirmation) {
      setError("Пароли не совпадают. Повторите ввод.");
      return;
    }
    const id = ++sequence.current;
    working.current = true;
    unresolved.current = true;
    setBusy(true);
    const controller = new AbortController();
    submission.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    // An explicit button click is the only path to this mutation. Never retry it.
    try {
      const response = await fetch("/api/owner-handoff/redeem", {
        signal: controller.signal, method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitation, password }),
      });
      const value = await response.json();
      if (sequence.current !== id) return;
      clearFields();
      if (response.ok && value.complete === true && value.loginRequired === true) {
        unresolved.current = false;
        setOutcome("success");
      } else if ((response.status === 400 && value.code === "INVALID_INPUT") || (response.status === 409 && value.code === "INVALID_INVITATION") || (response.status === 429 && value.code === "RATE_LIMITED")) {
        unresolved.current = false;
        setError(value.code === "INVALID_INVITATION"
          ? "Приглашение недействительно или уже использовано. Если вы уже отправляли его, сначала попробуйте войти с выбранным паролем. Иначе запросите новое приглашение у человека, который готовит передачу сайта."
          : value.code === "RATE_LIMITED" ? "Слишком много попыток. Подождите, прежде чем вводить данные снова."
          : "Сервер отклонил данные. Проверьте код и требования к паролю и введите их заново.");
      } else {
        // Unknown/proxy/malformed responses cannot establish whether a write committed.
        setOutcome("uncertain");
      }
    } catch {
      if (sequence.current === id) {
        clearFields();
        setOutcome("uncertain");
      }
    } finally {
      window.clearTimeout(timeout);
      if (submission.current === controller) submission.current = null;
      if (sequence.current === id) {
        working.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <main className="admin-setup owner-claim">
      <div className="admin-setup-shell">
        <a className="admin-setup-back" href="/admin" onClick={cancel}>← Вход в панель</a>
        <header className="admin-setup-header">
          <p className="admin-setup-eyebrow">Доступ владельца</p>
          <h1>Задайте свой пароль</h1>
          <p>Эта страница предназначена для владельца сайта с отдельным кодом приглашения.</p>
        </header>
        <aside className="admin-setup-notice" aria-label="Как работает приглашение">
          <p>Введите код вручную или вставьте его в поле ниже. Не добавляйте код в адрес страницы и не отправляйте его вместе с паролем в сообщениях.</p>
          <p>После нажатия «Сохранить пароль» код и пароль будут переданы серверу этого сайта. Страница не записывает их в хранилище браузера. Сохраните пароль в своём менеджере паролей.</p>
        </aside>
        {outcome === "success" ? <section className="admin-setup-card" role="status">
          <h2>Пароль сохранён</h2><p>Теперь войдите в панель с новым паролем.</p>
          <a className="admin-setup-primary owner-claim-login" href="/admin">Перейти ко входу</a>
        </section> : outcome === "uncertain" ? <section className="admin-setup-card" role="alert">
          <h2>Проверьте вход</h2><p>{uncertainMessage}</p>
          <a className="admin-setup-primary owner-claim-login" href="/admin">Перейти ко входу</a>
        </section> : status === "loading" ? <p role="status">Проверяем доступность настройки…</p>
          : status === "unavailable" ? <section className="admin-setup-card" role="status"><h2>Настройка по приглашению недоступна</h2><p>Обратитесь к человеку, который готовит передачу сайта. Эта страница не создаёт приглашения.</p></section>
          : status === "complete" ? <section className="admin-setup-card" role="status"><h2>Пароль владельца уже настроен</h2><p>Для работы с сайтом перейдите ко входу в панель.</p><a href="/admin">Перейти ко входу</a></section>
          : <form className="admin-setup-card" autoComplete="off" onSubmit={(event) => event.preventDefault()} aria-busy={busy}>
            <div className="admin-setup-fields">
              <label><span>Код приглашения</span><input ref={(node) => { fields.current[0] = node; }} type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" disabled={busy} aria-describedby="owner-claim-code-help" /></label>
              <p className="admin-setup-small" id="owner-claim-code-help">Одноразовый код из 64 символов, полученный отдельно от адреса сайта.</p>
              <label><span>Новый пароль</span><input ref={(node) => { fields.current[1] = node; }} type="password" autoComplete="new-password" disabled={busy} aria-describedby="owner-claim-password-help" /></label>
              <p className="admin-setup-small" id="owner-claim-password-help">От 12 до 256 символов. Используйте уникальный пароль.</p>
              <label><span>Повторите пароль</span><input ref={(node) => { fields.current[2] = node; }} type="password" autoComplete="new-password" disabled={busy} /></label>
            </div>
            {error && <p className="admin-setup-error" role="alert">{error}</p>}
            <div className="admin-setup-actions">
              <button className="admin-setup-primary" type="button" disabled={busy} onClick={redeem}>{busy ? "Сохраняем…" : "Сохранить пароль"}</button>
              <button className="admin-setup-secondary" type="button" onClick={cancel}>Отменить и очистить</button>
            </div>
            {busy && <p role="status">Дождитесь ответа. Не закрывайте страницу и не отправляйте код повторно.</p>}
          </form>}
      </div>
    </main>
  );
}
