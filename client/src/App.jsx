import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  TIME_ZONES,
  zonedToUtc,
  formatIcsUtc,
  formatInZone,
  parseTimeInput,
  formatTimeText,
  parseIcsUtc,
  utcToZoned,
} from './time.js';

const DEFAULT_ALARM = 15;

async function apiJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errorMsg || `요청 실패 (${res.status})`);
  return data;
}

async function downloadFile(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errorMsg || `다운로드 실패 (${res.status})`);
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/) || disposition.match(/filename="([^"]+)"/);
  const name = match ? decodeURIComponent(match[1]) : 'download';
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function App() {
  const fileInput = useRef(null);
  const [fileName, setFileName] = useState('');
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // DTSTART 설정
  const [date, setDate] = useState('');
  const [timeText, setTimeText] = useState('08:00'); // 사용자가 입력한 그대로의 시간 문자열
  const [dtDraft, setDtDraft] = useState(null); // DTSTART 칸을 직접 편집 중일 때의 입력값
  const [timeZone, setTimeZone] = useState('America/Toronto');
  const [alarmOn, setAlarmOn] = useState(true);
  const [alarmMinutes, setAlarmMinutes] = useState(DEFAULT_ALARM);
  const [prefix, setPrefix] = useState('');

  // 미리보기: 클릭한 국가 행 바로 아래에 표시 (한 번에 하나)
  const [preview, setPreview] = useState(null); // { id, content, error }

  const time = parseTimeInput(timeText);
  const timeInvalid = timeText.trim() !== '' && !time;
  const dtstart = useMemo(() => zonedToUtc(date, time, timeZone), [date, time, timeZone]);
  const dtDraftInvalid = dtDraft !== null && dtDraft.trim() !== '' && !parseIcsUtc(dtDraft);

  /** DTSTART(UTC)를 직접 입력하면 날짜/시간 칸을 현재 타임존 기준으로 맞춘다 */
  function onDtstartInput(value) {
    setDtDraft(value);
    const parsed = parseIcsUtc(value);
    if (!parsed) return;
    const z = utcToZoned(parsed, timeZone);
    setDate(z.date);
    setTimeText(formatTimeText(z.time));
  }
  const selected = rows.filter((r) => r.checked);

  const settings = () => ({
    dtstart: dtstart?.toISOString(),
    alarmMinutes: alarmOn ? Number(alarmMinutes) || 0 : null,
    fileNamePrefix: prefix,
  });

  const toEvent = (r) => ({ id: r.id, code: r.code, summary: r.summary, description: r.description, url: r.url });

  async function handleFile(file) {
    if (!file) return;
    setError('');
    setPreview(null);
    setLoading(true);
    setFileName(file.name);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/parse', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errorMsg || '파싱 실패');
      setMeta({ sheet: data.sheet, marker: data.marker, method: data.method, hiddenRowCount: data.hiddenRowCount, hiddenRows: data.hiddenRows || [] });
      setRows(data.countries.map((c) => ({ ...c, checked: true })));
    } catch (e) {
      setRows([]);
      setMeta(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function updateRow(id, patch) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function guard() {
    if (!dtstart) {
      setError(
        timeInvalid
          ? `시작 시간 "${timeText}"을(를) 이해할 수 없습니다. 예: 08:00, 20:30, 8:00 PM, 오후 8시`
          : 'DTSTART(시작 날짜/시간)를 설정해 주세요.'
      );
      return false;
    }
    setError('');
    return true;
  }

  function onPreview(row) {
    // 같은 행을 다시 누르면 닫기
    setPreview((prev) => (prev?.id === row.id ? null : { id: row.id, content: '', error: '' }));
  }

  // 열려 있는 미리보기는 해당 행의 카피나 일정/알림 설정이 바뀌면 자동으로 다시 생성
  const previewRow = preview ? rows.find((r) => r.id === preview.id) : null;
  const previewKey = previewRow
    ? JSON.stringify([toEvent(previewRow), dtstart?.toISOString(), alarmOn, alarmMinutes, timeInvalid])
    : null;
  useEffect(() => {
    if (!previewRow) return;
    const id = previewRow.id;
    if (!dtstart) {
      setPreview({
        id,
        content: '',
        error: timeInvalid ? '시작 시간 형식을 확인해 주세요.' : '위 "2. 일정 설정"에서 시작 날짜/시간을 먼저 입력해 주세요.',
      });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { content } = await apiJson('/api/preview', { ...settings(), event: toEvent(previewRow) });
        if (!cancelled) setPreview((prev) => (prev?.id === id ? { id, content, error: '' } : prev));
      } catch (e) {
        if (!cancelled) setPreview((prev) => (prev?.id === id ? { id, content: '', error: e.message } : prev));
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  async function onDownload(list) {
    if (!guard()) return;
    if (list.length === 0) return setError('다운로드할 국가를 선택해 주세요.');
    try {
      await downloadFile('/api/generate', { ...settings(), events: list.map(toEvent) });
    } catch (e) {
      setError(e.message);
    }
  }

  const allChecked = rows.length > 0 && selected.length === rows.length;

  return (
    <div className="page">
      <header>
        <h1>ICS Creator</h1>
        <p className="sub">엑셀 카피 시트를 국가별 캘린더(.ics) 파일로 변환합니다.</p>
      </header>

      <section className="card">
        <h2>1. 엑셀 업로드</h2>
        <div
          className={`drop ${dragOver ? 'over' : ''}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files[0]);
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            hidden
            onChange={(e) => {
              handleFile(e.target.files[0]);
              e.target.value = '';
            }}
          />
          {loading
            ? '읽는 중… (NASCA 보호 파일은 Excel로 여는 데 시간이 걸릴 수 있습니다)'
            : fileName
              ? `📄 ${fileName}`
              : '엑셀 파일(.xlsx)을 끌어다 놓거나 클릭해서 선택'}
        </div>
        <p className="hint">
          시작 국가(예: CA) 열 바로 위 셀에 <b>V</b> 표시가 있으면 그 열부터 오른쪽 국가들을 국가별 카피로 인식합니다.
          왼쪽 열에 <b>Summary / Description / URL</b> 라벨이 있어야 합니다.
        </p>
        {meta && (
          <p className="ok">
            시트 <b>{meta.sheet}</b>, V 표시 <b>{meta.marker}</b> 기준 {rows.length}개 국가 인식
            {meta.method === 'excel-com' && ' · DRM(NASCA) 파일 — Excel로 열어 읽음'}
            {meta.hiddenRowCount > 0 && ` · 숨긴 행 ${meta.hiddenRowCount}개 제외 (${meta.hiddenRows.join(', ')}행)`}
          </p>
        )}
      </section>

      <section className="card">
        <h2>2. 일정 설정 (DTSTART)</h2>
        <div className="grid">
          <label>
            시작 날짜
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            시작 시간
            <input
              type="text"
              inputMode="text"
              placeholder="예: 08:00, 20:30, 8:00 PM"
              className={timeInvalid ? 'invalid' : ''}
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              onBlur={() => time && setTimeText(formatTimeText(time))}
            />
            {timeInvalid && <small className="field-error">시간 형식을 확인해 주세요</small>}
          </label>
          <label>
            기준 타임존
            <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {TIME_ZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            알림
            <span className="inline">
              <input type="checkbox" checked={alarmOn} onChange={(e) => setAlarmOn(e.target.checked)} />
              <input
                type="number"
                min="0"
                disabled={!alarmOn}
                value={alarmMinutes}
                onChange={(e) => setAlarmMinutes(e.target.value)}
              />
              분 전
            </span>
          </label>
          <label>
            파일명 접두어 (선택)
            <input placeholder="예: galaxy_event_" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </label>
        </div>
        <div className="dtstart">
          <label className="dtstart-input">
            DTSTART (UTC, 직접 입력 가능)
            <input
              type="text"
              spellCheck={false}
              placeholder="예: 20260827T120000Z"
              className={dtDraftInvalid ? 'invalid' : ''}
              value={dtDraft ?? (dtstart ? formatIcsUtc(dtstart) : '')}
              onFocus={() => setDtDraft(dtstart ? formatIcsUtc(dtstart) : '')}
              onChange={(e) => onDtstartInput(e.target.value)}
              onBlur={() => setDtDraft(null)}
            />
            {dtDraftInvalid && <small className="field-error">형식: YYYYMMDDTHHMMSSZ</small>}
          </label>
          {dtstart ? (
            <span>
              = {formatInZone(dtstart, timeZone)} ({timeZone}) · {formatInZone(dtstart, 'UTC')} UTC ·{' '}
              {formatInZone(dtstart, 'Asia/Seoul')} KST
            </span>
          ) : (
            <span className="muted">날짜와 시간을 입력하거나, DTSTART를 직접 입력하세요.</span>
          )}
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {rows.length > 0 && (
        <section className="card">
          <div className="row-head">
            <h2>3. 국가별 카피 ({selected.length}/{rows.length} 선택)</h2>
            <button className="primary" disabled={selected.length === 0} onClick={() => onDownload(selected)}>
              선택 항목 다운로드 {selected.length > 1 ? '(.zip)' : '(.ics)'}
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => setRows((p) => p.map((r) => ({ ...r, checked: e.target.checked })))}
                    />
                  </th>
                  <th>국가</th>
                  <th>Summary</th>
                  <th>Description</th>
                  <th>URL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className={`${r.checked ? '' : 'off'} ${preview?.id === r.id ? 'previewing' : ''}`}>
                      <td>
                        <input type="checkbox" checked={r.checked} onChange={(e) => updateRow(r.id, { checked: e.target.checked })} />
                      </td>
                      <td className="code">
                        <b>{r.id}</b>
                        <small>{r.language}</small>
                      </td>
                      <td>
                        <textarea dir="auto" rows={2} value={r.summary} onChange={(e) => updateRow(r.id, { summary: e.target.value })} />
                      </td>
                      <td>
                        <textarea
                          dir="auto"
                          rows={3}
                          value={r.description}
                          onChange={(e) => updateRow(r.id, { description: e.target.value })}
                        />
                      </td>
                      <td>
                        <input dir="ltr" value={r.url} onChange={(e) => updateRow(r.id, { url: e.target.value })} />
                      </td>
                      <td className="actions">
                        <button className={preview?.id === r.id ? 'active' : ''} onClick={() => onPreview(r)}>
                          {preview?.id === r.id ? '미리보기 닫기' : '미리보기'}
                        </button>
                        <button onClick={() => onDownload([r])}>.ics</button>
                      </td>
                    </tr>
                    {preview?.id === r.id && (
                      <tr className="preview-row">
                        <td colSpan={6}>
                          <div className="preview-head">
                            <b>미리보기 · {r.id}</b>
                            <span className="muted">내용을 수정하면 자동으로 반영됩니다</span>
                            <button onClick={() => setPreview(null)}>닫기</button>
                          </div>
                          {preview.error ? (
                            <div className="error">{preview.error}</div>
                          ) : (
                            <pre dir="ltr">{preview.content || '생성 중…'}</pre>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </div>
  );
}
