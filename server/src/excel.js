'use strict';

const ExcelJS = require('exceljs');

/** 시작 열 표시로 인식할 값 */
const MARKERS = new Set(['v', '✓', '✔', '√', '☑']);

/** 행 라벨 → 필드 매핑 (대소문자/공백 무시) */
const FIELD_ALIASES = {
  summary: ['summary', 'title', 'subject', '제목'],
  description: ['description', 'desc', 'body', '내용', '설명'],
  url: ['url', 'link', 'cta', '링크'],
};

function normLabel(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * exceljs 셀 값을 문자열로 변환.
 * 리치텍스트/하이퍼링크/수식 결과를 모두 지원하며, 텍스트 자체(RTL 포함)는 변형하지 않는다.
 */
function cellText(cell) {
  if (!cell) return '';
  let v = cell.value;
  if (v === null || v === undefined) return '';

  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text ?? '').join('');
    if ('formula' in v || 'sharedFormula' in v) v = v.result ?? '';
    else if ('text' in v) {
      const t = v.text;
      v = typeof t === 'object' && t && Array.isArray(t.richText) ? t.richText.map((r) => r.text ?? '').join('') : t;
    } else if ('error' in v) return '';
    if (v && typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map((r) => r.text ?? '').join('');
      return '';
    }
  }

  // 셀 내부 줄바꿈 정규화 (\r\n, \r → \n), 앞뒤 공백만 제거
  return String(v ?? '').replace(/\r\n?/g, '\n').trim();
}

function findMarker(sheet) {
  let found = null;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (found) return;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (found) return;
      if (MARKERS.has(normLabel(cellText(cell)))) found = { row: rowNumber, col: colNumber };
    });
  });
  return found;
}

/**
 * 시트 구조:
 *   - 시작 국가 열(예: CA) 바로 위 셀에 "V" 표시
 *   - V 아래 행: 국가 코드 (CA, LATIN_EN, SG, ... , CA_FR, MX)
 *   - 그 다음 행: 언어 (English, French, ...)
 *   - V 표시 열보다 왼쪽 열에 Summary / Description / URL 라벨이 있는 행
 *
 * V 표시 열부터 오른쪽으로 국가 코드가 비어 있을 때까지를 국가별 카피로 인식한다.
 */
function parseSheet(sheet) {
  const marker = findMarker(sheet);
  if (!marker) return null;

  // 국가 코드 행: 마커 아래에서 처음으로 값이 있는 행
  let countryRow = null;
  for (let r = marker.row + 1; r <= Math.min(sheet.rowCount, marker.row + 10); r++) {
    if (cellText(sheet.getRow(r).getCell(marker.col))) {
      countryRow = r;
      break;
    }
  }
  if (!countryRow) throw new Error(`"V" 표시(${sheet.name}!${colName(marker.col)}${marker.row}) 아래에 국가 코드가 없습니다.`);

  // 필드 라벨 행 찾기
  const fieldRows = {};
  for (let r = countryRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c < marker.col; c++) {
      const label = normLabel(cellText(row.getCell(c)));
      if (!label) continue;
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (!fieldRows[field] && aliases.includes(label)) fieldRows[field] = r;
      }
    }
  }
  if (!fieldRows.summary) {
    throw new Error('"Summary" 라벨 행을 찾을 수 없습니다. 국가 열 왼쪽에 Summary / Description / URL 라벨이 있어야 합니다.');
  }

  // 언어 행: 국가 코드 바로 아래 행이 필드 행이 아니면 언어 행으로 간주
  const langRow = Object.values(fieldRows).includes(countryRow + 1) ? null : countryRow + 1;

  const countries = [];
  const seen = new Map();
  const lastCol = Math.max(sheet.columnCount, marker.col);
  for (let c = marker.col; c <= lastCol; c++) {
    const code = cellText(sheet.getRow(countryRow).getCell(c));
    if (!code) break;

    const get = (r) => (r ? cellText(sheet.getRow(r).getCell(c)) : '');
    const count = (seen.get(code) || 0) + 1;
    seen.set(code, count);

    countries.push({
      id: count > 1 ? `${code}_${count}` : code,
      code,
      column: colName(c),
      language: get(langRow),
      summary: get(fieldRows.summary),
      description: get(fieldRows.description),
      url: get(fieldRows.url),
    });
  }

  return {
    sheet: sheet.name,
    marker: `${colName(marker.col)}${marker.row}`,
    countries,
  };
}

async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (e) {
    throw new Error('엑셀(.xlsx) 파일을 읽을 수 없습니다. .xlsx 형식인지 확인해 주세요.');
  }

  for (const sheet of wb.worksheets) {
    const result = parseSheet(sheet);
    if (result) return result;
  }
  throw new Error('"V" 표시를 찾을 수 없습니다. 시작 국가(예: CA) 열 바로 위 셀에 V를 입력해 주세요.');
}

function colName(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

module.exports = { parseWorkbook, parseSheet, cellText };
