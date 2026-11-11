import { parseClinicalJSON } from '../shared/clinical-json.mjs';
// Upgraded tabs cooperate via one origin-scoped Web Lock. Older writers do not.
// This is not server storage and cannot protect against browser eviction/clearing.
export const CLINICAL_KEY = 'anna-open-synthetic-clinical-v1';
export const LEGACY_BACKUP_KEY = CLINICAL_KEY + ':original-v1';
export const RAW_BACKUP_KIND = 'anna-clinical-raw-backup';
const LOCK = CLINICAL_KEY + ':write';
const fail = code => { throw Object.assign(new Error(code), { code }); };

// JSON escaping preserves every UTF-16 code unit, even lone surrogates, through
// UTF-8 Blob download. Blob([raw]) is NOT lossless for arbitrary JS strings.
export function encodeRawClinicalBackup(raw, sourceKey = CLINICAL_KEY) {
  if (typeof raw !== 'string' || ![CLINICAL_KEY, LEGACY_BACKUP_KEY].includes(sourceKey)) fail('INVALID_RAW_BACKUP');
  return JSON.stringify({ kind: RAW_BACKUP_KIND, version: 1, sourceKey, raw });
}
export function decodeRawClinicalBackup(text) {
  const value = parseClinicalJSON(text);
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'kind,raw,sourceKey,version' ||
      value.kind !== RAW_BACKUP_KIND || value.version !== 1 || typeof value.raw !== 'string' ||
      ![CLINICAL_KEY, LEGACY_BACKUP_KEY].includes(value.sourceKey)) fail('INVALID_RAW_BACKUP');
  return value;
}

// Deliberately supports even corrupt source raw. It restores only into an absent
// primary key, never overwrites, never repairs, and requires subsequent reload.
export async function restoreRawClinicalBackup({ storage, locks }, text) {
  const backup = decodeRawClinicalBackup(text);
  if (!locks?.request) fail('LOCKS_UNAVAILABLE');
  return locks.request(LOCK, () => {
    if (storage.getItem(CLINICAL_KEY) !== null) fail('RESTORE_REQUIRES_EMPTY_STORAGE');
    storage.setItem(CLINICAL_KEY, backup.raw);
    if (storage.getItem(CLINICAL_KEY) !== backup.raw) fail('WRITE_UNVERIFIED');
    return { sourceKey: backup.sourceKey, codeUnits: backup.raw.length };
  });
}

export function openClinicalStorage({ storage, locks, restore, empty, example }) {
  let observed, blocked = false, state, legacy = false, pending = false, exportAllowed = false;
  try {
    observed = storage.getItem(CLINICAL_KEY);
    if (observed === null) state = example();
    else {
      const parsed = parseClinicalJSON(observed);
      state = restore(parsed);
      legacy = parsed.schema === 'anna-open-synthetic-clinical-v1';
    }
    exportAllowed = true;
  } catch { blocked = true; state = empty(); }
  const original = observed, openedLegacy = legacy;
  let legacyBackupSnapshot, backupReadError;
  try { legacyBackupSnapshot = storage.getItem(LEGACY_BACKUP_KEY); }
  catch (error) { backupReadError = error; }
  if (!locks?.request) blocked = true;
  return {
    state,
    sourceIsLegacy: openedLegacy,
    get blocked() { return blocked; },
    get exportAllowed() { return exportAllowed; },
    raw() { return original; },
    legacyRaw() { if (backupReadError) throw backupReadError; return legacyBackupSnapshot; },
    invalidate({ exports = false } = {}) { blocked = true; if (exports) exportAllowed = false; },
    // Later write conflicts do not invalidate this tab's last valid state.
    currentExport(next) {
      if (!exportAllowed) fail('EXPORT_BLOCKED');
      return restore(next);
    },
    async save(next) {
      if (!locks?.request) fail('LOCKS_UNAVAILABLE');
      if (blocked) fail('STORAGE_BLOCKED');
      if (pending) fail('WRITE_PENDING');
      const validated = restore(next), serialized = JSON.stringify(validated);
      pending = true;
      try {
        return await locks.request(LOCK, () => {
          if (blocked) fail('STORAGE_BLOCKED');
          if (storage.getItem(CLINICAL_KEY) !== observed) { blocked = true; fail('STORAGE_CONFLICT'); }
          if (legacy) {
            const backup = storage.getItem(LEGACY_BACKUP_KEY);
            if (backup !== null && backup !== observed) fail('BACKUP_CONFLICT');
            if (backup === null) storage.setItem(LEGACY_BACKUP_KEY, observed);
            if (storage.getItem(LEGACY_BACKUP_KEY) !== observed) { blocked = true; fail('BACKUP_FAILED'); }
            legacyBackupSnapshot = observed; backupReadError = undefined;
          }
          storage.setItem(CLINICAL_KEY, serialized);
          try {
            if (storage.getItem(CLINICAL_KEY) !== serialized) fail('WRITE_UNVERIFIED');
          } catch { blocked = true; fail('WRITE_UNVERIFIED'); }
          observed = serialized; legacy = false;
          return validated;
        });
      } finally { pending = false; }
    },
  };
}

// Add-only: validate both datasets before merging, reject any identity collision.
export function mergeClinicalArchive(current, incoming, restore) {
  const a = restore(current), b = restore(incoming);
  const ids = new Set([...a.clients, ...a.visits, ...a.photos].map(x => x.id).filter(Boolean));
  const labels = new Set(a.clients.map(x => x.label));
  if (b.clients.some(x => labels.has(x.label)) ||
      [...b.clients, ...b.visits, ...b.photos].some(x => x.id && ids.has(x.id))) fail('IMPORT_CONFLICT');
  return restore({ ...a, clients: [...a.clients, ...b.clients], visits: [...a.visits, ...b.visits], photos: [...a.photos, ...b.photos] });
}
