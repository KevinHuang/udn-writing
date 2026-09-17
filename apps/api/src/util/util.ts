import { Context } from "koa";

class Util {


    static makeErrorMsg(msg: string) {
        return { error: msg };
    }

    static returnError(ctx: Context, status: number, msg: string) {
        ctx.status = status;
        ctx.body = Util.makeErrorMsg(msg);
    }

    static returnMsg(ctx: Context, status: number, msg: any) {
        ctx.status = status;
        ctx.body = msg;
    }

    /**
     * 平均分數。**沒有任何有效分數時回 null，不是 0。**
     *
     * ⚠️ 以前只擋空陣列，沒擋元素是 undefined —— 呼叫端是
     *    `submissions.map(s => s.sub_scores?.theme_and_content_score)`，
     *    而四向度分數是另一支批次工作寫的，多數批改根本沒有。
     *    `[undefined].reduce((a, s) => a + s, 0)` 就是 **NaN**，而且會被
     *    寫進 final_report 的 numeric 欄位、原樣顯示在期末總結卡片上
     *    （實測：某位學生的四個向度全是 NaN）。
     *
     *    回 0 也不行 —— 0 是合法的級分，會變成「這位學生立意取材 0 分」。
     *    沒有資料就要說沒有資料。
     */
    static calculateAvgScore(scores: (number | null | undefined)[]): number | null {
        const valid = (scores || []).filter(
            (s): s is number => typeof s === 'number' && Number.isFinite(s),
        );
        if (valid.length === 0) { return null; }
        const sum = valid.reduce((acc, score) => acc + score, 0);
        return Math.round((sum / valid.length) * 10) / 10;
    }

    static findHightestScoreRec(submissions: any[]) {
        let highestScoreRec = null;
        let score = 0;
        for (const sub of submissions) {
            const s = sub.score;
            if (s === null || s === undefined) { continue; }

            if (s > score) {
                score = s;
                highestScoreRec = sub;
            }
        }
        return highestScoreRec;
    }

    /**
     * 從一筆批改裡取出「總體評語」那一段。
     *
     * ⚠️ **一定要先把 JSON 解析出來再切。** `submission_feedback.content` 存的是
     *    `{ raw_score, score, response }` 的 JSON **字串**，裡面的換行是
     *    `\` + `n` 兩個字元。直接在原字串上 indexOf/slice，切出來的就是字面的
     *    `\n` —— 期末總結的「本學期表現最好的一篇」會印出
     *    `…勇氣。\n\n---\n\n 一、文章亮點` 這種東西（實測看到的就是這個）。
     *
     * 呼叫端傳的東西不一致：calculate() 傳整筆紀錄，updateHightestScoreTilte()
     * 傳的是 `rec.content`（字串）。兩種都吃。
     */
    static getScoreRemark(recOrContent: any): string {
        const raw = typeof recOrContent === 'string'
            ? recOrContent
            : recOrContent?.content;
        if (!raw) return '';

        // 先還原成真正的 markdown：可能是 JSON 字串，也可能已經是物件
        let content: string;
        if (typeof raw === 'object') {
            content = typeof raw.response === 'string' ? raw.response : JSON.stringify(raw);
        } else {
            try {
                const parsed = JSON.parse(raw);
                content = typeof parsed?.response === 'string' ? parsed.response : raw;
            } catch {
                content = raw;   // 不是 JSON，舊資料可能就是純文字
            }
        }

        const startIndex = content.indexOf('總體評語：');
        let endIndex = content.indexOf('= 定性分析摘要');
        if (endIndex < 0) {
            endIndex = content.indexOf('二、再上層樓');
        }
        if (startIndex < 0) return '';
        // 找不到結尾就取到最後，不要整段丟掉
        const end = endIndex < 0 ? content.length : endIndex;

        return content.slice(startIndex, end).replace(/\*/g, '').replace(/#/g, '').trim();
    }
}

export default Util;