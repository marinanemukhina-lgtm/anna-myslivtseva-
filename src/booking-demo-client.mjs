export function createBrowserBookingClient() {
  const worker = new Worker(new URL('./booking-demo-worker.mjs', import.meta.url), { type: 'module' });
  const pending = new Map(); let next = 0, stopped = false;
  const stop = () => {
    stopped = true;
    for (const { reject } of pending.values()) reject(Object.assign(Error('Демонстрация прервалась. Обновите страницу.'), { definite: true }));
    pending.clear(); worker.terminate();
  };
  worker.onerror = stop;
  worker.onmessageerror = stop;
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id); if (!item) return; pending.delete(data.id);
    if (data.error) item.reject(Object.assign(Error(data.error), { code: data.error, definite: true }));
    else item.resolve(data.result);
  };
  return { close: stop, call(path, body, session) {
    if (stopped) return Promise.reject(Object.assign(Error('Демо завершено. Обновите страницу.'), { definite: true }));
    return new Promise((resolve,reject) => { const id = ++next; pending.set(id,{resolve,reject}); worker.postMessage({ id, path, body, session }); });
  } };
}
