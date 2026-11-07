import React from 'react';
import { publicSocialLinks } from '../shared/contact-links.mjs';
export default function SocialLinks({ profile = {}, prominent = false }) {
  const links = publicSocialLinks(profile);
  if (!links.length) return null;
  return <div className={'social-links' + (prominent ? ' social-links-prominent' : '')} aria-label="Страницы и каналы Анны">
    {links.map(({key, label, href}) => <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}<span className="sr-only"> (в новой вкладке)</span><span aria-hidden="true"> ↗</span></a>)}
  </div>;
}
