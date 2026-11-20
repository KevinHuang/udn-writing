/**
 * 在網頁上直接列印、下載 PDF（《我的稿紙》用）。移植自 1Campus Write 的 utils/answerSheet.ts。
 *
 * 網頁不能直接指揮印表機：直接列印是把 PDF 放進看不見的框，叫出瀏覽器的列印視窗，
 * 份數、雙面、紙張、縮放都在那裡選。手機、平板多半做不到，呼叫端接到 reject 就改成下載。
 */

/** 直接列印用的隱藏框（一次只留一個；下一次列印或關掉頁面才清掉 —— 列印視窗開著的時候不能拿掉） */
export const PRINT_FRAME_ID = 'answersheet-print-frame';
const PRINT_LOAD_TIMEOUT_MS = 20_000;

export const printPdfBlob = (blob: Blob): Promise<void> =>
  new Promise((resolve, reject) => {
    const previous = document.getElementById(PRINT_FRAME_ID) as HTMLIFrameElement | null;
    if (previous) {
      URL.revokeObjectURL(previous.src);
      previous.remove();
    }
    const url = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.id = PRINT_FRAME_ID;
    frame.title = '列印稿紙';
    frame.setAttribute('aria-hidden', 'true');
    // 不能用 display:none（有的瀏覽器不印看不見的框）：放在角落、大小是 0
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    const timer = window.setTimeout(() => reject(new Error('print frame timeout')), PRINT_LOAD_TIMEOUT_MS);
    frame.onload = () => {
      window.clearTimeout(timer);
      try {
        const target = frame.contentWindow;
        if (!target) throw new Error('print frame has no window');
        target.focus();
        target.print();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('print failed'));
      }
    };
    frame.src = url;
    document.body.appendChild(frame);
  });

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 留一點時間給瀏覽器開始下載再釋放
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** 抓網站上的 PDF。失敗丟出看得懂的錯誤 */
export const fetchPdf = async (url: string): Promise<Blob> => {
  const res = await fetch(url);
  const type = res.headers.get('content-type') ?? '';
  // 檔案不存在時 SPA 會回 index.html（200），只看 ok 會把網頁當成 PDF 印出來
  if (!res.ok || !type.includes('pdf')) throw new Error('稿紙檔案下載失敗，請稍後再試');
  return res.blob();
};
