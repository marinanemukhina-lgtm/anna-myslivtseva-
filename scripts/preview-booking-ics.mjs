#!/usr/bin/env node
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { previewBookingIcs, MAX_ICS_BYTES, ICS_PREVIEW_VERSION } from '../shared/booking-ics.mjs';

// Read only. No output file, network, persistence, application or backup decoding.
const failure = code => ({
  version: ICS_PREVIEW_VERSION, applied: false, sourceSha256: null, valid: false,
  counts: { events: 0, intervals: 0 }, intervals: [],
  warnings: ['PREVIEW_ONLY_NOT_APPLIED', 'OWNER_CONFIRMATION_WITH_SOURCE_HASH_AND_VERSION_REQUIRED'], errors: [code],
});
let handle, result;
try {
  const args = process.argv.slice(2);
  if (![1, 3].includes(args.length) || (args.length === 3 && (args[1] !== '--timezone' || !args[2])) || args[0].startsWith('--')) {
    result = failure('USAGE_FILE_OPTIONAL_TIMEZONE');
  } else if (extname(args[0]).toLowerCase() !== '.ics') result = failure('UNSUPPORTED_FILE_TYPE');
  else {
    handle = await open(args[0], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) result = failure('REGULAR_FILE_REQUIRED');
    else if (stat.size > MAX_ICS_BYTES) result = failure('FILE_TOO_LARGE');
    else {
      // Bounded even if another process grows the source after stat.
      const bytes = Buffer.alloc(MAX_ICS_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      result = previewBookingIcs(bytes.subarray(0, length), args.length === 3 ? { timezone: args[2] } : {});
    }
  }
} catch { result = failure('FILE_READ_FAILED'); }
finally { if (handle) { try { await handle.close(); } catch { result = failure('FILE_READ_FAILED'); } } }
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exitCode = result.valid ? 0 : 1;
