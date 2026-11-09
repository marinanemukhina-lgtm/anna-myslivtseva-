import React, { useEffect, useId, useRef, useState } from "react";
import { phoneHref, smsHref } from "../shared/contact-ui-links.mjs";
import { lockDocumentScroll } from "./dialog-scroll-lock.mjs";
import "./ContactChoiceDialog.css";

const HANDSET = "M5.1 2.8c-.9 0-1.7.7-1.8 1.6C2.5 12.8 11.2 21.5 19.6 20.7c.9-.1 1.6-.9 1.6-1.8v-3c0-.8-.6-1.5-1.4-1.6l-3.2-.5c-.5-.1-1 .1-1.4.5l-1.6 1.6a13.9 13.9 0 0 1-5.5-5.5l1.6-1.6c.4-.4.6-.9.5-1.4l-.5-3.2c-.1-.8-.8-1.4-1.6-1.4Z";

function outsideDialog(event) {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right ||
    event.clientY < box.top || event.clientY > box.bottom;
}

// Optional chooser opened only by its own explicit trigger.
// It does not intercept PhoneCircleLink or any other native tel/SMS link.
export function ContactChoiceDialog({
  phone,
  smsPhone,
  title = "Связаться с Анной",
  callLabel = "Позвонить Анне",
  smsLabel = "Написать SMS Анне",
  triggerLabel = "Связаться",
  triggerClassName = "",
}) {
  const [dialogSupported, setDialogSupported] = useState(false);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const returnFocusRef = useRef(null);
  const unlockRef = useRef(null);
  const backdropPressRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const tel = phoneHref(phone);
  const sms = smsHref(phone, smsPhone);

  function releaseAndRestore() {
    unlockRef.current?.();
    unlockRef.current = null;
    const opener = returnFocusRef.current;
    returnFocusRef.current = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }

  useEffect(() => {
    setDialogSupported(typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal === "function");
    return () => {
      unlockRef.current?.();
      unlockRef.current = null;
      const opener = returnFocusRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      returnFocusRef.current = null;
    };
  }, []);

  function openDialog(event) {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal !== "function") { setDialogSupported(false); return; }
    returnFocusRef.current = event.currentTarget;
    dialog.showModal();
    unlockRef.current = lockDocumentScroll(dialog.ownerDocument);
    closeButtonRef.current?.focus({ preventScroll: true });
  }

  function closeDialog() {
    if (dialogRef.current?.open) dialogRef.current.close();
  }

  return (
    <>
      {dialogSupported ? <button type="button" className={`contact-choice-trigger ${triggerClassName}`.trim()} onClick={openDialog}>
        {triggerLabel}
      </button> : <a className={`contact-choice-trigger ${triggerClassName}`.trim()} href="/contact">{triggerLabel}</a>}
      {dialogSupported && <dialog
        ref={dialogRef}
        className="contact-choice"
        data-lenis-prevent
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={releaseAndRestore}
        onPointerDown={event => {
          backdropPressRef.current = event.target === event.currentTarget && outsideDialog(event);
        }}
        onPointerCancel={() => { backdropPressRef.current = false; }}
        onClick={event => {
          if (backdropPressRef.current && event.target === event.currentTarget && outsideDialog(event)) closeDialog();
          backdropPressRef.current = false;
        }}
      >
        <button ref={closeButtonRef} className="contact-choice__close" type="button" onClick={closeDialog} aria-label="Закрыть выбор способа связи">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
        <h2 className="contact-choice__title" id={titleId}>{title}</h2>
        <p className="contact-choice__intro" id={descriptionId}>Выберите удобный способ связи</p>
        <div className="contact-choice__channels">
          {tel && <a className="contact-choice__channel contact-choice__channel--call" href={tel} aria-label={callLabel}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={HANDSET} /></svg>
            <span><strong>Позвонить</strong><small>Откроется приложение для звонков</small></span>
          </a>}
          {sms && <a className="contact-choice__channel" href={sms} aria-label={smsLabel}>
            <svg viewBox="0 0 24 24" className="contact-choice__sms" aria-hidden="true" focusable="false"><path d="M4 4h16v12H9l-5 4V4Z" /><path d="M8 8h8M8 12h5" /></svg>
            <span><strong>Написать SMS</strong><small>Откроется приложение сообщений</small></span>
          </a>}
          {!tel && !sms && <p className="contact-choice__empty">Контакты пока не опубликованы</p>}
        </div>
        {(tel || sms) && <p className="contact-choice__note">Вы сами совершаете звонок или отправляете сообщение</p>}
      </dialog>}
    </>
  );
}
