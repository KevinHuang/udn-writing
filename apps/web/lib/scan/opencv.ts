/* eslint-disable @typescript-eslint/no-explicit-any --
   OpenCV.js 沒有官方型別定義，專案也沒有裝第三方的 @types。
   把 any 全部關在這一個檔案裡：其他模組只透過 getCv() 取得它，
   不需要再各自宣告 any。 */

import { OPENCV_URLS, SCAN_CONFIG } from './config';

/** OpenCV.js 的模組本體 */
export type Cv = any;
/** cv.Mat。**每一個 Mat 都必須手動 delete()**，不會被 GC 回收 */
export type Mat = any;
export type MatVector = any;

declare global {
  interface Window {
    cv?: Cv;
  }
}

let loading: Promise<void> | null = null;
let ready: Cv | null = null;

/** 影像引擎載入到哪一步了，給畫面顯示用 */
export type CvStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * 載入 OpenCV.js。
 *
 * **只在使用者真的要掃描時才呼叫** —— 這個檔案約 10MB，
 * 放進首屏會讓整個系統變慢，而且大多數使用者根本用不到掃描。
 *
 * 重複呼叫共用同一個 Promise，不會重複下載。
 */
export function loadOpenCv(): Promise<void> {
  if (ready) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    let done = false;

    const finish = (cv: Cv) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      window.cv = cv;
      ready = cv;
      /*
        **絕對不可以把 cv 當成 resolve 的值傳出去**（resolve(cv) 或
        resolve(ready) 都一樣）：Emscripten 的 Module 物件自己帶著 .then()，
        Promise 會把它當成 thenable 一直展開下去，主執行緒會整個凍住 ——
        頁面沒有錯誤訊息，就是不動了。
        所以這裡 resolve 不帶值，要用 OpenCV 的人去呼叫 getCv()。
      */
      resolve();
    };

    const fail = (err: Error) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      loading = null;   // 讓使用者可以按「重試」
      reject(err);
    };

    // 不同版本的 opencv.js 初始化方式不同（onRuntimeInitialized／Promise），用輪詢兜底
    const check = () => {
      const c = window.cv;
      if (c && typeof c.Mat === 'function') finish(c);
    };
    const poll = window.setInterval(check, 200);
    const timer = window.setTimeout(
      () => fail(new Error('載入逾時，請檢查網路連線')),
      SCAN_CONFIG.opencvTimeoutMs,
    );

    const tryUrl = (index: number) => {
      const url = OPENCV_URLS[index];
      if (!url) {
        fail(new Error('無法下載影像處理引擎（OpenCV.js）'));
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = () => {
        const c = window.cv;
        if (!c) return;
        if (typeof c.then === 'function' && typeof c.Mat !== 'function') {
          c.then(finish, fail);            // 新版 build：window.cv 是 Promise
        } else if (typeof c.Mat !== 'function') {
          c.onRuntimeInitialized = check;  // 舊版 build
        }
        check();
      };
      script.onerror = () => {
        console.warn('[opencv] 載入失敗，改試下一個來源：', url);
        script.remove();
        tryUrl(index + 1);
      };
      document.head.appendChild(script);
    };
    tryUrl(0);
  });

  return loading;
}

/** 已經載好的 OpenCV。還沒載好就丟錯 —— 呼叫端應該先 await loadOpenCv() */
export function getCv(): Cv {
  if (!ready) throw new Error('影像處理引擎尚未載入');
  return ready;
}

export function isCvReady(): boolean {
  return ready !== null;
}

/**
 * OpenCV 的錯誤常常是一個數字指標，直接印出來看不懂，
 * 要透過 cv.exceptionFromPtr 才拿得到訊息。
 */
export function cvErrorMessage(e: unknown): string {
  if (typeof e === 'number' && ready && typeof ready.exceptionFromPtr === 'function') {
    try {
      return ready.exceptionFromPtr(e).msg;
    } catch {
      /* 取不到就退回下面的通用訊息 */
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * 用完一定要 delete 的 Mat 集中管理。
 *
 * OpenCV.js 的 Mat 配置在 WebAssembly 的堆積裡，不會被 JS 的 GC 回收；
 * 漏掉幾個，連續掃十張就會把記憶體吃光、手機直接把分頁砍掉。
 */
export function withMats<T>(fn: (track: <M extends Mat>(m: M) => M) => T): T {
  const mats: Mat[] = [];
  const track = <M extends Mat>(m: M): M => {
    mats.push(m);
    return m;
  };
  try {
    return fn(track);
  } finally {
    mats.forEach((m) => {
      try {
        m.delete();
      } catch {
        /* 已經被刪掉的就算了 */
      }
    });
  }
}
