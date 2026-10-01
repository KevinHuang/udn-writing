import { db } from './database';

/**
 * 數位作品集專用資料介面的查詢（routes/portfolio.ts）。
 *
 * 規則全部寫在 SQL 裡，呼叫端不必再篩：
 *   - **只給已發還的作品**：有效（is_valid）而且已發還（is_returned）的那一筆批改
 *   - 軟刪除的不會出現：被清掉的繳交 ref_user_id 是負數，JOIN 不到 "user"
 *   - 同校觀摩 = 佳作章 ＋ 學生願意公開（migration 010）＋ 觀看者同校
 *     家長同意在數位作品集那邊，由作品集自己再篩一次
 *   - 觀摩時的級分依班級設定（course_showcase，migration 008），沒設定＝不給
 */

/** 一篇作品的完整資料列。各支查詢共用，回傳前由 route 決定要給哪些欄位 */
export interface PortfolioWorkRow {
  submission_id: string;
  assignment_id: string;
  title: string | null;
  school_id: string;
  school_name: string | null;
  course_id: string;
  class_name: string | null;
  school_year: number;
  semester: number;
  student_id: string;
  student_name: string | null;
  seat_no: number | null;
  submitted_at: string | null;
  word_count: number | null;
  score: number | null;
  feedback_raw: unknown;
  content: string | null;
  pic_files: unknown;
  /** 批次代繳交的照片（裸檔名）。pic_files 空著時才用，見 portfolio_image.ts 的 imagePathsOf */
  batch_files: unknown;
  featured: boolean;
  publish_consent: boolean | null;
  show_score: boolean;
}

/**
 * 已發還作品的基底查詢。`$(where)` 由各支查詢補上條件（只放參數化的片段）。
 *
 * 取「目前有效、已發還」那一筆批改的寫法與 InstructorHelper 的 DISTINCT ON 相同。
 */
const WORKS_SQL = (where: string, order = 'c.school_year, c.semester, s.submited_time, s.id') => `
    WITH fb AS (
        SELECT DISTINCT ON (ref_submission_id) ref_submission_id, score, content
          FROM submission_feedback
         WHERE is_valid = true AND is_returned = true
         ORDER BY ref_submission_id, created_time DESC, id DESC
    )
    SELECT
        s.id::text            AS submission_id,
        a.id::text            AS assignment_id,
        t.title,
        sch.id::text          AS school_id,
        sch.school_name,
        c.id::text            AS course_id,
        c.course_name         AS class_name,
        c.school_year,
        c.semester,
        u.id::text            AS student_id,
        u.name                AS student_name,
        ul.seat_no,
        s.submited_time       AS submitted_at,
        s.word_count,
        fb.score,
        fb.content            AS feedback_raw,
        s.content,
        s.pic_files,
        (SELECT b.img_files FROM batch_proxy_submission b
          WHERE b.ref_assignment_id = s.ref_assignment_id AND b.ref_user_id = s.ref_user_id
            AND b.is_valid = true
          ORDER BY b.id DESC LIMIT 1) AS batch_files,
        EXISTS (SELECT 1 FROM submission_mark m
                 WHERE m.ref_submission_id = s.id AND m.kind = 'featured') AS featured,
        pc.willing            AS publish_consent,
        COALESCE(cs.show_score, false) AS show_score
      FROM submission s
      JOIN fb              ON fb.ref_submission_id = s.id
      JOIN assignment a    ON a.id = s.ref_assignment_id
      JOIN task t          ON t.id = a.ref_task_id
      JOIN course c        ON c.id = a.ref_course_id
      JOIN school sch      ON sch.id = c.ref_school_id
      JOIN "user" u        ON u.id = s.ref_user_id
      LEFT JOIN uc_learner ul ON ul.ref_course_id = c.id AND ul.ref_user_id = u.id
      LEFT JOIN submission_publish_consent pc ON pc.ref_submission_id = s.id
      LEFT JOIN course_showcase cs ON cs.ref_course_id = c.id
     WHERE s.is_submitted IS NOT FALSE
       AND ${where}
     ORDER BY ${order}`;

/** 同校觀摩的條件：佳作章、學生願意公開、作者的學校在觀看者的學校裡 */
const SHOWCASE_WHERE = `
       EXISTS (SELECT 1 FROM submission_mark m
                WHERE m.ref_submission_id = s.id AND m.kind = 'featured')
   AND pc.willing = true
   AND sch.id IN ($(schoolIds:csv))`;

export interface LearnerContext {
  user_id: string;
  name: string | null;
  schools: Array<{ id: string; name: string | null }>;
}

class PortfolioHelper {

    /**
     * 這個 1Campus 帳號在這個系統是不是學生、在哪些學校。不是學生回傳 null。
     *
     * 帳號比對方式與登入相同（"user".account = 1Campus 的 mail）。
     * 學校不分學期 —— 與身分判定一致（docs/auth.md「身分刻意不依學期篩選」）。
     */
    public static async learnerContext(account: string): Promise<LearnerContext | null> {
        return await db.default.oneOrNone<LearnerContext>(
            `SELECT u.id::text AS user_id, u.name,
                    json_agg(DISTINCT jsonb_build_object('id', sch.id::text, 'name', sch.school_name)) AS schools
               FROM "user" u
               JOIN uc_learner ul ON ul.ref_user_id = u.id
               JOIN course c      ON c.id = ul.ref_course_id
               JOIN school sch    ON sch.id = c.ref_school_id
              WHERE u.account = $1
              GROUP BY u.id`,
            [account],
        );
    }

    /** 學生自己的已發還作品，依學期由舊到新 */
    public static async worksOf(userId: string) {
        return await db.default.manyOrNone<PortfolioWorkRow>(
            WORKS_SQL('u.id = $(userId)'),
            { userId },
        );
    }

    /**
     * 同校觀摩的作品。schoolIds 是觀看者能看的學校（呼叫端已經和觀看者的學校取交集）。
     * semester 選填，形如 { year: 114, term: 2 }。
     */
    public static async showcase(schoolIds: string[], semester?: { year: number; term: number }) {
        if (schoolIds.length === 0) return [];
        const semesterWhere = semester ? ' AND c.school_year = $(year) AND c.semester = $(term)' : '';
        return await db.default.manyOrNone<PortfolioWorkRow>(
            WORKS_SQL(SHOWCASE_WHERE + semesterWhere, 'c.school_year DESC, c.semester DESC, t.title, sch.school_name, c.course_name, ul.seat_no NULLS LAST, s.id'),
            { schoolIds, year: semester?.year, term: semester?.term },
        );
    }

    /**
     * 觀看者能不能看這一篇：是自己的，或是同校觀摩裡的作品。
     * 看得到就回傳那一列，看不到回傳 null（呼叫端一律回 404，不區分是哪一種）。
     */
    public static async viewableWork(submissionId: string, viewerUserId: string, schoolIds: string[]) {
        return await db.default.oneOrNone<PortfolioWorkRow>(
            WORKS_SQL(
                `s.id = $(submissionId) AND (u.id = $(viewerUserId)` +
                (schoolIds.length ? ` OR (${SHOWCASE_WHERE})` : '') + ')',
            ),
            { submissionId, viewerUserId, schoolIds },
        );
    }

    /**
     * 原稿轉送時用：這一篇的照片清單來源（pic_files 與批次代繳交的照片）。
     *
     * **不做權限檢查** —— 能走到這裡的請求帶著本系統簽過的短效網址
     * （lib/portfolio_image.ts），權限在簽發時就檢查過了。
     * 軟刪除的繳交（ref_user_id < 0）一律查不到。
     */
    public static async imageSourceOf(submissionId: string) {
        return await db.default.oneOrNone<{ assignment_id: string; pic_files: unknown; batch_files: unknown }>(
            `SELECT s.ref_assignment_id::text AS assignment_id, s.pic_files,
                    (SELECT b.img_files FROM batch_proxy_submission b
                      WHERE b.ref_assignment_id = s.ref_assignment_id AND b.ref_user_id = s.ref_user_id
                        AND b.is_valid = true
                      ORDER BY b.id DESC LIMIT 1) AS batch_files
               FROM submission s
              WHERE s.id = $1 AND s.ref_user_id > 0`,
            [submissionId],
        );
    }
}

export default PortfolioHelper;
