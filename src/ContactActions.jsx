import React from "react";
import { PhoneCircleLink } from "./PhoneCircleLink.jsx";
import { ContactChoiceDialog } from "./ContactChoiceDialog.jsx";
import { OfficeDirections } from "./OfficeDirections.jsx";
import { contactMethods } from "./contact-methods.mjs";
import "./contact.css";
import SocialLinks from "./SocialLinks.jsx";
import { publicSocialLinks, safePublicUrl } from "../shared/contact-links.mjs";

export default function ContactActions({ profile = {} }) {
  const { phone, displayPhone, smsHref } = contactMethods(profile);
  return <section className="contact-intro contact-editorial" aria-labelledby="contact-title">
    <div className="contact-intro-copy">
      <span className="eyebrow">03 / Контакты</span>
      <h1 id="contact-title">Контакты</h1>
      <p>{[profile.name, profile.role].filter(Boolean).join(" / ")}</p>
      {!phone && <p className="contact-lead">{publicSocialLinks(profile).length ? "Откройте страницы и каналы Анны." : "Телефон для связи пока не опубликован."}</p>}
    </div>
    <div className="contact-editorial__circle"><PhoneCircleLink phone={profile.phone} /></div>
    <div className="contact-editorial__details">
      {phone && <>
        <span className="eyebrow">Для записи на приём</span>
        <a className="contact-editorial__number" href={"tel:" + phone}>{displayPhone}</a>
        {smsHref && <a className="contact-editorial__sms" href={smsHref}>Написать SMS <span aria-hidden="true">↗</span></a>}
        <ContactChoiceDialog phone={profile.phone} />
      </>}
      {profile.address && <p className="pre-line contact-editorial__address">{profile.address}</p>}
      <OfficeDirections officeAddress={profile.officeAddress} directionsUrl={profile.directionsUrl} />
      {profile.email && <p><a href={"mailto:" + profile.email}>{profile.email}</a></p>}
      {profile.hours && <p className="pre-line">{profile.hours}</p>}
      {safePublicUrl(profile.bookingUrl) && <a className="contact-editorial__booking" href={safePublicUrl(profile.bookingUrl)} target="_blank" rel="noopener noreferrer">Онлайн-запись <span aria-hidden="true">↗</span></a>}
      {smsHref && <p className="contact-note">SMS откроется в приложении сообщений, если оно доступно на вашем устройстве. Сообщение отправляете вы.</p>}
      <SocialLinks profile={profile} prominent />
    </div>
  </section>;
}
