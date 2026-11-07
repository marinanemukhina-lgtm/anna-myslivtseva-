import React from "react";
import { contactMethods } from "./contact-methods.mjs";
import "./contact.css";

export default function ContactActions({ profile = {} }) {
  const { phone, displayPhone, smsHref } = contactMethods(profile);
  return <section className="contact-intro" aria-labelledby="contact-title">
    <div className="contact-intro-copy">
      <span className="eyebrow">Запись и организационные вопросы</span>
      <h1 id="contact-title">Связаться<br />с Анной.</h1>
      <p className="contact-lead">{phone ? "Выберите удобный способ связи." : "Телефон для связи пока не опубликован."}</p>
      {phone && <div className="contact-actions">
        <a className="contact-button contact-primary" href={"tel:" + phone}><span>Позвонить Анне</span><span>{displayPhone}</span></a>
        {smsHref && <a className="contact-button" href={smsHref}>Написать SMS<span aria-hidden="true">↗</span></a>}
      </div>}
      {smsHref && <p className="contact-note">SMS откроется в приложении сообщений, если оно доступно на вашем устройстве. Сообщение отправляете вы.</p>}
    </div>
    <div className="contact-portrait"><img src={!profile.portrait || profile.portrait === "/media/anna-portrait.jpg" ? "/media/anna-portrait-smile.png" : profile.portrait} alt={profile.name || "Анна Мысливцева"} style={{ objectPosition: `50% ${profile.heroPosition ?? 0}%` }} /></div>
  </section>;
}
