/** 자주 쓰는 타임존 목록 (값: IANA 타임존) */
export const TIME_ZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/Toronto', label: 'America/Toronto (EST/EDT)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT)' },
  { value: 'America/Mexico_City', label: 'America/Mexico_City' },
  { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Asia/Riyadh', label: 'Asia/Riyadh (AST)' },
  { value: 'Asia/Jerusalem', label: 'Asia/Jerusalem (IST/IDT)' },
  { value: 'Asia/Karachi', label: 'Asia/Karachi (PKT)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Dhaka', label: 'Asia/Dhaka (BST)' },
  { value: 'Asia/Yangon', label: 'Asia/Yangon (MMT)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul (KST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },
];

function tzOffsetMs(timeZone, utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - utcMs;
}

/**
 * 특정 타임존의 벽시계 시간(YYYY-MM-DD, HH:MM)을 UTC Date로 변환
 */
export function zonedToUtc(dateStr, timeStr, timeZone) {
  if (!dateStr || !timeStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss = 0] = timeStr.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, ss);
  if (Number.isNaN(naive)) return null;
  if (timeZone === 'UTC') return new Date(naive);

  let utc = naive - tzOffsetMs(timeZone, naive);
  // DST 경계 보정
  utc = naive - tzOffsetMs(timeZone, utc);
  return new Date(utc);
}

export function formatIcsUtc(date) {
  if (!date) return '';
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function formatInZone(date, timeZone) {
  if (!date) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * 사용자가 자유롭게 입력한 시간 문자열 → "HH:MM:SS" (실패 시 null)
 * 지원 예: 8, 08:00, 8:00, 20:30, 0830, 08:00:30, 8:00 PM, 8pm, 오후 8:30, 오전 8시, 오후 8시 30분
 */
export function parseTimeInput(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;

  let meridiem = null;
  if (/(pm|p\.m\.|오후)/.test(s)) meridiem = 'pm';
  else if (/(am|a\.m\.|오전)/.test(s)) meridiem = 'am';
  s = s
    .replace(/(a\.m\.|p\.m\.|am|pm|오전|오후)/g, ' ')
    .replace(/시/g, ':')
    .replace(/분/g, ':')
    .replace(/초/g, '')
    .replace(/\s+/g, '')
    .replace(/[.]/g, ':')
    .replace(/:+$/, '');

  let h, m = 0, sec = 0;
  let mt;
  if ((mt = s.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/))) {
    h = +mt[1];
    m = mt[2] ? +mt[2] : 0;
    sec = mt[3] ? +mt[3] : 0;
  } else if ((mt = s.match(/^(\d{2})(\d{2})(\d{2})?$/))) {
    h = +mt[1];
    m = +mt[2];
    sec = mt[3] ? +mt[3] : 0;
  } else {
    return null;
  }

  if (meridiem) {
    if (h < 1 || h > 12) return null;
    if (meridiem === 'pm' && h !== 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
  }
  if (h > 23 || m > 59 || sec > 59) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** "HH:MM:SS" → 화면 표시용 "HH:MM" (초가 있으면 유지) */
export function formatTimeText(hms) {
  if (!hms) return '';
  return hms.endsWith(':00') ? hms.slice(0, 5) : hms;
}

/**
 * ICS 형식 문자열 → UTC Date (실패 시 null)
 * 지원 예: 20260827T120000Z, 20260827T1200Z, 2026-08-27T12:00:00Z (Z 생략 시에도 UTC로 해석)
 */
export function parseIcsUtc(input) {
  const s = String(input ?? '').trim().toUpperCase().replace(/[-:]/g, '');
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se = '00'] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  // 2월 30일 같은 잘못된 날짜 거르기
  if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d || +h > 23 || +mi > 59 || +se > 59) return null;
  return date;
}

/** UTC Date → 특정 타임존의 { date: 'YYYY-MM-DD', time: 'HH:MM:SS' } */
export function utcToZoned(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
