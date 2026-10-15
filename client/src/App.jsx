import { useMemo, useRef, useState } from 'react';
import { TIME_ZONES, zonedToUtc, formatIcsUtc, formatInZone } from './time.js';

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
  const [time, setTime] = useState('08:00');
  const [timeZone, setTimeZone] = useState('America/Toronto');
  const [alarmOn, setAlarmOn] = useState(true);
  const [alarmMinutes, setAlarmMinutes] = useState(DEFAULT_ALARM);
  const [prefix, setPrefix] = useState('');

  const [preview, setPreview] = useState(null);

  const dtstart = useMemo(() => zonedToUtc(date, time, timeZone), [date, time, timeZone]);
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
      setMeta({ sheet: data.sheet, marker: data.marker });
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
      setError('DTSTART(시작 날짜/시간)를 설정해 주세요.');
      return false;
    }
    setError('');
    return true;
  }

  async function onPreview(row) {
    if (!guard()) return;
    try {
      const { content } = await apiJson('/api/preview', { ...settings(), event: toEvent(row) });
      setPreview({ id: row.id, content });
    } catch (e) {
      setError(e.message);
    }
  }

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
            accept=".xlsx"
            hidden
            onChange={(e) => {
              handleFile(e.target.files[0]);
              e.target.value = '';
            }}
          />
          {loading ? '읽는 중…' : fileName ? `📄 ${fileName}` : '.xlsx 파일을 끌어다 놓거나 클릭해서 선택'}
        </div>
        <p className="hint">
          시작 국가(예: CA) 열 바로 위 셀에 <b>V</b> 표시가 있으면 그 열부터 오른쪽 국가들을 국가별 카피로 인식합니다.
          왼쪽 열에 <b>Summary / Description / URL</b> 라벨이 있어야 합니다.
        </p>
        {meta && (
          <p className="ok">
            시트 <b>{meta.sheet}</b>, V 표시 <b>{meta.marker}</b> 기준 {rows.length}개 국가 인식
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
            <input type="time" step="60" value={time} onChange={(e) => setTime(e.target.value)} />
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
          {dtstart ? (
            <>
              <code>DTSTART:{formatIcsUtc(dtstart)}</code>
              <span>
                = {formatInZone(dtstart, 'UTC')} UTC · {formatInZone(dtstart, 'Asia/Seoul')} KST
              </span>
            </>
          ) : (
            <span className="muted">날짜와 시간을 입력하면 UTC 변환 결과가 표시됩니다.</span>
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
                  <tr key={r.id} className={r.checked ? '' : 'off'}>
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
                      <button onClick={() => onPreview(r)}>미리보기</button>
                      <button onClick={() => onDownload([r])}>.ics</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {preview && (
        <section className="card">
          <div className="row-head">
            <h2>미리보기 · {preview.id}</h2>
            <button onClick={() => setPreview(null)}>닫기</button>
          </div>
          <pre dir="auto">{preview.content}</pre>
        </section>
      )}
    </div>
  );
}
