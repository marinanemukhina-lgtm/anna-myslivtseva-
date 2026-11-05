import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// All dates, IDs, text and databases here are synthetic. No production backup.
const script = new URL('../scripts/preview-shifter.py', import.meta.url).pathname;
const schema = `import sqlite3,sys,json
p=json.load(sys.stdin)
c=sqlite3.connect(sys.argv[1])
c.executescript('''
CREATE TABLE dias(fecha INTEGER PRIMARY KEY, turno1 INTEGER, turno2 INTEGER,
 horasExtraT1 INTEGER, horasExtraT2 INTEGER, salidaAnticipadaT1 INTEGER,
 salidaAnticipadaT2 INTEGER, horasExtraT1Acumula INTEGER, horasExtraT2Acumula INTEGER,
 notas TEXT, ingreso TEXT);
CREATE TABLE tablaTurnos(_id INTEGER PRIMARY KEY, horaInicio1 TEXT, horaFinal1 TEXT,
 horaInicio2 TEXT, horaFinal2 TEXT, turnoPartido INTEGER, tiempoDescanso INTEGER,
 tiempoTurno INTEGER, calcularTiempoTurnoManual INTEGER, texto TEXT, abreviatura TEXT);
''')
for row in p['shifts']: c.execute('INSERT INTO tablaTurnos VALUES (?,?,?,?,?,?,?,?,?,?,?)',row)
for row in p['days']: c.execute('INSERT INTO dias VALUES (?,?,?,?,?,?,?,?,?,?,?)',row)
if p.get('sql'): c.executescript(p['sql'])
c.commit()
c.close()
`;
const shift = (id = 1, start = '09:00', end = '11:00', extra = {}) => {
  const row = [id, start, end, '', '', 0, 0, '', 0, 'PRIVATE_SYNTHETIC_TITLE', 'PRIVATE_ABBR'];
  for (const [key, value] of Object.entries(extra)) row[+key] = value;
  return row;
};
const day = (date = 20310308, first = 1, second = 0, extra = {}) => {
  const row = [date, first, second, 0, 0, 0, 0, 0, 0, 'PRIVATE_NOTE $(touch /tmp/never-execute)', 'PRIVATE_INCOME'];
  for (const [key, value] of Object.entries(extra)) row[+key] = value;
  return row;
};
const run = path => {
  const process = spawnSync('python3', [script, path], { encoding: 'utf8' });
  assert.equal(process.stderr, '');
  return { status: process.status, output: JSON.parse(process.stdout), text: process.stdout };
};
async function fixture(fn, { shifts = [shift()], days = [day()], sql = '' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'synthetic-shifts-'));
  const path = join(dir, 'synthetic.Shifter');
  try {
    const setup = spawnSync('python3', ['-c', schema, path], { input: JSON.stringify({ shifts, days, sql }), encoding: 'utf8' });
    assert.equal(setup.status, 0, setup.stderr);
    await fn(path, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
function invalid(result, error) {
  assert.equal(result.status, 1); assert.equal(result.output.valid, false);
  assert.deepEqual(result.output.localSegments, []); assert.deepEqual(result.output.markers, []);
  assert.ok(result.output.errors.includes(error), result.text);
}

test('read-only exact bytes/hash, sanitized timing subset, no sidecar output', async () => {
  await fixture(async (path, dir) => {
    const before = await readFile(path);
    await chmod(path, 0o444);
    const result = run(path);
    assert.equal(result.status, 0); assert.equal(result.output.valid, true);
    assert.equal(result.output.applied, false); assert.equal(result.output.timezone, null);
    assert.equal(result.output.formatVersion, 'shifter-shift-preview-v2');
    assert.equal(result.output.dateEncoding, 'year-month0-day');
    assert.equal(result.output.meaning, 'unconfirmed-shift-intervals');
    assert.equal(result.output.sourceSha256, createHash('sha256').update(before).digest('hex'));
    assert.deepEqual(result.output.localSegments, [{ sourceDate: '2031-04-08', shiftId: 1, segment: 1, startLocal: '2031-04-08T09:00', endLocal: '2031-04-08T11:00', overnight: false }]);
    assert.doesNotMatch(result.text, /PRIVATE|touch|never-execute|synthetic|ingreso|notas/);
    assert.deepEqual(await readFile(path), before);
    assert.deepEqual(await readdir(dir), ['synthetic.Shifter']);
  });
});
test('equal endpoints are markers, zero assignments stay unassigned, missing dates unfilled', async () => {
  await fixture(async path => {
    const { output } = run(path);
    assert.equal(output.valid, true); assert.deepEqual(output.localSegments, []);
    assert.deepEqual(output.markers, [
      { sourceDate: '2031-04-08', shiftId: 1, segment: 1, kind: 'equal-endpoints-not-24-hours', localTime: '00:00' },
      { sourceDate: '2031-04-10', kind: 'unassigned-day' },
    ]);
    assert.equal(output.counts.unassignedDays, 1);
  }, { shifts: [shift(1, '00:00', '00:00')], days: [day(), day(20310310, 0)] });
});
test('potential overnight flagged, not converted to UTC', async () => {
  await fixture(async path => {
    const { output } = run(path);
    assert.equal(output.valid, true);
    assert.equal(output.localSegments[0].endLocal, '2031-04-09T02:00');
    assert.equal(output.localSegments[0].overnight, true);
    assert.ok(output.warnings.includes('POTENTIAL_OVERNIGHT_REQUIRES_CONFIRMATION'));
  }, { shifts: [shift(1, '22:00', '02:00')] });
});
test('split shifts and second assignments preserve separate segments; overlaps flagged', async () => {
  await fixture(async path => {
    const { output } = run(path);
    assert.equal(output.valid, true); assert.equal(output.localSegments.length, 3);
    assert.deepEqual(output.localSegments.map(item => item.segment), [1, 1, 2]);
    assert.ok(output.warnings.includes('OVERLAPPING_SHIFT_SEGMENTS'));
  }, { shifts: [shift(1, '09:00', '12:00', { 3: '13:00', 4: '17:00', 5: 1 }), shift(2, '11:00', '14:00')], days: [day(20310308, 1, 2)] });
});
test('bad references/dates and nonzero timing adjustments reject without partial output', async () => {
  await fixture(async path => invalid(run(path), 'MISSING_SHIFT_REFERENCE'), { days: [day(), day(20310309, 99)] });
  await fixture(async path => invalid(run(path), 'INVALID_SOURCE_DATE'), { days: [day(20310130)] });
  for (const column of [3, 4, 5, 6, 7, 8]) {
    await fixture(async path => invalid(run(path), 'UNSUPPORTED_TIMING_ADJUSTMENT'), { days: [day(20310308, 1, 0, { [column]: 1 })] });
  }
});
test('invalid split/time, break and manual duration fail closed', async () => {
  await fixture(async path => invalid(run(path), 'INVALID_SPLIT_FLAG'), { shifts: [shift(1, '09:00', '10:00', { 5: 2 })] });
  await fixture(async path => invalid(run(path), 'INVALID_SHIFT_TIME'), { shifts: [shift(1, '24:00', '10:00')] });
  for (const column of [6, 8]) await fixture(async path => invalid(run(path), 'UNSUPPORTED_BREAK_OR_MANUAL_DURATION'), { shifts: [shift(1, '09:00', '10:00', { [column]: 1 })] });
});
test('stored empty/integer duration never changes endpoints', async () => {
  await fixture(async path => {
    const { output } = run(path);
    assert.equal(output.valid, true);
    assert.equal(output.localSegments[0].endLocal, '2031-04-08T11:00');
  }, { shifts: [shift(1, '09:00', '11:00', { 7: 999 })] });
});
test('views, triggers and virtual tables rejected; no arbitrary schema execution', async () => {
  for (const sql of [
    'CREATE VIEW ignored_view AS SELECT texto FROM tablaTurnos;',
    'CREATE TRIGGER ignored_trigger AFTER INSERT ON dias BEGIN SELECT 1; END;',
    'CREATE VIRTUAL TABLE ignored_virtual USING fts5(secret);',
  ]) await fixture(async path => invalid(run(path), 'UNSUPPORTED_SQLITE_SCHEMA'), { sql });
});
test('sidecar, oversized, non-SQLite and missing file errors sanitized', async () => {
  await fixture(async (path, dir) => {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      await writeFile(path + suffix, 'PRIVATE_PAYLOAD');
      invalid(run(path), 'SQLITE_SIDECARS_PRESENT');
      await rm(path + suffix);
    }
    await writeFile(path, 'PRIVATE_NOT_SQLITE');
    invalid(run(path), 'NOT_SQLITE_DATABASE');
    await writeFile(path, Buffer.alloc(1024 * 1024 + 1));
    invalid(run(path), 'FILE_TOO_LARGE');
    const missing = run(join(dir, 'PRIVATE_MISSING.Shifter'));
    invalid(missing, 'FILE_OR_TIMING_READ_FAILED'); assert.doesNotMatch(missing.text, /PRIVATE_MISSING/);
  });
});
test('event and row bounds enforced', async () => {
  const days = Array.from({ length: 2501 }, (_, index) => {
    const date = new Date(Date.UTC(2031, 0, index + 1));
    const encoded = date.getUTCFullYear() * 10000 + date.getUTCMonth() * 100 + date.getUTCDate();
    return day(encoded, 1, 1);
  });
  await fixture(async path => invalid(run(path), 'EVENT_LIMIT_EXCEEDED'), { days });
  await fixture(async path => invalid(run(path), 'EVENT_LIMIT_EXCEEDED'), {
    days: days.map(row => { const copy = [...row]; copy[2] = 0; return copy; }),
    shifts: [shift(1, '00:00', '00:00', { 3: '13:00', 4: '17:00', 5: 1 })],
  });
  const shifts = Array.from({ length: 5001 }, (_, index) => shift(index + 1));
  await fixture(async path => invalid(run(path), 'ROW_LIMIT_EXCEEDED'), { shifts });
});
test('source mutation during preview detected by byte recheck', async () => {
  await fixture(async path => {
    const code = `import importlib.util,sys,json
s=importlib.util.spec_from_file_location('preview',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
original=m.read_bytes
calls=[0]
def changed(fd):
 calls[0]+=1
 if calls[0]==2:
  with open(sys.argv[2],'ab') as f: f.write(b'CHANGED_BY_TEST')
 return original(fd)
m.read_bytes=changed
print(json.dumps(m.preview(sys.argv[2])))
`;
    const process = spawnSync('python3', ['-B', '-c', code, script, path], { encoding: 'utf8' });
    assert.equal(process.status, 0, process.stderr);
    const output = JSON.parse(process.stdout);
    assert.equal(output.valid, false); assert.deepEqual(output.localSegments, []);
    assert.deepEqual(output.errors, ['SOURCE_CHANGED_DURING_PREVIEW']);
  });
});

// Encoding examples supplied for this regression are synthetic fixture rows only.
test('zero-based month encoding regressions and complete calendar validation', async () => {
  const cases = [
    [20260631, '2026-07-31'],
    [20260931, '2026-10-31'],
    [20261028, '2026-11-28'],
    [20260001, '2026-01-01'],
    [20261131, '2026-12-31'],
    [20240129, '2024-02-29'],
  ];
  for (const [raw, expected] of cases) {
    await fixture(async path => {
      const { output } = run(path);
      assert.equal(output.valid, true);
      assert.equal(output.localSegments[0].sourceDate, expected);
      assert.equal(output.localSegments[0].startLocal, expected + 'T09:00');
    }, { days: [day(raw)] });
  }
  for (const raw of [20261201, 20260129, 20260000, 20260032, 20260331, -1]) {
    await fixture(async path => invalid(run(path), 'INVALID_SOURCE_DATE'), { days: [day(raw)] });
  }
});
