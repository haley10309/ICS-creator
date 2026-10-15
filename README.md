# ICS Creator

엑셀 국가별 카피 시트를 국가별 캘린더 파일(`.ics`)로 변환하는 도구입니다. ([이슈 #1](https://github.com/haley10309/ICS-creator/issues/1))

```
client/   Vite + React 프론트엔드 (빌드 결과 → server/public)
server/   Node(Express) 백엔드: 엑셀 파싱, ICS 생성, 정적 파일 서빙
```

## 개발 실행

```bash
# 서버 (http://localhost:5174)
cd server
npm install
npm run dev

# 클라이언트 (http://localhost:5173, /api 는 5174로 프록시)
cd client
npm install
npm run dev
```

- 테스트: `cd server && npm test`
- 샘플 엑셀 생성: `cd server && npm run sample` → `server/sample.xlsx`

## 빌드

```bash
cd client && npm run build        # → server/public
cd server && npm run build:exe    # → dist/ics-creator.exe (Windows)
```

`ics-creator.exe`를 실행하면 서버가 뜨고 브라우저(`http://localhost:5174`)가 자동으로 열립니다. 창을 닫으면 종료됩니다.

## 엑셀 파일 읽기 (NASCA DRM 대응)
두 단계로 읽습니다. (`server/src/loader.js`)

1. **exceljs**: 일반 `.xlsx`는 Excel 없이 바로 읽습니다. (모든 OS)
2. **Excel 자동화(PowerShell + COM)**: 1단계가 실패하면(NASCA 등 DRM으로 보호된 파일은 정상적인 zip/OOXML이 아님)
   PC에 설치된 Excel을 백그라운드로 띄워 파일을 엽니다. NASCA 플러그인이 설치돼 있으면 Excel이 여는 시점에 자동 복호화됩니다.
   - Windows + Microsoft Excel 필요 (Python/xlwings 불필요). `.xls`는 바로 이 단계로 엽니다.
   - 열기 실패 시 2초 간격 3회 재시도, 병합 셀은 영역 전체에 값을 채워 읽음 (원본 파일은 수정하지 않음)
   - 시간 초과(기본 180초, `NASCA_TIMEOUT_MS`로 변경) 시 Excel 프로세스를 강제 종료합니다.
   - NASCA 최초 인증/권한 팝업이 뜨는 경우 화면에 보이지 않아 멈춘 것처럼 보일 수 있습니다.
     최초 1회는 해당 파일을 Excel로 직접 열어 인증을 완료하거나, `NASCA_DEBUG_VISIBLE=1`로 실행해 Excel 창을 띄워 확인하세요.

## 엑셀 입력 규칙
- 시작 국가(예: `CA`) 열 **바로 위 셀에 `V`** 를 표시하면, 그 열부터 오른쪽으로 국가 코드가 비어 있을 때까지를 국가별 카피로 인식합니다.
- V 아래 행 = 국가 코드, 그 다음 행 = 언어(선택).
- 국가 열보다 왼쪽 열에 `Summary`, `Description`, `URL` 라벨이 있는 행에서 값을 읽습니다.
- 셀 내 줄바꿈은 ICS의 `\n` 으로 변환되며, 텍스트(한글·아랍어·히브리어 등 RTL 포함)는 변형 없이 그대로 옮겨집니다.
- 첫 번째 시트를 읽습니다.
- **숨기기된 행은 그 가로 줄 전체를 없는 것으로 보고 무시합니다.** (행 숨기기, 필터로 숨겨진 행, 그룹 접기, 높이 0인 행 포함)
  제외된 행 번호는 업로드 후 화면과 서버 콘솔에 표시됩니다.

## 화면에서 설정
- **DTSTART**: 날짜 / 시작 시간 / 기준 타임존 → UTC(`YYYYMMDDTHHMMSSZ`)로 변환 (예: 2026-08-27 08:00 America/Toronto → `20260827T120000Z`)
  - 시작 시간은 자유 입력: `08:00`, `20:30`, `0830`, `8:00 PM`, `8pm`, `오후 8시 30분` 등
  - DTSTART 칸에 `20260827T120000Z`처럼 UTC 값을 직접 입력할 수도 있으며, 입력하면 날짜/시간 칸이 선택한 타임존 기준으로 자동 변경됩니다.
- **알림(VALARM)**: N분 전 (기본 15분, `TRIGGER:-P0DT0H15M0S`), 끌 수 있음
- 국가별 Summary/Description/URL은 화면에서 수정 가능, 개별 `.ics` / 선택 항목 `.zip` 다운로드
- **미리보기**: 누른 국가 행 바로 아래에 ICS 내용이 펼쳐지며(다시 누르면 닫힘), 카피나 일정/알림 설정을 바꾸면 자동으로 갱신됩니다.

## 생성 규칙 (RFC 5545)
- `BEGIN:VCALENDAR` / `VERSION:2.0` / `PRODID` / `VEVENT`(DTSTAMP, DTSTART, UID, SUMMARY …) / `END:VCALENDAR`
- UID: `crypto.randomUUID()`, DTSTAMP: 생성 시각(UTC)
- UTF-8, 줄 끝 CRLF, 75바이트 초과 시 공백 한 칸으로 접기(멀티바이트 문자는 자르지 않음)
- TEXT 값의 `\`, `;`, `,`, 줄바꿈은 표준에 따라 이스케이프 (`Aug. 27\, 2026`)
