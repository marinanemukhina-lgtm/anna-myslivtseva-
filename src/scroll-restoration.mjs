// History targets can exceed the first layout after a route remount. Keep the
// target until it is reachable instead of accepting the browser's clamped value.
export function restorePageScroll({ root, top, getLenis, focusTarget, onFinish }) {
  const view = root.ownerDocument.defaultView;
  let observer, frame, timeout, stopped = false, focused = false;
  const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  const mediaEvents = ['load', 'loadedmetadata', 'error'];
  const stop = () => {
    stopped = true;
    observer?.disconnect();
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    if (timeout !== undefined) view.clearTimeout(timeout);
    for (const event of inputEvents) view.removeEventListener(event, finish);
    for (const event of mediaEvents) root.removeEventListener(event, apply, true);
    view.removeEventListener('resize', apply);
  };
  const finish = () => {
    if (stopped) return;
    stop();
    onFinish();
  };
  const apply = () => {
    if (stopped) return;
    const target = top();
    const lenis = getLenis();
    lenis?.resize();
    lenis?.scrollTo(target, { immediate: true, force: true });
    view.scrollTo({ top: target, left: 0, behavior: 'instant' });
    if (focusTarget && !focused) {
      focusTarget.focus({ preventScroll: true });
      focused = true;
    }
    if (Math.abs(view.scrollY - target) <= 1) finish();
  };
  apply();
  if (!stopped) {
    observer = new view.ResizeObserver(apply);
    observer.observe(root);
    frame = view.requestAnimationFrame(apply);
    // Changed CMS content may now be shorter; do not retain an observer forever.
    timeout = view.setTimeout(finish, 5000);
    for (const event of inputEvents) view.addEventListener(event, finish, { passive: true });
    for (const event of mediaEvents) root.addEventListener(event, apply, true);
    view.addEventListener('resize', apply);
  }
  return stop;
}
