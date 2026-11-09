import React, { useEffect, useId, useRef, useState } from "react";
import { contactMethods } from "./contact-methods.mjs";
import { normalizeCallbackPhone } from "../shared/callbacks.mjs";
import "./contact.css";
import { lockDocumentScroll } from "./dialog-scroll-lock.mjs";
import { cycleDialogFocus } from "./dialog-focus.mjs";

const retryStorageKey = "anna-callback-retry-v1";
function previousOperation() {
  try {
    const value = JSON.parse(sessionStorage.getItem(retryStorageKey));
    return /^[a-f0-9-]{36}$/i.test(value?.requestId || "") && /^[a-f0-9]{64}$/.test(value?.consentVersion || "") ? { requestId: value.requestId, consentVersion: value.consentVersion } : null;
  } catch { return null; }
}

export default function CallbackForm({ profile = {} }) {
  const { phone, displayPhone } = contactMethods(profile);
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [retryConfig, setRetryConfig] = useState(0);
  const [number, setNumber] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [recovering, setRecovering] = useState(() => Boolean(previousOperation()));
  const input = useRef(null);
  const heading = useRef(null);
  const operation = useRef(previousOperation());
  const pending = useRef(null);
  const uid = useId();
  const titleId = uid + '-title', phoneId = uid + '-phone', hintId = uid + '-hint';
  const dialog = useRef(null), opener = useRef(null), unlock = useRef(null), dialogHeading = useRef(null);
  const triggerRef = useRef(null);
  const backdropPress = useRef(false);
  const outside = event => { const r=event.currentTarget.getBoundingClientRect(); return event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom; };
  const [nativeDialog, setNativeDialog] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [closeNotice, setCloseNotice] = useState(false);
  useEffect(() => {
    setNativeDialog(typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function');
    return () => { unlock.current?.(); if(opener.current?.isConnected) opener.current.focus({preventScroll:true}); };
  }, []);
  function releaseDialog() {
    unlock.current?.(); unlock.current = null; setModalOpen(false); setConsent(false); setCloseNotice(false);
    if(saved) requestAnimationFrame(() => heading.current?.focus({preventScroll:true}));
    else if(triggerRef.current?.isConnected) triggerRef.current.focus({preventScroll:true});
    else if(opener.current?.isConnected) opener.current.focus({preventScroll:true});
    else heading.current?.focus({preventScroll:true});
  }
  function closeDialog() {
    if(pending.current) { setCloseNotice(true); return; }
    dialog.current?.close();
  }
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setConfigError(false);
    fetch("/api/contact/config", { signal: controller.signal, credentials: "same-origin", cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(value => { if (mounted) setConfig(value); })
      .catch(() => { if (mounted) setConfigError(true); })
      .finally(() => clearTimeout(timeout));
    return () => { mounted = false; clearTimeout(timeout); controller.abort(); };
  }, [retryConfig]);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event) {
    event.preventDefault();
    if (pending.current || !config?.enabled || !consent) return;
    const snapshot = normalizeCallbackPhone(number);
    if (!snapshot) { setError("Введите телефон с кодом страны, например +7 900 000-00-00."); input.current?.focus(); return; }
    if (!operation.current) {
      if (!globalThis.crypto?.randomUUID) { setError("Защищённая отправка недоступна. Откройте сайт по HTTPS или позвоните Анне."); return; }
      operation.current = { requestId: crypto.randomUUID(), consentVersion: config.consentVersion };
      // Preserve only the opaque retry handle, never the visitor's phone number.
      try { sessionStorage.setItem(retryStorageKey, JSON.stringify(operation.current)); } catch { /* Retry still works in this open form. */ }
    }
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/contact/callback", {
        method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...operation.current, phone: snapshot, consent: true, website }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "CALLBACK_DISABLED") {
          setConsent(false); setConfig({ enabled: false });
          // A previous attempt may have committed: retain its opaque retry handle.
        }
        if (result.code === "CONSENT_CHANGED") {
          operation.current = null; setRecovering(false);
          try { sessionStorage.removeItem(retryStorageKey); } catch {}
          setConsent(false); setConfig(null); setRetryConfig(value => value + 1);
        }
        if (result.code === "IDEMPOTENCY_CONFLICT") setConflict(true);
        throw new Error(result.error || "Не удалось сохранить заявку. Попробуйте ещё раз или позвоните Анне.");
      }
      if (result.ok !== true || result.requestId !== operation.current.requestId) throw new Error("Не удалось подтвердить получение заявки. Повторите отправку с тем же номером или позвоните Анне.");
      setSaved(true); setNumber(""); setConsent(false); operation.current = null;
      try { sessionStorage.removeItem(retryStorageKey); } catch {}
      requestAnimationFrame(() => (dialog.current?.open ? dialogHeading.current : heading.current)?.focus());
    } catch (failure) {
      setRecovering(Boolean(operation.current));
      setError(failure.name === "AbortError" || failure instanceof TypeError || failure instanceof SyntaxError
        ? "Не удалось подтвердить получение заявки. Повторите отправку с тем же номером в этой вкладке: уже сохранённая заявка не продублируется. Также можно позвонить Анне."
        : failure.message);
    } finally { clearTimeout(timeout); pending.current = null; setBusy(false); }
  }
  const goToForm = event => {
    if(!config?.enabled || pending.current || dialog.current?.open) return;
    setConsent(false); setCloseNotice(false);
    if(nativeDialog && dialog.current) {
      opener.current = event.currentTarget;
      dialog.current.showModal(); setModalOpen(true);
      unlock.current = lockDocumentScroll(document);
    }
    input.current?.focus();
  };
  const useModal = nativeDialog && (config?.enabled || modalOpen);
  const Container = useModal ? 'dialog' : 'div';

  return (
    <section className="callback-section" id="callback" aria-labelledby={titleId}>
      <div>
        <span className="eyebrow">Обратный звонок</span>
        <h2 id={titleId} ref={heading} tabIndex={-1}>{saved && !modalOpen ? "Заявка сохранена" : "Удобнее, чтобы вам позвонили?"}</h2>
        <p>{saved ? "Номер появился в защищённом списке обращений Анны. Это просьба перезвонить, а не подтверждённая запись на приём." : config?.enabled ? "Оставьте только номер телефона. Медицинские сведения здесь не нужны." : (phone ? "Обратный звонок пока недоступен. Можно связаться с Анной напрямую." : "Обратный звонок пока недоступен.")}</p>
        {config?.enabled && !saved && <button ref={triggerRef} className="contact-button" type="button" onClick={goToForm}>Оставить номер для звонка<span aria-hidden="true">↓</span></button>}
      </div>
      <Container ref={dialog} className={useModal ? 'callback-dialog' : undefined}
        aria-labelledby={useModal ? uid + '-dialog-title' : undefined}
        data-lenis-prevent={useModal ? '' : undefined}
        onClose={useModal ? releaseDialog : undefined}
        onCancel={useModal ? event => { event.preventDefault(); closeDialog(); } : undefined}
        onKeyDown={useModal ? cycleDialogFocus : undefined}
        onPointerDown={useModal ? event => { backdropPress.current = event.target===event.currentTarget && outside(event); } : undefined}
        onPointerCancel={useModal ? () => { backdropPress.current = false; } : undefined}
        onClick={useModal ? event => {
          if(backdropPress.current && event.target===event.currentTarget && outside(event)) closeDialog();
          backdropPress.current = false;
        } : undefined}>
        {useModal && <><button type="button" className="contact-button" onClick={closeDialog} aria-label="Закрыть форму обратного звонка">Закрыть</button>
          <h2 id={uid + '-dialog-title'} ref={dialogHeading} tabIndex={-1}>{saved ? 'Заявка сохранена' : 'Заказать обратный звонок'}</h2></>}
        {busy && <p role="status">Сохраняем заявку. Дождитесь результата перед закрытием окна.</p>}
        {closeNotice && busy && <p role="status">Окно можно закрыть после ответа или сообщения о неопределённом результате.</p>}
        {saved ? <div className="callback-result" role="status"><p>Отправлять номер повторно не нужно.</p>{phone && <a className="contact-button" href={"tel:" + phone}>Если вопрос срочный, позвоните Анне</a>}</div>
        : config?.enabled ? <form onSubmit={submit} aria-label="Заказать обратный звонок" className="callback-form">
          {recovering && <p className="contact-note">Если предыдущая отправка прервалась, введите тот же номер. Мы проверим ранее отправленную заявку, не создавая повтор.</p>}
          <label htmlFor={phoneId}>Ваш телефон</label>
          <input ref={input} id={phoneId} name="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={32} required value={number} disabled={busy} aria-describedby={hintId} onChange={event => { setNumber(event.target.value); setError(""); }} />
          <p id={hintId} className="contact-note">Например: +7 900 000-00-00. Проверьте номер перед отправкой.</p>
          <div className="callback-trap" aria-hidden="true"><label>Сайт<input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} /></label></div>
          <label className="callback-consent"><input type="checkbox" checked={consent} required disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>{config.consentText} <a href={config.consentUrl || "/callback-consent"} target="_blank" rel="noopener noreferrer">Согласие на обработку телефона</a>.</span></label>
          <p className="contact-note callback-privacy">Информация об обработке данных: <a href={config.privacyUrl || "/privacy"} target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a>.</p>
          {error && <p role="alert" className="callback-error">{error}</p>}
          {conflict && <div className="callback-error"><p>Ранее с этой вкладки уже была сохранена заявка с другими данными. Новая отправка создаст отдельную заявку.</p><button type="button" className="contact-button" onClick={() => { operation.current = null; try { sessionStorage.removeItem(retryStorageKey); } catch {} setConflict(false); setRecovering(false); setConsent(false); setError(""); }}>Начать новую заявку</button></div>}
          <button className="contact-button contact-primary" disabled={busy || !consent || conflict} type="submit">{busy ? "Сохраняем заявку…" : "Перезвоните мне"}<span aria-hidden="true">↗</span></button>
          <p className="contact-note">Подтверждение появится только после сохранения на сервере. Заявка не подписывает вас на рекламу.</p>
        </form>
        : <div className="callback-unavailable" role="status">
          <p>{configError ? "Не удалось проверить доступность обратного звонка." : config ? (phone ? "Обратный звонок пока не подключён. Воспользуйтесь прямой связью с Анной." : "Обратный звонок пока не подключён.") : "Проверяем доступность обратного звонка…"}</p>
          {configError && <button type="button" className="contact-button" onClick={() => setRetryConfig(value => value + 1)}>Повторить проверку</button>}
          {phone && <a className="contact-button" href={"tel:" + phone}>Позвонить {displayPhone}</a>}
        </div>}
      </Container>
    </section>
  );
}
