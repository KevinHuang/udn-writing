import { db } from './database';
import { CourseScope, courseScopeSubquery } from '../lib/course_scope';

class CourseHelper {

    /** 取得指定教師所教授的課程清單 */
    public static async getByInstructorUserId(userId: string) {
        if (!userId) { return; }

        const sql = `
            WITH target_user AS (
                SELECT * FROM "user" WHERE id = $1
            )
            -- 使用者所教授課程
            , target_courses AS (
            SELECT DISTINCT
                org.id as org_id,
                org.name as org_name,
                sch.id as school_id,
                sch.school_name,
                sch.school_type,
                crs.*
            FROM uc_instructor AS inst 
                INNER JOIN target_user AS u ON u.id = inst.ref_user_id
                INNER JOIN course as crs ON crs.id = inst.ref_course_id
                INNER JOIN org ON crs.ref_org_id = org.id
                INNER JOIN school AS sch ON crs.ref_school_id = sch.id
            )

            , stud_count AS (
                SELECT
                    count(id) AS stud_count,
                    ref_course_id
                FROM
                    uc_learner
                WHERE
                    ref_course_id IN (SELECT id FROM target_courses)
                GROUP BY
                    ref_course_id
            )

            SELECT
                tc.*,
                COALESCE(sc.stud_count, 0) AS stud_count
            FROM
                target_courses AS tc
                LEFT OUTER JOIN stud_count AS sc ON sc.ref_course_id = tc.id
            order by
                tc.school_year DESC,
                tc.semester DESC,
                tc.org_id ASC

        `

        const result = await db.default.manyOrNone(sql, [userId]);
        return result || [];
    }

    /**
     * 管理人員看得到的課程。
     *
     * 與 getByInstructorUserId() 回傳完全相同的欄位 —— 呼叫端只是換一支查詢，
     * 不需要為兩種身分寫兩套對應。差別只在 WHERE 換成範圍條件：
     * 聯合報管理人員是全部，校務管理是自己管的學校（見 lib/course_scope.ts）。
     */
    public static async getByScope(scope: CourseScope) {
        const sql = `
            WITH target_courses AS (
                SELECT DISTINCT
                    org.id as org_id,
                    org.name as org_name,
                    sch.id as school_id,
                    sch.school_name,
                    sch.school_type,
                    crs.*
                FROM course as crs
                    INNER JOIN org ON crs.ref_org_id = org.id
                    INNER JOIN school AS sch ON crs.ref_school_id = sch.id
                WHERE crs.id IN ${courseScopeSubquery(scope)}
            )
            , stud_count AS (
                SELECT count(id) AS stud_count, ref_course_id
                FROM uc_learner
                WHERE ref_course_id IN (SELECT id FROM target_courses)
                GROUP BY ref_course_id
            )
            SELECT
                tc.*,
                COALESCE(sc.stud_count, 0) AS stud_count
            FROM
                target_courses AS tc
                LEFT OUTER JOIN stud_count AS sc ON sc.ref_course_id = tc.id
            ORDER BY
                tc.school_year DESC, tc.semester DESC, tc.org_id ASC
        `;
        return (await db.default.manyOrNone(sql)) || [];
    }

    /**
     * 同步名單需要的最小資料：班級代碼與學校的 dsns。
     *
     * 一次查完才有辦法在 route 裡分辨「沒有權限」與「這班不是匯入來的」——
     * 兩者要給不一樣的訊息，老師才知道是自己的問題還是這個班的問題。
     */
    public static async getForRosterSync(courseId: string, scope: CourseScope) {
        return await db.default.oneOrNone<{
            id: string;
            course_name: string;
            source_index: string | null;
            dsns: string | null;
        }>(
            `SELECT c.id::text, c.course_name, c.source_index::text, s.dsns
               FROM public.course c
               LEFT JOIN public.school s ON s.id = c.ref_school_id
              WHERE c.id = $1 AND c.id IN ${courseScopeSubquery(scope)}`,
            [courseId],
        );
    }

    /** 建立新課程，並自動建立 uc_instructor 關聯 */
    public static async create(data: {
        ref_school_id: number;
        school_year: number;
        semester: number;
        course_name: string;
        course_type: string;
        ref_org_id: number;
    }, userId: number) {
        const insertSql = `
            INSERT INTO course (ref_school_id, school_year, semester, course_name, course_type, ref_org_id, ref_user_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING *;
        `;
        const course = await db.default.oneOrNone(insertSql, [
            data.ref_school_id,
            data.school_year,
            data.semester,
            data.course_name,
            data.course_type,
            data.ref_org_id,
            userId
        ]);

        if (!course) return null;

        // 建立 uc_instructor 關聯讓這位教師可以看到這堂課
        const linkSql = `
            INSERT INTO uc_instructor (ref_user_id, ref_course_id, created_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT DO NOTHING;
        `;
        await db.default.none(linkSql, [userId, course.id]);

        return course;
    }

    /** 更新課程（僅限建立者的課程） */
    /**
     * 更新課程。**只寫有給的欄位**（COALESCE），沒給的維持原值。
     *
     * 原本是無條件 `SET` 四個欄位，呼叫端只要漏給一個，那一欄就被寫成 NULL ——
     * 前端的 updateCourse() 只送 course_name，一旦接上就會把學年度、學期、
     * 課程類型整組清掉。所以改成部分更新，而不是要求呼叫端每次都送全部。
     *
     * `is_active` 是「封存」的儲存位置：false 代表封存。因為 COALESCE 只把
     * `null` 當成「沒給」，傳 false 一樣寫得進去。
     *
     * 權限：只能改自己任教的課程（uc_instructor）。
     */
    public static async update(courseId: string, data: {
        school_year?: number | null;
        semester?: number | null;
        course_name?: string | null;
        course_type?: string | null;
        is_active?: boolean | null;
    }, scope: CourseScope) {
        const sql = `
            UPDATE course
            SET school_year = COALESCE($2::integer, school_year),
                semester    = COALESCE($3::integer, semester),
                course_name = COALESCE($4::varchar, course_name),
                course_type = COALESCE($5::varchar, course_type),
                is_active   = COALESCE($6::boolean, is_active)
            WHERE id=$1
              AND id IN ${courseScopeSubquery(scope)}
            RETURNING *;
        `;
        const result = await db.default.oneOrNone(sql, [
            courseId,
            data.school_year ?? null,
            data.semester ?? null,
            data.course_name ?? null,
            data.course_type ?? null,
            data.is_active ?? null,
        ]);
        return result;
    }

    /** 刪除課程（限範圍內的課程，並一起刪除 uc_instructor 關聯） */
    public static async deleteById(courseId: string, scope: CourseScope) {
        // 範圍外的課程刪不動（教師＝自己的班，管理人員＝全部／自己的學校）
        const checkSql = `
            SELECT 1 FROM public.course WHERE id=$1 AND id IN ${courseScopeSubquery(scope)};
        `;
        const exists = await db.default.oneOrNone(checkSql, [courseId]);
        if (!exists) return null;

        // 先刪掉關聯再刪課程
        await db.default.none(`DELETE FROM uc_instructor WHERE ref_course_id=$1`, [courseId]);
        const result = await db.default.oneOrNone(
            `DELETE FROM course WHERE id=$1 RETURNING *;`,
            [courseId]
        );
        return result;
    }

    public static async addInstructors(course_id: number, instructors: { account: string, name: string }[]) {
        const sql = `
         WITH raw_instructor AS (
            SELECT 
                parsed_instructor.name,
                parsed_instructor.account
            FROM (
                SELECT
                    '${JSON.stringify(instructors)}'::jsonb AS instructor
            ) as original_data,
            LATERAL jsonb_to_recordset(original_data.instructor) AS parsed_instructor(name text, account text)
        )
        ,
        insert_user AS (
            INSERT INTO "user" (account, name)
            SELECT
                ri.account, ri.name
            FROM raw_instructor AS ri
                LEFT OUTER JOIN "user" AS u 
                    ON u.account = ri.account
            WHERE
                u.account is null
            returning "user".*
        )
        , target_user AS (
            select
                u.id, u.account, u.name
            FROM
                "user" as u inner join raw_instructor as ins ON u.account = ins.account
            UNION
            SELECT
                iu.id, iu.account, iu.name
            FROM
                insert_user as iu
        )
        --select * from target_user

        , insert_data AS (
            INSERT INTO uc_instructor (ref_course_id, ref_user_id)
            SELECT
                $1 as ref_count_id,
                tu.id
            FROM
                target_user AS tu
                LEFT OUTER JOIN uc_instructor AS uci ON uci.ref_course_id = $1
                                                AND uci.ref_user_id = tu.id
            WHERE
                uci.id is null
            RETURNING
                uc_instructor.id
        )
        select * FROM insert_data
        `
        const result = await db.default.manyOrNone(sql, [course_id]);
        return result || [];
    }


    public static async addStudents(course_id: number, studs: { account: string, name: string }[]) {
        const sql = `
        WITH raw_studs AS (
            SELECT 
                parsed_instructor.name,
                parsed_instructor.account
            FROM (
                SELECT
                    '${JSON.stringify(studs)}'::jsonb AS instructor
            ) as original_data,
            LATERAL jsonb_to_recordset(original_data.instructor) AS parsed_instructor(name text, account text)
        )

        -- select * from raw_studs
        ,
        insert_user AS (
            INSERT INTO "user" (account, name)
            SELECT
                ri.account, ri.name
            FROM raw_studs AS ri
                LEFT OUTER JOIN "user" AS u 
                    ON u.account = ri.account
            WHERE
                u.account is null
            returning "user".*
        )
        , target_user AS (
            select
                u.id, u.account, u.name
            FROM
                "user" as u inner join raw_studs as ins ON u.account = ins.account
            UNION
            SELECT
                iu.id, iu.account, iu.name
            FROM
                insert_user as iu
        )
        --select * from target_user

        , insert_data AS (
            INSERT INTO uc_learner (ref_course_id, ref_user_id)
            SELECT
                $1 as ref_count_id,
                tu.id
            FROM
                target_user AS tu
                LEFT OUTER JOIN uc_learner AS uci ON uci.ref_course_id = $1
                                                AND uci.ref_user_id = tu.id
            WHERE
                uci.id is null
            RETURNING
                uc_learner.id
        )
        select * FROM insert_data


        `
        const result = await db.default.manyOrNone(sql, [course_id]);
        return result || [];
    }


    public static async getCoursesBySchoolId(school_id: string) {
        const sql = `
            SELECT
                * 
            FROM 
                course
            WHERE
                ref_school_id = $1
                and
                school_year = 114
                and
                semester = 2
        `
        const result = await db.default.manyOrNone(sql, [school_id]);
        return result || [];
    }
}


export default CourseHelper;