'use strict';

const { loadGrid } = require('./loader');

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
 * grid: 시트 전체를 문자열 2차원 배열로 읽은 것 (grid[행][열], 0-based).
 * 병합 셀은 병합 영역 전체에 좌상단 값이 채워져 있다고 가정한다.
 *
 * 시트 구조:
 *   - 시작 국가 열(예: CA) 바로 위 셀에 "V" 표시
 *   - V 아래 행: 국가 코드 (CA, LATIN_EN, SG, ... , CA_FR, MX)
 *   - 그 다음 행: 언어 (English, French, ...)
 *   - V 표시 열보다 왼쪽 열에 Summary / Description / URL 라벨이 있는 행
 *
 * V 표시 열부터 오른쪽으로 국가 코드가 비어 있을 때까지를 국가별 카피로 인식한다.
 */
function parseGrid(grid, rowNumbers) {
  // rowNumbers[i] = grid i번째 행의 실제 엑셀 행 번호 (숨긴 행을 뺀 경우 주소 표시용)
  const rowNo = (r) => (rowNumbers ? rowNumbers[r] : r + 1);
  const at = (r, c) => (grid[r] && grid[r][c] != null ? String(grid[r][c]).replace(/\r\n?/g, '\n').trim() : '');
  const rowCount = grid.length;
  const colCount = Math.max(0, ...grid.map((r) => r.length));

  // V 표시 찾기
  let marker = null;
  for (let r = 0; r < rowCount && !marker; r++) {
    for (let c = 0; c < colCount; c++) {
      if (MARKERS.has(normLabel(at(r, c)))) {
        marker = { row: r, col: c };
        break;
      }
    }
  }
  if (!marker) {
    throw new Error('"V" 표시를 찾을 수 없습니다. 시작 국가(예: CA) 열 바로 위 셀에 V를 입력해 주세요.');
  }
  const markerAddr = `${colName(marker.col + 1)}${rowNo(marker.row)}`;

  // 국가 코드 행: 마커 아래에서 처음으로 값이 있는 행
  let countryRow = null;
  for (let r = marker.row + 1; r < Math.min(rowCount, marker.row + 11); r++) {
    if (at(r, marker.col)) {
      countryRow = r;
      break;
    }
  }
  if (countryRow === null) throw new Error(`"V" 표시(${markerAddr}) 아래에 국가 코드가 없습니다.`);

  // 필드 라벨 행 찾기 (V 열보다 왼쪽)
  const fieldRows = {};
  for (let r = countryRow + 1; r < rowCount; r++) {
    for (let c = 0; c < marker.col; c++) {
      const label = normLabel(at(r, c));
      if (!label) continue;
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (fieldRows[field] === undefined && aliases.includes(label)) fieldRows[field] = r;
      }
    }
  }
  if (fieldRows.summary === undefined) {
    throw new Error('"Summary" 라벨 행을 찾을 수 없습니다. 국가 열 왼쪽에 Summary / Description / URL 라벨이 있어야 합니다.');
  }

  // 언어 행: 국가 코드 바로 아래 행이 필드 행이 아니면 언어 행으로 간주
  const langRow = Object.values(fieldRows).includes(countryRow + 1) ? null : countryRow + 1;

  const countries = [];
  const seen = new Map();
  for (let c = marker.col; c < colCount; c++) {
    const code = at(countryRow, c);
    if (!code) break;

    const get = (r) => (r === null || r === undefined ? '' : at(r, c));
    const count = (seen.get(code) || 0) + 1;
    seen.set(code, count);

    countries.push({
      id: count > 1 ? `${code}_${count}` : code,
      code,
      column: colName(c + 1),
      language: get(langRow),
      summary: get(fieldRows.summary),
      description: get(fieldRows.description),
      url: get(fieldRows.url),
    });
  }

  return { marker: markerAddr, countries };
}

/**
 * 엑셀 파일 → 국가별 카피
 * @param {Buffer} buffer
 * @param {string} [fileName] 원본 파일명 (확장자 판별용)
 */
async function parseWorkbook(buffer, fileName) {
  const { grid, hiddenRows = [], sheet, method } = await loadGrid(buffer, fileName);

  // 숨기기된 행은 없는 것으로 보고 제외한 뒤 파싱
  const hidden = new Set(hiddenRows);
  const visible = [];
  const rowNumbers = [];
  grid.forEach((row, i) => {
    if (hidden.has(i)) return;
    visible.push(row);
    rowNumbers.push(i + 1);
  });

  return { sheet, method, hiddenRowCount: hidden.size, ...parseGrid(visible, rowNumbers) };
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

module.exports = { parseWorkbook, parseGrid };
