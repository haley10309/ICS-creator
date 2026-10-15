#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const express = require('express');
const multer = require('multer');
const JSZip = require('jszip');

const { parseWorkbook } = require('./excel');
const { buildIcs, safeFileName } = require('./ics');

const PORT = Number(process.env.PORT) || 5174;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const isPackaged = Boolean(process.pkg);

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

/** 엑셀 업로드 → 국가별 카피 목록 (일반 파일: exceljs, NASCA DRM 파일: Windows Excel 자동화) */
app.post('/api/parse', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ errorMsg: '파일이 없습니다.' });
    const result = await parseWorkbook(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (e) {
    res.status(400).json({ errorMsg: e.message });
  }
});

/**
 * ICS 생성
 * body: {
 *   dtstart: ISO 문자열 (UTC로 변환됨),
 *   alarmMinutes: number | null,
 *   prodId?: string,
 *   fileNamePrefix?: string,
 *   events: [{ id, code, summary, description, url, dtstart? }]
 * }
 * events가 1개면 .ics, 여러 개면 .zip 반환
 */
app.post('/api/generate', async (req, res) => {
  try {
    const { dtstart, alarmMinutes = 15, prodId, fileNamePrefix = '', events } = req.body || {};
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ errorMsg: '생성할 국가를 하나 이상 선택해 주세요.' });
    }

    const dtstamp = new Date();
    const files = events.map((ev) => {
      const start = ev.dtstart || dtstart;
      if (!start) throw new Error(`[${ev.code}] DTSTART가 지정되지 않았습니다.`);
      if (!ev.summary) throw new Error(`[${ev.code}] SUMMARY가 비어 있습니다.`);
      return {
        name: safeFileName(`${fileNamePrefix}${ev.id || ev.code}`),
        content: buildIcs({
          summary: ev.summary,
          description: ev.description,
          url: ev.url,
          dtstart: start,
          dtstamp,
          alarmMinutes,
          prodId,
        }),
      };
    });

    if (files.length === 1) {
      const f = files[0];
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', contentDisposition(f.name));
      return res.send(Buffer.from(f.content, 'utf8'));
    }

    const zip = new JSZip();
    for (const f of files) zip.file(f.name, Buffer.from(f.content, 'utf8'));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition(`${fileNamePrefix || 'ics'}_files.zip`));
    res.send(buf);
  } catch (e) {
    res.status(400).json({ errorMsg: e.message });
  }
});

/** 미리보기용: 한 국가의 ICS 텍스트 */
app.post('/api/preview', (req, res) => {
  try {
    const { dtstart, alarmMinutes = 15, prodId, event } = req.body || {};
    const content = buildIcs({ ...event, dtstart: event?.dtstart || dtstart, alarmMinutes, prodId });
    res.json({ content });
  } catch (e) {
    res.status(400).json({ errorMsg: e.message });
  }
});

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// 빌드된 프론트엔드 정적 파일 서빙
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
}

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`ICS Creator 서버 실행 중: ${url}`);
  if (isPackaged || process.env.OPEN_BROWSER === '1') {
    console.log('브라우저가 열리지 않으면 위 주소를 직접 열어 주세요. 종료하려면 이 창을 닫으세요.');
    openBrowser(url);
  }
});

function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
