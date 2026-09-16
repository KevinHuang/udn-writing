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

    static calculateAvgScore(scores: number[]) {
        if (!scores || scores.length === 0) { return 0; }
        const sum = scores.reduce((acc, score) => acc + score, 0);
        return Math.round((sum / scores.length) * 10) / 10;
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

    static getScoreRemark(rec: any) {
        if (!rec || !rec.content) return '';
        const content = rec.content || '';
        // console.log({ rec, content });
        // const content = rec.content || '';
        const startIndex = content.indexOf('總體評語：');
        let endIndex = content.indexOf('= 定性分析摘要');
        if (endIndex < 0) {
            endIndex = content.indexOf('二、再上層樓')
        }
        console.log({ startIndex, endIndex })
        if (startIndex < 0 || endIndex < 0) return '';

        return content.slice(startIndex, endIndex).replace(/\*/g, '').replace(/\#/g, '');
    }
}

export default Util;