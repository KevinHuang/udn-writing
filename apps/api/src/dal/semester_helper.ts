import { db } from './database';

export interface SemesterRow {
    school_year: number;
    semester: number;
    start_date: string;
    end_date: string;
}

/**
 * 學年期。
 *
 * `semesters` 表的區間是連續的（第一學期 9/1–2/28、第二學期 3/1–8/31），
 * 所以任何一天都落在某個學期裡，不會有「寒暑假查不到目前學期」的空窗。
 */
export class SemesterHelper {

    /** 全部學年期，新的在前。 */
    public static async list(): Promise<SemesterRow[]> {
        return await db.default.manyOrNone(`
            SELECT
                school_year,
                semester,
                to_char(start_date, 'YYYY-MM-DD') AS start_date,
                to_char(end_date, 'YYYY-MM-DD') AS end_date
            FROM semesters
            ORDER BY start_date DESC
        `);
    }

    /**
     * 今天落在哪一個學年期。
     *
     * ⚠️ `ORDER BY start_date DESC LIMIT 1` 不是多餘的。
     *    `semesters` 目前有一筆資料錯誤：118 學年度有**兩列 118-2**、
     *    沒有 118-1（見 artifacts/spec.md 的 findings）。區間本身不重疊，
     *    所以今天仍然只會對到一列 —— 但沒有 LIMIT 的查詢在資料再出錯時
     *    會安靜地回傳多列，呼叫端拿 [0] 就變成看執行計畫決定結果。
     */
    public static async current(): Promise<SemesterRow | null> {
        return await db.default.oneOrNone(`
            SELECT
                school_year,
                semester,
                to_char(start_date, 'YYYY-MM-DD') AS start_date,
                to_char(end_date, 'YYYY-MM-DD') AS end_date
            FROM semesters
            WHERE start_date <= now()::date AND end_date >= now()::date
            ORDER BY start_date DESC
            LIMIT 1
        `);
    }
}

export default SemesterHelper;
