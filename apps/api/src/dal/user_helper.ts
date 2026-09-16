import { db } from './database';

class UserHelper {

    /** 透過 identity code 取得登入者資訊 */
    public static async add(userInfo: any) {
        if (!userInfo) { return; }

        // let schoolSystemId = (userInfo.roleType === 'teacher' ? userInfo.teacher.teacherID :
        //     (userInfo.roleType === 'student' ? userInfo.student.studentID :
        //         (userInfo.roleType === 'parent' ? userInfo.parent.studentID : '')
        //     )
        // );
        let schoolSystemId = null;

        const sql = `
        WITH raw_data AS (
            select
                $(account)::varchar AS account,
                $(name)::varchar AS name,
                $(role)::varchar AS role,
                $(dsns)::varchar AS dsns,
                $(school_name)::varchar AS school_name,
                $(school_year)::integer AS school_year,
                $(semester)::smallint AS semester,
                $(sso_detail)::jsonb as sso_detail,
                $(auth_uuid)::varchar AS auth_uuid,
                ${schoolSystemId || 'null'}::bigint as school_system_id
        )
        -- select * from raw_data
        
        -- 2. 儲存/更新使用者資料
        , insert_user AS (
            -- last_signin 一定要在這裡就填。
            -- 下面的 update_user 是**同一句** SQL 裡的兄弟 CTE，看不到這裡剛插入的
            -- 資料列（同一個快照），所以新使用者不會被它更新到 ——
            -- 少了這一欄，first login 的 last_signin 會一直是 NULL，
            -- 要等第二次登入才有值。
            INSERT INTO "user" ( account, name, auth_uuid, last_signin )
            SELECT
                r.account, r.name, r.auth_uuid, now()
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
                -- ⚠️ name 的同步是**刻意**留著註解的。放開它會讓 1Campus 的姓名
                --    覆蓋掉任何在這邊手動修正過的名字。要不要開，是產品決定。
                -- name = r.name,
                --
                -- auth_uuid 先前完全沒有被寫入 —— userInfo.uuid 拿到之後就被丟掉了。
                -- 用 COALESCE 只補空值，不覆蓋既有資料。
                auth_uuid = COALESCE("user".auth_uuid, r.auth_uuid),
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
            target_user.*
        FROM target_user
        LIMIT 1
        `

        // console.log({ sql });

        const result = await db.default.oneOrNone(sql, {
            account: userInfo.account,
            name: userInfo.lastName + userInfo.firstName,
            role: null,
            dsns: null,
            school_name: null,
            school_year: null,
            semester: null,
            sso_detail: JSON.stringify(userInfo),
            school_system_id: null,
            auth_uuid: userInfo.uuid ?? null
        });
        // const result = await db.default.oneOrNone(sql, {
        //     account: userInfo.account,
        //     name: userInfo.name,
        //     role: userInfo.roleType,
        //     dsns: userInfo.schoolDsns,
        //     school_name: userInfo.schoolName,
        //     school_year: userInfo.schoolYear,
        //     semester: userInfo.semester,
        //     sso_detail: JSON.stringify(userInfo),
        //     school_system_id: schoolSystemId
        // });

        // await UserHelper.sync_role(userInfo, result.id); 

        // console.log({ result })

        return result;
    }

    public static async updateSchoolSystemID(user_role_id: number, sis_teacher_id: number) {
        const sql = `UPDATE user_role SET school_system_id=$1 WHERE id=$2 RETURNING id`;

        const result = db.default.oneOrNone(sql, [sis_teacher_id, user_role_id]);
        return result || [];

    }

    /**
     * 取得使用者的身份。
     *
     * **刻意不依學期篩選。** 只要 uc_instructor / uc_learner 裡有過任何一列，
     * 不論哪個學年期，這個身份就成立 —— 過去學期帶過班的人仍然是教師，
     * 才進得去看自己批改過的作品。
     *
     * 這裡原本有一個 current_semester CTE（用 semesters 的起訖日比對今天）
     * 與兩行註解掉的 JOIN。已經刪掉，因為那是個地雷：
     *
     *   1. 它是 INNER JOIN，而寒暑假期間 semesters 可能沒有任何一列涵蓋今天。
     *      current_semester 一旦是空集合，JOIN 之後全滅 —— **所有人都會失去
     *      所有身份**，登入後畫面全空。程式沒壞，但看起來像壞了。
     *   2. 學期篩選放錯層次了。「能不能進系統、看到哪一組功能」是身份問題；
     *      「這學期有哪些課」是課程清單的篩選，那在各自的課程查詢裡處理。
     *
     * 要做「只顯示本學期課程」請改課程查詢，不要改這裡。
     */
    public static async getIdentity(account: string) {
        const sql = `
        WITH target_user AS (
            select * from "user" where account = $1
        ),
        instructors AS (
            -- 1. 取得作為「教師」的身份 (透過 uc_instructor)
            SELECT distinct
                u.account,
                u.name ,
                s.school_name,
                s.school_type,
                'instructor' AS identity_type
            FROM target_user u
            JOIN public.uc_instructor ui ON u.id = ui.ref_user_id
            JOIN public.course c ON ui.ref_course_id = c.id
            JOIN public.school s ON c.ref_school_id = s.id
        ),

        learners as (
            -- 2. 取得作為「學生」的身份 (透過 uc_learner)
            SELECT distinct
                u.account,
                u.name ,
                s.school_name,
                s.school_type,
                'learner' AS identity_type
            FROM target_user u
            JOIN public.uc_learner ul ON u.id = ul.ref_user_id
            JOIN public.course c ON ul.ref_course_id = c.id
            JOIN public.school s ON c.ref_school_id = s.id
        ),

        school_admin as (
            -- 3. 取得作為「學校管理員」的身份 (透過 school_admin)
            SELECT distinct
                u.account,
                u.name ,
                s.school_name,
                s.school_type,
                'school_admin' AS identity_type
            FROM target_user u
            JOIN public.school_admin sa ON u.account = sa.account
            JOIN public.school s ON sa.ref_school_id = s.id
        ),

        user_identity AS (
            select * from instructors
            UNION ALL
            select * from learners
            UNION ALL
            select * from school_admin
        )

        SELECT * 
        FROM user_identity
        ORDER BY school_name, identity_type;
		
        `

        const result = await db.default.manyOrNone(sql, [account]);
        return result || [];
    }

}

export default UserHelper;