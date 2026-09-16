
import { db } from './database';

export class DsaSyncHelper {

    public static async syncSchools(classes: any[]) {
        const rawData = classes.map((cls: any) => {
            return (`SELECT '${cls.className}'::varchar as school_name, '${cls.classID}'::bigint as source_index`);
        }).join(' UNION ALL ');

        // console.log({ rawData })


        const sql = `
            WITH target AS (
                ${rawData}
            ),
            insert_data AS (
                INSERT INTO school( school_name, school_type, source_index )
                SELECT target.school_name, '國中'::varchar as school_type, target.source_index
                FROM target
                LEFT JOIN school AS s ON s.source_index = target.source_index
                WHERE s.id IS NULL
                RETURNING school.id, school.school_name, school.source_index
            ),
            update_data AS (
                UPDATE school
                SET 
                    school_name = target.school_name
                FROM
                    target
				WHERE
                    school.source_index = target.source_index
                RETURNING school.id, school.school_name, school.source_index
            )
            SELECT * FROM insert_data
            UNION ALL
            SELECT * FROM update_data
        `;
        const result = await db.default.manyOrNone(sql);
        return result || [];
    }

    public static async syncCourses(courses: any[], schools: any[]) {
        const rawData = courses.map((crs: any) => {
            const cls = crs.class;
            const sch = schools.find(sch => sch.source_index === cls.classID.toString());
            return (`SELECT '${crs.courseName}'::varchar as course_name, 
                            '${crs.courseID}'::bigint as source_index, 
                            '${crs.schoolYear}'::int as school_year, 
                            '${crs.semester}'::int as semester,
                            '${sch?.id}'::bigint as ref_school_id
                    `);
        }).join(' UNION ALL ');

        // console.log({ rawData })


        const sql = `
            WITH target AS (
                ${rawData}
            ),
            insert_data AS (
                INSERT INTO course( ref_org_id, ref_school_id, school_year, semester, course_name,
                    ref_user_id, course_type, source_index )
                SELECT 
                    '1'::bigint as ref_org_id, target.ref_school_id, target.school_year, target.semester, target.course_name,
                    '1'::bigint as ref_user_id, 'course'::varchar as course_type, target.source_index
                FROM target
                    LEFT JOIN course AS c ON c.source_index = target.source_index
                WHERE c.id IS NULL
                RETURNING course.id, course.ref_school_id, course.school_year, course.semester, course.course_name, course.source_index
            ),
            update_data AS (
                UPDATE course
                SET 
                    course_name = target.course_name,
                    school_year = target.school_year,
                    semester = target.semester
                FROM
                    target
				WHERE
                    course.source_index = target.source_index
                RETURNING course.id, course.ref_school_id, course.school_year, course.semester, course.course_name, course.source_index
            )
            SELECT * FROM insert_data
            UNION ALL
            SELECT * FROM update_data
        `;
        // console.log({ sql })
        // return;
        const result = await db.default.manyOrNone(sql);
        return result || [];
    }

    public static async syncInstructor(courseId: string, ref_user_id: string) {

        const sql = `
            WITH target AS (
                SELECT '${courseId}'::bigint as ref_course_id,
                '${ref_user_id}'::bigint as ref_user_id
            ),
            insert_data AS (
                INSERT INTO uc_instructor( ref_course_id, ref_user_id )
                SELECT target.ref_course_id, target.ref_user_id
                FROM target
                LEFT JOIN uc_instructor AS s ON s.ref_course_id = target.ref_course_id
                            AND s.ref_user_id = target.ref_user_id
                WHERE s.id IS NULL
                RETURNING uc_instructor.id
            )
            SELECT * FROM insert_data
        `;

        // console.log({ sql })
        const result = await db.default.manyOrNone(sql);
        return result || [];
    }

    public static async deleteLearners(courseId: string) {
        const sql = `
            DELETE FROM uc_learner
            WHERE ref_course_id = ${courseId};
        `;
        const result = await db.default.manyOrNone(sql);
        return result || [];
    }

    public static async syncLearners(courseId: string, users: any[], students: any[]) {

        const rawData = users.map((u: any) => {
            const stud = students.find(stud => stud.studentAcc === u.account);
            // console.log({ stud, u });

            return (`SELECT '${courseId}'::bigint as ref_course_id, 
                            '${u.id}'::bigint as ref_user_id, 
                            ${stud?.seatNo ? ("'" + stud.seatNo + "'") : "null"}::int as seat_no
                    `);
        }).join(' UNION ALL ');

        const sql = `
            WITH target AS (
                ${rawData}
            ),
            delete_course_learner as (
                delete from uc_learner 
                where ref_course_id = ${courseId} and
                      ref_user_id not in (select ref_user_id from target)
           ),
            insert_data AS (
                INSERT INTO uc_learner( ref_course_id, ref_user_id, seat_no )
                SELECT target.ref_course_id, target.ref_user_id, target.seat_no
                FROM target
                LEFT JOIN uc_learner AS s ON s.ref_course_id = target.ref_course_id
                            AND s.ref_user_id = target.ref_user_id
                WHERE s.id IS NULL
                RETURNING uc_learner.id
            )
            SELECT * FROM insert_data
        `;
        const result = await db.default.manyOrNone(sql);
        return result || [];
    }
    public static async syncUsers(users: any[]) {

        const rawData = users.map((user: any) => {
            return (`SELECT '${user.account}'::varchar as account, '${user.name}'::varchar as name`);
        }).join(' UNION ALL ');

        const sql = `
        WITH raw_data AS (
            ${rawData}
        )
        -- select * from raw_data
        
        -- 2. 儲存/更新使用者資料
        , insert_user AS (
            INSERT INTO "user" ( account, name )
            SELECT
                r.account, r.name
            FROM
                raw_data AS r LEFT OUTER JOIN "user" AS u 
                        ON u.account = r.account
            WHERE
                u.id IS null
            RETURNING
                *
        ), update_user AS (
            UPDATE 
                "user"
            SET
                -- name = r.name,
                last_signin = now()
            FROM
                raw_data as r
            WHERE
                "user".account = r.account
            RETURNING "user".*
        )
        
        , temp_user AS (
            SELECT id, account, name, last_signin FROM insert_user
            UNION
            SELECT id, account, name, last_signin FROM update_user
        )
        
        , target_user AS (
            SELECT
                temp_user.id , raw_data.*
            FROM
                temp_user INNER JOIN raw_data ON temp_user.account = raw_data.account
        )
        
        SELECT 
            *
        FROM temp_user
        `

        // console.log({ sql });

        const result = await db.default.manyOrNone(sql);
        return result;
    }
}


