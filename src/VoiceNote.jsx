import React, { useEffect, useRef, useState } from 'react';

const LIMIT = 4000;
const errors = {
  'not-allowed': 'Доступ к микрофону не разрешён. Разрешите его в настройках браузера или используйте клавиатуру.',
  'service-not-allowed': 'Распознавание недоступно в этом браузере. Используйте микрофон клавиатуры телефона.',
  'audio-capture': 'Микрофон недоступен. Проверьте его подключение и разрешения.',
  'no-speech': 'Речь не распознана. Можно повторить диктовку.',
  network: 'Сервис распознавания недоступен. Проверьте соединение или используйте клавиатуру.',
  'language-not-supported': 'Распознавание русского языка недоступно. Используйте клавиатуру.',
};

// Mounted separately for each card: late callbacks cannot write into another card.
export default function VoiceNote({ value, onChange, disabled, onBusy }) {
  const session = useRef(null);
  const [supported] = useState(() => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('');
  const [interim, setInterim] = useState('');
  const active = phase !== 'idle';

  function finish(recognition, message) {
    if (session.current?.recognition !== recognition) return;
    clearTimeout(session.current.timer);
    session.current = null;
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
    try { recognition.abort(); } catch { /* Some engines have already ended. */ }
    setPhase('idle'); setInterim(''); onBusy(false); setStatus(message);
  }

  useEffect(() => {
    const hide = () => {
      if (document.hidden && session.current) finish(session.current.recognition, 'Диктовка остановлена. Проверьте текст перед сохранением.');
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      const current = session.current;
      session.current = null;
      if (current) {
        clearTimeout(current.timer);
        current.recognition.onstart = current.recognition.onresult = current.recognition.onerror = current.recognition.onend = null;
        try { current.recognition.abort(); } catch { /* Already ended. */ }
        onBusy(false);
      }
    };
  }, [onBusy]);

  function start() {
    if (session.current || disabled || value.length >= LIMIT) return;
    let recognition;
    try {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new Recognition();
      const base = value.trimEnd();
      session.current = { recognition, timer: null };
      recognition.lang = 'ru-RU';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onstart = () => {
        if (session.current?.recognition !== recognition) return;
        if (!session.current.stopping) { setPhase('listening'); setStatus('Слушаю… Говорите по-русски.'); }
      };
      recognition.onresult = event => {
        if (session.current?.recognition !== recognition) return;
        const final = [], draft = [];
        // The API returns the cumulative list. Rebuild it, never append it twice.
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          (result.isFinal ? final : draft).push(result[0].transcript.trim());
        }
        const text = [base, ...final].filter(Boolean).join(' ');
        onChange(text.slice(0, LIMIT));
        setInterim(draft.join(' ').slice(0, LIMIT));
        if (text.length >= LIMIT) finish(recognition, 'Достигнут предел 4000 символов. Проверьте текст: продолжение не добавлено.');
      };
      recognition.onerror = event => finish(recognition, errors[event.error] || 'Диктовка прервана. Уже распознанный текст сохранён в поле.');
      recognition.onend = () => finish(recognition, 'Диктовка завершена. Проверьте текст и сохраните процедуру.');
      setPhase('starting'); setInterim(''); setStatus('Ожидаю доступ к микрофону…'); onBusy(true);
      recognition.start();
    } catch {
      if (recognition && session.current) finish(recognition, 'Не удалось начать диктовку. Используйте микрофон клавиатуры телефона или повторите попытку.');
      else setStatus('Распознавание недоступно. Используйте клавиатуру.');
    }
  }

  function stop() {
    const current = session.current;
    if (!current || current.stopping) return;
    current.stopping = true;
    setPhase('stopping'); setStatus('Завершаю диктовку…');
    // Release controls even if the browser fails to emit onend.
    current.timer = setTimeout(() => finish(current.recognition, 'Диктовка остановлена. Проверьте текст перед сохранением.'), 2000);
    try { current.recognition.stop(); }
    catch { finish(current.recognition, 'Диктовка остановлена. Проверьте текст перед сохранением.'); }
  }

  return <div className="clinical-voice-note">
    <label>Заметка к посещению<textarea value={value} onChange={e => onChange(e.target.value)} maxLength={LIMIT} rows={5} disabled={disabled || active} placeholder="Напишите или надиктуйте тестовое наблюдение" aria-describedby="voice-hint"/></label>
    <div className="clinical-voice-actions">
      {supported && <button className="clinical-secondary" type="button" disabled={disabled || phase === 'stopping' || (!active && value.length >= LIMIT)} aria-pressed={active} onClick={active ? stop : start}>{active ? 'Остановить диктовку' : 'Надиктовать'}</button>}
      <span className="clinical-note-count">{value.length} / {LIMIT}</span>
    </div>
    <p id="voice-hint" className="clinical-hint">{supported ? 'Для демо используйте тестовые фразы. Браузер может передавать речь внешнему сервису распознавания. Сохраняется только текст заметки.' : 'В этом браузере используйте микрофон на клавиатуре телефона или вводите текст вручную.'}</p>
    <p className="clinical-voice-status" aria-live="polite">{status}</p>
    {interim && <p className="clinical-voice-interim">Распознаётся: {interim}</p>}
  </div>;
}
