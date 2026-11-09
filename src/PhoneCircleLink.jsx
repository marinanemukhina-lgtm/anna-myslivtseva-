import React from "react";
import { phoneHref } from "../shared/contact-ui-links.mjs";
import "./contact-actions.css";

// Generic handset silhouette, not extracted from Apple SF Symbols.
export function PhoneCircleLink({
  phone,
  label = "Позвонить Анне",
  className = "",
}) {
  const href = phoneHref(phone);
  if (!href) return null;
  return (
    <a className={`phone-circle-link ${className}`.trim()} href={href} aria-label={label}>
      <svg className="phone-circle-link__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5.1 2.8c-.9 0-1.7.7-1.8 1.6C2.5 12.8 11.2 21.5 19.6 20.7c.9-.1 1.6-.9 1.6-1.8v-3c0-.8-.6-1.5-1.4-1.6l-3.2-.5c-.5-.1-1 .1-1.4.5l-1.6 1.6a13.9 13.9 0 0 1-5.5-5.5l1.6-1.6c.4-.4.6-.9.5-1.4l-.5-3.2c-.1-.8-.8-1.4-1.6-1.4Z" />
      </svg>
    </a>
  );
}
