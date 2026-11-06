// Browser-only build alias for the two randomBytes calls in the demo engine.
// Native Node/server modules continue using node:crypto.
export function randomBytes(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return { toString(encoding) {
    if (encoding !== 'hex') throw Error('Unsupported demo encoding');
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  } };
}
