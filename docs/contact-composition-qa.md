# Contact composition recovery QA, 8 November 2026

## Scope and visual grounding

This isolated recovery starts from production commit `d37630287496752ca94167b6f595a279cdc7c758`. The former local candidate `1c41510b4e8bc6925e1bd2d907f63eaa6b414759` and its patch disappeared when the execution environment changed. The implementation and checks are being reconstructed from the task's recorded changes, not represented as a byte-identical recovery without a matching tree.

The new branch is `feat/anna-contact-composition-recovery-20261108`; public deployment must remain disabled in `vercel.json`.

On 8 November 2026 the recovery implementer personally re-inspected both supplied user screenshots and the restored Kalm award-era footer, services and gallery references. This is reference review, not a rendered-candidate approval. Their raster dimensions are **not** CSS viewport dimensions. They are not committed or included in CI artifacts. The Kalm direction is grounded in the award-era footer, services and gallery on Awwwards, not the redesigned current live site or an unfinished loading screen:

- https://www.awwwards.com/inspiration/footer-kalm-moments
- https://www.awwwards.com/sites/kalm-moments

Adapted principles: one connected contact composition, softer blue/milk surfaces, a clear serif hierarchy, authentic Anna media, compact useful groups and monochrome actions. No third-party photos, spa claims, invented prices, hours or contact channels are introduced.

## Changes requiring visual review

- The home hero pairs text with an uncropped 4:5 portrait/video. Mobile places a compact full-frame portrait beside the actions, with diploma access in the first viewport. The supplied photo/video files are unchanged.
- One contact composition replaces the hero, closed-calendar advertisement and repeated contact section. Address/visit format, hours, map, email, booking link and channels appear only when supplied.
- Contact-page footer completes the page with identity, navigation, legal links and animation/admin controls. Other pages get one compact contact panel and one static contact action. No moving/cropped CTA marquee.
- Clear labels replace abbreviated contact labels and missing-value dashes. SVG arrows replace platform emoji.
- Sparse service/news/offer pages have honest, content-sized empty states. Empty news/offer promotions are not expanded into home sections.
- Repeated home footage and repeated approach text are removed. Both distinct session videos remain in one editorial group; published philosophy and CMS texts remain.
- Internal navigation resets scroll after the new route commits. Entry-specific positions preserve Back/Forward, including same-path hash entries, without a per-scroll history write loop. The skip-link transfers keyboard focus to main.

## Automated browser matrix

`npm run test:composition` defines **56** cases:

- Chromium: 1440×960, 320×740 CSS px.
- WebKit: 390×844, 768×1024, 820×1180, 1024×1366, 1024×768 CSS px.
- Each viewport: normal movement (`no-preference`, asserted `.motion-on`) and reduced movement (`reduce`, asserted `.motion-off`).
- Each movement setting: production-shaped sparse contact; filled contact; production-shaped full-home and navigation/history journey; sparse services/about/diplomas walkthrough.

Test names and capture filenames label sparse data `production-shaped-synthetic-phone` and populated data `synthetic-filled`. These are synthetic QA captures, not captures of production content or a real contact number.

Sparse fixtures use Anna's identity/portrait, the published visit-format text and a synthetic phone of the same format. They have no invented email, hours, channels, services, documents, news or offers. Filled fixtures are explicitly synthetic and add optional fields to test layout growth.

Guards cover:

- No horizontal overflow or colliding header controls.
- Contact heading below the fixed header, one contact composition and no repeated footer contact on `/contact`.
- Phone/SMS tap targets, complete number, monochrome arrow, keyboard focus, real portrait loading; home portrait and primary/diploma links within the first viewport, actual playing/paused portrait state.
- Content-sized lower area, bounded footer and sparse page height.
- Optional information and channels appear only in the populated fixture.
- Diploma, privacy, terms, animation and admin access remain.
- No form/input, contact/booking request or non-GET write from public journeys.
- From the bottom of home: header CTA → contact top, Back → previous home position, Forward → contact top, footer CTA → contact top, rapid repeated navigation, menu dismissal/focus, repeat same-route CTA, same-path hash navigation and Back/Forward for introduction/documents, skip-link keyboard focus.
- A cold `/services#services` load with delayed synthetic CMS data stays at the top while the anchor is absent, then aligns the hydrated anchor to the scroll-padding offset below the header. This regression runs inside the existing route walkthrough, keeping the matrix at 56 cases; it creates no additional captures.
- Full-page and bottom-scroll images wait for CMS hydration, fonts and relevant image/video loading. Hidden `aria-hidden` portrait video is not awaited in the paused/reduced-motion case; the displayed portrait image is checked. Non-hidden session video metadata is checked without requiring playback in reduced motion.

Images are output to `.qa/composition/` and uploaded by the isolated `public-composition` CI job as `public-composition-qa`, together with the browser report. This keeps the existing full browser suite and its time budget separate. These are review captures and layout assertions, **not** approved pixel-diff baselines. Visual approval requires personally viewing the exact-commit full-page and bottom captures, especially all four tablet sizes and both motion modes.

## Local verification and test migration

Fresh recovery checks on 8 November 2026, reported by the recovery implementer:

- `npm test`: 196 tests, 195 passed, 1 skipped, 0 failed.
- `npm run build`: passed.
- `npm run test:sites`: 4/4 passed.
- `node scripts/verify-browser-booking.mjs`: compiled worker verification passed.
- Playwright discovery: 260 existing cases and 56 composition cases. Discovery is not browser execution.

Results for the former missing candidate are not evidence for this recovery. The default HTML reporter encountered a read-only-filesystem error during a previous discovery attempt, after listing the tests. Repeat discovery uses `--reporter=list` to avoid writing a report. No browser or app server is started by these discovery checks.

The exact unit-test migration relative to base `d37630287496752ca94167b6f595a279cdc7c758` is **10 removed, 5 added** (net −5):

- Removed: nine parameterized closed-calendar notice cases plus its default no-calendar-promise case.
- Added: populated ContactActions details/icon case; contact-page/regular-footer case; empty-footer case; published-philosophy case; server contact fallback/safe-link case.
- Three existing tests were renamed/reworked, not added: Contact integration source contract, home structure contract, and the former desktop-scrim test now guarding the full-frame portrait and controls. The hero guard therefore is not a sixth added case.

The seven real Contact integration cases remain. Backend intake, availability and authentication tests were not weakened or changed. With the fresh current total of 196, the source-level net change implies a baseline total of 201, not the earlier reported 200; no new baseline test execution is claimed here.

## Release gate

No local browser is launched because that route was previously denied. No new rendered screenshots are claimed. Do not describe the implementation as visually verified until permitted CI has run for the exact candidate commit and its images have been reviewed. Do not publish or deploy this branch as part of QA. Backend, credentials, databases, PR20/21 and other projects are outside this change.

## First PR24 CI and follow-up corrections

The first remote candidate `b7b9b709f3eebb701f0ada256b985ae71d3819c2` (same tree as the local recovery candidate) did not pass CI. Desktop reduced-motion captures confirmed the improved single contact composition, but did not establish tablet/mobile or whole-site approval.

Two failures were investigated without launching a local browser:

- Back from contact to the home footer restored 2512 px instead of the saved 2590 px and stayed there. The trace confirms this in reduced motion, so it is not only a Lenis issue. The restoration code accepted any clamped result and cleared its pending target after one synchronous remount layout. The exact asset or layout responsible for the 78 px difference is not established by the old trace.
- Calendar tests used four exact accessible-name strings with an extra space before a colon. These strings already existed in base `d376302`; they were not introduced by the recovery. The locators now match the unchanged AdminCalendar labels.

The follow-up retains a pending target when the browser cannot yet reach it, retries after layout/media changes and one animation frame, uses the current Lenis instance, and cancels on user input or another route. Observers, listeners and timers are removed on success or after a five-second ceiling for genuinely shorter content. Six explicit unit regressions cover clamping, successful completion, cancellation, current Lenis, focus and bounded cleanup. They are included in `npm test`. Browser position tolerances are unchanged; the next CI attaches before/immediate/frame/finished geometry with the requested position.

The visible header booking label now has a flex gap and the explicit accessible name “Запись на приём”, including on narrow screens. Sparse home content now uses a compact two-route surface instead of a repeated filler portrait and a large empty education promotion. Unpublished documents are described honestly. Without published approach text, both real clips share a heading without an empty text column. Published intro, biography, qualification, approach and document content remains available. The introduction anchor and first-screen diploma access remain.

Composition `maxFailures: 0` allows every viewport to produce diagnostic results while preserving a failed exit status. All captures remain synthetic and clearly named.

Fresh follow-up local checks: `npm test` 204 tests, 203 passed, 1 optional PostgreSQL skip, 0 failures; production build passed; Sites 4/4; compiled booking worker passed; discovery 260 + 56; diff-check passed. No new browser execution or visual approval is claimed. A second exact-commit CI run and full-page/bottom image review are required.
