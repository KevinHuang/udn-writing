import { db } from './database';

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
    public static async update(courseId: string, data: {
        school_year: number;
        semester: number;
        course_name: string;
        course_type: string;
    }, userId: number) {
        const sql = `
            UPDATE course
            SET school_year=$2, semester=$3, course_name=$4, course_type=$5
            WHERE id=$1
              AND id IN (
                SELECT ref_course_id FROM uc_instructor WHERE ref_user_id=$6
              )
            RETURNING *;
        `;
        const result = await db.default.oneOrNone(sql, [
            courseId,
            data.school_year,
            data.semester,
            data.course_name,
            data.course_type,
            userId,
        ]);
        return result;
    }

    /** 刪除課程（僅限最初建立者，並一起刪除 uc_instructor 關聯） */
    public static async deleteById(courseId: string, userId: number) {
        // 只允許刪除自己建立的課程（透過 uc_instructor 確認）
        const checkSql = `
            SELECT 1 FROM uc_instructor
            WHERE ref_course_id=$1 AND ref_user_id=$2;
        `;
        const exists = await db.default.oneOrNone(checkSql, [courseId, userId]);
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