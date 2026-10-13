import React, { useEffect, useState } from "react";
import { useSite } from "./App.jsx";
import "./admin.css";
const tabs = [
  ["profile", "О себе и сайт"],
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
  const [auth, setAuth] = useState(null),
    [configured, setConfigured] = useState(true),
    [password, setPassword] = useState(""),
    [payload, setPayload] = useState(null),
    [tab, setTab] = useState("profile"),
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
        setAuth(r.authenticated);
        setConfigured(r.configured);
        if (r.authenticated) await read();
      })
      .catch((e) => {
        setAuth(false);
        setError(e.message);
      });
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const change = (mutate) => {
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
    payload && tab !== "profile"
      ? payload.data[tab].find((x) => x.id === selected)
      : null;
  const changeItem = (key, value) =>
    change((d) => {
      const x = d[tab].find((x) => x.id === selected);
      if (x) x[key] = value;
    });
  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const k of ["services", "news", "offers", "diplomas"])
        if (payload.data[k].some((x) => x.published && !x.title.trim()))
          throw Error("У опубликованной записи должно быть название.");
      const result = await api("/api/admin/content", "PUT", payload);
      setPayload(result);
      setDirty(false);
      setNotice("Сохранено. Опубликованные записи уже видны на сайте.");
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
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              await api("/api/session", "POST", { password });
              setPassword("");
              await read();
              setAuth(true);
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
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
              />
              <button className="admin-primary" disabled={busy}>
                {busy ? "Входим…" : "Войти"}
              </button>
            </>
          ) : (
            <p>
              Доступ ещё не настроен. Задайте пароль администратора при
              установке проекта.
            </p>
          )}
          {error && (
            <p role="alert" className="admin-error">
              {error}
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
        <span className="eyebrow">Управление сайтом</span>
        <nav>
          {tabs.map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setSelected(null);
                setError("");
              }}
            >
              {label}
              {payload && key !== "profile" && (
                <span>{payload.data[key].length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <a href="/" target="_blank" rel="noreferrer">
            Открыть сайт
          </a>
          <button
            onClick={async () => {
              if (
                dirty &&
                !confirm("Есть несохранённые изменения. Выйти без сохранения?")
              )
                return;
              await api("/api/session", "DELETE");
              setAuth(false);
              setPayload(null);
              setDirty(false);
            }}
          >
            Выйти
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">
              {dirty
                ? "Есть несохранённые изменения"
                : "Все изменения сохранены"}
            </span>
            <h1>{tabs.find((t) => t[0] === tab)?.[1]}</h1>
          </div>
          <button
            className="admin-primary"
            onClick={save}
            disabled={busy || !dirty || !payload}
          >
            {busy ? "Сохраняем…" : "Сохранить изменения"}
          </button>
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
        ) : tab === "profile" ? (
          <form className="profile-form" onSubmit={save}>
            <section className="admin-card">
              <h2>Личная информация</h2>
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
          Изменения публикуются после сохранения. Черновики видны только в этой
          панели.
        </div>
      </main>
    </div>
  );
}
