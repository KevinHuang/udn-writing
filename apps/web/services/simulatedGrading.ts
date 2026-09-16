/**
 * 示範用的模擬批改。
 *
 * 沒有設定 GEMINI_API_KEY 時，真正的 API 會直接 throw，「批改」與
 * 「批次批改」兩個功能就完全跑不動 —— 對一個要拿來展示的原型來說，
 * 等於最核心的那段流程沒東西可看。這支在沒有金鑰時頂上。
 *
 * 三個原則：
 *   1. **決定性**：分數由作文內容的雜湊決定，同一篇永遠得到同一個結果。
 *      批改結果會存進 localStorage，用 Math.random() 的話重新整理就變一份，
 *      老師會以為系統在亂給分。
 *   2. **看得出是模擬的**：評語開頭就標明，不要讓人誤以為是真的 AI 批閱。
 *   3. **對輸入有反應**：太短的作文分數會低，示範時才有說服力。
 *
 * 這裡產生的是「已批改」，不會自動發還 —— 發還一律由老師手動決定。
 */

import { AiGradingResponse } from '../types';
import { hashString } from '../lib/hash';

/** 標記字樣。任何人看到評語就知道這不是真的 AI 批閱 */
export const SIMULATION_NOTICE = '【示範模式：以下為模擬批改結果，非真人或 AI 實際評閱】';

/** 中文字數。與 StudentEssayEditor 的算法一致：不計空白與標點 */
const countChinese = (text: string): number =>
  (text.match(/[一-鿿]/g) || []).length;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** 各級分的整體評語。用國中生看得懂的話，不要用文學評論術語 */
const OVERALL: Record<number, string[]> = {
  6: [
    '取材具體而有層次，能從一件小事帶出自己的體會，收尾不喊口號，讀完會停一下。',
    '全篇圍繞一個核心經驗展開，鋪陳與轉折都有交代，句子乾淨，情感節制而真誠。',
  ],
  5: [
    '主題清楚，開頭用具體場景切入，讀起來有畫面。中段的情緒轉折若再放慢一點會更好。',
    '結構完整，前後呼應。部分句子稍長，斷句調整後會更好讀。',
  ],
  4: [
    '有把題目要求交代完整，敘事順序清楚，但多半停在說明事情經過，個人的感受寫得比較少。',
    '內容切題，段落分明。舉的例子偏一般，若換成只有你會遇到的細節會更有說服力。',
  ],
  3: [
    '大致扣住題目，但重心分散，前半段花太多篇幅交代背景，真正要談的事到後面才出現。',
    '有想法，表達還不夠清楚。同一個意思換句話說了兩三次，段落之間的連接也偏鬆。',
  ],
  2: [
    '離題目還有一段距離，多在描述場景，沒有回答題目真正問的問題。',
    '篇幅偏短，想法還沒展開就結束了。建議先想清楚要講哪一件事，再動筆。',
  ],
  1: [
    '篇幅明顯不足，只寫了開頭。請先把想寫的那件事完整說一遍。',
    '內容大多重複題目的文字，還沒有自己的敘述。',
  ],
  0: [
    '未達可評閱的篇幅，或未依題目要求作答。',
  ],
};

const SUGGESTIONS = [
  '第二段可以再具體一點：把「我很難過」換成當時你做了什麼、看到什麼。',
  '結尾不要用「總而言之」收，直接回到開頭那個場景會更有力量。',
  '有幾個長句可以斷成兩句，讀起來會順很多。',
  '試著加入一句對話。人物一開口，畫面就活了。',
  '前後段落之間可以補一句過渡，現在的轉折有點突然。',
  '同樣的意思出現了兩次，留下寫得比較好的那一次就好。',
  '開頭可以直接從事件中間切入，不必先交代時間地點。',
];

/**
 * 產生一份模擬批改結果。
 *
 * @param essayContent 學生作品，決定分數與挑到哪幾句評語
 * @param topic 題目，一併納入雜湊，讓同一篇文章在不同題目下不會完全相同
 */
export function simulateGrading(
  essayContent: string,
  topic: string,
): AiGradingResponse {
  const words = countChinese(essayContent);
  const h = hashString(`${topic}::${essayContent}`);

  /*
    以字數定基準，再用雜湊做出正負一級的變化。
    國中會考的實際分布集中在 3-5 級分，這裡刻意貼近那個分布，
    示範時看到的才像真的一個班。
  */
  let base: number;
  if (words === 0) base = 0;
  else if (words < 80) base = 1;
  else if (words < 200) base = 2;
  else if (words < 350) base = 3;
  else if (words < 500) base = 4;
  else base = 5;

  const totalScore = clamp(base + ((h % 3) - 1), 0, 6);

  // 四項要素在整體級分附近浮動。它們是強弱項的說明，
  // 不是用來回推整體級分的（見 lib/scoring.ts）
  const around = (salt: string) =>
    clamp(totalScore + ((hashString(`${h}/${salt}`) % 3) - 1), 0, 6);

  const pool = OVERALL[totalScore] ?? OVERALL[3];
  const overall = pool[h % pool.length];

  // 挑 3 則不重複的建議
  const suggestions: string[] = [];
  for (let i = 0; suggestions.length < 3 && i < SUGGESTIONS.length * 2; i++) {
    const pick = SUGGESTIONS[hashString(`${h}/s${i}`) % SUGGESTIONS.length];
    if (!suggestions.includes(pick)) suggestions.push(pick);
  }

  return {
    totalScore,
    categoryScores: {
      content: around('content'),
      structure: around('structure'),
      grammar: around('grammar'),
      vocabulary: around('vocabulary'),
    },
    feedback: `${SIMULATION_NOTICE}\n\n${overall}\n\n（全文約 ${words} 字）`,
    suggestions,
  };
}

/**
 * 模擬一次批改的耗時。
 *
 * 不是為了好看 —— 批次批改有進度條與「批改中…」狀態，
 * 瞬間回傳的話那些狀態根本來不及顯示，等於沒被測到。
 * 用雜湊決定長度，讓每一篇的耗時略有差異但可重現。
 */
export function simulatedDelayMs(essayContent: string): number {
  return 500 + (hashString(essayContent) % 500);
}
