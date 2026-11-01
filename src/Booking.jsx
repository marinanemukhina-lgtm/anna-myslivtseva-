import React, { useEffect, useState } from "react";
import "./booking.css";

export default function Booking({ profile = {} }) {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/demo/clinical/config").then(r => r.json()).then(config => {
      if (alive) setDemo(config.enabled === true);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const hasContact = [profile.phone, profile.email, profile.socialUrl, profile.bookingUrl].some(
    value => typeof value === "string" && value.trim());
  return <section className="booking-section" aria-labelledby="booking-title">
    <div className="booking-intro"><span className="eyebrow">Запись на приём</span><h2 id="booking-title">Удобное<br/>время для вас.</h2></div>
    <div className="booking-panel">
      <p className="booking-unavailable">
        {hasContact ? "Онлайн-календарь пока не открыт. Для записи воспользуйтесь контактами ниже." :
          "Онлайн-запись пока не открыта. Контакты для записи ещё не опубликованы."}
      </p>
      {demo && <p className="booking-unavailable"><a href="/demo/booking">Открыть демонстрацию записи (только вымышленные данные)</a></p>}
    </div>
  </section>;
}
