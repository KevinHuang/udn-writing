/**
 * 字串雜湊（FNV-1a 變體）。同樣的輸入永遠得到同一個數字。
 *
 * 這件事非做不可：示範資料會被存進 localStorage，用 Math.random() 的話
 * 每次重新產生都不一樣 —— 名冊與 Submission 各自存了 studentName，
 * 兩邊一旦對不上就會像先前座號那次一樣整片失效，重現問題也無從比對。
 *
 * 原本這支函式藏在 mockData.ts 裡，示範批改也要用，就收到這裡共用。
 */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
