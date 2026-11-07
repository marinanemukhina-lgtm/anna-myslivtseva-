import React from 'react';
import './booking.css';

export default function Booking({ profile = {} }) {
  const hasContact = [profile.phone, profile.email, profile.socialUrl, profile.bookingUrl].some(value => typeof value === 'string' && value.trim());
  return <section className="booking-section" aria-labelledby="booking-title">
    <div className="booking-intro"><span className="eyebrow">Запись на приём</span><h2 id="booking-title">Удобное<br />время для вас.</h2></div>
    <div className="booking-panel"><p className="booking-unavailable">{hasContact ? 'Онлайн-календарь пока не открыт. Для записи воспользуйтесь контактами на этой странице.' : 'Онлайн-запись пока не открыта. Контакты для записи ещё не опубликованы.'}</p></div>
  </section>;
}
