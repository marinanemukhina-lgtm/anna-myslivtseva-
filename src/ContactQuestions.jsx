import React from "react";
import { contactMethods } from "./contact-methods.mjs";

function publishesRostovHomeVisits(address) {
  // The current site publishes this exact service area and scheduling condition.
  // Suppress the answer when the owner edits the contact text instead of guessing a new area.
  if (typeof address !== "string") return false;
  return address.trim().replace(/\s+/g, " ").replace(/[‐‑–]/g, "-")
    .replace(/\.$/, "").toLowerCase() === "ростов-на-дону. выезд на дом по предварительной записи";
}

export default function ContactQuestions({ data = {}, Link }) {
  const profile = data.profile || {};
  const { phone, smsHref } = contactMethods(profile);
  const services = (data.services || []).filter(item => item.published);
  const hasPrices = services.some(item => typeof item.price === "string" && item.price.trim());

  return (
    <section className="contact-questions grid" aria-labelledby="contact-questions-title">
      <h2 id="contact-questions-title">Частые вопросы</h2>
      <div>
        <details>
          <summary>Как записаться?</summary>
          <p>
            {phone ? <>
              Чтобы согласовать время, позвоните Анне{smsHref && " или напишите SMS"}. Кнопки есть <a href="#contact-title">в начале страницы</a>.
            </> : <>Посмотрите доступные способы связи <a href="#contact-title">в начале страницы</a>.</>}
          </p>
        </details>
        {publishesRostovHomeVisits(profile.address) && <details>
          <summary>Можно ли договориться о выезде на дом?</summary>
          <p>Выезд на дом в Ростове-на-Дону возможен по предварительной записи.{phone && " Время и адрес согласуйте с Анной."}</p>
        </details>}
        <details>
          <summary>Где посмотреть услуги и стоимость?</summary>
          <p>Проверьте актуальный список в разделе <Link to="/services">«Услуги и цены»</Link>. {hasPrices
            ? "Стоимость указана в карточках с опубликованной ценой."
            : "Если цена опубликована, она будет видна в карточке услуги."}</p>
        </details>
        <details>
          <summary>Где посмотреть сведения об образовании?</summary>
          <p>Опубликованные сведения и документы можно найти в разделе <Link to="/diplomas">«Образование и дипломы»</Link>.</p>
        </details>
      </div>
    </section>
  );
}
