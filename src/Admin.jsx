import React, { useEffect, useRef, useState } from "react";
import { mergeSavedPayload } from "../shared/admin-save.mjs";
import { useSite } from "./App.jsx";
import "./admin.css";
import { profileDraft, socialChannels } from "../shared/anna-materials.mjs";
import AdminCalendar from "./AdminCalendar.jsx";
import AdminCallbacks from "./AdminCallbacks.jsx";
import { mergeScheduleSave } from "./booking-client.mjs";
const tabs = [
  ["profile", "О себе и сайт"],
  ["social", "Соцсети"],
  ["callbacks", "Обратные звонки"],
  ["calendar", "Календарь и запись"],
  ["services", "Услуги и цены"],
  ["news", "Новости"],
  ["offers", "Акции"],
  ["diplomas", "Дипломы"],
];
async function api(url, method = "GET", body) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    const e = new Error(data.error || "Не удалось выполнить действие.");
    e.status = r.status;
    throw e;
  }
  return data;
}
function Field({
  label,
  value,
  onChange,
  textarea = false,
  type = "text",
  hint,
  required = false,
  disabled = false,
  autoComplete,
}) {
  return (
    <label className={"admin-field " + (textarea ? "wide" : "")}>
      <span>{label}</span>
      {textarea ? (
        <textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
        />
      ) : (
        <input
          type={type}
          value={value ?? ""}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          onChange={(e) =>
            onChange(
              type === "number" ? Number(e.target.value) : e.target.value,
            )
          }
        />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Upload({ value, onChange, pdf = false }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="admin-upload">
      <label>
        <span>
          {busy ? "Загрузка…" : value ? "Заменить файл" : "Загрузить файл"}
        </span>
        <input
          type="file"
          disabled={busy}
          accept={
            pdf
              ? "image/jpeg,image/png,image/webp,application/pdf"
              : "image/jpeg,image/png,image/webp"
          }
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError("");
            if (file.size > 3 * 1024 * 1024) {
              setError("Максимальный размер — 3 МБ.");
              return;
            }
            setBusy(true);
            try {
              const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve(String(reader.result).split(",")[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              const data = await api("/api/media", "POST", {
                base64,
                type: file.type,
                name: file.name,
              });
              onChange(
                data.url,
                data.type === "application/pdf" ? "pdf" : "image",
              );
            } catch (err) {
              setError(err.message || "Не удалось загрузить файл.");
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      <small>JPG, PNG, WebP{pdf ? ", PDF" : ""} · до 3 МБ</small>
      {value && (
        <>
          <a href={value} target="_blank" rel="noreferrer">
            Открыть файл
          </a>
          <button
            type="button"
            className="text-button"
            onClick={() => onChange("", "image")}
          >
            Убрать
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
    </div>
  );
}
export default function Admin() {
  const { navigate, load } = useSite();
  const editRevision = useRef(0);
  const sessionRequest = useRef(false);
  const ownerLoginButton = useRef(null);
  const ownerLoginForm = useRef(null);
  const [ownerLoginOpen, setOwnerLoginOpen] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [calendarDirty, setCalendarDirty] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [contentOnlyAccess, setContentOnlyAccess] = useState(false);
  const [temporaryCalendarAccess, setTemporaryCalendarAccess] = useState(false);
  const visibleTabs = tabs.filter(([key]) => !(contentOnlyAccess && key === "callbacks") && !(contentOnlyAccess && !temporaryCalendarAccess && key === "calendar"));
  const [auth, setAuth] = useState(null),
    [configured, setConfigured] = useState(true),
    [password, setPassword] = useState(""),
    [payload, setPayload] = useState(null),
    [tab, setTab] = useState(() => tabs.some(([key]) => key === location.hash.slice(1)) ? location.hash.slice(1) : "profile"),
    [selected, setSelected] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const read = async () => {
    const d = await api("/api/admin/content");
    setPayload(d);
    setDirty(false);
  };
  useEffect(() => {
    api("/api/session")
      .then(async (r) => {
        setAuth(r.authenticated || r.temporaryContentAccess);
        setContentOnlyAccess(Boolean(r.temporaryContentAccess && !r.authenticated));
        setTemporaryCalendarAccess(Boolean(r.temporaryCalendarAccess && !r.authenticated));
        setConfigured(r.configured);
        if (r.authenticated || r.temporaryContentAccess) await read();
      })
      .catch((e) => {
        setAuth(false);
        setError(e.message);
      });
  }, []);
  useEffect(() => {
    if (!dirty && !calendarDirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, calendarDirty]);
  useEffect(() => {
    if (ownerLoginOpen) ownerLoginForm.current?.querySelector("input, button")?.focus();
  }, [ownerLoginOpen]);
  const closeOwnerLogin = () => {
    if (sessionRequest.current) return;
    setOwnerLoginOpen(false);
    setPassword("");
    setLoginError("");
    ownerLoginButton.current?.focus();
  };
  const login = async (e) => {
    e.preventDefault();
    if (sessionRequest.current || busy || calendarBusy || !configured) return;
    if (calendarDirty && !confirm("Войти и загрузить расписание владельца? Несохранённые изменения расписания будут потеряны.")) return;
    sessionRequest.current = true;
    setSessionBusy(true);
    setLoginError("");
    setError("");
    try {
      await api("/api/session", "POST", { password });
      setPassword("");
      const session = await api("/api/session");
      if (!session.authenticated) throw Error("Не удалось подтвердить вход. Попробуйте войти ещё раз.");
      setConfigured(session.configured);
      // Keep the editor's draft and version, including edits made during login.
      // Calendar data is fetched separately, only after password verification.
      if (!payload) await read();
      setContentOnlyAccess(false);
      setTemporaryCalendarAccess(false);
      setAuth(true);
      setOwnerLoginOpen(false);
    } catch (err) {
      setLoginError(err.message);
    } finally {
      sessionRequest.current = false;
      setSessionBusy(false);
    }
  };
  const logout = async () => {
    if (sessionRequest.current || busy || calendarBusy) return;
    if ((dirty || calendarDirty) && !confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
    sessionRequest.current = true;
    setSessionBusy(true);
    setError("");
    setLoginError("");
    // Hide private data as soon as the owner confirms logout, including when
    // a failed response leaves the server-side session outcome uncertain.
    setAuth(null);
    setContentOnlyAccess(false);
    setTemporaryCalendarAccess(false);
    setOwnerLoginOpen(false);
    setPassword("");
    setPayload(null);
    setDirty(false);
    setCalendarDirty(false);
    setCalendarBusy(false);
    setTab("profile");
    setSelected(null);
    setNotice("");
    let signedOut = false;
    try {
      await api("/api/session", "DELETE");
      signedOut = true;
      // Temporary access can change between login and logout. Ask the server.
      const session = await api("/api/session");
      setConfigured(session.configured);
      const canEdit = Boolean(session.authenticated || session.temporaryContentAccess);
      setContentOnlyAccess(Boolean(session.temporaryContentAccess && !session.authenticated));
      setTemporaryCalendarAccess(Boolean(session.temporaryCalendarAccess && !session.authenticated));
      if (canEdit) await read();
      setAuth(canEdit);
    } catch (err) {
      setAuth(false);
      setContentOnlyAccess(false);
      setTemporaryCalendarAccess(false);
      if (signedOut) {
        setError("Вы вышли. Не удалось проверить доступ к редактору. Обновите страницу.");
      } else {
        setError("Не удалось подтвердить выход. Обновите страницу и проверьте сеанс.");
      }
    } finally {
      sessionRequest.current = false;
      setSessionBusy(false);
    }
  };
  const change = (mutate) => {
    editRevision.current += 1;
    setPayload((p) => {
      const next = structuredClone(p);
      mutate(next.data);
      return next;
    });
    setDirty(true);
    setNotice("");
  };
  const changeProfile = (key, value) =>
    change((d) => {
      d.profile[key] = value;
    });
  const item =
    payload && tab !== "profile" && tab !== "calendar" && tab !== "social" && tab !== "callbacks"
      ? payload.data[tab].find((x) => x.id === selected)
      : null;
  const changeItem = (key, value) =>
    change((d) => {
      const x = d[tab].find((x) => x.id === selected);
      if (x) x[key] = value;
    });
  const save = async (e) => {
    e?.preventDefault();
    if (busy || sessionRequest.current) return;
    const submitted = payload;
    const submittedRevision = editRevision.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const k of ["services", "news", "offers", "diplomas"])
        if (payload.data[k].some((x) => x.published && !x.title.trim()))
          throw Error("У опубликованной записи должно быть название.");
      const result = await api("/api/admin/content", "PUT", payload);
      const hasNewEdits = editRevision.current !== submittedRevision;
      setPayload((current) => mergeSavedPayload(current, submitted, result));
      setDirty(hasNewEdits);
      setNotice(hasNewEdits
        ? "Предыдущие изменения сохранены. Новые правки ещё не сохранены."
        : "Сохранено. Опубликованные записи уже видны на сайте.");
      load();
    } catch (err) {
      setError(err.message);
      if (err.status === 401) setAuth(false);
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    const id = crypto.randomUUID();
    const base = { id, title: "", body: "", image: "", published: false };
    const extra =
      tab === "services"
        ? { price: "", duration: "", category: "" }
        : tab === "news"
          ? { date: "" }
          : tab === "offers"
            ? { price: "", until: "", conditions: "" }
            : { issuer: "", year: "", fileType: "image" };
    change((d) => {
      d[tab].push({ ...base, ...extra });
    });
    setSelected(id);
  };
  if (auth === null)
    return (
      <div className="admin-login">
        <p>Открываем панель…</p>
      </div>
    );
  if (!auth)
    return (
      <div className="admin-login">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="admin-brand"
        >
          Анна Мысливцева
        </a>
        <form onSubmit={login}>
          <span className="eyebrow">Панель управления</span>
          <h1>Вход.</h1>
          {configured ? (
            <>
              <Field
                label="Пароль"
                type="password"
                value={password}
                onChange={setPassword}
                required
                disabled={sessionBusy}
                autoComplete="current-password"
              />
              <button className="admin-primary" disabled={sessionBusy}>
                {sessionBusy ? "Входим…" : "Войти"}
              </button>
            </>
          ) : (
            <p>
              Доступ ещё не настроен. <a href="/admin/setup">Подготовьте пароль</a> и сохраните его хеш в настройках проекта Vercel.
            </p>
          )}
          {(loginError || error) && (
            <p role="alert" className="admin-error">
              {loginError || error}
            </p>
          )}
        </form>
        <a href="/">Вернуться на сайт</a>
      </div>
    );
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <a href="/" target="_blank" rel="noreferrer" className="admin-brand">
          Анна
          <br />
          Мысливцева
        </a>
        <a
          href="/admin/patients"
          className="admin-primary admin-patients-link"
          aria-disabled={busy || calendarBusy || sessionBusy}
          onClick={(event) => {
            if (busy || calendarBusy || sessionBusy) { event.preventDefault(); return; }
            if ((dirty || calendarDirty) && !confirm("Есть несохранённые изменения. Перейти в истории пациентов без сохранения?")) event.preventDefault();
          }}
        >
          Истории пациентов <span aria-hidden="true">→</span>
        </a>
        <a className="admin-marketing-link" href="/admin/marketing" onClick={(event) => {
          if (busy || calendarBusy || sessionBusy) { event.preventDefault(); return; }
          if ((dirty || calendarDirty) && !confirm("Есть несохранённые изменения. Перейти в маркетинг без сохранения?")) event.preventDefault();
        }}>Маркетинг и прогрев <span aria-hidden="true">→</span></a>
        <span className="eyebrow">Управление сайтом</span>
        <nav>
          {visibleTabs.map(([key, label]) => (
            <button
              key={key}
              disabled={calendarBusy || sessionBusy}
              className={tab === key ? "active" : ""}
              onClick={() => {
                if (calendarDirty && key !== tab && !confirm("Есть несохранённое расписание. Перейти без сохранения?")) return;
                setTab(key);
                history.replaceState(null, "", "#" + key);
                setSelected(null);
                setError("");
              }}
            >
              {label}
              {payload && key !== "profile" && key !== "calendar" && key !== "social" && key !== "callbacks" && (
                <span>{payload.data[key].length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <a href="/demo/booking" target="_blank" rel="noreferrer">Демо онлайн-записи</a>
          <a href="/" target="_blank" rel="noreferrer">
            Открыть сайт
          </a>
          {contentOnlyAccess ? <button
            type="button"
            ref={ownerLoginButton}
            aria-expanded={ownerLoginOpen}
            aria-controls="owner-login"
            disabled={busy || calendarBusy || sessionBusy || !payload}
            onClick={() => {
              setOwnerLoginOpen(true);
              setLoginError("");
            }}
          >
            Вход владельца
          </button> : <button
            disabled={busy || calendarBusy || sessionBusy}
            onClick={logout}
          >
            {sessionBusy ? "Выходим…" : "Выйти"}
          </button>}
        </div>
      </aside>
      <main className="admin-main">
        {contentOnlyAccess && <div role="status" className="admin-alert admin-error">
          Временный открытый доступ: любой посетитель может менять материалы сайта.
          Не добавляйте конфиденциальные сведения. {temporaryCalendarAccess ? "Рабочие часы тоже доступны всем для изменения. Занятость и проверка свободного времени доступны только владельцу по паролю. Онлайн-запись закрыта." : "Календарь и запись остаются закрытыми."}
          Чтобы вернуть защиту, владелец должен отключить временный доступ и повторно развернуть сайт.
        </div>}
        {contentOnlyAccess && ownerLoginOpen && <form
          id="owner-login"
          ref={ownerLoginForm}
          className="admin-card"
          aria-labelledby="owner-login-title"
          onSubmit={login}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeOwnerLogin();
            }
          }}
        >
          <h2 id="owner-login-title">Вход владельца</h2>
          {configured ? <>
            <p>Введите существующий пароль владельца. Занятость и проверка свободного времени откроются только после проверки пароля. Правки материалов останутся в редакторе.</p>
            <Field
              label="Пароль"
              type="password"
              value={password}
              onChange={setPassword}
              required
              disabled={sessionBusy}
              autoComplete="current-password"
            />
          </> : <p>
            Защищённый вход ещё не настроен. Занятость и проверка свободного времени недоступны. После настройки пароля и подключения хранилища обновите страницу.
          </p>}
          {loginError && <p role="alert" className="admin-error">{loginError}</p>}
          <div className="editor-actions">
            {configured && <button className="admin-primary" disabled={sessionBusy || busy}>
              {sessionBusy ? "Входим…" : "Войти"}
            </button>}
            <button type="button" className="text-button" disabled={sessionBusy} onClick={closeOwnerLogin}>
              Отмена
            </button>
          </div>
        </form>}
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">
              {tab === "callbacks" ? "Защищённые обращения" : tab === "calendar" ? "Подготовка расписания" : dirty
                ? "Есть несохранённые изменения"
                : "Все изменения сохранены"}
            </span>
            <h1>{tabs.find((t) => t[0] === tab)?.[1]}</h1>
          </div>
          {tab !== "calendar" && tab !== "callbacks" && <button
            className="admin-primary"
            onClick={save}
            disabled={busy || sessionBusy || !dirty || !payload}
          >
            {busy ? "Сохраняем…" : "Сохранить изменения"}
          </button>}
        </header>
        {error && (
          <div role="alert" className="admin-alert admin-error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="admin-alert success">
            {notice}
          </div>
        )}
        {!payload ? (
          <p>Загрузка…</p>
        ) : tab === "callbacks" ? (
          contentOnlyAccess ? <p>Обращения доступны только владельцу после входа по паролю.</p> : <AdminCallbacks onUnauthenticated={() => setAuth(false)} />
        ) : tab === "calendar" ? (
          <AdminCalendar key={temporaryCalendarAccess ? "temporary" : "owner"} temporaryCalendarAccess={temporaryCalendarAccess} services={payload.data.services} onDirtyChange={setCalendarDirty} onBusyChange={setCalendarBusy} onUnauthenticated={() => setAuth(false)} onSaved={(previousVersion, saved) => setPayload(current => mergeScheduleSave(current, previousVersion, saved))} />
        ) : tab === "social" ? (
          <section className="admin-card">
            <h2>Соцсети Анны</h2>
            <p>Адреса страниц и каналов. Сохранение ссылки не подключает аккаунт и не включает отправку сообщений.</p>
            <div className="admin-fields">
              {socialChannels.map(([key,label]) => <Field key={key} label={label + " · ссылка"} type="url"
                value={payload.data.profile.socialLinks?.[key] ?? ""}
                onChange={value => changeProfile("socialLinks", {...payload.data.profile.socialLinks, [key]:value})}
                hint={payload.data.profile.socialLinks?.[key] ? "Ссылка указана в редакторе. Автопостинг не подключён." : "Адрес пока не указан."}/>)}
              <Field label="Основная ссылка на соцсеть" type="url" value={payload.data.profile.socialUrl} onChange={value => changeProfile("socialUrl",value)} hint="Эта ссылка используется в публичных контактах сайта."/>
            </div>
            <p><a href="/admin/marketing">Перейти к маркетинговому плану</a></p>
          </section>
        ) : tab === "profile" ? (
          <form className="profile-form" onSubmit={save}>
            <section className="admin-card">
              <h2>Личная информация</h2>
              {(!payload.data.profile.intro || !payload.data.profile.about) && <div className="admin-prepared-copy">
                <h3>Подготовленное описание · для проверки</h3>
                <p>{profileDraft.intro}</p><p>{profileDraft.about}</p><small>{profileDraft.source}</small>
                <button type="button" className="text-button" onClick={() => change(d => {
                  if (!d.profile.intro) d.profile.intro=profileDraft.intro;
                  if (!d.profile.about) d.profile.about=profileDraft.about;
                })}>Заполнить пустые поля этим текстом</button>
                <p>Текст попадёт в редактор. Публикация — после кнопки «Сохранить изменения».</p>
              </div>}
              <div className="admin-fields">
                <Field
                  label="Имя и фамилия"
                  value={payload.data.profile.name}
                  onChange={(v) => changeProfile("name", v)}
                />
                <Field
                  label="Специализация"
                  value={payload.data.profile.role}
                  onChange={(v) => changeProfile("role", v)}
                />
                <Field
                  label="Краткая подпись на первом экране"
                  value={payload.data.profile.tagline}
                  onChange={(v) => changeProfile("tagline", v)}
                />
                <div className="admin-field">
                  <span>Главная фотография</span>
                  <div className="portrait-preview">
                    <img
                      src={
                        payload.data.profile.portrait ||
                        "/media/anna-portrait.jpg"
                      }
                      alt="Главная фотография"
                    />
                  </div>
                  <Upload
                    value={payload.data.profile.portrait}
                    onChange={(v) => changeProfile("portrait", v)}
                  />
                </div>
                <Field
                  label="Положение фото по вертикали, от 0 до 100"
                  type="number"
                  value={payload.data.profile.heroPosition}
                  onChange={(v) => changeProfile("heroPosition", v)}
                  hint="0 — верх кадра, 50 — центр, 100 — низ."
                />
                <Field
                  label="Вступление на главной странице"
                  textarea
                  value={payload.data.profile.intro}
                  onChange={(v) => changeProfile("intro", v)}
                />
                <Field
                  label="О себе"
                  textarea
                  value={payload.data.profile.about}
                  onChange={(v) => changeProfile("about", v)}
                />
                <Field
                  label="Образование и квалификация"
                  textarea
                  value={payload.data.profile.qualification}
                  onChange={(v) => changeProfile("qualification", v)}
                />
                <Field
                  label="О подходе"
                  textarea
                  value={payload.data.profile.philosophy}
                  onChange={(v) => changeProfile("philosophy", v)}
                />
                <Field
                  label="Дополнительный текст на главной"
                  textarea
                  value={payload.data.profile.approach}
                  onChange={(v) => changeProfile("approach", v)}
                />
              </div>
            </section>
            <section className="admin-card">
              <h2>Контакты и запись</h2>
              <div className="admin-fields">
                {[
                  ["phone", "Телефон"],
                  ["email", "Электронная почта"],
                  ["address", "Адрес"],
                  ["bookingUrl", "Ссылка на онлайн-запись"],
                  ["mapUrl", "Ссылка на карту"],
                  ["socialUrl", "Социальная сеть"],
                ].map(([k, label]) => (
                  <Field
                    key={k}
                    label={label}
                    value={payload.data.profile[k]}
                    onChange={(v) => changeProfile(k, v)}
                    type={
                      k === "email"
                        ? "email"
                        : k.includes("Url")
                          ? "url"
                          : "text"
                    }
                  />
                ))}
                <Field
                  label="Часы приёма"
                  textarea
                  value={payload.data.profile.hours}
                  onChange={(v) => changeProfile("hours", v)}
                  hint="Каждый день или период — с новой строки."
                />
              </div>
            </section>
            <section className="admin-card">
              <h2>Документы сайта</h2>
              <div className="admin-fields">
                <Field
                  label="Конфиденциальность"
                  textarea
                  value={payload.data.profile.privacy}
                  onChange={(v) => changeProfile("privacy", v)}
                />
                <Field
                  label="Условия использования"
                  textarea
                  value={payload.data.profile.terms}
                  onChange={(v) => changeProfile("terms", v)}
                />
              </div>
            </section>
            <button className="admin-primary" disabled={!dirty || busy}>
              Сохранить изменения
            </button>
          </form>
        ) : (
          <div className="admin-content-grid">
            <section className="admin-items">
              <button className="admin-add" onClick={add}>
                Добавить{" "}
                {tab === "services"
                  ? "услугу"
                  : tab === "news"
                    ? "новость"
                    : tab === "offers"
                      ? "акцию"
                      : "диплом"}
              </button>
              {payload.data[tab].length ? (
                payload.data[tab].map((x, i) => (
                  <button
                    key={x.id}
                    className={
                      "admin-item " + (selected === x.id ? "selected" : "")
                    }
                    onClick={() => setSelected(x.id)}
                  >
                    <span className="admin-item-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <strong>{x.title || "Без названия"}</strong>
                      <small>
                        {x.published ? "Опубликовано" : "Черновик"}
                        {x.price ? " · " + x.price : ""}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <p className="admin-empty">
                  Пока нет записей. Нажмите «Добавить».
                </p>
              )}
            </section>
            {item ? (
              <section className="admin-card editor-card">
                <div className="editor-toolbar">
                  <span
                    className={
                      "status-pill " + (item.published ? "published" : "")
                    }
                  >
                    {item.published ? "Публикация" : "Черновик"}
                  </span>
                  <button
                    className="admin-danger"
                    onClick={() => {
                      if (
                        confirm(
                          "Удалить запись? Изменение применится после сохранения.",
                        )
                      ) {
                        change((d) => {
                          d[tab] = d[tab].filter((x) => x.id !== selected);
                        });
                        setSelected(null);
                      }
                    }}
                  >
                    Удалить
                  </button>
                </div>
                <div className="admin-fields">
                  <Field
                    label={tab === "services" ? "Название услуги" : "Заголовок"}
                    value={item.title}
                    onChange={(v) => changeItem("title", v)}
                  />
                  {tab === "services" && (
                    <>
                      <Field
                        label="Цена"
                        value={item.price}
                        onChange={(v) => changeItem("price", v)}
                        hint="Например: 3 000 ₽ или от 3 000 ₽"
                      />
                      <Field
                        label="Длительность"
                        value={item.duration}
                        onChange={(v) => changeItem("duration", v)}
                      />
                      <Field
                        label="Категория"
                        value={item.category}
                        onChange={(v) => changeItem("category", v)}
                      />
                    </>
                  )}
                  {tab === "news" && (
                    <Field
                      label="Дата публикации"
                      type="date"
                      value={item.date}
                      onChange={(v) => changeItem("date", v)}
                    />
                  )}{" "}
                  {tab === "offers" && (
                    <>
                      <Field
                        label="Цена или предложение"
                        value={item.price}
                        onChange={(v) => changeItem("price", v)}
                      />
                      <Field
                        label="Действует до"
                        type="date"
                        value={item.until}
                        onChange={(v) => changeItem("until", v)}
                      />
                    </>
                  )}
                  {tab === "diplomas" && (
                    <>
                      <Field
                        label="Учебное заведение"
                        value={item.issuer}
                        onChange={(v) => changeItem("issuer", v)}
                      />
                      <Field
                        label="Год"
                        value={item.year}
                        onChange={(v) => changeItem("year", v)}
                      />
                    </>
                  )}
                  <Field
                    label="Текст"
                    textarea
                    value={item.body}
                    onChange={(v) => changeItem("body", v)}
                  />
                  {tab === "offers" && (
                    <Field
                      label="Условия акции"
                      textarea
                      value={item.conditions}
                      onChange={(v) => changeItem("conditions", v)}
                    />
                  )}
                  <div className="admin-field wide">
                    <span>
                      {tab === "diplomas"
                        ? "Изображение или PDF диплома"
                        : "Изображение"}
                    </span>
                    {item.image && item.fileType !== "pdf" && (
                      <img
                        className="editor-preview"
                        src={item.image}
                        alt="Предпросмотр"
                      />
                    )}
                    <Upload
                      value={item.image}
                      pdf={tab === "diplomas"}
                      onChange={(value, fileType) =>
                        change((d) => {
                          const target = d[tab].find((x) => x.id === selected);
                          target.image = value;
                          if (tab === "diplomas") target.fileType = fileType;
                        })
                      }
                    />
                  </div>
                </div>
                <label className="publish-toggle">
                  <input
                    type="checkbox"
                    checked={item.published}
                    onChange={(e) => changeItem("published", e.target.checked)}
                  />
                  <span>Показывать на сайте после сохранения</span>
                </label>
                <div className="editor-actions">
                  <button
                    className="admin-primary"
                    onClick={save}
                    disabled={busy || !dirty}
                  >
                    Сохранить
                  </button>
                  {payload.data[tab].findIndex((x) => x.id === selected) >
                    0 && (
                    <button
                      className="text-button"
                      onClick={() =>
                        change((d) => {
                          const i = d[tab].findIndex((x) => x.id === selected);
                          [d[tab][i - 1], d[tab][i]] = [
                            d[tab][i],
                            d[tab][i - 1],
                          ];
                        })
                      }
                    >
                      Поднять выше
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <div className="admin-editor-empty">
                <h2>Ваши материалы.</h2>
                <p>Выберите запись слева или добавьте новую.</p>
              </div>
            )}
          </div>
        )}
        <div className="admin-footnote">
          {tab === "callbacks" ? "Обращения не публикуются на сайте. Доступ к ним есть только у владельца." : <>Изменения публикуются после сохранения. {contentOnlyAccess
            ? "Пока доступ открыт, черновики в панели доступны всем посетителям."
            : "Черновики видны только в этой панели."}</>}
        </div>
      </main>
    </div>
  );
}
