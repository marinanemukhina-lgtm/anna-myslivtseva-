import React from "react";
import { officeDirections } from "../shared/contact-ui-links.mjs";
import "./contact-actions.css";

export function OfficeDirections({ officeAddress, directionsUrl }) {
  const destination = officeDirections(officeAddress, directionsUrl);
  if (!destination) return null;
  return (
    <section className="office-directions" aria-label="Адрес и маршрут">
      <p className="office-directions__address">{destination.address}</p>
      {destination.href && <a className="office-directions__link" href={destination.href} target="_blank" rel="noopener noreferrer">
        <span>Как добраться</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 19 19 5M5 5h14v14" />
        </svg>
        <span className="contact-visually-hidden">, откроется в новой вкладке</span>
      </a>}
    </section>
  );
}
