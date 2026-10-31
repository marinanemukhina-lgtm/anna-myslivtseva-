import React, { useEffect, useRef, useState } from "react";

// A safe, content-grounded visitor assistant. No visitor text is transmitted or stored.
export default function VisitorAssistant() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { from: "assistant", text: "Здравствуйте! Я виртуальный помощник сайта Анны Мысливцевой. Помогу найти опубликованные услуги, цены и контакты. Я не врач и не ставлю диагнозы." },
  ]);
  const log = useRef(null);
  useEffect(() => {
    fetch("/api/content", { credentials: "same-origin" })
      .then((r) => { if (!r.ok) throw Error("content"); return r.json(); })
      .then(setData).catch(() => setData(null));
  }, []);
  useEffect(() => { if (open) log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages, open]);
  function answer(question) {
    const q = question.toLowerCase();
    if (/бол|диагноз|леч|симптом|противопоказ|беремен|ребен|травм|лекарств|врач|безопасн/.test(q))
      return "По вопросам здоровья, противопоказаний и выбора лечения необходима консультация квалифицированного специалиста. Я могу показать опубликованные услуги и контакты для обращения.";
    if (!data) return "Сейчас не удалось загрузить информацию сайта. Посмотрите раздел «Услуги и цены» или «Запись на приём».";
    const p = data.profile || {};
    const services = (data.services || []).filter(s => s.published);
    if (/цен|стоим|сколько|руб|прайс|услуг|массаж|сеанс|длител|процедур/.test(q)) {
      const matches = services.filter(s => (s.title + " " + s.category).toLowerCase().split(/\s+/).some(w => w.length > 4 && q.includes(w)));
      const chosen = matches.length ? matches : services;
      return chosen.length
        ? "Опубликованные услуги:\n" + chosen.slice(0, 8).map(s => "• " + s.title + (s.price ? " — " + s.price : " — цена уточняется") + (s.duration ? ", " + s.duration : "")).join("\n") + "\nПодробности — в разделе «Услуги и цены»."
        : "На сайте пока не опубликованы услуги с ценами. Их можно уточнить непосредственно у Анны.";
    }
    if (/запис|прием|приём|время|расписан|свободн/.test(q))
      return "Для записи перейдите в раздел «Запись на приём». Я не вижу свободные интервалы и не подтверждаю запись.";
    if (/адрес|где|наход|доех|контакт|телефон|позвон|связ|час|график/.test(q))
      return [p.address && "Адрес: " + p.address, p.hours && "Часы: " + p.hours, p.phone && "Телефон: " + p.phone, p.email && "Почта: " + p.email].filter(Boolean).join("\n") || "Контакты пока не опубликованы. Посмотрите раздел «Запись на приём».";
    return "Я могу подсказать опубликованные услуги и цены, контакты и путь к записи. Для индивидуальных вопросов обратитесь непосредственно к Анне.";
  }
  function submit(e) {
    e.preventDefault();
    const q = input.trim().slice(0, 500);
    if (!q) return;
    setMessages(m => [...m.slice(-18), { from: "user", text: q }, { from: "assistant", text: answer(q) }]);
    setInput("");
  }
  return <div className="visitor-assistant">
    <button className="visitor-assistant-toggle" type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="visitor-assistant-panel">{open ? "Закрыть" : "Задать вопрос"}</button>
    {open && <section className="visitor-assistant-panel" id="visitor-assistant-panel" aria-label="Виртуальный помощник">
      <header><strong>Помощник Анны</strong><button type="button" onClick={() => setOpen(false)} aria-label="Закрыть помощника">×</button></header>
      <div className="visitor-assistant-log" ref={log} role="log" aria-live="polite">{messages.map((m, i) => <p key={i} className={m.from === "user" ? "visitor-user" : "visitor-reply"}>{m.text}</p>)}</div>
      <form onSubmit={submit}><label htmlFor="visitor-question">Ваш вопрос</label><div><input id="visitor-question" value={input} maxLength={500} onChange={e => setInput(e.target.value)} placeholder="Услуги, цены, запись…" /><button type="submit">Отправить</button></div></form>
      <small>Ответы по данным сайта. Не сообщайте сведения о здоровье и персональные данные. Сообщения не отправляются на сервер.</small>
    </section>}
    <style>{`
      .visitor-assistant{position:fixed;right:20px;bottom:20px;z-index:10000;font-family:Inter,Arial,sans-serif;color:#26231f}
      .visitor-assistant-toggle{border:0;border-radius:40px;background:#302d29;color:white;padding:14px 22px;min-height:48px;cursor:pointer;box-shadow:0 8px 30px #0003}
      .visitor-assistant-panel{position:absolute;bottom:65px;right:0;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100dvh - 110px));display:flex;flex-direction:column;background:#f9f7f2;border:1px solid #dedbd3;border-radius:16px;box-shadow:0 15px 55px #0003;overflow:hidden}
      .visitor-assistant-panel header{display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid #ddd7cd}
      .visitor-assistant-panel header button{background:transparent;border:0;font-size:26px;min-width:44px;min-height:44px;cursor:pointer}
      .visitor-assistant-log{overflow-y:auto;flex:1;padding:16px;display:flex;flex-direction:column;gap:12px}
      .visitor-assistant-log p{margin:0;white-space:pre-line;line-height:1.5;font-size:14px;padding:12px;border-radius:12px;background:#eae5db;max-width:95%}
      .visitor-assistant-log .visitor-user{align-self:flex-end;background:#302d29;color:#fff}
      .visitor-assistant-panel form{padding:12px 16px;border-top:1px solid #ddd7cd}
      .visitor-assistant-panel label{display:block;font-size:13px;margin-bottom:8px}
      .visitor-assistant-panel form div{display:flex;gap:6px}
      .visitor-assistant-panel input{flex:1;min-width:0;border:1px solid #aaa59c;border-radius:8px;padding:10px;font-size:16px;background:white}
      .visitor-assistant-panel form button{background:#302d29;color:white;border:0;border-radius:8px;padding:10px;cursor:pointer}
      .visitor-assistant-panel small{font-size:11px;line-height:1.5;padding:0 16px 12px;color:#615c55}
      .visitor-assistant button:focus-visible,.visitor-assistant input:focus-visible{outline:3px solid #a16c34;outline-offset:2px}
      @media(max-width:500px){.visitor-assistant{right:12px;bottom:max(12px,env(safe-area-inset-bottom))}}
    `}</style>
  </div>;
}
