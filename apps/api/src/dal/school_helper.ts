
import { db } from './database';

/** 學校管理者的資訊  */
export class SchoolHelper {

    /** 取得學校定義的管理者 */
    public static async getAll() {
        const sql = `
            select
                *
            from
                school
            where
                is_valid = true
        `;

        const result = await db.default.manyOrNone(sql);

        return (result);
    }

    /** 取得指定學校學年期的所有課程清單，含授課教師與修課學生 */
    public static async getAllCoursesBySchoolId(schoolId: string, schoolYear: string, semester: string) {
        const sql = `
            select
                s.school_name, c.*
            from
                course as c
                inner join school as s on s.id = c.ref_school_id
            where
                c.ref_school_id = $(schoolId)
                and c.school_year = $(schoolYear)
                and c.semester = $(semester)
        `;

        const result = await db.default.manyOrNone(sql, { schoolId, schoolYear, semester });

        if (result && result.length > 0) {
            const insts = await SchoolHelper.getCourseInstructorsBySchoolId(schoolId, schoolYear, semester);
            const studs = await SchoolHelper.getCourseStudentsBySchoolId(schoolId, schoolYear, semester);

            result.forEach((c: any) => {
                c.instructors = insts.filter((i: any) => i.ref_course_id === c.id);
                c.students = studs.filter((s: any) => s.ref_course_id === c.id);
            })
        }

        return (result);
    }

    /** 取得指定學校學年期的授課教師清單 */
    public static async getCourseInstructorsBySchoolId(schoolId: string, schoolYear: string, semester: string) {
        const sql = `
            select
                c.id as ref_course_id,
                u.id as user_id,
                u.account, u.name
            from
                uc_instructor as inst
                inner join "user" as u on u.id = inst.ref_user_id
                inner join course as c on c.id = inst.ref_course_id
            where
                c.ref_school_id = $(schoolId)
                and c.school_year = $(schoolYear)
                and c.semester = $(semester)
            order by 
                c.id
        `
        const result = await db.default.manyOrNone(sql, { schoolId, schoolYear, semester });

        return (result);
    }

    /** 取得指定學校學年期的修課學生清單 */
    private static async getCourseStudentsBySchoolId(schoolId: string, schoolYear: string, semester: string) {
        const sql = `
            select
                c.id as ref_course_id,
                u.id as user_id,
                u.account, u.name, learn.seat_no, learn.source_class
            from
                uc_learner as learn
                inner join "user" as u on u.id = learn.ref_user_id
                inner join course as c on c.id = learn.ref_course_id
            where
                c.ref_school_id = $(schoolId)
                and c.school_year = $(schoolYear)
                and c.semester = $(semester)
            order by 
                c.id
        `
        const result = await db.default.manyOrNone(sql, { schoolId, schoolYear, semester });

        return (result);
    }

    /**
     * 教師端「可匯入的課程」清單。
     *
     * 與 getAllCoursesBySchoolId() 的差別，兩邊都是刻意的：
     *
     *   1. **沒有任何學生個資。** 只給人數。SyncSchoolModal 畫面上顯示的就是
     *      id / code / name / studentCount / teacherName 五樣，不需要名冊。
     *      （匯入時才需要學生姓名，那是另一支 endpoint 的事，見 spec.md Phase 4。）
     *   2. **學校範圍由伺服器端從呼叫者推導**，不收 :schoolId 參數 ——
     *      沒有客戶端提供的 id，就沒有 IDOR 的空間。教師只看得到
     *      自己有掛 uc_instructor 的那些學校。
     *
     * is_mine 是伺服器端算的「這門課是不是你的」。前端的 canImportCourse()
     * 可以拿它來決定按鈕能不能按，但**真正的把關必須在匯入的那支 endpoint**，
     * 不是靠這個旗標 —— 它只是給畫面用的。
     */
    public static async getImportableCourses(userId: string, schoolYear: string, semester: string) {
        const sql = `
            select
                c.id as course_id,
                -- source_index 是校務系統的課程編號。前端的 SchoolCourse.code
                -- 對應到哪一欄要在 Phase 4 接畫面時確認，目前用這個最合理的候選。
                c.source_index::text as code,
                c.course_name,
                c.school_year,
                c.semester,
                s.id as school_id,
                s.school_name,
                (
                    select count(*) from public.uc_learner ul
                    where ul.ref_course_id = c.id
                ) as student_count,
                (
                    select string_agg(u2.name, '、' order by u2.name)
                    from public.uc_instructor i2
                        join public."user" u2 on u2.id = i2.ref_user_id
                    where i2.ref_course_id = c.id
                ) as teacher_names,
                exists (
                    select 1 from public.uc_instructor mine
                    where mine.ref_course_id = c.id and mine.ref_user_id = $(userId)
                ) as is_mine
            from
                public.course c
                join public.school s on s.id = c.ref_school_id
            where
                c.school_year = $(schoolYear)
                and c.semester = $(semester)
                -- 只限這位教師有掛課的學校
                and c.ref_school_id in (
                    select distinct c2.ref_school_id
                    from public.uc_instructor i
                        join public.course c2 on c2.id = i.ref_course_id
                    where i.ref_user_id = $(userId)
                )
            order by s.school_name, c.course_name
        `;
        return await db.default.manyOrNone(sql, { userId, schoolYear, semester });
    }

    /** 指定教師帳號或姓名，找出有教授的學校課程錢單 */
    public static async getCoursesByInstructor(instructor_key: string,) {
        const sql = `
            select
                s.school_name,
                c.school_year, c.semester, c.course_name,  c.id as ref_course_id,
                u.id as user_id,
                u.account, u.name
            from
                uc_instructor as inst
                inner join "user" as u on u.id = inst.ref_user_id
                inner join course as c on c.id = inst.ref_course_id
                inner join school as s on s.id = c.ref_school_id
            where
                u.name = $(instructor_key)
                or 
                u.account = $(instructor_key)
        `;

        const result = await db.default.manyOrNone(sql, { instructor_key });

        return (result);
    }
}
