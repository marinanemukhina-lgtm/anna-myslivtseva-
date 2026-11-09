// Shared among instances from this module; no storage or network use.
const activeLocks = new WeakMap();
export function isDocumentScrollLocked(doc) { return Boolean(activeLocks.get(doc)?.count); }
function notify(doc) {
  const EventClass = doc.defaultView?.Event;
  if (EventClass && doc.dispatchEvent) doc.dispatchEvent(new EventClass("anna:dialog-scroll-lock"));
}
export function lockDocumentScroll(doc) {
  if (!doc?.documentElement?.style || !doc.body?.style) return () => {};
  let state = activeLocks.get(doc);
  if (!state) {
    const elements = [doc.documentElement, doc.body];
    state = { count: 0, saved: elements.map(element => ({
      element,
      value: element.style.getPropertyValue("overflow"),
      priority: element.style.getPropertyPriority("overflow"),
    })) };
    activeLocks.set(doc, state);
    for (const { element } of state.saved) element.style.setProperty("overflow", "hidden");
  }
  state.count += 1;
  notify(doc);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.count -= 1;
    if (state.count) return;
    for (const { element, value, priority } of state.saved) {
      // Do not overwrite a deliberate later change by another owner.
      if (element.style.getPropertyValue("overflow") !== "hidden") continue;
      if (value) element.style.setProperty("overflow", value, priority);
      else element.style.removeProperty("overflow");
    }
    activeLocks.delete(doc);
    notify(doc);
  };
}
