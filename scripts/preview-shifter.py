#!/usr/bin/env python3
"""Local, read-only timing preview of a bounded verified Shifter schema subset.
Not a booking importer: shift meanings, timezone and completeness are unconfirmed.
Only explicitly allowlisted timing columns are queried. No application/network path.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
from urllib.parse import quote

MAX_BYTES = 1024 * 1024
MAX_ROWS = 5000
ADJUSTMENTS = (
    'horasExtraT1', 'horasExtraT2', 'salidaAnticipadaT1', 'salidaAnticipadaT2',
    'horasExtraT1Acumula', 'horasExtraT2Acumula',
)
DAY_COLUMNS = ('fecha', 'turno1', 'turno2') + ADJUSTMENTS
SHIFT_COLUMNS = (
    '_id', 'horaInicio1', 'horaFinal1', 'horaInicio2', 'horaFinal2',
    'turnoPartido', 'tiempoDescanso', 'tiempoTurno', 'calcularTiempoTurnoManual',
)
WARNINGS = [
    'PREVIEW_ONLY_NOT_APPLIED',
    'SHIFT_MEANING_AND_TIMEZONE_REQUIRE_OWNER_CONFIRMATION',
    'NOT_APPOINTMENTS_OR_FREE_TIME',
    'COVERAGE_COMPLETENESS_UNKNOWN_NOTES_EXCLUDED',
    'MISSING_DATES_NOT_FILLED_OR_EXTRAPOLATED',
    'SOURCE_COVERAGE_AND_FRESHNESS_NOT_VERIFIED',
    'STORED_DURATION_NOT_USED_TO_DERIVE_INTERVALS',
    'OWNER_CONFIRMATION_WITH_SOURCE_HASH_AND_VERSION_REQUIRED',
]

class Rejected(Exception):
    pass

def reject(code):
    raise Rejected(code)

def integer(value):
    return type(value) is int

def fingerprint(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)

def sidecars(path):
    return any(os.path.lexists(str(path) + suffix) for suffix in ('-wal', '-shm', '-journal'))

def read_bytes(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    result = bytearray()
    while len(result) <= MAX_BYTES:
        block = os.read(fd, min(65536, MAX_BYTES + 1 - len(result)))
        if not block:
            break
        result.extend(block)
    if len(result) > MAX_BYTES:
        reject('FILE_TOO_LARGE')
    return bytes(result)

def parse_date(value):
    # Shifter fecha encodes a zero-based month, not conventional YYYYMMDD.
    # For example, month 00 is January and month 11 is December.
    if not integer(value) or value < 0:
        reject('INVALID_SOURCE_DATE')
    year, month_zero, day = value // 10000, (value // 100) % 100, value % 100
    if not 1000 <= year <= 9999 or not 0 <= month_zero <= 11:
        reject('INVALID_SOURCE_DATE')
    try:
        date = dt.date(year, month_zero + 1, day)
    except ValueError:
        reject('INVALID_SOURCE_DATE')
    return date

def parse_time(value):
    if type(value) is not str or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', value):
        reject('INVALID_SHIFT_TIME')
    return dt.time(int(value[:2]), int(value[3:]))

def validate_schema(connection):
    # SQLite identifies virtual/shadow tables even when CREATE SQL uses comments.
    table_list = connection.execute('PRAGMA table_list').fetchmany(501)
    if len(table_list) > 500:
        reject('SCHEMA_LIMIT_EXCEEDED')
    if any(row[2] in ('virtual', 'shadow', 'view') for row in table_list):
        reject('UNSUPPORTED_SQLITE_SCHEMA')
    schema = connection.execute("SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table','view','trigger') LIMIT 501").fetchall()
    if len(schema) > 500:
        reject('SCHEMA_LIMIT_EXCEEDED')
    tables = {}
    for name, kind, sql in schema:
        if kind in ('view', 'trigger') or (sql and re.match(r'\s*CREATE\s+VIRTUAL\s+TABLE\b', sql, re.I)):
            reject('UNSUPPORTED_SQLITE_SCHEMA')
        if kind == 'table':
            tables[name] = sql
    for table, columns in (('dias', DAY_COLUMNS), ('tablaTurnos', SHIFT_COLUMNS)):
        if table not in tables or not tables[table]:
            reject('EXPECTED_TABLE_MISSING')
        # Fixed table names, never interpolate source-supplied identifiers.
        rows = connection.execute('PRAGMA table_xinfo(' + table + ')').fetchall()
        if any(row[6] != 0 for row in rows):
            reject('UNSUPPORTED_SQLITE_SCHEMA')
        by_name = {row[1]: row for row in rows}
        if any(column not in by_name for column in columns):
            reject('EXPECTED_COLUMN_MISSING')
        for column in columns:
            expected = 'TEXT' if column.startswith('horaInicio') or column.startswith('horaFinal') else 'INTEGER'
            if by_name[column][2].upper() != expected:
                reject('UNSUPPORTED_COLUMN_TYPE')
        primary = 'fecha' if table == 'dias' else '_id'
        if by_name[primary][5] != 1 or sum(row[5] > 0 for row in rows) != 1:
            reject('UNSUPPORTED_PRIMARY_KEY')

def get_rows(connection, table, columns, order):
    # Arguments are constants above; no source text enters SQL.
    sql = 'SELECT ' + ','.join(columns) + ' FROM ' + table + ' ORDER BY ' + order + ' LIMIT 5001'
    rows = connection.execute(sql).fetchall()
    if len(rows) > MAX_ROWS:
        reject('ROW_LIMIT_EXCEEDED')
    return [dict(zip(columns, row)) for row in rows]

def preview(path):
    result = {
        'formatVersion': 'shifter-shift-preview-v2', 'dateEncoding': 'year-month0-day', 'sourceSha256': None,
        'applied': False, 'meaning': 'unconfirmed-shift-intervals', 'timezone': None,
        'valid': False, 'localSegments': [], 'markers': [],
        'counts': {'sourceDays': 0, 'shiftDefinitions': 0, 'assignedShifts': 0,
                   'segments': 0, 'markers': 0, 'unassignedDays': 0},
        'warnings': list(WARNINGS), 'errors': [],
    }
    fd = None
    connection = None
    try:
        if sidecars(path):
            reject('SQLITE_SIDECARS_PRESENT')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            reject('REGULAR_FILE_REQUIRED')
        if before.st_size > MAX_BYTES:
            reject('FILE_TOO_LARGE')
        original = read_bytes(fd)
        result['sourceSha256'] = hashlib.sha256(original).hexdigest()
        if not original.startswith(b'SQLite format 3\x00'):
            reject('NOT_SQLITE_DATABASE')
        # Open the already held descriptor, avoiding a path replacement between
        # the initial file check and SQLite open. Linux /proc is required.
        uri = 'file:' + quote('/proc/self/fd/' + str(fd), safe='/') + '?mode=ro&immutable=1'
        connection = sqlite3.connect(uri, uri=True, timeout=0)
        connection.enable_load_extension(False)
        connection.execute('PRAGMA trusted_schema=OFF')
        connection.execute('PRAGMA query_only=ON')
        connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_BYTES)
        connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 100000)
        ticks = [0]
        def progress():
            ticks[0] += 1
            return ticks[0] > 10000
        connection.set_progress_handler(progress, 1000)
        validate_schema(connection)
        days = get_rows(connection, 'dias', DAY_COLUMNS, 'fecha')
        shifts = get_rows(connection, 'tablaTurnos', SHIFT_COLUMNS, '_id')
        result['counts']['sourceDays'] = len(days)
        result['counts']['shiftDefinitions'] = len(shifts)
        definitions = {}
        for shift in shifts:
            key = shift['_id']
            if not integer(key) or key <= 0 or key in definitions:
                reject('INVALID_SHIFT_ID')
            if not integer(shift['turnoPartido']) or shift['turnoPartido'] not in (0, 1):
                reject('INVALID_SPLIT_FLAG')
            for field in ('tiempoDescanso', 'calcularTiempoTurnoManual'):
                if not integer(shift[field]) or shift[field] != 0:
                    reject('UNSUPPORTED_BREAK_OR_MANUAL_DURATION')
            # tiempoTurno is deliberately never a source of endpoints. Empty
            # strings occur despite INTEGER affinity; unsupported types fail.
            if not (integer(shift['tiempoTurno']) and shift['tiempoTurno'] >= 0) and shift['tiempoTurno'] != '':
                reject('UNSUPPORTED_STORED_DURATION')
            pairs = [(parse_time(shift['horaInicio1']), parse_time(shift['horaFinal1']))]
            if shift['turnoPartido'] == 1:
                pairs.append((parse_time(shift['horaInicio2']), parse_time(shift['horaFinal2'])))
            definitions[key] = pairs
        segments, markers = [], []
        for day in days:
            date = parse_date(day['fecha'])
            for field in ADJUSTMENTS:
                if not integer(day[field]) or day[field] != 0:
                    reject('UNSUPPORTED_TIMING_ADJUSTMENT')
            refs = [day['turno1'], day['turno2']]
            if any(not integer(ref) or ref < 0 for ref in refs):
                reject('INVALID_SHIFT_REFERENCE')
            if refs == [0, 0]:
                result['counts']['unassignedDays'] += 1
                markers.append({'sourceDate': date.isoformat(), 'kind': 'unassigned-day'})
            for ref in refs:
                if ref == 0:
                    continue
                if ref not in definitions:
                    reject('MISSING_SHIFT_REFERENCE')
                result['counts']['assignedShifts'] += 1
                if result['counts']['assignedShifts'] > MAX_ROWS:
                    reject('EVENT_LIMIT_EXCEEDED')
                if len(definitions[ref]) == 2 and 'SPLIT_DATES_ANCHORED_TO_SOURCE_DATE_UNCONFIRMED' not in result['warnings']:
                    result['warnings'].append('SPLIT_DATES_ANCHORED_TO_SOURCE_DATE_UNCONFIRMED')
                for number, (start, end) in enumerate(definitions[ref], 1):
                    item = {'sourceDate': date.isoformat(), 'shiftId': ref, 'segment': number}
                    if start == end:
                        markers.append(dict(item, kind='equal-endpoints-not-24-hours', localTime=start.isoformat(timespec='minutes')))
                        continue
                    overnight = end < start
                    start_local = dt.datetime.combine(date, start)
                    end_local = dt.datetime.combine(date, end) + dt.timedelta(days=int(overnight))
                    segments.append(dict(item, startLocal=start_local.isoformat(timespec='minutes'),
                                         endLocal=end_local.isoformat(timespec='minutes'), overnight=overnight))
                    if len(segments) + len(markers) > MAX_ROWS:
                        reject('EVENT_LIMIT_EXCEEDED')
        if len(segments) + len(markers) > MAX_ROWS:
            reject('EVENT_LIMIT_EXCEEDED')
        segments.sort(key=lambda item: (item['startLocal'], item['endLocal'], item['shiftId'], item['segment']))
        if any(item['overnight'] for item in segments):
            result['warnings'].append('POTENTIAL_OVERNIGHT_REQUIRES_CONFIRMATION')
        if any(item['kind'] == 'equal-endpoints-not-24-hours' for item in markers):
            result['warnings'].append('EQUAL_ENDPOINTS_ARE_MARKERS_NOT_24_HOURS')
        latest_end = ''
        for item in segments:
            if item['startLocal'] < latest_end and 'OVERLAPPING_SHIFT_SEGMENTS' not in result['warnings']:
                result['warnings'].append('OVERLAPPING_SHIFT_SEGMENTS')
            latest_end = max(latest_end, item['endLocal'])
        connection.close()
        connection = None
        after = os.fstat(fd)
        current = os.stat(path, follow_symlinks=False)
        if fingerprint(before) != fingerprint(after) or fingerprint(before) != fingerprint(current) or read_bytes(fd) != original:
            reject('SOURCE_CHANGED_DURING_PREVIEW')
        if sidecars(path):
            reject('SQLITE_SIDECARS_PRESENT')
        result['localSegments'], result['markers'] = segments, markers
        result['counts']['segments'], result['counts']['markers'] = len(segments), len(markers)
        result['valid'] = True
    except Rejected as error:
        result['errors'] = [str(error)]
    except sqlite3.Error:
        result['errors'] = ['SQLITE_READ_OR_SCHEMA_FAILED']
    except (OSError, ValueError, OverflowError):
        result['errors'] = ['FILE_OR_TIMING_READ_FAILED']
    except Exception:
        result['errors'] = ['PREVIEW_FAILED']
    finally:
        try:
            if connection is not None:
                connection.close()
            if fd is not None:
                os.close(fd)
        except (OSError, sqlite3.Error):
            result['valid'] = False
            result['localSegments'], result['markers'] = [], []
            result['counts']['segments'], result['counts']['markers'] = 0, 0
            result['errors'] = ['FILE_CLOSE_FAILED']
    return result

if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1].startswith('--'):
        output = {'formatVersion': 'shifter-shift-preview-v2', 'dateEncoding': 'year-month0-day', 'sourceSha256': None,
                  'applied': False, 'meaning': 'unconfirmed-shift-intervals', 'timezone': None,
                  'valid': False, 'localSegments': [], 'markers': [], 'counts': {},
                  'warnings': list(WARNINGS), 'errors': ['USAGE_EXACTLY_ONE_LOCAL_FILE']}
    else:
        output = preview(Path(sys.argv[1]))
    print(json.dumps(output, ensure_ascii=True, sort_keys=True))
    sys.exit(0 if output['valid'] else 1)
