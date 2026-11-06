// Read-only summary. Opening this page never saves CMS or marketing content.
(async () => {
  const el = id => document.getElementById(id);
  const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
  const https = value => typeof value === 'string' && /^https:\/\/[^\s]+$/i.test(value);
  const media = value => typeof value === 'string' && /^\/(?:media\/[a-zA-Z0-9_.-]+|api\/media\/[a-f0-9-]+)$/.test(value);
  try {
    const response = await fetch('/api/admin/marketing/materials', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error();
    const { profile, diplomas, profileDraft, socialChannels, editorialPlan } = await response.json();
    el('annaDescription').textContent = [profile.name, profile.role, profile.intro, profile.about].filter(Boolean).join('\n\n');
    if (!profile.intro && !profile.about) el('annaDescription').append(text('p', 'Развёрнутое описание пока не сохранено. Подготовленный текст находится рядом.'));
    el('annaPrepared').textContent = profileDraft.intro + '\n\n' + profileDraft.about;
    el('annaPreparedSource').textContent = profileDraft.source;
    el('annaQualification').textContent = profile.qualification || 'Сведения об образовании пока не заполнены.';
    for (const [key, label] of [...socialChannels, ['primary', 'Основная ссылка сайта']]) {
      const url = key === 'primary' ? profile.socialUrl : profile.socialLinks?.[key];
      const item = text('li', label + ': ');
      if (https(url)) { const a = text('a', url); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; item.append(a, text('span', ' · ссылка сохранена')); }
      else item.append(text('span', 'адрес пока не указан'));
      el('annaSocials').append(item);
    }
    if (!diplomas.length) el('annaDiplomas').append(text('p', 'В админке пока нет загруженных дипломов. Названия курсов из плана не заменяют документы Анны.'));
    for (const diploma of diplomas) {
      const item = document.createElement('article');
      item.append(text('h3', diploma.title), text('p', [diploma.issuer, diploma.year, diploma.published ? 'Опубликован' : 'Черновик'].filter(Boolean).join(' · ')), text('p', diploma.body));
      if (media(diploma.image)) { const a = text('a', 'Посмотреть документ'); a.href = diploma.image; a.target = '_blank'; a.rel = 'noopener noreferrer'; item.append(a); }
      el('annaDiplomas').append(item);
    }
    for (const stage of editorialPlan) {
      const item = document.createElement('article'), list = document.createElement('ul');
      item.append(text('h3', stage.stage), text('p', stage.goal));
      stage.items.forEach(value => list.append(text('li', value)));
      item.append(list); el('annaPlan').append(item);
    }
    el('materialsStatus').textContent = 'Данные из админки загружены. Открытие страницы не меняет материалы сайта.';
  } catch {
    el('materialsStatus').textContent = 'Не удалось загрузить материалы. Обновите страницу; сохранённые данные не изменены.';
  }
})();
