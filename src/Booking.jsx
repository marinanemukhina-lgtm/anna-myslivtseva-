import React from 'react';
import './booking.css';

export default function Booking() {
  return <section className="booking-section" aria-labelledby="booking-title">
    <div className="booking-intro"><span className="eyebrow">Запись на приём</span><h2 id="booking-title">Удобное<br />время для вас.</h2></div>
    <div className="booking-panel"><p className="booking-unavailable">Онлайн-календарь пока не открыт. Для записи свяжитесь с Анной по контактам на этой странице.</p></div>
  </section>;
}
