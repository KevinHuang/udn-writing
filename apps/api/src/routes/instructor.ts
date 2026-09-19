import Router from '@koa/router';
import InstructorHelper from '../dal/instructor_helper';
import SubmissionHelper from '../dal/submission_helper';
import GenAIHelper from '../dal/genai_helper';
import { isAiConfigured, simulateGrading, simulatedDelayMs } from '../dal/simulated_grading';
import type { Context } from 'koa';
import { OAuthMiddleware, actsAsSystemAdmin } from '../middleware/oauth';
import SubmissionFeedbackHelper from '../dal/submission_feedback_helper';
import TaskHelper from '../dal/task_helper';
import StorageHelper from '../dal/storage_helper';
import CourseHelper from '../dal/course_helper';
import AssignmentHelper from '../dal/assignment_helper';
import BatchProxySubmissionHelper from '../dal/batch_proxy_submission_helper';
import CloudRunJobsHelper from '../dal/cloud_run_jobs_helper';
import FinalReportHelper from '../dal/final_report_helper';
import { SchoolHelper } from '../dal/school_helper';
import FolderHelper from '../dal/folder_helper';
import SubmissionMarkHelper from '../dal/submission_mark_helper';
import AssignmentLeaveHelper from '../dal/assignment_leave_helper';
// 建立授課教師專用的 Router 實例

const router = new Router();

/**
 * @middleware
 * @description
 * 全域攔截器：
 * 1. requireLogin: 確保請求帶有合法的 Session (使用者已登入)。
 * 2. isInstructor: 確保登入之使用者具備 isInstructor 屬性 (具有授課教師身份)。
 * 皆符合才會放行至底下的 API 端點。
 */
router.use(OAuthMiddleware.requireLogin);
/*
  題庫（/tasks、/folders）另外開放給聯合報管理人員 —— 共同題庫只有他們能編輯。
  ⚠️ 以前整個路由只認授課教師：管理人員明確切換成管理身分之後，題庫 API 一律 403，
     連讀都讀不到；共同題庫又只准管理人員編輯，結果沒有人能透過畫面編輯共同題庫。
  其餘路由（班級、作業、批改）維持只給授課教師。
*/
const QUESTION_BANK_PATH = /\/instructor\/(tasks|folders)(\/|$)/;
router.use(async (ctx, next) => {
    if (QUESTION_BANK_PATH.test(ctx.path) && actsAsSystemAdmin(ctx)) return next();
    return OAuthMiddleware.isInstructor(ctx, next);
});

/**
 * @route GET /service/instructor/school-courses?school_year=115&semester=1
 * @description 教師端「可匯入的課程」清單，給 SyncSchoolModal 用。
 *
 * 這支刻意**不收學校 id**：範圍由伺服器端從登入者的 uc_instructor 推導，
 * 只會回傳這位教師有掛課的那些學校。沒有客戶端提供的 id，就沒有 IDOR 的空間。
 *
 * 回傳裡**沒有任何學生個資**，只有人數。管理端的
 * /service/admin/schools/:schoolId/classes 才給完整名冊（含 email 與座號），
 * 那支限定系統管理者。
 *
 * @returns {Array} course_id / code / course_name / school_name / student_count
 *                  / teacher_names / is_mine
 */
router.get('/school-courses', async (ctx) => {
    try {
        const { school_year, semester } = ctx.query as { school_year?: string; semester?: string };
        if (!school_year || !semester) {
            ctx.status = 400;
            ctx.body = { error: '缺少 school_year 或 semester' };
            return;
        }
        const userId = ctx.session.userInfo.id;
        ctx.body = await SchoolHelper.getImportableCourses(userId, school_year, semester);
    } catch (error) {
        console.error('Error fetching importable courses:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route GET /api/instructor/assignments
 * @description 取得目前登入教師所指定或所屬班級的所有派發任務 (Assignments)。
 * @returns {Array} 回傳該教師關聯的作業清單，包含課程名稱、作業標題、派發日期及選課人數等相關資訊。
 */
router.get('/assignments', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const assignments = await InstructorHelper.getAssignments(userId);
        ctx.body = assignments;
    } catch (error) {
        console.error('Error fetching assignments:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route GET /api/instructor/assignments/:assignmentId/submissions
 * @description 取得特定作業的所有學生的繳交狀況與批改結果。
 * 包含未繳交、已繳交待批改，或已經具備 AI 審查與教師批改分數的詳細記錄。
 * @param {string} assignmentId - 作業的唯一識別 ID (由路徑參數傳入)
 * @returns {Array} 回傳包含每一位學生繳交詳情與解析好的 `ai_analysis` 物件。
 */
router.get('/assignments/:assignmentId/submissions', async (ctx) => {
    try {
        const { assignmentId } = ctx.params;
        const submissions = await InstructorHelper.getSubmissions(assignmentId);

        // Parse JSON content if it's stored as string
        const parsedSubmissions = submissions.map(s => {
            let ai_analysis = null;
            if (s.ai_analysis) {
                try {
                    ai_analysis = JSON.parse(s.ai_analysis);
                } catch (e) {
                    ai_analysis = s.ai_analysis;
                }
            }
            let pic_files = [];
            if (s.pic_files) {
                try {
                    pic_files = typeof s.pic_files === 'string' ? JSON.parse(s.pic_files) : s.pic_files;
                } catch (e) {
                    pic_files = [];
                }
            }
            return {
                ...s,
                ai_analysis,
                pic_files
            };
        });

        ctx.body = parsedSubmissions;
    } catch (error) {
        console.error('Error fetching submissions:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route POST /api/instructor/submissions/:submissionId/feedback
 * @description 教師提交或更新特定作業繳交紀錄的成績與評語。
 * 此端點會將分數與詳細的回饋內容 (以 JSON 格式) 保存至 `submission_feedback` 資料表中。
 * @param {string} submissionId - 學生提交紀錄的唯一識別 ID (由路徑參數傳入)
 * @body {number} score - 教師給予的最終分數
 * @body {any} analysis_content - 教師給予的評語與 AI 分析的統整物件
 * @returns {Object} 包含操作成功旗標與寫入生成的 `feedback` ID。
 */
router.post('/submissions/:submissionId/feedback', async (ctx) => {
    try {
        const { submissionId } = ctx.params;
        const userId = ctx.session.userInfo.id;
        const { score, analysis_content } = ctx.request.body as { score: number, analysis_content: any };

        // console.log({ score, analysis_content })

        if (score === undefined || !analysis_content) {
            ctx.status = 400;
            ctx.body = { error: 'Missing score or analysis_content' };
            return;
        }

        const feedback = await InstructorHelper.saveFeedback(submissionId, score, analysis_content, userId, 0, 0, false);
        if (!feedback) { ctx.status = 403; ctx.body = { error: 'Not yours' }; return; }
        ctx.body = { success: true, feedback };
    } catch (error) {
        console.error('Error saving feedback:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route POST /api/instructor/submissions/:submissionId/reset
 * @description 教師重置特定作業繳交紀錄以及批改紀錄，將狀態標示為未繳交。
 * @param {string} submissionId - 學生提交紀錄的唯一識別 ID (由路徑參數傳入)
 * @returns {Object} 包含操作成功旗標。
 */
router.post('/submissions/:submissionId/reset', async (ctx) => {
    try {
        const { submissionId } = ctx.params;
        const userId = ctx.session.userInfo.id;

        if (!submissionId) {
            ctx.status = 400;
            ctx.body = { error: 'Missing submissionId' };
            return;
        }

        /*
          先重置繳交，**沒改到任何一列就停在這裡**。
          回空陣列代表「沒這一筆」或「不是你教的班」—— 兩者都回 404，刻意不區分。

          一定要 return：底下的 resetBySubmissionId 是另一個破壞性動作，
          第一支被擋卻讓第二支跑下去，會留下不一致的狀態。
        */
        const result = await SubmissionHelper.resetSubmissions(submissionId, userId);
        if (result.length === 0) {
            ctx.status = 404;
            ctx.body = { error: 'Submission not found or unauthorized' };
            return;
        }

        const result2 = await SubmissionFeedbackHelper.resetBySubmissionId(submissionId, userId);
        ctx.body = { success: true, result, result2 };
    } catch (error) {
        console.error('Error resetting submission:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route GET /api/instructor/courses/:courseId/students
 * @description 取得特定班級的所有學生的名單。
 * @param {string} courseId - 課程的唯一識別 ID (由路徑參數傳入)
 * @returns {Array} 回傳包含每一位學生 ID 與姓名的清單。
 */
router.get('/courses/:courseId/students', async (ctx) => {
    try {
        const { courseId } = ctx.params;
        const students = await InstructorHelper.getStudents(courseId, ctx.session.userInfo.id);
        ctx.body = students;
    } catch (error) {
        console.error('Error fetching students:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route POST /api/instructor/grading/:submissionId
 * @description 針對特定繳交紀錄，透過 GenAI 取得 AI 批改結果並自動儲存至資料庫
 * @param {string} submissionId - 學生提交紀錄的唯一識別 ID
 */
router.post('/grading/:submissionId', async (ctx) => {
    try {
        const { submissionId } = ctx.params;
        const userId = ctx.session.userInfo.id;

        /*
          **先把關，再花錢。**

          這裡原本用不限定班級的 getSubmissionById 取作文，跑完 AI 才在
          saveFeedback 裡擋權限 —— 而且擋下來的回傳值（null）被忽略，
          照樣回 200。結果是任何教師都能拿任意 submission id 換到別班學生的
          作文批改結果，順便燒掉 Vertex AI 的 token。寫入是安全的，讀取不是。

          404 同時涵蓋「沒這一筆」與「不是你的班」，刻意不區分。
        */
        const submission = await SubmissionHelper.getSubmissionByIdForInstructor(submissionId, userId);
        if (!submission) {
            ctx.status = 404;
            ctx.body = { error: 'Submission not found' };
            return;
        }

        const gradingContext = await InstructorHelper.getGradingContextBySubmissionId(submissionId);
        if (!gradingContext) {
            ctx.status = 404;
            ctx.body = { error: 'Task grading context not found' };
            return;
        }

        /*
          沒有設定 Vertex AI 憑證時走決定性的模擬批改（見 simulated_grading.ts）。
          少了這一段，開發環境沒有憑證就整條批改流程都跑不動。
          模擬結果的評語開頭會標明「示範模式」。
        */
        let result: any;
        let inputTokens = 0;
        let outputTokens = 0;
        if (isAiConfigured()) {
            const genAIHelper = new GenAIHelper();
            const aiResponse = await genAIHelper.grading(gradingContext, submission.content, submission.word_count || submission.content);
            result = aiResponse.result;
            inputTokens = aiResponse.inputTokens;
            outputTokens = aiResponse.outputTokens;
        } else {
            await new Promise((r) => setTimeout(r, simulatedDelayMs(submission.content || '')));
            const sim = simulateGrading(submission.content || '', gradingContext.title || '');
            /*
              對齊真實 AI 的回傳形狀：score 是分數，response 是那**一整份** markdown 評語。
              真實 AI 的 response 本來就把建議寫在裡面，模擬批改的建議卻是獨立陣列 ——
              不併進去的話，前端只讀 response，那三則建議會安靜地不見。
              （這段合併原本在前端的 lib/feedbackMarkdown.ts，跟著搬過來。）
            */
            const advice = sim.suggestions.filter(Boolean);
            const response = advice.length
                ? [sim.feedback, '### 修改建議', ...advice.map((s) => `- ${s}`)].join('\n\n')
                : sim.feedback;
            result = { score: sim.totalScore, response };
        }

        const feedback = await InstructorHelper.saveFeedback(submissionId, result.score, result, userId, inputTokens, outputTokens);

        ctx.body = { success: true, result, feedback };
    } catch (error) {
        console.error('Error in AI grading:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route POST /api/instructor/grading/:submissionId
 * @description 針對特定繳交紀錄，將其所有批改結果設定為無效，也就回到待批改狀態。
 * @param {string} submissionId - 學生提交紀錄的唯一識別 ID
 */
router.post('/grading/reset/:submissionId', async (ctx) => {
    try {
        const { submissionId } = ctx.params;
        const userId = ctx.session.userInfo.id;

        // 回 404 同時涵蓋「沒有批改可以重置」與「不是你的班」——刻意不區分
        const result = await SubmissionFeedbackHelper.resetBySubmissionId(submissionId, userId);
        if (result.length === 0) {
            ctx.status = 404;
            ctx.body = { error: 'No feedback found' };
            return;
        }

        ctx.body = { success: true, result };
    } catch (error) {
        console.error('Error in AI grading:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});


/**
 * @route POST /api/instructor/submissions/proxy
 * @description 教師代替特定學生提交作業內容（適用學生未繳交但教師代為上傳手寫作業的情境）。
 * @body {string} assignment_id - 目標作業的 ID
 * @body {string} user_id - 被代繳的學生 user ID
 * @body {string} content - 作業文字內容
 * @returns {Object} 操作結果
 */
router.post('/submissions/proxy', async (ctx) => {
    try {
        const { assignment_id, user_id, content, word_count, files } = ctx.request.body as {
            assignment_id: string;
            user_id: string;
            content: string;
            word_count: number;
            files: string[];
        };

        if (!assignment_id || !user_id || !content || !files) {
            ctx.status = 400;
            ctx.body = { error: 'Missing assignment_id, user_id or content' };
            return;
        }

        // 直接給陣列 —— SubmissionHelper.submit 自己會 JSON.stringify，這裡再轉一次就變成 jsonb 字串
        const result = await SubmissionHelper.submit(
            user_id, assignment_id, content, Array.isArray(files) ? files : [], word_count);

        /*
          與學生端同一道擋：已經批改過的不接受覆寫，否則分數會指向一段
          已經不存在的文字。兩個 CTE 都 0 筆就是被擋下來了。
          這裡以前不論結果都回 success: true —— 擋下來還說成功，比擋不住更糟。
        */
        const changed = result.reduce((n: number, row: { count: string }) => n + Number(row.count), 0);
        if (changed === 0) {
            ctx.status = 409;
            ctx.body = { error: '這份作業已經批改過了，要重新繳交請先重置批改。' };
            return;
        }

        ctx.body = { success: true, result };
    } catch (error) {
        console.error('Error in proxy submission:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route POST /api/instructor/submissions/ocr_proxy
 * @description 教師使用批次代繳交上傳學生的作業圖片，並進行 OCR 辨識文字（適用學生未繳交但教師代為上傳手寫作業的情境）。
 * @body {string} assignmentId - 目標作業的 ID
 * @body {string} studentId - 被代繳的學生 user ID
 * @body {string} images - 作業圖片的 base64 字串陣列
 * @body {string} batchUUID - 這批次作業的 uuid
 * @returns {Object} 操作結果
 */
router.post('/submissions/ocr_proxy', async (ctx) => {
    try {
        const { assignmentId, studentId, images, batchUUID } = ctx.request.body as {
            assignmentId: string;
            studentId: string;
            images: string[];
            batchUUID: string;
        };

        if (!assignmentId || !studentId || !images) {
            ctx.status = 400;
            ctx.body = { error: 'Missing assignmentId, studentId or images' };
            return;
        }

        // 將 base64 圖片存成 cloud storage 檔案
        const bucketFolder = `submit/assign_${assignmentId}`;
        const dt = new Date();
        const fileNames = await Promise.all(images.map(async img => {
            const base64Data = `data:image/jpeg;base64,${img}`;
            const fileName = await StorageHelper.uploadImageIfBase64(base64Data, bucketFolder, `sub_${assignmentId}_${studentId}_${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDay()).padStart(2, '0')}-${String(dt.getHours()).padStart(2, '0')}${String(dt.getMinutes()).padStart(2, '0')}_`);
            return fileName;
        }));

        // // 將 base64 圖片轉為檔案
        // const fileNames = await Promise.all(images.map(async img => {
        //     const base64Data = `data:image/jpeg;base64,${img}`;
        //     const fileName = await StorageHelper.uploadImageIfBase64(base64Data, 'batch_proxy_submission');
        //     return fileName;
        // }));

        const submitterId = ctx.session.userInfo.id;

        // 紀錄到 batch_proxy_submission 資料表
        const result = await BatchProxySubmissionHelper.submit(studentId, assignmentId, submitterId, fileNames, batchUUID,);

        // 呼叫 job 進行 ocr
        await CloudRunJobsHelper.startOCRJob(studentId, assignmentId, batchUUID);

        ctx.body = { success: true, result };
    } catch (error) {
        console.error('Error in proxy submission:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/** 發還作業批改結果 */
router.post('/submission_feedback/return', async (ctx) => {
    try {
        const { submissionIds } = ctx.request.body as { submissionIds: string[] };

        // console.log({ submissionIds })
        if (!submissionIds || submissionIds.length === 0) {
            ctx.status = 400;
            ctx.body = { error: 'Missing submissionIds' };
            return;
        }

        // 只會發還呼叫者教的班 —— 別班的 id 混進陣列裡會被安靜略過
        const feedback = await SubmissionFeedbackHelper.returnFeedback(submissionIds, ctx.session.userInfo.id);

        // const feedback = await InstructorHelper.saveFeedback(submissionId, score, analysis_content, userId, 0, 0, false);
        ctx.body = { success: true, feedback };
    } catch (error) {
        console.error('Error saving feedback:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/*
  ── 共同題庫只有聯合報管理人員能動 ─────────────────────────────
  授課教師對共同題庫**唯讀**：不能新增、修改、封存、刪除題目與資料夾，
  也不能把自己的題目改成共用（那等於匯入）。以前 POST /tasks 與 POST /folders
  直接吃前端送來的 shared，畫面沒有按鈕，打 API 照樣建得進共同題庫。
  修改／封存／刪除原本已限定「自己建的」，但舊資料裡有老師自己建的共用題，
  所以一律看目標是不是共用的，不是只看是誰建的。
*/
const SHARED_BANK_FORBIDDEN = '共同題庫只有聯合報管理人員可以編輯';
const denySharedBank = (ctx: Context) => {
    ctx.status = 403;
    ctx.body = { error: SHARED_BANK_FORBIDDEN };
};
/** 這一題是共用題，而目前不是以管理人員身分操作 → 不准動 */
const sharedTaskLocked = async (ctx: Context, taskId: string) =>
    !actsAsSystemAdmin(ctx) && (await TaskHelper.getById(taskId))?.shared === true;
const sharedFolderLocked = async (ctx: Context, folderId: string) =>
    !actsAsSystemAdmin(ctx) && (await FolderHelper.isShared(folderId));

router.get('/tasks', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        // 管理人員看全部共用題；授課教師只看自己組織的
        const tasks = actsAsSystemAdmin(ctx)
            ? await TaskHelper.getForSystemAdmin(userId)
            : await TaskHelper.getByInstructorUserId(userId);
        ctx.body = tasks;
    } catch (error) {
        console.error('Error fetching tasks:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.post('/tasks', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const body = ctx.request.body as {
            title: string;
            description: string;
            level: string[];
            source: string[];
            note: string;
            pic1: string;
            shared: boolean;
            picPosition: string;
            refInstructionId: string;
            writingType?: string | null;
            maxScore?: number | null;
            preferredAiModel?: string | null;
            pic1Description?: string | null;
            refFolderId?: string | null;
        };

        if (body.shared && !actsAsSystemAdmin(ctx)) { denySharedBank(ctx); return; }

        // 處理 pic1：若是 base64 則上傳至 GCS 並由檔名取代
        if (body.pic1) {
            body.pic1 = await StorageHelper.uploadImageIfBase64(body.pic1);
        }

        const task = await TaskHelper.create(body, userId);
        ctx.body = task;
    } catch (error) {
        console.error('Error creating task:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.put('/tasks/:id', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { id } = ctx.params;
        const body = ctx.request.body as {
            title: string;
            description: string;
            level: string[];
            source: string[];
            note: string;
            pic1: string;
            shared: boolean;
            picPosition: string;
        };

        // 改成共用（＝匯入），或改一題本來就是共用的，都只有管理人員可以
        if (!actsAsSystemAdmin(ctx) && (body.shared || await sharedTaskLocked(ctx, id))) {
            denySharedBank(ctx); return;
        }

        // 處理 pic1：若是 base64 則上傳至 GCS 並由檔名取代
        if (body.pic1) {
            body.pic1 = await StorageHelper.uploadImageIfBase64(body.pic1);
        }

        const task = await TaskHelper.update(id, body, userId, actsAsSystemAdmin(ctx));
        if (!task) {
            ctx.status = 404;
            ctx.body = { error: 'Task not found or unauthorized' };
            return;
        }
        ctx.body = task;
    } catch (error) {
        console.error('Error updating task:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route GET /service/instructor/submissions
 * @description 所有班級的繳交**摘要**（不含作文全文）。
 *
 * 給統計、狀態徽章、作品標記用。要作文全文請走
 * `/assignments/:id/submissions` —— 那是「某一份作業」的範圍。
 */
router.get('/submissions', async (ctx) => {
    try {
        ctx.body = await InstructorHelper.getSubmissionSummary(ctx.session.userInfo.id);
    } catch (error) {
        console.error('Error fetching submission summary:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route DELETE /service/instructor/submissions/:submissionId
 * @description 清除繳交。整筆刪掉 —— 「找不到紀錄」就是「未繳交」，
 *              學生因此可以重新繳交。底下的批改結果與作品標記一併清掉。
 */
router.delete('/submissions/:submissionId', async (ctx) => {
    try {
        const removed = await SubmissionHelper.deleteById(ctx.params.submissionId, ctx.session.userInfo.id);
        if (!removed) { ctx.status = 403; ctx.body = { error: 'Not yours' }; return; }
        ctx.body = removed;
    } catch (error) {
        console.error('Error deleting submission:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route GET /service/instructor/marks
 * @route PUT /service/instructor/submissions/:submissionId/marks/:kind
 * @description 作品標記（佳作／預選）。學生端完全不顯示。
 *
 * 讀取一次拿這位教師所有班級的標記 —— 與作業一樣走「全域清單」而不是
 * 逐份作業查，因為畫面上同時會用到好幾份作業的標記。
 */
router.get('/marks', async (ctx) => {
    try {
        ctx.body = await SubmissionMarkHelper.getByInstructorUserId(ctx.session.userInfo.id);
    } catch (error) {
        console.error('Error fetching marks:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

const MARK_KINDS = ['featured', 'preselect'];

router.put('/submissions/:submissionId/marks/:kind', async (ctx) => {
    try {
        const { submissionId, kind } = ctx.params;
        const { marked } = (ctx.request.body ?? {}) as { marked?: unknown };
        if (!MARK_KINDS.includes(kind) || typeof marked !== 'boolean') {
            ctx.status = 400; ctx.body = { error: 'Invalid kind or marked' }; return;
        }
        const userId = ctx.session.userInfo.id;
        const row = marked
            ? await SubmissionMarkHelper.set(submissionId, kind, userId)
            : await SubmissionMarkHelper.unset(submissionId, kind, userId);
        // 取消一個本來就不存在的章不是錯誤，所以只有「蓋章失敗」才回 403
        if (marked && !row) { ctx.status = 403; ctx.body = { error: 'Not yours' }; return; }
        ctx.body = row ?? { ok: true };
    } catch (error) {
        console.error('Error setting mark:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route GET /service/instructor/leaves
 * @route PUT /service/instructor/assignments/:assignmentId/leaves/:studentId
 * @description 請假註記。標成請假的學生不計入逾期未繳。
 */
router.get('/leaves', async (ctx) => {
    try {
        ctx.body = await AssignmentLeaveHelper.getByInstructorUserId(ctx.session.userInfo.id);
    } catch (error) {
        console.error('Error fetching leaves:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

router.put('/assignments/:assignmentId/leaves/:studentId', async (ctx) => {
    try {
        const { assignmentId, studentId } = ctx.params;
        const { onLeave } = (ctx.request.body ?? {}) as { onLeave?: unknown };
        if (typeof onLeave !== 'boolean') {
            ctx.status = 400; ctx.body = { error: 'onLeave must be a boolean' }; return;
        }
        const userId = ctx.session.userInfo.id;
        const row = onLeave
            ? await AssignmentLeaveHelper.set(assignmentId, studentId, userId)
            : await AssignmentLeaveHelper.unset(assignmentId, studentId, userId);
        // ON CONFLICT DO NOTHING：本來就已經請假時 row 是 null，那不是錯誤
        ctx.body = row ?? { ok: true };
    } catch (error) {
        console.error('Error setting leave:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route GET|POST /service/instructor/folders
 * @route PUT|DELETE /service/instructor/folders/:id
 * @description 題庫資料夾。可視範圍與題目一致（自己的 + 組織共享）。
 */
router.get('/folders', async (ctx) => {
    try {
        ctx.body = actsAsSystemAdmin(ctx)
            ? await FolderHelper.getForSystemAdmin(ctx.session.userInfo.id)
            : await FolderHelper.getByInstructorUserId(ctx.session.userInfo.id);
    } catch (error) {
        console.error('Error fetching folders:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

router.post('/folders', async (ctx) => {
    try {
        const { name, parentId, shared } = (ctx.request.body ?? {}) as
            { name?: string; parentId?: string | null; shared?: boolean };
        if (!name?.trim()) {
            ctx.status = 400; ctx.body = { error: 'name is required' }; return;
        }
        if (shared && !actsAsSystemAdmin(ctx)) { denySharedBank(ctx); return; }
        ctx.body = await FolderHelper.create(
            { name: name.trim(), parentId: parentId ?? null, shared: !!shared },
            ctx.session.userInfo.id,
        );
    } catch (error) {
        console.error('Error creating folder:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

router.put('/folders/:id', async (ctx) => {
    try {
        const { name, parentId } = (ctx.request.body ?? {}) as
            { name?: string; parentId?: string | null };
        if (await sharedFolderLocked(ctx, ctx.params.id)) { denySharedBank(ctx); return; }
        const folder = await FolderHelper.update(
            ctx.params.id, { name, parentId: parentId ?? null }, ctx.session.userInfo.id, actsAsSystemAdmin(ctx));
        if (!folder) { ctx.status = 404; ctx.body = { error: 'Not Found' }; return; }
        ctx.body = folder;
    } catch (error) {
        console.error('Error updating folder:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

router.delete('/folders/:id', async (ctx) => {
    try {
        if (await sharedFolderLocked(ctx, ctx.params.id)) { denySharedBank(ctx); return; }
        const folder = await FolderHelper.deleteById(ctx.params.id, ctx.session.userInfo.id, actsAsSystemAdmin(ctx));
        if (!folder) { ctx.status = 404; ctx.body = { error: 'Not Found' }; return; }
        ctx.body = folder;
    } catch (error) {
        console.error('Error deleting folder:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route PUT /service/instructor/tasks/:id/archived
 * @description 封存／取消封存題目。封存的題目不出現在挑題清單，
 *              但已經派發出去的作業不受影響 —— 所以是旗標，不是刪除。
 */
router.put('/tasks/:id/archived', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { id } = ctx.params;
        const { archived } = (ctx.request.body ?? {}) as { archived?: unknown };
        if (typeof archived !== 'boolean') {
            ctx.status = 400;
            ctx.body = { error: 'archived must be a boolean' };
            return;
        }
        if (await sharedTaskLocked(ctx, id)) { denySharedBank(ctx); return; }
        const task = await TaskHelper.setArchived(id, archived, userId, actsAsSystemAdmin(ctx));
        if (!task) {
            // 找不到，或不是自己的題目 —— 兩者刻意不區分
            ctx.status = 404;
            ctx.body = { error: 'Not Found' };
            return;
        }
        ctx.body = task;
    } catch (error) {
        console.error('Error archiving task:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.delete('/tasks/:id', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { id } = ctx.params;
        if (await sharedTaskLocked(ctx, id)) { denySharedBank(ctx); return; }
        const result = await TaskHelper.deleteById(id, userId, actsAsSystemAdmin(ctx));
        if (!result) {
            ctx.status = 404;
            ctx.body = { error: 'Task not found or unauthorized' };
            return;
        }
        ctx.body = { success: true };
    } catch (error) {
        console.error('Error deleting task:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.get('/courses', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const courses = await CourseHelper.getByInstructorUserId(userId);
        ctx.body = courses;
    } catch (error) {
        console.error('Error fetching courses:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});


router.post('/courses', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const body = ctx.request.body as {
            ref_school_id: number;
            school_year: number;
            semester: number;
            course_name: string;
            course_type: string;
            ref_org_id: number;
        };
        body.course_type = 'course';
        const course = await CourseHelper.create(body, userId);
        // console.log({ course });
        if (!course) {
            ctx.status = 500;
            ctx.body = { error: 'Failed to create course' };
            return;
        }
        ctx.body = course;
    } catch (error) {
        console.error('Error creating course:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.put('/courses/:id', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { id } = ctx.params;
        const body = ctx.request.body as {
            school_year?: number;
            semester?: number;
            course_name?: string;
            course_type?: string;
            /** 封存：false 代表封存、true 代表復原 */
            is_active?: boolean;
        };
        const course = await CourseHelper.update(id, {
            school_year: body.school_year,
            semester: body.semester,
            course_name: body.course_name,
            course_type: body.course_type,
            is_active: typeof body.is_active === 'boolean' ? body.is_active : undefined,
        }, userId);
        if (!course) {
            ctx.status = 404;
            ctx.body = { error: 'Course not found or unauthorized' };
            return;
        }
        ctx.body = course;
    } catch (error) {
        console.error('Error updating course:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.delete('/courses/:id', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { id } = ctx.params;
        const result = await CourseHelper.deleteById(id, userId);
        if (!result) {
            ctx.status = 404;
            ctx.body = { error: 'Course not found or unauthorized' };
            return;
        }
        ctx.body = { success: true };
    } catch (error) {
        console.error('Error deleting course:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.get('/courses/:id/assignments', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { id } = ctx.params;
        const assignments = await AssignmentHelper.getAssignmentsByCourseId(userId, id);
        ctx.body = assignments;
    } catch (error) {
        console.error('Error fetching assignments:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.get('/courses/:course_id/tasks/:task_ids/scores', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { course_id, task_ids } = ctx.params;
        const tasksIdsArray = task_ids.split(',');
        console.log({ course_id, tasksIdsArray });
        const scores = await SubmissionFeedbackHelper.getScoresByCourseIdTaskId(course_id, tasksIdsArray)
        // console.log({ scores })
        // const assignments = await AssignmentHelper.getAssignmentsByCourseId(userId, id);
        ctx.body = scores;
    } catch (error) {
        console.error('Error fetching assignments:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route GET /service/instructor/courses/:course_id/finalReports
 * @description 這堂課每位學生的期末總結。**只能讀自己任教的班級。**
 *
 * 原本這裡取了 userId 卻沒有往下傳 —— 任何教師拿任意 course_id
 * 就能讀到別班學生的姓名、分數與 AI 評語。把關現在做在 SQL 裡。
 * 不是自己的班回空陣列，與「這班還沒產生總結」在畫面上同樣是空的。
 */
router.get('/courses/:course_id/finalReports', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { course_id } = ctx.params;
        ctx.body = await FinalReportHelper.getFinalReport(course_id, userId);
    } catch (error) {
        console.error('Error fetching final reports:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route POST /service/instructor/courses/:course_id/finalReports
 * @description 為這堂課還沒有期末總結的學生產生總結。
 *
 * 與 `/admin/gen_final_report` 是同一個計算，差別在**範圍**：
 * 那支給系統管理者跑任意課程，這支只跑呼叫者自己任教的班。
 *
 * **只處理還沒有總結的學生**，所以重複按是安全的 ——
 * 已經產生過的不會重算，也不會重複燒 AI 的錢。
 *
 * 刻意不呼叫 `updateHightestScoreTilte()`：那支是**全域**回填，
 * 會掃過所有課程的資料，不該由單一教師的動作觸發。
 * （calculate 本來就會一併寫入最高分作品的標題。）
 */
router.post('/courses/:course_id/finalReports', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { course_id } = ctx.params;

        if (!await FinalReportHelper.isTaughtBy(course_id, userId)) {
            ctx.status = 404;
            ctx.body = { error: 'Course not found or unauthorized' };
            return;
        }

        const result = await FinalReportHelper.calculate(course_id, userId);
        ctx.body = { success: true, ...result };
    } catch (error) {
        console.error('Error generating final reports:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});


router.put('/assignments/:assignmentId/status', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { assignmentId } = ctx.params;
        const body = ctx.request.body as {
            opened: boolean;
        };
        const assignment = await AssignmentHelper.updateStatus(assignmentId, body, userId);
        if (!assignment) {
            ctx.status = 404;
            ctx.body = { error: 'Assignment not found or unauthorized' };
            return;
        }
        ctx.body = assignment;
    } catch (error) {
        console.error('Error updating assignment status:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.post('/courses/:id/assignments', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { id: ref_course_id } = ctx.params;
        const body = ctx.request.body as {
            ref_task_id: string;
            week_no?: number | null;
            deadline?: string | null;
            allow_late_submission?: boolean;
            /** 派發精靈的「立即開放」。不帶就是先存著（未開放） */
            opened?: boolean;
        };
        const assignment = await AssignmentHelper.create(
            {
                ref_course_id,
                ref_task_id: body.ref_task_id,
                week_no: body.week_no ?? null,
                deadline: body.deadline ?? null,
                allow_late_submission: body.allow_late_submission ?? false,
                opened: body.opened === true,
            },
            userId
        );
        if (!assignment) {
            // 派不進去只有一個原因：這不是你教的班
            ctx.status = 403;
            ctx.body = { error: 'You do not teach this course' };
            return;
        }
        ctx.body = assignment;
    } catch (error) {
        console.error('Error creating assignment:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route PUT /service/instructor/assignments/:assignmentId/config
 * @description 截止日與逾期設定。deadline 送 null 代表「沒有截止日」——
 *              原型的實際操作習慣就是預設不設，需要才開啟。
 */
router.put('/assignments/:assignmentId/config', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const body = ctx.request.body as { deadline?: string | null; allow_late_submission?: boolean };
        const assignment = await AssignmentHelper.updateConfig(ctx.params.assignmentId, body, userId);
        if (!assignment) { ctx.status = 403; ctx.body = { error: 'Not yours' }; return; }
        ctx.body = assignment;
    } catch (error) {
        console.error('Error updating assignment config:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route PUT /service/instructor/courses/:id/assignments/order
 * @description 重新排序。收整個班的作業 id 依序排好的陣列 ——
 *              拖拉的結果本來就是一份完整順序，逐筆搬移中途失敗會留下半套。
 */
router.put('/courses/:id/assignments/order', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { orderedIds } = (ctx.request.body ?? {}) as { orderedIds?: unknown };
        if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string')) {
            ctx.status = 400; ctx.body = { error: 'orderedIds must be an array of ids' }; return;
        }
        const result = await AssignmentHelper.reorder(ctx.params.id, orderedIds as string[], userId);
        if (!result) { ctx.status = 403; ctx.body = { error: 'You do not teach this course' }; return; }
        ctx.body = result;
    } catch (error) {
        console.error('Error reordering assignments:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route DELETE /service/instructor/assignments/:assignmentId
 * @description 刪除作業。
 *
 * ⚠️ 資料庫**沒有** submission → assignment 的外鍵（只有 migration 001 為
 *    assignment_leave 加了一條），所以底下的繳交與批改結果不會自動清掉。
 *    這裡一併刪，順序是由下往上，全部在一個交易裡。
 */
router.delete('/assignments/:assignmentId', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const removed = await AssignmentHelper.deleteById(ctx.params.assignmentId, userId);
        if (!removed) { ctx.status = 403; ctx.body = { error: 'Not yours' }; return; }
        ctx.body = removed;
    } catch (error) {
        console.error('Error deleting assignment:', error);
        ctx.status = 500; ctx.body = { error: 'Internal Server Error' };
    }
});

router.put('/assignments/:assignmentId/task', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { assignmentId } = ctx.params;
        const body = ctx.request.body as { ref_task_id: string };
        const assignment = await AssignmentHelper.updateTask(assignmentId, body.ref_task_id, userId);
        if (!assignment) {
            ctx.status = 404;
            ctx.body = { error: 'Assignment not found' };
            return;
        }
        if (assignment === 'not_swappable') {
            // 規則同前端 lib/assignments.ts 的 canSwapQuestion / swapBlockedReason
            ctx.status = 409;
            ctx.body = { error: '這份作業還在收件（或允許遲交），可能有學生正在寫，不能換題。請先立即截止並取消允許遲交，或改回未開放。' };
            return;
        }
        ctx.body = assignment;
    } catch (error) {
        console.error('Error updating assignment task:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * @route GET /api/instructor/dashboard/stud_count
 * @description 取得Dashboard顯示的學生總數。
 * @returns {Object} 回傳包含學生總數的物件。
 */
// router.get('/dashboard/stud_count', async (ctx) => {
//     try {
//         const students = await InstructorHelper.getStudents(courseId, ctx.session.userInfo.id);
//         ctx.body = students;
//     } catch (error) {
//         console.error('Error fetching students:', error);
//         ctx.status = 500;
//         ctx.body = { error: 'Internal Server Error' };
//     }
// });

export default router;




