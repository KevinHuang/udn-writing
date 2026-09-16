import Router from '@koa/router';
import InstructorHelper from '../dal/instructor_helper';
import { OAuthMiddleware } from '../middleware/oauth';

import { COURSE_DATA } from '../dal/course_data';
import CourseHelper from '../dal/course_helper';
import SubmissionHelper from '../dal/submission_helper';
import GenAIHelper from '../dal/genai_helper';
import SubmissionFeedbackHelper from '../dal/submission_feedback_helper';
import config from '../config';
import FinalReportHelper from '../dal/final_report_helper';
import Util from '../util/util';
import DevapiJasmineHelper from '../dal/devapi/devapi_helper';
import { DsaSyncHelper } from '../dal/dsa_sync_helper';
import UserHelper from '../dal/user_helper';
import { SchoolHelper } from '../dal/school_helper';

// 建立授課教師專用的 Router 實例

const router = new Router({ prefix: '/admin' });

// ⚠️ 這個 router 先前完全沒有任何驗證 —— 匿名的人就能觸發校務同步、
//    寫入課程資料、呼叫 AI 產生成績。OAuthMiddleware 有被 import，
//    但從頭到尾沒有被使用。對照 student.ts 與 instructor.ts 都有守衛。
//
//    最低限度：這裡所有路由都必須登入。
router.use(OAuthMiddleware.requireLogin);

// 會寫入資料或呼叫 AI 的操作一律用 POST，不用 GET ——
// GET 可以被任何一張 <img src="..."> 觸發（CSRF）。
// 目前部署中的舊前端不呼叫任何 /admin/* 路由，所以改動不影響線上；
// 操作者改用 curl -X POST 觸發。

/**
 * @route POST /api/admin/import
 * @description 管理員匯入課程、授課教師、與學生
 */
router.post('/import', OAuthMiddleware.isSystemAdmin, async (ctx) => {
    const school_id = 22;   // 永平中學
    const result = [];
    try {
        for (const course of COURSE_DATA) {
            //1. 建立課程
            const crs = await CourseHelper.create({
                ref_school_id: school_id,
                school_year: 114,
                semester: 2,
                course_name: course.course,
                course_type: 'course',
                ref_org_id: 1
            }
                , 3);

            console.log({ crs });

            //2. 建立授課教師
            const instructor = await CourseHelper.addInstructors(crs.id, course.teachers);

            console.log({ instructor });

            const studs = await CourseHelper.addStudents(crs.id, course.students);

            console.log({ studs });

            result.push({ crs, instructor, studs });

            //3. 建立學生

            // for (const student of course.students) {
            //     await CourseHelper.addStudent(crs.id, {
            //         account: student.userid,
            //         name: student.name,
            //     });
            // }   

        }

        ctx.body = result;
    } catch (error) {
        console.error('Error fetching assignments:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});


router.post('/grading_subscores', OAuthMiddleware.isSystemAdmin, async (ctx) => {
    try {
        // const { submissionId } = ctx.params;
        // const userId = ctx.session.userInfo.id;

        const recs = await SubmissionHelper.getNoSubscoresRecord();
        if (recs.length <= 0) {
            ctx.status = 200;
            ctx.body = { msg: 'All records have sub_scores' };
            return;
        }

        const grading_subscore_systemInstruction = `
        # 臺灣國中教育會考寫作測驗閱卷專家 Prompt（嚴格校準版）

## 角色與任務
你是一位專精於「臺灣國中教育會考寫作測驗」的資深首席閱卷委員。你深諳國家教育研究院與國中教育會考網站公佈之「一至六級分評分規準」。
**【重要心態校準】**：請摒棄 AI 溫和鼓勵的傾向。會考是嚴謹的篩選性考試，評分應「從嚴認定」。4 級分為全國平均（一般水準），若文章有明顯瑕疵，絕不寬貸給予 5 級分以上。

---

## 核心評量規準（標準參照與嚴格扣分線）

### 1. 立意取材
  **6 級分**：適切統整、運用材料，能進一步闡述說明以凸顯主旨，具深刻的思想高度。
  **5 級分**：適當統整、運用材料，並能闡述說明主旨，論述清晰。
  **4 級分**：能統整、運用材料，尚能闡述說明主旨。（若流於平鋪直敘、缺乏深刻反思，上限即為 4 級分）
  **3 級分**：嘗試依據題目取材，但不甚適當，或發展不夠充分、內容流於空洞重複。
  **2 級分**：取材不足，發展有限，或大量引述、抄錄題幹引導內容。
  **1 級分**：僅能解釋題目；或材料過於簡略，無法加以發展。

### 2. 結構組織
  **6 級分**：文章結構完整，段落分明，脈絡極其分明，內容前後連貫。
  **5 級分**：文章結構完整，但偶有轉折不夠流暢之處。
  **4 級分**：文章結構大致完整，但偶有不連貫、轉折不清之處。
  **3 級分**：文章結構鬆散；或前後不連貫；或各段字數極度不均。
  **2-1 級分**：結構不完整；或僅有單一段落。

### 3. 遣詞造句（嚴格審查項）
  **6 級分**：能精確使用語詞，並有效運用各種句型使文句流暢，具文采。
  **5 級分**：能正確使用語詞，並運用各種句型使文句通順。（若出現成語嚴重誤用、或文句帶有強烈網路/流行語，直接取消 5 級分資格）
  **4 級分**：能正確使用語詞，表達尚清楚，但偶有冗詞贅句，且句型缺乏變化。
  **3 級分**：用字遣詞不太恰當，出現語法錯誤；或文句高度口語化、句子破碎、大量重複相同詞彙。
  **2-1 級分**：遣詞造句常有錯誤，文句支離破碎，難以理解。

### 4. 錯別字、格式與標點符號
  **6-5 級分**：幾乎沒有或極少錯別字，格式、標點符號運用正確，不影響文意。
  **4 級分**：有一些錯別字及格式（如段首未縮排兩格）、標點錯誤。
  **3 級分**：錯別字或標點錯誤已造成理解上的困難。

---

## 閱卷委員審查極限（級分定錨關鍵）
1.  **口語化懲罰**：若文章出現類似「跟補習班在一起」、「對我不想上了」、「就樣就」等口語、文法不通之文句，代表寫作語感未達國中畢業生一般水準，遣詞造句直接判定為 3 級分，整體級分上限為 3 級分。
2.  **嚴重錯用詞彙懲罰**：若文章出現嚴重的成語或詞彙誤用（例如將大開的門形容為「一絲不掛」），視為缺乏精確表達能力，遣詞造句直接判定為 4 級分，整體級分上限為 4 級分（無論故事多精彩）。
3.  **平庸流水帳定錨**：僅敘述事件過程（如：以前補習很累，後來不補習好快樂），缺乏轉折後的深刻省思與認知蛻變者，立意取材上限為 4 級分。

---

## 評量流程與限制

### 評分流程
1.  **資格審查**：檢視是否符合「零級分」之技術條件。
2.  **向度評定**：對照四大向度，給予 1 至 6 級分。
3.  **綜合判定**：根據四個向度之綜合表現，判定最終整體級分（注意：此為整體性評閱，並非四項分數之算術平均值）。
4.  **撰寫評語**：依規定格式產出詳細評語。

### 字數與格式嚴格限制（極重要）
  **向度評語字數**：四個向度之「評語總結」字數，每個向度皆嚴格限制在 50 個字以內（包含中文字元、標點符號與空格，絕不能超過 50 字）。
  **專
業用語要求**：評語必須使用臺灣中文寫作學術用語（如「冗詞贅句」、「脈絡分明」、「首尾呼應」、「亮點金句」），語氣客觀嚴謹。

---

## 輸出格式範本
請完全依照以下 Markdown 結構輸出評分報告，不得包含任何額外的引言或無關字句：
markdown
# 臺灣國中教育會考寫作測驗評分報告

## 【整體綜合評定】
* **整體最終級分**：[請填入 0 - 6] 級分
* **綜合評語**：[請提供100-150字之綜合評估，指出全篇核心亮點、待改進處（特別說明扣分關鍵），以及如何往上一級分突破之建議。]

## 【分項評估維度】
### 一、立意取材
* **得分級分**：[0 - 6] 級分
* **評語總結**：[此處填寫不超過50字之評語，簡述主旨、取材與題意之扣合度。]

### 二、結構組織
* **得分級分**：[0 - 6] 級分
* **評語總結**：[此處填寫不超過50字之評語，簡述分段合理性、脈絡連貫度與首尾呼應。]

### 三、遣詞造句
* **得分級分**：[0 - 6] 級分
* **評語總結**：[此處填寫不超過50字之評語，簡述詞彙精確度、贅字口語化與句型變化。]

### 四、錯別字、格式與標點符號
* **得分級分**：[0 - 6] 級分
* **評語總結**：[此處填寫不超過50字之評語，指出錯別字、標點與段落格式之優缺點。]
\_
        `;

        const genAIHelper = new GenAIHelper(config.gradingModel);

        let index = 0;

        for (const rec of recs) {
            index++;

            // const rec = recs[0]
            // console.log({ rec });
            const { score, content } = rec;
            let result = {
                theme_and_content_score: 0,
                theme_and_content_score_summary: '',
                structure_and_organization_score: 0,
                structure_and_organization_score_summary: '',
                diction_and_sentence_structure_score: 0,
                diction_and_sentence_structure_score_summary: '',
                mechanics_and_punctuation_score: 0,
                mechanics_and_punctuation_score_summary: ''
            };
            let inputTokens = 0;
            let outputTokens = 0;

            if (score > 0) {
                const aiResponse = await genAIHelper.gradingSubscores(rec, grading_subscore_systemInstruction, content, content.length);
                result = aiResponse.result;
                inputTokens = aiResponse.inputTokens;
                outputTokens = aiResponse.outputTokens;
            }


            const feedback = await SubmissionFeedbackHelper.saveSubscores(rec.feedback_id, inputTokens, outputTokens, result);
            console.log({ index: `${index}/${recs.length}`, score, inputTokens, outputTokens, feedback })

        }

        // console.log({ submission });

        // const gradingContext = await InstructorHelper.getGradingContextBySubmissionId(submissionId);
        // if (!gradingContext) {
        //     ctx.status = 404;
        //     ctx.body = { error: 'Task grading context not found' };
        //     return;
        // }

        // console.log({ gradingContext })




        // const feedback = await InstructorHelper.saveFeedback(submissionId, result.score, result, userId, inputTokens, outputTokens, sub_scores);

        ctx.body = { success: true };
    } catch (error) {
        console.error('Error in AI grading:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/** 產生指定班級的每位學生的期末報告 */
router.post('/gen_final_report', OAuthMiddleware.isSystemAdmin, async (ctx) => {
    try {
        const { course_id } = ctx.query as { course_id: string };
        const userId = ctx.session.userInfo.id;
        console.log({ course_id, userId });
        const result = await FinalReportHelper.calculate(course_id, userId);

        ctx.body = { success: true };
    } catch (error) {
        console.error('Error in AI grading:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});


/** 產生指定學校的每位學生的期末報告 */
router.post('/gen_school_final_report', OAuthMiddleware.isSystemAdmin, async (ctx) => {
    try {
        const { school_id } = ctx.query as { school_id: string };
        const userId = ctx.session.userInfo.id;

        const courses = await CourseHelper.getCoursesBySchoolId(school_id);

        // console.log({ school_id, userId, courses });
        let index = 0;
        for (const course of courses) {
            index++;
            console.log({ course_id: course.id, progress: `${index} / ${courses.length}` })
            await FinalReportHelper.calculate(course.id, userId);
        }
        console.log(` == 完成 school_id: ${school_id} 的所有班級期末總結 == `)
        ctx.body = { success: true };
    } catch (error) {
        console.error('Error in AI grading:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/** 產生指定班級的每位學生的學期最高分的作文標題 */
router.post('/updateHightestScoreTilte', OAuthMiddleware.isSystemAdmin, async (ctx) => {
    try {
        // const content = `{"raw_score":82,"score":4,"sub_scores":{"diction_and_sentence_structure_score":80,"mechanics_and_punctuation_score":85,"structure_and_organization_score":80,"theme_and_content_score":82},"response":"📝 寫作評量與深度診斷\n--------------------------------------------------\n內容相關性檢查\n- 文章切合題意，以「陶土」為例，敘述賦予其新面貌的過程與感受。\n\n綜合評分\n- 最終等第：4級分\n- 文章總字數：約 685 字\n- 總體評語：文章能掌握題旨，以捏陶經驗說明賦予事物新面貌的過程。結構尚稱完整，段落間有基本的銜接。唯立意較為平實，部分語句略顯冗長，若能進一步深化「賦予新面貌」的獨特意義，並精鍊文句，將能提升文章層次。\n\n(1) 【優點一】：能具體描述捏陶的觸感與過程。\n(2) 【優點二】：將陶器與友誼連結，賦予情感意義。\n(3) 【核心建議】：深化「新面貌」的意涵，並精簡冗詞。\n\n== 定性分析摘要 (評分輔助) ==\n- 立意取材：能依據題意選取陶土為例，敘述其轉變過程，並連結個人情感，立意平實。\n- 結構組織：文章結構大致完整，起承轉合尚稱清晰，但段落內的層次可再加強。\n- 遣詞造句：語詞使用大致正確，但部分句子稍嫌冗長，可再精鍊以提升流暢度。\n--------------------------------------------------\n第一部分：整體診斷與深度引導\n\n== 文章亮點（✨ 值得保留與發展的優勢） ==\n✨ 【亮點類別】：具體感官描寫\n- 具體表現：「軟呼呼的陶土冰冰涼涼的，摸起來很舒服，且與一般泥土的觸感相似」\n- 為什麼這是亮點：透過觸覺描寫，讓讀者能具體感受到陶土的質地，增加文章的真實感。\n- 如何進一步發揮：可加入更多視覺或聽覺的描寫，例如拉坏機轉動的聲音，或陶土在手中成形的視覺變化。\n\n== 🎯 關鍵優化方向 ==\n🚀 提升點一：【立意取材】深化「賦予新面貌」的獨特意義\n--- 🔍 現況分析 ---\n- 你寫了：「雖然我並沒有為我的陶器穿上色彩繽紛的衣服，但現在我發現，就算是看起來很一般的陶土也可以因為人們的創意而得到新的面貌，以截然不同的外貌展現新的生命力」\n- 待優化處：這段敘述較為一般，未能突顯你個人在「賦予新面貌」過程中的獨特巧思或深刻體悟。\n--- 📈 改進建議 ---\n- 你可以這樣改寫：雖然我並未替陶器披上斑斕的彩衣，但我刻意保留了手捏的樸拙痕跡。這份不完美，正是我賦予它的新面貌——它不再是工廠裡千篇一律的複製品，而是帶著我指尖溫度的獨特存在，展現出質樸而堅韌的生命力。\n- 💯 為什麼這樣改更好：透過強調「保留手捏痕跡」這個具體行動，突顯了你賦予陶土的獨特新面貌，使立意更加深刻且個人化。\n\n🚀 提升點二：【遣詞造句】精簡冗長句型，提升文氣流暢度\n--- 🔍 現況分析 ---\n- 你寫了：「後來我把那個精緻的杯子送給我的好朋友，祝福我們的友誼可以像陶杯一樣，即使歷經高溫與手部捏製也依然展現韌性，成為厚實耐用的器具，陶器之於我，是件特別的物品，有屬於它本身的靈魂也有我所寄託的希望，它不再是一塊平凡的陶土，而是充滿生命力的物件，承載了我的回憶與時光的印記，每次從櫃子裡拿出來欣賞，就彷彿回到了那天捏陶的時候，它成了我與回憶的連結，打造專屬於我的時空飛船。」\n- 待優化處：這段句子過長，缺乏適當的標點符號停頓，導致文氣不夠緊湊，且部分概念重複。\n--- 📈 改進建議 ---\n- 你可以這樣改寫：後來，我將那個精緻的陶杯贈予摯友，期盼我們的友誼能如陶器般，歷經高溫淬鍊依然堅韌厚實。這件陶器對我而言意義非凡，它不僅擁有獨特的靈魂，更寄託了我的祝福。它不再是平凡的泥土，而是承載時光印記的生命體。每當我端詳著它，便彷彿搭上時空飛船，重溫那段捏陶的美好回憶。\n- 💯 為什麼這樣改更好：將長句拆解為短句，並刪除重複的詞彙，使文氣更加流暢，情感表達也更為清晰有力。\n--------------------------------------------------\n文學之路始於大膽嘗試，願你在文字世界中繼續勇敢探索！🌟"}`;
        // const content = `### 📝 寫作評量與基礎診斷\n\n**【🔍 內容相關性檢查】**\n* 文章內容符合「一次印象深刻的旅行」之主題，描述了去泰國騎大象的經驗。\n\n**【📊 綜合評分】**\n* 🏆 **最終等第：** 3級分\n* 📏 **文章總字數：** 約 600 字\n* 💡 **總體評語：** 文章能敘述旅行經驗，但結構稍嫌鬆散，且遣詞造句較為口語平淡，錯別字亦需留意。若能深化內心感受與體悟，並加強段落間的連結，將有助於提升至 4 級分。\n\n---\n\n### 一、文章亮點（✨ 值得保留與發展的優勢）\n✨ **【亮點類別】：具體事件的描寫**\n* 📌 **具體表現：** 「因為大象太高所以我們必需上到一個平台才能座上大象的背，當時我看到大象就覺得很高很可怕，走上平台的時候我就有點後悔了，但我還是鼓足勇氣坐了上去。」\n* 👍 **為什麼這是亮點：** 能具體寫出騎大象前的恐懼與心理轉折，讓讀者能感受到當時的情境。\n\n---\n\n### 二、再上層樓（🎯 建議調整改善的部分）\n**【✍️ 字詞診療室】**\n1. 必需 ➡️ 必須 (表示一定要)\n2. 座上 ➡️ 坐上 (動詞)\n3. 物他 ➡️ 幫他 (錯字)\n4. 但步 ➡️ 但我 (錯字)\n\n== 📄 段落解析 (逐段進行) ==\n* 🤔 **引導提問：** 第一段由照片引起回憶，是否能用更精煉的文字帶出主題？\n* 🛠️ **改進建議：** 減少瑣碎的對話，直接點出照片帶來的回憶與感受。\n* 🪄 **改寫示範：** 「午後，媽媽遞來手機，螢幕上是我在泰國騎大象的照片。看著照片中略顯生澀的笑容，那段充滿驚奇與挑戰的泰國之旅，再次浮現腦海。」\n* 🔔 **小提醒：** 首段應簡潔有力地破題。\n\n* 🤔 **引導提問：** 第二、三段描述騎大象的過程，如何讓恐懼與克服恐懼的過程更生動？\n* 🛠️ **改進建議：** 增加對大象的視覺描寫（如龐大的身軀、粗糙的皮膚）以及內心的掙扎。\n* 🪄 **改寫示範：** 「大象龐大的身軀如同一座小山，讓我望而生畏。當工作人員示意我坐到大象脖子上時，我的心跳瞬間加速，雙腿發軟。但在弟弟勇敢的示範與家人的鼓勵下，我深吸一口氣，緩緩挪動身軀。那一刻，我彷彿戰勝了心中的巨獸。」\n* 🔔 **小提醒：** 善用感官摹寫，能讓讀者身歷其境。\n\n* 🤔 **引導提問：** 結尾段提到老虎，是否會模糊焦點？\n* 🛠️ **改進建議：** 結尾應聚焦於「克服恐懼」的成長，將老虎的經驗作為對比或省略，並深化旅行的意義。\n* 🪄 **改寫示範：** 「雖然之後面對老虎時，我仍因恐懼而卻步，但騎大象的經驗已在我心中種下勇敢的種子。這次泰國之旅，不僅讓我體驗了異國風情，更讓我學會直面恐懼。這份跨越心理障礙的喜悅，將成為我人生旅途中最珍貴的行囊。」\n* 🔔 **小提醒：** 結尾要能呼應主題，並昇華文章的意涵。\n---\n文學之路始於大膽嘗試，願你在文字世界中繼續勇敢探索！🌟`;
        // const remark = Util.getScoreRemark(content);
        //    console.log(remark);

        await FinalReportHelper.updateHightestScoreTilte()


        ctx.body = { msg: 'OK' };
    } catch (error) {
        console.error('Error in AI grading:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/** 從聯合學苑 DSA 同步學校清單與課程清單 */
router.post('/sync/school', OAuthMiddleware.isSystemAdmin, async (ctx) => {
    const dsns = 'udncollege.plus'
    const { schoolYear, semester } = { schoolYear: 115, semester: 1 }
    // const dsns = 'fljh.hc.edu.tw'
    try {
        // 1. 取得指定學校的所有班級。（對聯合學苑這個 DSA 來說， class 代表各校， course 代表某個課程）
        const classes = await DevapiJasmineHelper.getAllClasses(dsns);
        // console.log({ classes });
        // 2. 針對每個班級，更新到學校清單
        const schools = await DsaSyncHelper.syncSchools(classes);
        // console.log({ schools });

        // 3. 取得所有的課程
        const courses = await DevapiJasmineHelper.getAllCourses(dsns, schoolYear, semester);
        // const courses = tempCourses.filter((crs: any) => {
        //     // console.log({ source_index: sch.source_index, cls_id: crs.class.classID })
        //     const sch = schools.find((sch: any) => sch.source_index === crs.class.classID.toString());
        //     if (!sch) return false;
        //     return true;
        // });
        // console.log({ crs: courses.find((crs: any) => crs.courseID === 8197) });

        // return;
        // console.log({ courses })
        if (courses.length > 0) {
            // 4. 更新課程資訊`
            const finalCourses = await DsaSyncHelper.syncCourses(courses, schools);
            // console.log({ finalCourses })

            const targetCourseSourceIds: number[] = [8];
            // 5 針對每個課程，
            for (const crs of finalCourses) {

                // 如果有特別單獨轉檔的，加入 targetCourseSourceIds
                if (targetCourseSourceIds.length > 0) {
                    if (!targetCourseSourceIds.map(s => s.toString()).includes(crs.source_index.toString())) continue;
                }
                // 5.1 找出此課程的所有教師
                const targetCourse = courses.find((c: any) => c.courseID.toString() === crs.source_index.toString());
                console.log(`開始處理課程：${targetCourse.class.className}-${crs.course_name}, id: ${crs.source_index}`);


                const teachers = targetCourse.teacher;

                // 5.2 針對每位教師
                for (const teacher of teachers) {
                    // 5.2.1 更新或建立使用者資訊
                    const user = await UserHelper.add({ account: teacher.teacherAcc, firstName: teacher.teacherName, lastName: '' })
                    // console.log({ teacher, user, crs });
                    // 5.2.2 更新或建立授課紀錄
                    await DsaSyncHelper.syncInstructor(crs.id, user.id)
                }

                // 5.3 取得指定課程學生清單，
                const students = await DevapiJasmineHelper.getStudentsByCourseId(dsns, crs.source_index);

                // 5.4 更新學生帳號資料
                let users = students.map((stud: any) => (
                    { account: stud.studentAcc, name: stud.studentName }
                ));
                const finalUsers = await DsaSyncHelper.syncUsers(users)

                // 5.5 更新課程修課學生
                const learners = await DsaSyncHelper.syncLearners(crs.id, finalUsers, students);
            }
        } else {
            console.log('沒有符合的課程');
        }

        console.log('處理完成');
        ctx.body = { msg: 'OK' };
    } catch (error) {
        console.error('Error in AI grading:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});


/**
 * 指定學校的課程清單（含授課教師與**修課學生的完整名冊**）。
 *
 * 回傳裡包含每個學生的 account（就是 email）、座號與原始校務班級，
 * 所以一個請求等於一整間學校的名冊 —— 限定系統管理者。
 *
 * 教師端要瀏覽可匯入的課程，走 /service/instructor/school-courses，
 * 那支只回傳畫面真正需要的欄位，沒有任何學生個資。
 */
router.get('/schools/:schoolId/classes', OAuthMiddleware.isSystemAdmin, async (ctx) => {
    try {
        const { schoolId } = ctx.params;
        const { school_year, semester } = ctx.query;
        console.log({ schoolId, school_year, semester });

        if (!school_year || !semester) throw new Error('缺少 學年期 ');

        // 1. 取得指定學校的所有班級。（對聯合學苑這個 DSA 來說， class 代表各校， course 代表某個課程）
        const classes = await SchoolHelper.getAllCoursesBySchoolId(schoolId, school_year?.toString() || '', semester?.toString() || '');

        ctx.body = { classes };
    } catch (error) {
        console.error('Error in AI grading:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

/**
 * 依教師**姓名或帳號**查他教的所有學校課程。
 *
 * 比對條件是 `u.name = $1 or u.account = $1` —— 用姓名就查得到，
 * 不需要任何 id。這種形狀的查詢不適合開放，限定系統管理者。
 * 教師本人要看自己的課程走 /service/instructor/courses。
 */
router.get('/instructors/:instructor_key/courses', OAuthMiddleware.isSystemAdmin, async (ctx) => {

    try {

        const { instructor_key } = ctx.params;

        const classes = await SchoolHelper.getCoursesByInstructor(instructor_key as string);

        ctx.body = { classes };
    } catch (error) {
        console.error('Error in AI grading:', error);
        ctx.status = 500;
        ctx.body = { error: 'Internal Server Error' };
    }
});

export default router;

