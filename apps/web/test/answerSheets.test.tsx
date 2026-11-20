/**
 * 《我的稿紙》的清單和 public/sheets/ 底下的檔案（lib/answerSheets.ts）。
 *
 * 稿紙檔是 services/handwriting-ocr/tools/build_static_sheets.py 產生的，清單是手寫的：
 * 兩邊對不上時網頁不會壞，只是按下去下載到 index.html（SPA 的 fallback）、預覽是破圖。
 * 這裡逐一確認清單上的每個 PDF 與每頁預覽都真的在、而且真的是 PDF／PNG。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ANSWER_SHEETS,
  sheetDownloadName,
  sheetPdfUrl,
  sheetPreviewUrls,
} from '../lib/answerSheets';
import { routePatterns, routes } from '../lib/routes';

const publicDir = resolve(import.meta.dirname, '..', 'public');
const fileOf = (url: string) => resolve(publicDir, url.replace(/^\//, ''));

describe('稿紙清單', () => {
  test('四種稿紙：聯合報國中寫作稿紙、聯合盃作文大賽稿紙、會考、學測', () => {
    assert.deepEqual(ANSWER_SHEETS.map((s) => s.id), ['udn', 'ucup', 'cap', 'gsat']);
  });

  test('預設紙張是稿紙原本的尺寸（聯合報國中、學測 A3，聯合盃、會考 B4）', () => {
    assert.deepEqual(
      ANSWER_SHEETS.map((s) => [s.id, s.papers[0].paper]),
      [['udn', 'A3'], ['ucup', 'B4'], ['cap', 'B4'], ['gsat', 'A3']],
    );
  });

  for (const sheet of ANSWER_SHEETS) {
    for (const { paper } of sheet.papers) {
      test(`${sheet.label} ${paper}：PDF 與每頁預覽都在`, () => {
        const pdf = fileOf(sheetPdfUrl(sheet.id, paper));
        assert.ok(existsSync(pdf), `缺 ${pdf}`);
        assert.equal(readFileSync(pdf).subarray(0, 4).toString('latin1'), '%PDF');
        const previews = sheetPreviewUrls(sheet, paper);
        assert.equal(previews.length, sheet.pages);
        for (const url of previews) {
          const png = fileOf(url);
          assert.ok(existsSync(png), `缺 ${png}`);
          assert.equal(readFileSync(png).subarray(1, 4).toString('latin1'), 'PNG');
        }
      });
    }
  }

  test('下載的檔名看得懂', () => {
    assert.equal(sheetDownloadName(ANSWER_SHEETS[0], 'B4'), '聯合報國中寫作稿紙_B4.pdf');
  });
});

describe('路徑', () => {
  test('我的稿紙在 /sheets，兩份路徑表一致', () => {
    assert.equal(routes.answerSheets(), '/sheets');
    assert.equal(routePatterns.answerSheets, '/sheets');
  });
});
