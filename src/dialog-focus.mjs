// Keep keyboard navigation inside the chooser, including browser chrome boundaries.
export function cycleDialogFocus(event) {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  const items = [...dialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length > 0);
  if (!items.length) { event.preventDefault(); dialog.focus(); return; }
  const first = items[0], last = items.at(-1);
  const active = dialog.ownerDocument.activeElement;
  if (!items.includes(active) || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }
}
