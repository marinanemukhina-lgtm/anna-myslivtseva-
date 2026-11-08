import React from "react";
import { contactMethods } from "./contact-methods.mjs";
import "./contact.css";
import SocialLinks from "./SocialLinks.jsx";
import ArrowIcon from "./ArrowIcon.jsx";
import { publicSocialLinks, safePublicUrl } from "../shared/contact-links.mjs";

export default function ContactActions({ profile = {} }) {
  const { phone, displayPhone, smsHref } = contactMethods(profile);
  const email = profile.email?.trim(), address = profile.address?.trim(), hours = profile.hours?.trim();
  const map = safePublicUrl(profile.mapUrl), booking = safePublicUrl(profile.bookingUrl);
  const hasActions = phone || email || booking;
  return <section className="contact-intro" aria-labelledby="contact-title">
    <div className="contact-intro-copy">
      <span className="eyebrow">Запись и организационные вопросы</span>
      <h1 id="contact-title">Связаться<br />с Анной.</h1>
      <p className="contact-lead">{hasActions ? "Выберите удобный способ связи." : publicSocialLinks(profile).length ? "Откройте страницы и каналы Анны." : "Телефон для связи пока не опубликован."}</p>
      {hasActions && <div className="contact-actions">
        {phone && <a className="contact-button contact-primary" href={"tel:" + phone}><span>Позвонить Анне</span><span>{displayPhone}</span></a>}
        {smsHref && <a className="contact-button" href={smsHref}>Написать SMS<ArrowIcon /></a>}
      {smsHref && <p className="contact-note">SMS откроется в приложении сообщений, если оно доступно на вашем устройстве. Сообщение отправляете вы.</p>}
        {email && <a className="contact-button contact-email" href={"mailto:" + email}><span>Электронная почта<span>{email}</span></span><ArrowIcon /></a>}
        {booking && <a className="contact-button" href={booking} target="_blank" rel="noopener noreferrer">Записаться на приём<ArrowIcon /></a>}
      </div>}
      <SocialLinks profile={profile} prominent />
    </div>
    <figure className="contact-portrait"><img src={!profile.portrait || profile.portrait === "/media/anna-portrait.jpg" ? "/media/anna-portrait-smile.png" : profile.portrait} alt={profile.name || "Анна Мысливцева"} style={{ objectPosition: `50% ${profile.heroPosition ?? 0}%` }} loading="eager" /></figure>
    {(address || map || hours) && <div className="contact-visit" aria-label="Информация о приёме">
      {(address || map) && <div><h2 className="eyebrow">Место и формат приёма</h2>{address && <p className="pre-line">{address}</p>}{map && <a className="contact-map" href={map} target="_blank" rel="noopener noreferrer">Как добраться <ArrowIcon /></a>}</div>}
      {hours && <div className="hours"><h2 className="eyebrow">Часы приёма</h2><p className="pre-line">{hours}</p></div>}
    </div>}
  </section>;
}
