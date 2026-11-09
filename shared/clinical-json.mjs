// Reject duplicate object keys, including escaped equivalents. JSON.parse alone
// silently drops them. Syntax validation is done before this depth-limited scan.
export function parseClinicalJSON(raw) {
  const parsed = JSON.parse(raw);
  let at = 0;
  const ws = () => { while (at < raw.length && /\s/.test(raw[at])) at++; };
  function string() {
    const start = at++;
    while (at < raw.length) {
      if (raw[at++] === '"') return JSON.parse(raw.slice(start, at));
      if (raw[at - 1] === '\\') at++;
    }
  }
  function value(depth = 0) {
    if (depth > 100) throw Error('JSON_TOO_DEEP');
    ws();
    if (raw[at] === '"') { string(); return; }
    if (raw[at] === '{') {
      at++; ws(); const keys = new Set();
      if (raw[at] === '}') { at++; return; }
      while (true) {
        ws(); const key = string();
        if (keys.has(key)) throw Error('JSON_DUPLICATE_KEY');
        keys.add(key); ws(); at++; value(depth + 1); ws();
        if (raw[at++] === '}') return;
      }
    }
    if (raw[at] === '[') {
      at++; ws();
      if (raw[at] === ']') { at++; return; }
      while (true) { value(depth + 1); ws(); if (raw[at++] === ']') return; }
    }
    while (at < raw.length && !/[\s,}\]]/.test(raw[at])) at++;
  }
  value();
  return parsed;
}
