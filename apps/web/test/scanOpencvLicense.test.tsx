/**
 * OpenCV.js 的授權聲明（public/licenses/opencv.txt）。
 *
 * OpenCV 是 Apache 2.0，跟著網站一起部署、由使用者的瀏覽器從本站下載，
 * 就要附上授權條款與版權聲明。這裡釘住：聲明檔存在、內容完整，而且版本跟
 * package.json、CDN 備援網址一致 —— 升級套件時忘了更新聲明會在這裡失敗。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OPENCV_FALLBACK_URLS } from '../lib/scan/config';

const root = resolve(import.meta.dirname, '..');
const notice = readFileSync(resolve(root, 'public/licenses/opencv.txt'), 'utf-8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as {
  dependencies: Record<string, string>;
};

describe('OpenCV 授權聲明', () => {
  test('附上 Apache License 2.0 全文與 OpenCV 的版權聲明', () => {
    assert.ok(notice.includes('Apache License'));
    assert.ok(notice.includes('Version 2.0, January 2004'));
    assert.ok(notice.includes('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION'));
    assert.ok(notice.includes('Copyright (C) 2000-2022, Intel Corporation, all rights reserved.'));
    assert.ok(notice.includes('OpenCV Foundation'));
  });

  test('聲明的版本與 package.json、CDN 備援網址一致', () => {
    const version = pkg.dependencies['@techstark/opencv-js'];
    assert.equal(version, '4.10.0-release.1');
    assert.ok(notice.includes(`@techstark/opencv-js ${version}`));
    assert.ok(OPENCV_FALLBACK_URLS[0].includes(`@techstark/opencv-js@${version}`));
  });
});
