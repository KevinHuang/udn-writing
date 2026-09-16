import Router from '@koa/router';
import InstructorHelper from '../dal/instructor_helper';
import SubmissionHelper from '../dal/submission_helper';
import GenAIHelper from '../dal/genai_helper';
import { OAuthMiddleware } from '../middleware/oauth';
import SubmissionFeedbackHelper from '../dal/submission_feedback_helper';
import TaskHelper from '../dal/task_helper';
import StorageHelper from '../dal/storage_helper';
import CourseHelper from '../dal/course_helper';
import AssignmentHelper from '../dal/assignment_helper';
import BatchProxySubmissionHelper from '../dal/batch_proxy_submission_helper';
import CloudRunJobsHelper from '../dal/cloud_run_jobs_helper';
import FinalReportHelper from '../dal/final_report_helper';
import { SchoolHelper } from '../dal/school_helper';
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
router.use(OAuthMiddleware.isInstructor);

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

        const result = await SubmissionHelper.resetSubmissions(submissionId);
        const result2 = await SubmissionFeedbackHelper.resetBySubmissionId(submissionId);
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

        const submission = await SubmissionHelper.getSubmissionById(submissionId);
        if (!submission) {
            ctx.status = 404;
            ctx.body = { error: 'Submission not found' };
            return;
        }

        // console.log({ submission });

        const gradingContext = await InstructorHelper.getGradingContextBySubmissionId(submissionId);
        if (!gradingContext) {
            ctx.status = 404;
            ctx.body = { error: 'Task grading context not found' };
            return;
        }

        // console.log({ gradingContext })

        const genAIHelper = new GenAIHelper();
        const aiResponse = await genAIHelper.grading(gradingContext, submission.content, submission.word_count || submission.content);

        const { result, inputTokens, outputTokens } = aiResponse;

        // console.log({ result });
        // const sub_scores = result.sub_scores;

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

        const result = await SubmissionFeedbackHelper.resetBySubmissionId(submissionId);
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

        const result = await SubmissionHelper.submit(user_id, assignment_id, content, files, word_count);
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

        const feedback = await SubmissionFeedbackHelper.returnFeedback(submissionIds);

        // const feedback = await InstructorHelper.saveFeedback(submissionId, score, analysis_content, userId, 0, 0, false);
        ctx.body = { success: true, feedback };
    } catch (error) {
        console.error('Error saving feedback:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

router.get('/tasks', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const tasks = await TaskHelper.getByInstructorUserId(userId);
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
        };

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

        // 處理 pic1：若是 base64 則上傳至 GCS 並由檔名取代
        if (body.pic1) {
            body.pic1 = await StorageHelper.uploadImageIfBase64(body.pic1);
        }

        const task = await TaskHelper.update(id, body, userId);
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

router.delete('/tasks/:id', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { id } = ctx.params;
        const result = await TaskHelper.deleteById(id, userId);
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
            school_year: number;
            semester: number;
            course_name: string;
            course_type: string;
        };
        const course = await CourseHelper.update(id, body, userId);
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

router.get('/courses/:course_id/finalReports', async (ctx) => {
    try {
        const userId = ctx.session.userInfo.id;
        const { course_id } = ctx.params;
        console.log({ course_id });
        const finalReports = await FinalReportHelper.getFinalReport(course_id)
        ctx.body = finalReports;
    } catch (error) {
        console.error('Error fetching assignmßents:', error);
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
            week_no: number;
        };
        const assignment = await AssignmentHelper.create(
            { ref_course_id, ref_task_id: body.ref_task_id, week_no: body.week_no },
            userId
        );
        if (!assignment) {
            ctx.status = 500;
            ctx.body = { error: 'Failed to create assignment' };
            return;
        }
        ctx.body = assignment;
    } catch (error) {
        console.error('Error creating assignment:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
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




