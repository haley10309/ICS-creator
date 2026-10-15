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
