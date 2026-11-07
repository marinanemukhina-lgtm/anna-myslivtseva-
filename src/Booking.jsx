import React from 'react';
import './booking.css';
import { contactMethods } from './contact-methods.mjs';
import { publicSocialLinks, safePublicUrl } from '../shared/contact-links.mjs';

export default function Booking({ profile = {} }) {
  const hasContact = Boolean(contactMethods(profile).phone || (typeof profile.email === 'string' && profile.email.trim()) || publicSocialLinks(profile).length || safePublicUrl(profile.bookingUrl));
  return <section className="booking-section" aria-labelledby="booking-title">
    <div className="booking-intro"><span className="eyebrow">Запись на приём</span><h2 id="booking-title">Удобное<br />время для вас.</h2></div>
    <div className="booking-panel"><p className="booking-unavailable">{hasContact ? 'Онлайн-календарь пока не открыт. Для записи воспользуйтесь контактами ниже.' : 'Онлайн-запись пока не открыта. Контакты для записи ещё не опубликованы.'}</p></div>
  </section>;
}
