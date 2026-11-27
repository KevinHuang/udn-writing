import { api } from './client';
import type { ProxyImage } from './proxySubmissions';
import type { ScanPage } from '../lib/batchScan';

/**
 * 整疊掃描的讀座號（docs/batch-scan.md）。
 *
 * `POST /assignments/:id/seat_scan`：一批稿紙照片 → 每一頁是哪種稿紙的第幾頁、塗的座號、表頭截圖。
 * **只讀不寫** —— 伺服器不存照片；分好人之後每位學生照舊走 `uploadProxyImages`。
 *
 * @param offset 這一批的第一張是整疊裡的第幾張（0 起算）。伺服器回的 index 是「這一批裡的第幾張」，
 *               這裡加上 offset 變成整疊的位置 —— 分檔是看整疊的順序，不能各批都從 0 開始。
 */
export async function scanSeats(assignmentId: string, images: ProxyImage[], offset: number): Promise<ScanPage[]> {
  const { pages } = await api.post<{ pages: ScanPage[] }>(
    `/service/instructor/assignments/${assignmentId}/seat_scan`,
    { images },
  );
  if (!Array.isArray(pages) || pages.length !== images.length) {
    // 伺服器已經檢查過一次；這裡再擋一次，是因為對不上的後果是座號配到別張照片
    throw new Error('讀座號的結果和送出去的頁數對不上，請再試一次。');
  }
  return pages.map((page, i) => ({ ...page, index: offset + i }));
}
