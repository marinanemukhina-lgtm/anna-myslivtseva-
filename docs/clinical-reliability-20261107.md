# Демо-кабинет Анны: проверка сохранения фото и диктовки

Scope: only synthetic histories stored in this browser. No private patient records, production database writes, personal data or public owner invitation. No calendar, authentication or site content changes.

- Photo encoder: variable JPEG quality plus downscaling when a resulting photo would violate the current 1,400,000-character schema ceiling. Never report success until localStorage accepts the updated state.
- Replacement: existing chosen visit and angle; old photo stays if decoding, encoding or storage fails.
- Dictation: pending transcript is retained as an *unconfirmed draft* and can be corrected before the separate Save Procedure action. A stalled microphone startup stops after 10 seconds, with a keyboard fallback.
- Cleanup: the already-existing button **Начать с пустого кабинета** clears the whole synthetic demo of this one browser after confirmation; it does not delete pictures from iPhone Photos or touch production CMS/calendar.
- Release guard: Vercel automatic deployment for this branch is explicitly disabled. This branch is a review candidate, not a published repair.

Still outstanding: add arbitrary photos per visit, individual deletion, selected-patient PDF export, portable ZIP export/restore and workflow for eventual securely hosted patient data. Real iPhone/Safari verification has not been completed.
