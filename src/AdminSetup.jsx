import React, { useEffect, useRef, useState } from "react";
import { generateAdminPasswordHash } from "../shared/admin-password-hash.mjs";
import "./admin-setup.css";

export default function AdminSetup() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const working = useRef(false);
  const output = useRef(null);

  function clear() {
    requestId.current += 1;
    setPassword("");
    setConfirmation("");
    setResult("");
    setError("");
  }

  useEffect(() => {
    function resetRestoredPage(event) {
      if (event.persisted) clear();
    }
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", resetRestoredPage);
    return () => {
      requestId.current += 1;
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", resetRestoredPage);
    };
  }, []);

  async function generate() {
    if (working.current) return;
    setError("");
    setResult("");
    if (password.length < 12 || password.length > 256) {
      setError("Нужно от 12 до 256 символов.");
      return;
    }
    if (password !== confirmation) {
      setError("Пароли не совпадают. Повторите ввод.");
      return;
    }
    const id = ++requestId.current;
    working.current = true;
    setBusy(true);
    try {
      const value = await generateAdminPasswordHash(password);
      if (requestId.current !== id) return;
      setResult(value);
      setPassword("");
      setConfirmation("");
    } catch {
      if (requestId.current === id) {
        setError("Не удалось сформировать хеш. Откройте страницу по HTTPS в современном браузере и попробуйте ещё раз.");
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="admin-setup">
      <div className="admin-setup-shell">
        <a className="admin-setup-back" href="/admin">← Вход в панель</a>
        <header className="admin-setup-header">
          <p className="admin-setup-eyebrow">Настройка администратора</p>
          <h1>Подготовка пароля</h1>
          <p>Здесь можно получить значение ADMIN_PASSWORD_HASH для настройки сайта в Vercel.</p>
        </header>

        <aside className="admin-setup-notice" aria-label="Как работает страница">
          <strong>Вычисление происходит в этом браузере.</strong>
          <p>Страница не отправляет пароль и хеш на сервер и не сохраняет их в хранилище браузера. Настройки сайта изменятся только после того, как вы сами сохраните значение в Vercel и запустите новое развёртывание.</p>
          <p>Открывайте эту страницу на доверенном устройстве. Расширения браузера и программы на устройстве могут иметь доступ к введённым данным.</p>
        </aside>

        <section className="admin-setup-card" aria-labelledby="setup-input-title" aria-busy={busy}>
          <h2 id="setup-input-title">Выберите пароль</h2>
          <p id="setup-password-help">От 12 до 256 символов. Сохраните выбранный пароль у себя: для входа в панель понадобится именно он.</p>
          <div className="admin-setup-fields">
            <label>
              <span>Новый пароль</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                minLength={12}
                maxLength={256}
                value={password}
                disabled={busy}
                aria-describedby="setup-password-help"
                onChange={(event) => { setPassword(event.target.value); setResult(""); setError(""); }}
              />
            </label>
            <label>
              <span>Повторите пароль</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                minLength={12}
                maxLength={256}
                value={confirmation}
                disabled={busy}
                onChange={(event) => { setConfirmation(event.target.value); setResult(""); setError(""); }}
              />
            </label>
          </div>
          {error && <p className="admin-setup-error" role="alert">{error}</p>}
          <div className="admin-setup-actions">
            <button className="admin-setup-primary" type="button" disabled={busy} onClick={generate}>
              {busy ? "Вычисление…" : "Сформировать хеш"}
            </button>
            <button className="admin-setup-secondary" type="button" onClick={clear}>Очистить</button>
          </div>
          <p className="admin-setup-small">«Очистить» убирает значения со страницы. Полное удаление данных из памяти браузера не гарантируется; содержимое буфера обмена эта кнопка не меняет.</p>
        </section>

        {result && (
          <section className="admin-setup-card admin-setup-result" aria-labelledby="setup-result-title">
            <h2 id="setup-result-title">Значение готово</h2>
            <p role="status">Хеш сформирован. Поля пароля очищены.</p>
            <label>
              <span>Значение ADMIN_PASSWORD_HASH</span>
              <textarea ref={output} value={result} readOnly rows={5} autoComplete="off" spellCheck={false} />
            </label>
            <button className="admin-setup-secondary" type="button" onClick={() => { output.current?.focus(); output.current?.select(); }}>Выделить значение</button>
            <p className="admin-setup-small">Скопируйте выделенное значение вручную. Относитесь к нему как к секрету: не отправляйте в чат и не добавляйте в код или репозиторий.</p>
            <p>Для входа в панель на Vercel также нужно настроенное подключение к базе данных DATABASE_URL. Создание хеша пароля само по себе не подключает базу.</p>
            <ol>
              <li>В Vercel откройте свой проект → Settings → Environment Variables.</li>
              <li>Добавьте ADMIN_PASSWORD_HASH. Вставьте только значение из поля выше, без имени переменной и кавычек. Выберите нужное окружение, например Production.</li>
              <li>Сохраните переменную и запустите новое развёртывание сайта (Redeploy).</li>
              <li>После развёртывания откройте /admin и войдите с выбранным паролем.</li>
            </ol>
          </section>
        )}
        <p className="admin-setup-small">scrypt · @noble/hashes 2.0.1 · <a className="admin-setup-license" href="/licenses/noble-hashes-MIT.txt" target="_blank" rel="noreferrer">Лицензия MIT</a></p>
      </div>
    </main>
  );
}
