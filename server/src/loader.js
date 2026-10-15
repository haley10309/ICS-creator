'use strict';

/**
 * 엑셀 파일 → 문자열 2차원 배열(grid) 로더 — 두 단계 전략
 *
 * 1) exceljs(순수 JS, Excel 앱/OS 무관)로 연다.
 *    대부분의 일반 파일은 이 단계에서 바로 성공하며 빠르고 가볍다.
 * 2) exceljs로 열리지 않으면(NASCA 등 DRM으로 보호된 파일은 정상적인 zip/OOXML 구조가
 *    아니라서 예외가 난다) PowerShell + COM으로 실제 설치된 Excel을 띄워서 연다.
 *    해당 PC에 NASCA 플러그인이 설치돼 있으면 Excel이 파일을 여는 시점에 자동으로 복호화된다.
 *
 * 주의:
 * - 2단계는 Windows + Microsoft Excel이 설치된 PC에서만 동작한다. (Python/xlwings 불필요)
 * - 2단계는 DRM 복호화 특성상 오픈 속도가 느릴 수 있다.
 * - NASCA 플러그인이 최초 인증/권한 팝업을 띄우는 경우, Excel이 화면에 보이지 않는 상태로
 *   실행되므로 멈춘 것처럼 보일 수 있다. 이 경우 최초 1회는 해당 파일을 Excel로 직접 열어
 *   인증을 완료해 두거나, 환경변수 NASCA_DEBUG_VISIBLE=1 로 실행해 Excel 창을 띄워 확인한다.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const MAX_ROWS = 3000; // 안전장치: 비정상적으로 큰 파일 방지
const OPEN_RETRIES = 3; // NASCA 복호화 지연 대응 재시도 횟수
const OPEN_RETRY_DELAY = 2; // 재시도 간 대기(초)
const COM_TIMEOUT_MS = Number(process.env.NASCA_TIMEOUT_MS) || 180_000;

function log(msg) {
  console.log(`[excel] ${msg}`);
}

/* ------------------------------------------------------------------ */
/* 1단계: exceljs                                                       */
/* ------------------------------------------------------------------ */

/** exceljs 셀 값을 문자열로 변환 (리치텍스트/하이퍼링크/수식 결과 지원, 텍스트 자체는 변형하지 않음) */
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
  return String(v ?? '').replace(/\r\n?/g, '\n').trim();
}

/**
 * 첫 번째 시트 XML에서 숨긴 행 번호(1-based)를 직접 읽는다.
 * exceljs는 높이 0(ht="0")을 "높이 없음"으로 버리기 때문에 원본 XML을 함께 확인한다.
 */
async function hiddenRowsFromXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !relsXml) return [];

  const sheetTag = workbookXml.match(/<(?:\w+:)?sheet\b[^>]*>/);
  const rid = sheetTag && sheetTag[0].match(/\br:id="([^"]+)"/);
  if (!rid) return [];
  const rel = [...relsXml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid[1]}"`));
  const target = rel && rel.match(/Target="([^"]+)"/);
  if (!target) return [];
  const sheetPath = target[1].startsWith('/') ? target[1].slice(1) : path.posix.join('xl', target[1]);
  const sheetXml = await zip.file(sheetPath)?.async('string');
  if (!sheetXml) return [];

  const rows = [];
  for (const m of sheetXml.matchAll(/<(?:\w+:)?row\b([^>]*)>/g)) {
    const attrs = m[1];
    const r = attrs.match(/\br="(\d+)"/);
    if (!r) continue;
    const hidden = attrs.match(/\bhidden="([^"]*)"/);
    const ht = attrs.match(/\bht="([^"]*)"/);
    if ((hidden && /^(1|true)$/i.test(hidden[1])) || (ht && parseFloat(ht[1]) === 0)) rows.push(Number(r[1]));
  }
  return rows;
}

async function loadWithExcelJS(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet || sheet.rowCount === 0) throw new Error('시트에 데이터가 없습니다.');

  const rowCount = Math.min(sheet.rowCount, MAX_ROWS);
  const colCount = sheet.columnCount;
  const grid = [];
  const hiddenRows = [];
  // 병합 셀의 하위 셀은 exceljs가 좌상단(master) 값을 그대로 돌려주므로 별도 채우기 불필요
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    // 숨기기된 행 (필터/그룹 접기로 숨겨진 행, 높이 0인 행 포함)
    if (row.hidden || row.height === 0) hiddenRows.push(r - 1);
    const out = new Array(colCount);
    for (let c = 1; c <= colCount; c++) out[c - 1] = cellText(row.getCell(c));
    grid.push(out);
  }
  // exceljs가 놓치는 경우(높이 0 등)를 위해 원본 XML 기준 숨김 행도 합친다
  try {
    for (const r of await hiddenRowsFromXml(buffer)) if (r <= rowCount && !hiddenRows.includes(r - 1)) hiddenRows.push(r - 1);
  } catch (e) {
    log(`STEP:시트 XML 숨김 행 확인 실패 - ${e.message}`);
  }
  hiddenRows.sort((a, b) => a - b);
  return { grid, hiddenRows, sheet: sheet.name };
}

/* ------------------------------------------------------------------ */
/* 2단계: PowerShell + Excel COM (Windows 전용, NASCA DRM 대응)          */
/* ------------------------------------------------------------------ */

const PS_SCRIPT = String.raw`
param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutPath,
  [int]$MaxRows = 3000,
  [int]$Retries = 3,
  [int]$RetryDelay = 2
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Log([string]$m) { [Console]::Error.WriteLine($m); [Console]::Error.Flush() }

Add-Type -AssemblyName System.Web
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class IcsW32 {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@

function CellStr($v) {
  if ($null -eq $v -or $v -is [System.DBNull]) { return '' }
  $s = [string]$v
  $s = $s.Replace([string][char]13 + [char]10, [string][char]10).Replace([string][char]13, [string][char]10)
  return $s.Trim()
}

$exitCode = 1
$excel = $null
$wb = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = ($env:NASCA_DEBUG_VISIBLE -eq '1')
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false
  try { $excel.AskToUpdateLinks = $false } catch {}
  try {
    $procId = [uint32]0
    [void][IcsW32]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd, [ref]$procId)
    Log "EXCEL_PID:$procId"
  } catch {}

  Log 'STEP:opening file (NASCA decrypt wait)'
  for ($i = 1; $i -le $Retries; $i++) {
    try { $wb = $excel.Workbooks.Open($InputPath); break }
    catch {
      Log "STEP:open attempt $i/$Retries failed - $($_.Exception.Message)"
      if ($i -ge $Retries) { throw }
      Start-Sleep -Seconds $RetryDelay
    }
  }
  Log 'STEP:file opened, reading sheet'

  $sht = $wb.Worksheets.Item(1)
  $used = $sht.UsedRange
  $r0 = [int]$used.Row
  $c0 = [int]$used.Column
  $nRows = [int]$used.Rows.Count
  $nCols = [int]$used.Columns.Count
  $lastRow = [Math]::Min($r0 + $nRows - 1, $MaxRows)
  $lastCol = $c0 + $nCols - 1

  # A1 기준 grid (UsedRange가 A1에서 시작하지 않아도 주소가 맞도록 앞쪽을 빈 값으로 채움)
  $grid = New-Object 'string[][]' $lastRow
  for ($r = 0; $r -lt $lastRow; $r++) {
    $row = New-Object 'string[]' $lastCol
    for ($c = 0; $c -lt $lastCol; $c++) { $row[$c] = '' }
    $grid[$r] = $row
  }

  $vals = $used.Value2
  if ($vals -is [System.Array]) {
    for ($r = 1; $r -le $nRows; $r++) {
      $gr = $r0 + $r - 2
      if ($gr -ge $lastRow) { break }
      for ($c = 1; $c -le $nCols; $c++) { $grid[$gr][$c0 + $c - 2] = CellStr $vals[$r, $c] }
    }
  } else {
    $grid[$r0 - 1][$c0 - 1] = CellStr $vals
  }

  # 병합 셀: 병합 영역 전체에 좌상단 값을 채움 (원본 파일은 수정하지 않음)
  if ($used.MergeCells -ne $false) {
    Log 'STEP:filling merged cells'
    $seen = @{}
    for ($r = 1; $r -le [Math]::Min($nRows, $lastRow - $r0 + 1); $r++) {
      for ($c = 1; $c -le $nCols; $c++) {
        $cell = $used.Cells.Item($r, $c)
        if (-not $cell.MergeCells) { continue }
        $area = $cell.MergeArea
        $addr = $area.Address()
        if ($seen.ContainsKey($addr)) { continue }
        $seen[$addr] = $true
        $top = CellStr $area.Cells.Item(1, 1).Value2
        $ar0 = [int]$area.Row; $ac0 = [int]$area.Column
        for ($ar = 0; $ar -lt [int]$area.Rows.Count; $ar++) {
          for ($ac = 0; $ac -lt [int]$area.Columns.Count; $ac++) {
            $gr = $ar0 + $ar - 1; $gc = $ac0 + $ac - 1
            if ($gr -lt $lastRow -and $gc -lt $lastCol) { $grid[$gr][$gc] = $top }
          }
        }
      }
    }
  }
  # 숨기기된 행 (필터/그룹 접기로 숨겨진 행, 높이 0인 행 포함) — 행마다 직접 확인
  Log 'STEP:checking hidden rows'
  $hidden = New-Object System.Collections.Generic.List[int]
  for ($r = 1; $r -le $lastRow; $r++) {
    $xr = $sht.Rows.Item($r)
    $isHidden = $false
    try { if ([bool]$xr.Hidden) { $isHidden = $true } } catch {}
    if (-not $isHidden) { try { if ([double]$xr.RowHeight -eq 0) { $isHidden = $true } } catch {} }
    if ($isHidden) { $hidden.Add($r - 1) }
  }
  Log "HIDDEN_ROWS:$(($hidden | ForEach-Object { $_ + 1 }) -join ',')"
  Log 'STEP:grid read complete'

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('{"sheet":"').Append([System.Web.HttpUtility]::JavaScriptStringEncode([string]$sht.Name)).Append('","grid":[')
  for ($r = 0; $r -lt $lastRow; $r++) {
    if ($r -gt 0) { [void]$sb.Append(',') }
    [void]$sb.Append('[')
    for ($c = 0; $c -lt $lastCol; $c++) {
      if ($c -gt 0) { [void]$sb.Append(',') }
      [void]$sb.Append('"').Append([System.Web.HttpUtility]::JavaScriptStringEncode($grid[$r][$c])).Append('"')
    }
    [void]$sb.Append(']')
  }
  [void]$sb.Append('],"hiddenRows":[').Append(($hidden -join ',')).Append(']}')
  [System.IO.File]::WriteAllText($OutPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
  $exitCode = 0
}
catch {
  Log "ERROR:$($_.Exception.Message)"
}
finally {
  if ($wb) { try { $wb.Close($false) } catch {} }
  if ($excel) {
    try { $excel.Quit() } catch {}
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) } catch {}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
exit $exitCode
`;

function killPid(pid) {
  if (!pid) return;
  execFile('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true }, () => {});
}

async function loadWithExcelCom(buffer, fileName) {
  if (process.platform !== 'win32') {
    throw new Error(
      '이 파일은 일반 엑셀 형식으로 열리지 않아 Excel 자동화가 필요한데, 이 기능은 Windows에서만 지원됩니다. ' +
        'DRM(NASCA 등)으로 보호된 파일이라면 NASCA가 설치된 Windows PC에서 실행해 주세요. ' +
        '일반 파일인데 이 오류가 난다면 파일이 손상됐을 수 있습니다.'
    );
  }

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ics-creator-'));
  const ext = (path.extname(fileName || '') || '.xlsx').toLowerCase();
  const inputPath = path.join(dir, `input${ext}`);
  const outPath = path.join(dir, 'grid.json');
  const scriptPath = path.join(dir, 'read-excel.ps1');

  try {
    await fs.promises.writeFile(inputPath, buffer);
    // Windows PowerShell 5.1이 UTF-8로 읽도록 BOM 포함
    await fs.promises.writeFile(scriptPath, '﻿' + PS_SCRIPT, 'utf8');

    await new Promise((resolve, reject) => {
      const lines = [];
      let excelPid = null;
      let buf = '';
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', scriptPath,
          '-InputPath', inputPath,
          '-OutPath', outPath,
          '-MaxRows', String(MAX_ROWS),
          '-Retries', String(OPEN_RETRIES),
          '-RetryDelay', String(OPEN_RETRY_DELAY),
        ],
        { windowsHide: true }
      );

      const timer = setTimeout(() => {
        log(`timeout (${COM_TIMEOUT_MS}ms) - Excel 프로세스 강제 종료`);
        child.kill();
        killPid(excelPid);
        reject(
          new Error(
            'Excel로 파일을 여는 시간이 초과되었습니다. NASCA 인증/권한 팝업이 떠 있을 수 있으니, ' +
              '해당 파일을 Excel로 직접 한 번 열어 인증을 완료한 뒤 다시 시도해 주세요.'
          )
        );
      }, COM_TIMEOUT_MS);

      child.stderr.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          lines.push(line);
          log(line);
          const m = line.match(/^EXCEL_PID:(\d+)/);
          if (m) excelPid = Number(m[1]);
        }
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`PowerShell을 실행할 수 없습니다: ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (buf.trim()) lines.push(buf.trim());
        if (code === 0) return resolve();
        const err = lines.filter((l) => l.startsWith('ERROR:')).map((l) => l.slice(6)).join(' ');
        reject(new Error(`Excel로 파일을 열지 못했습니다. ${err || lines.slice(-3).join(' ')}`.trim()));
      });
    });

    const json = JSON.parse(await fs.promises.readFile(outPath, 'utf8'));
    if (!json.grid || json.grid.length === 0) throw new Error('시트에 데이터가 없습니다.');
    return { grid: json.grid, hiddenRows: json.hiddenRows || [], sheet: json.sheet };
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */

/**
 * @returns {Promise<{grid: string[][], hiddenRows: number[], sheet: string, method: 'exceljs'|'excel-com'}>}
 * hiddenRows: 숨기기된 행 번호 (0-based)
 */
async function loadGrid(buffer, fileName) {
  const ext = path.extname(fileName || '').toLowerCase();

  // .xls(구 바이너리 형식)는 exceljs가 지원하지 않으므로 바로 Excel로 연다
  if (ext !== '.xls') {
    try {
      log('STEP:exceljs로 파싱 시도');
      const result = await loadWithExcelJS(buffer);
      log('STEP:exceljs 파싱 성공');
      return { ...result, method: 'exceljs' };
    } catch (e) {
      log(`STEP:exceljs 파싱 실패 - ${e.message}`);
      log('STEP:Excel 자동화(COM)로 재시도 — DRM(NASCA) 보호 파일일 가능성');
    }
  }

  const result = await loadWithExcelCom(buffer, fileName);
  log('STEP:Excel COM 파싱 성공');
  return { ...result, method: 'excel-com' };
}

module.exports = { loadGrid, loadWithExcelJS, cellText, PS_SCRIPT };
