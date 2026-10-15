'use strict';

const crypto = require('crypto');

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;
const DEFAULT_PRODID = '-//Cheil PengTai//ICS Creator 1.0//EN';

/**
 * Date -> YYYYMMDDTHHMMSSZ (UTC)
 */
function formatUtc(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`잘못된 날짜 값입니다: ${date}`);
  }
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/**
 * RFC 5545 TEXT 값 이스케이프.
 * 백슬래시, 세미콜론, 콤마, 줄바꿈을 이스케이프한다. 문자 자체(한글, 아랍어, 히브리어 등 RTL 포함)는 그대로 유지한다.
 */
function escapeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * 75 바이트(UTF-8 octet) 초과 시 접기(folding).
 * 다음 줄은 공백 한 칸으로 시작하며, 멀티바이트 문자(한글/이모지/RTL 문자)가 중간에서 잘리지 않도록 코드포인트 단위로 자른다.
 */
function foldLine(line) {
  if (Buffer.byteLength(line, 'utf8') <= MAX_LINE_OCTETS) return line;

  const parts = [];
  let current = '';
  let currentBytes = 0;
  // 첫 줄은 75바이트, 이어지는 줄은 앞의 공백 1바이트를 제외한 74바이트
  let limit = MAX_LINE_OCTETS;

  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (currentBytes + chBytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current) parts.push(current);

  return parts.join(CRLF + ' ');
}

/**
 * 단일 이벤트를 담은 VCALENDAR 문자열 생성
 *
 * @param {object} opts
 * @param {string} opts.summary
 * @param {string} [opts.description]
 * @param {string} [opts.url]
 * @param {Date|string} opts.dtstart
 * @param {Date|string} [opts.dtstamp]   기본값: 현재 시각
 * @param {string} [opts.uid]            기본값: crypto.randomUUID()
 * @param {number|null} [opts.alarmMinutes] 알림(분 전). null/음수면 VALARM 생략
 * @param {string} [opts.prodId]
 */
function buildIcs(opts) {
  if (!opts || !opts.summary) throw new Error('SUMMARY(제목)는 필수입니다.');
  if (!opts.dtstart) throw new Error('DTSTART(시작 시간)는 필수입니다.');

  const uid = opts.uid || crypto.randomUUID();
  const dtstamp = formatUtc(opts.dtstamp || new Date());
  const dtstart = formatUtc(opts.dtstart);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${opts.prodId || DEFAULT_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `UID:${uid}`,
    `SUMMARY:${escapeText(opts.summary)}`,
  ];

  if (opts.description) lines.push(`DESCRIPTION:${escapeText(opts.description)}`);
  if (opts.url) lines.push(`URL:${String(opts.url).trim()}`);

  const alarm = opts.alarmMinutes;
  if (alarm !== null && alarm !== undefined && Number(alarm) >= 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:${formatTrigger(Number(alarm))}`,
      'END:VALARM'
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** 15 -> -P0DT0H15M0S */
function formatTrigger(minutes) {
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  return `-P${d}DT${h}H${m}M0S`;
}

/** 파일명에 쓸 수 없는 문자 제거 */
function safeFileName(name) {
  return String(name || 'event').replace(/[\\/:*?"<>|\s]+/g, '_') + '.ics';
}

module.exports = { buildIcs, formatUtc, escapeText, foldLine, formatTrigger, safeFileName, DEFAULT_PRODID };
