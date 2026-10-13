# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

# Требования этого проекта

- Весь интерфейс на русском. Визуальный ориентир: https://www.odysseeclinic.com.au/.
- Сохранять композицию, пропорции, характер типографики и анимаций референса; не предлагать другие концепции.
- Использовать предоставленные фото и видео Анны, не копировать чужие материалы без разрешения.
- Не придумывать услуги, цены, квалификации, контакты и результаты лечения. Пустые поля заполняет владелец через `/admin`.
- Панель должна сохранять настоящие данные на сервере, поддерживать новости, акции, массажи/услуги, цены, биографию и дипломы.
- Целевая поставка — GitHub и Vercel. Не заменять API статическими демонстрационными обработчиками.

# Уточнение визуального направления

- Первый вариант отклонён: мелкие белые подписи на фотографии не читаются, повторяющиеся короткие блоки выглядят незавершённо.
- Нужны крупная выразительная кириллическая типографика, контрастная навигация, полноценные редакционные разделы и длинная композиция референса. Допускается переместить текст относительно исходника ради читаемости.
- Страница дипломов должна открываться прямо с первого экрана и иметь самостоятельную композицию; нельзя подменять отсутствующие дипломы вымышленными документами.
- Портрет можно оживить естественным морганием и небольшим движением. Не выдавать CSS-приближение фотографии за сгенерированное видео.

- Согласованный портрет: сохранить полную фигуру, возраст и узнаваемость; улыбка — по фотографии Анны с цветком. На первом экране использовать видео с прямым взглядом, улыбкой и естественным морганием, с возможностью остановить движение.

- Живой портрет должен двигаться медленно и спокойно: первый ролик показался суетливым. Текущая версия замедлена в 2,2 раза. Пользователь просит немного увеличить глаза; подготовлен отдельный исходный портрет, эта правка пока не перенесена в видео.

- Пользователь отклонил заголовок «За словами — документы»: неестественно по-русски. Использовать ясный заголовок «Образование и дипломы».

- Пользователь отклонил пёстрые цвета в роликах массажа; нужны спокойные нейтральные оттенки и более современное оформление кабинета. Текущая правка — цветокоррекция; полная замена интерьера пока не выполнена.
