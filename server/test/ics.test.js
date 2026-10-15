'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildIcs, foldLine, formatUtc, formatTrigger } = require('../src/ics');
const { parseWorkbook } = require('../src/excel');
const { makeSample, COLUMNS } = require('../scripts/make-sample');

/** 접힌 줄을 다시 펼치고 TEXT 이스케이프를 해제 */
function unfold(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}
function unescape(v) {
  return v.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
}

test('formatUtc / trigger', () => {
  assert.strictEqual(formatUtc('2026-08-27T12:00:00Z'), '20260827T120000Z');
  assert.strictEqual(formatTrigger(15), '-P0DT0H15M0S');
  assert.strictEqual(formatTrigger(1500), '-P1DT1H0M0S');
});

test('buildIcs: 필수 구조, CRLF, 75바이트 접기', () => {
  const ics = buildIcs({
    summary: 'Galaxy Event',
    description: 'Aug. 27, 2026 at 8:00 AM \nLive on Samsung.com',
    url: 'www.samsung.com/ca',
    dtstart: '2026-08-27T12:00:00Z',
    dtstamp: '2026-08-21T08:00:00Z',
    uid: 'c9ed119f-41cb-443c-b5d1-baa58fc61f7a',
    alarmMinutes: 15,
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'LF 단독 사용 없음');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  const flat = unfold(ics);
  assert.match(flat, /\r\nDTSTART:20260827T120000Z\r\n/);
  assert.match(flat, /\r\nDTSTAMP:20260821T080000Z\r\n/);
  assert.match(flat, /\r\nUID:c9ed119f-41cb-443c-b5d1-baa58fc61f7a\r\n/);
  assert.match(flat, /\r\nDESCRIPTION:Aug. 27\\, 2026 at 8:00 AM \\nLive on Samsung.com\r\n/);
  assert.match(flat, /\r\nURL:www.samsung.com\/ca\r\n/);
  assert.match(flat, /BEGIN:VALARM\r\nACTION:DISPLAY\r\n.*\r\nTRIGGER:-P0DT0H15M0S\r\nEND:VALARM/);
});

test('foldLine: 멀티바이트 문자를 자르지 않음', () => {
  const line = 'SUMMARY:' + '가나다라마바사아자차카타파하'.repeat(5) + 'حدث جالكسي'.repeat(5);
  const folded = foldLine(line);
  for (const part of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(part) <= 75);
    assert.ok(!part.includes('�'));
  }
  assert.strictEqual(folded.replace(/\r\n /g, ''), line);
});

test('엑셀 파싱 → ICS: 로컬어(RTL 포함) 완전 보존', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ics-')), 'sample.xlsx');
  await makeSample(file);
  const result = await parseWorkbook(fs.readFileSync(file));
  assert.strictEqual(result.marker, 'C1');
  assert.deepStrictEqual(result.countries.map((c) => c.code), COLUMNS.map((c) => c[0]));

  result.countries.forEach((c, i) => {
    const [, lang, summary, desc, url] = COLUMNS[i];
    assert.strictEqual(c.language, lang);
    assert.strictEqual(c.summary, summary);
    assert.strictEqual(c.description, desc.trim());
    assert.strictEqual(c.url, url);

    const flat = unfold(buildIcs({ ...c, dtstart: '2026-08-27T12:00:00Z' }));
    const get = (k) => unescape(flat.match(new RegExp(`\\r\\n${k}:(.*)\\r\\n`))[1]);
    assert.strictEqual(get('SUMMARY'), summary);
    assert.strictEqual(get('DESCRIPTION'), desc.trim());
  });
});

test('parseGrid: 병합으로 채워진 라벨, A1 기준 오프셋 grid', () => {
  const { parseGrid } = require('../src/excel');
  const grid = [
    ['', '', '', ''],
    ['', '', 'V', ''],
    ['', '', 'CA', 'SA'],
    ['', '', 'English', 'Arabic'],
    ['Copy', 'Summary', 'Galaxy Event', 'حدث جالكسي'],
    ['Copy', 'Description', 'Aug. 27\nLive', 'مباشر'],
    ['Copy', 'URL', 'www.samsung.com/ca', 'www.samsung.com/sa'],
  ];
  const r = parseGrid(grid);
  assert.strictEqual(r.marker, 'C2');
  assert.deepStrictEqual(
    r.countries.map((c) => [c.code, c.language, c.summary, c.description, c.url]),
    [
      ['CA', 'English', 'Galaxy Event', 'Aug. 27\nLive', 'www.samsung.com/ca'],
      ['SA', 'Arabic', 'حدث جالكسي', 'مباشر', 'www.samsung.com/sa'],
    ]
  );
});

test('DRM(비 OOXML) 파일: exceljs 실패 → Excel 자동화로 폴백 (Windows 외에서는 안내 오류)', async () => {
  // NASCA 보호 파일은 zip 구조가 아니므로 exceljs가 실패한다
  const drmLike = Buffer.from('<## NASCA DRM FILE - VER1.00 ##>' + '\0'.repeat(64));
  if (process.platform === 'win32') return;
  await assert.rejects(parseWorkbook(drmLike, 'copy.xlsx'), /Windows에서만 지원/);
});
