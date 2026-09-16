import * as DevapiUtil from "./devapi_util";


class DevapiJasmineHelper {

    // 使用靜態屬性快取 token 或資料
    private static tokenCache: { access_token: string, expire_time: number } | null;

    /** 取得訊息推播之 Access Token */
    private static async getAccessToken() {
        // access token 儲存在 global 物件中
        if ((!DevapiJasmineHelper.tokenCache || !DevapiJasmineHelper.tokenCache.access_token) || (DevapiJasmineHelper.tokenCache.expire_time < new Date().getTime())) {
            try {
                const token = await DevapiUtil.getAccessToken('jasmine');

                // console.log({ action: 'DevapiJasmineHelper.getAccessToken()', token });

                const { token_type, access_token, expires_in } = token;
                DevapiJasmineHelper.tokenCache = {
                    access_token,
                    expire_time: new Date().getTime() + (expires_in - 300) * 1000
                };
                // expire_time = new Date().getTime() + (expires_in - 300) * 1000;;
                // ACCESS_TOKEN = access_token;
                // console.log({ access_token })

                // await next();
            } catch (error) {
                console.error(error);
                // ctx.status = 500;
                // ctx.body = { error };
                DevapiJasmineHelper.tokenCache = null;
                throw new Error('Failed to get access token')
            }
        }

        const token = DevapiJasmineHelper.tokenCache?.access_token;
        if (!token) throw new Error('Failed to get access token');

        return token;
    }

    /** 取得指定學校的所有學生名單 */
    public static async getClassStudents(schoolDsns: string) {
        const token = await DevapiJasmineHelper.getAccessToken();

        const url = `${DevapiUtil.getDevapiHost()}/api/jasmine/${schoolDsns}/getClassStudent`;
        // console.log({ url });
        const students = await DevapiUtil.sendDevapiRequest(url, token);
        return JSON.parse(students);
    }

    public static async getAllClasses(schoolDsns: string) {
        const token = await DevapiJasmineHelper.getAccessToken();
        // console.log({ token })

        const url = `${DevapiUtil.getDevapiHost()}/api/jasmine/${schoolDsns}/getClass`;
        // console.log({ url });
        const resp = await DevapiUtil.sendDevapiRequest(url, token);
        // console.log({ resp })
        const result = JSON.parse(resp);
        const classes = result.class;

        // console.log({ classes })
        return classes;
    }

    /** 取得學校所有教師*/
    public static async getAllTeachers(schoolDsns: string) {

        const token = await DevapiJasmineHelper.getAccessToken();

        const url = `${DevapiUtil.getDevapiHost()}/api/jasmine/${schoolDsns}/getTeacher`;
        // console.log({ url });
        const teachers = await DevapiUtil.sendDevapiRequest(url, token);
        return JSON.parse(teachers);
    }

    /** 取得學校所有教師*/
    public static async getTeacherInfo(schoolDsns: string, account: string) {

        const token = await DevapiJasmineHelper.getAccessToken();

        const url = `${DevapiUtil.getDevapiHost()}/api/jasmine/${schoolDsns}/getTeacher?teacherAcc=${encodeURIComponent(account)}`;
        // console.log({ url, token });
        const raw_teachers = await DevapiUtil.sendDevapiRequest(url, token);
        // console.log( { raw_teachers })
        const jsonResp = JSON.parse(raw_teachers);
        // console.log( { result: jsonResp.teacher[0]});
        return jsonResp.teacher[0];
    }

    /** 取得指定學校的所有課程 */
    public static async getAllCourses(schoolDsns: string, schoolYear: number, semester: number) {
        const token = await DevapiJasmineHelper.getAccessToken();

        const url = `${DevapiUtil.getDevapiHost()}/api/jasmine/${schoolDsns}/getCourse`;
        // console.log({ url });
        const resp = await DevapiUtil.sendDevapiRequest(url, token);
        // console.log({ resp })
        const jsonResp = JSON.parse(resp);
        const result = jsonResp.course
            .filter((crs: any) => (crs.schoolYear === schoolYear && crs.semester === semester))
            .filter((crs: any) => (crs.class));
        // console.log({ result })
        return result;
    }

    /** 取得指定學校的所有課程的學生名單 */
    public static async getStudentsByCourseId(schoolDsns: string, courseId: string) {
        const token = await DevapiJasmineHelper.getAccessToken();

        const url = `${DevapiUtil.getDevapiHost()}/api/jasmine/${schoolDsns}/getCourseStudent?courseID=${courseId}`;
        // console.log({ url });
        const resp = await DevapiUtil.sendDevapiRequest(url, token);
        const jsonResp = JSON.parse(resp);
        const crs = jsonResp.course ? jsonResp.course[0] : null;

        return crs ? crs.student : [];
    }
}

export default DevapiJasmineHelper;