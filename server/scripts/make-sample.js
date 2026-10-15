'use strict';
// 이슈의 입력 예시와 같은 구조의 샘플 엑셀 생성: node scripts/make-sample.js [출력경로]
const path = require('path');
const ExcelJS = require('exceljs');

const COLUMNS = [
  ['CA', 'English', 'Galaxy Event', 'Aug. 27, 2026 at 8:00 AM \nLive on Samsung.com', 'www.samsung.com/ca'],
  ['UK', 'English', 'Galaxy Event', 'Aug. 27, 2026 at 13:00\nLive on Samsung.com', 'www.samsung.com/uk'],
  ['SA', 'Arabic', 'حدث جالكسي', '27 أغسطس 2026 الساعة 3 مساءً بتوقيت السعودية\nمباشر على Samsung.com', 'www.samsung.com/sa'],
  ['IL', 'Hebrew', 'אירוע גלקסי', '27 באוגוסט 2026 בשעה 15:00\nבשידור חי ב-Samsung.com', 'www.samsung.com/il'],
  ['CA_FR', 'French', 'Événement Galaxy', '27 août 2026 à 8 h 00\nEn direct sur Samsung.com', 'www.samsung.com/ca_fr'],
  ['KR', 'Korean', '갤럭시 언팩 이벤트', '2026년 8월 27일 오후 9시\nSamsung.com 라이브', 'www.samsung.com/sec'],
];

async function makeSample(outPath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('C1').value = 'V';
  ws.getCell('A2').value = 'Simulated Image';
  ws.mergeCells('A2:A3');
  ws.getCell('B4').value = 'Summary';
  ws.getCell('B5').value = 'Description';
  ws.getCell('B6').value = 'URL';
  COLUMNS.forEach(([code, lang, summary, desc, url], i) => {
    const col = 3 + i;
    ws.getCell(2, col).value = code;
    ws.getCell(3, col).value = lang;
    ws.getCell(4, col).value = summary;
    ws.getCell(5, col).value = desc;
    ws.getCell(6, col).value = { text: url, hyperlink: `https://${url}` };
  });
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

module.exports = { makeSample, COLUMNS };

if (require.main === module) {
  const out = process.argv[2] || path.join(process.cwd(), 'sample.xlsx');
  require('fs').mkdirSync(path.dirname(out), { recursive: true });
  makeSample(out).then((p) => console.log('생성됨:', p));
}
