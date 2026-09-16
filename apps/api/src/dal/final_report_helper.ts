

import Util from '../util/util';
import { db } from './database';
import GenAIHelper from './genai_helper';
import SubmissionFeedbackHelper from './submission_feedback_helper';
import SubmissionHelper from './submission_helper';

class FinalReportHelper {

    public static async getFinalReport(courseId: string) {
        const sql = `
            /**  取得指定課程的每位學生的期末總結 */
            select * from final_report 
            where ref_course_id = $1 
        `;
        const result = await db.default.manyOrNone(sql, [courseId]);
        return result;
    }


    /** 計算指定課程的每位學生的期末總結 */
    public static async calculate(courseId: string, created_by: string) {
        if (!courseId) { return; }

        // 1. 取得這門課的所有學生中，尚未計算期末總結的學生清單
        const studIds = await FinalReportHelper.getNoFinalReporStuds(courseId);
        // console.log({ studIds });

        if (!studIds || studIds.length === 0) { return []; }

        // 2. 分別取得這些在這堂課所繳交的所有作業。
        let index = 0;
        for (const studId of studIds) {
            index++;
            const submissions = await SubmissionFeedbackHelper.getByCourseIdUserId(courseId, studId.ref_user_id);
            if (submissions.length === 0) { continue; }
            // console.log({ submissions })
            const articleCount = submissions.filter(sub => sub.sub_scores).length;
            console.log({ studId, progress: `${index}/${studIds.length}` })

            // 3. 計算成績總平均，四面向個別平均分
            const avgScore = Util.calculateAvgScore(submissions.map(sub => sub.score));
            const avgContent = Util.calculateAvgScore(submissions.map(sub => sub.sub_scores?.theme_and_content_score));
            const avgDict = Util.calculateAvgScore(submissions.map(sub => sub.sub_scores?.diction_and_sentence_structure_score));
            const avgOrganization = Util.calculateAvgScore(submissions.map(sub => sub.sub_scores?.structure_and_organization_score));
            const avgMechanics = Util.calculateAvgScore(submissions.map(sub => sub.sub_scores?.mechanics_and_punctuation_score));

            // console.log({ avgScore, avgContent, avgDict, avgOrganization, avgMechanics })

            // 4. 取得總分最高的作業，找出內容
            const highestScoreRec = Util.findHightestScoreRec(submissions);
            if (!highestScoreRec || !highestScoreRec.score) {
                console.log({ msg: '沒有任何批改的文章，跳過該學生', studId })
                continue;
            }

            // 取得評分裡的評語
            const hightestScoreRemark = Util.getScoreRemark(highestScoreRec);
            const hightestScoreTitle = highestScoreRec.title || '';


            // 5. 針對每個面向，分別找出評語的摘要。
            const theme_and_content_score_summarys = submissions.map(sub => sub.sub_scores?.theme_and_content_score_summary).join(',\n');
            const structure_and_organization_score_summarys = submissions.map(sub => sub.sub_scores?.structure_and_organization_score_summary).join(',\n');
            const diction_and_sentence_structure_score_summarys = submissions.map(sub => sub.sub_scores?.diction_and_sentence_structure_score_summary).join(',\n');
            const mechanics_and_punctuation_score_summarys = submissions.map(sub => sub.sub_scores?.mechanics_and_punctuation_score_summary).join(',\n');
            const final_summarys = submissions.map(sub => Util.getScoreRemark(sub)).join(',\n');



            const prompt = `
            以下每一段內容都有幾句話，請針對每一段內容的幾句話產生一句摘要結論。請採用正向鼓勵的語氣，並以 json 格式輸出。

            **theme_and_content_score_summary**
            ${theme_and_content_score_summarys}


            **mechanics_and_punctuation_score_summary**
            ${mechanics_and_punctuation_score_summarys}


            **structure_and_organization_score_summary**
            ${structure_and_organization_score_summarys}

            **diction_and_sentence_structure_score_summary**
            ${diction_and_sentence_structure_score_summarys}

            **final_summarys**
            ${final_summarys}

            `;
            const modelName = 'gemini-3.5-flash-lite';
            const ai = new GenAIHelper(modelName);
            const result = await ai.createSummary(prompt);
            // console.log(result);

            // 寫入資料庫
            await FinalReportHelper.saveFinalReport(
                studId.ref_user_id,
                courseId,
                avgScore,
                avgContent,
                avgDict,
                avgOrganization,
                avgMechanics,
                result.theme_and_content_score_summary,
                result.structure_and_organization_score_summary,
                result.diction_and_sentence_structure_score_summary,
                result.mechanics_and_punctuation_score_summary,
                articleCount,
                created_by,
                modelName,
                result.inputTokens,
                result.outputTokens,
                hightestScoreTitle,
                hightestScoreRemark,
                result.final_summarys
            );

        }

    }

    public static async saveFinalReport(studentId: string, courseId: string,
        avgScore: number, avgContent: number, avgDict: number, avgOrganization: number, avgMechanics: number,
        theme_and_content_score_summary: string,
        structure_and_organization_score_summary: string,
        diction_and_sentence_structure_score_summary: string,
        mechanics_and_punctuation_score_summary: string,
        article_count: number,
        created_by: string,
        model_name: string,
        input_tokens: number,
        output_tokens: number,
        hightest_score_title: string,
        hightest_score_remark: string,
        final_summarys: string
    ) {
        const sql = `
            /**  寫入期末總結 */
            insert into final_report (
                ref_user_id,
                ref_course_id,
                avg_score,
                theme_and_content_score,
                structure_and_organization_score,
                diction_and_sentence_structure_score,
                mechanics_and_punctuation_score,
                theme_and_content_score_summary,
                structure_and_organization_score_summary,
                diction_and_sentence_structure_score_summary,
                mechanics_and_punctuation_score_summary,
                article_count,
                created_by,
                model_name,
                input_tokens,
                output_tokens,
                hightest_score_title,
                hightest_score_remark,
                final_summarys
            ) values (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                $13,
                $14,
                $15,
                $16,
                $17,
                $18,
                $19
            )
        `;
        const result = await db.default.none(sql, [
            studentId,
            courseId,
            avgScore,
            avgContent,
            avgDict,
            avgOrganization,
            avgMechanics,
            theme_and_content_score_summary,
            structure_and_organization_score_summary,
            diction_and_sentence_structure_score_summary,
            mechanics_and_punctuation_score_summary,
            article_count,
            created_by,
            model_name,
            input_tokens,
            output_tokens,
            hightest_score_title,
            hightest_score_remark,
            final_summarys
        ]);
        return result;
    }

    /** 取得這門課的所有學生中，尚未計算期末總結的學生清單 */
    public static async getNoFinalReporStuds(courseId: string) {
        const sql = `
            /**  取得這門課的所有學生中，尚未計算期末總結的學生清單 */
            with course_stud AS (
                select 
                    l.ref_user_id,
                    ref_course_id
                from
                    uc_learner as l 
                where
                    ref_course_id = $1
            )

            select
                stud.ref_user_id,
                rpt.id
            from
                course_stud as stud
                left outer join final_report rpt 
                    ON stud.ref_user_id = rpt.ref_user_id
                    AND stud.ref_course_id = rpt.ref_course_id
            where
                rpt.id is null
`;
        const result = await db.default.manyOrNone(sql, [courseId]);
        return result || [];
    }


    public static async updateHightestScoreTilte() {
        //1. 對於每一筆尚未有最高分標題備注的期末報告紀錄
        const sql = `
        SELECT * FROM final_report WHERE hightest_score_title is null ORDER BY id DESC ;    
        `;
        const records = await db.default.manyOrNone(sql);

        let index = 0;
        for (const rec of records) {
            index++;
            console.log(`== ${index} / ${records.length} ==`);

            //2. 找出這位學生在這堂課的所有繳交作業與評分。
            const studId = rec.ref_user_id;
            const courseId = rec.ref_course_id;
            const submissions = await SubmissionFeedbackHelper.getByCourseIdUserId(courseId, studId);

            // 3. 找出分數最高的那一份作業
            const highestScoreRec = Util.findHightestScoreRec(submissions);
            // // 4. 計算出總結評語
            const hightestScoreRemark = Util.getScoreRemark(highestScoreRec.content);
            const hightestScoreTitle = highestScoreRec.title || '';

            // 5. 更新標題與備注
            const updateSql = `
                UPDATE final_report 
                SET hightest_score_title = $1,
                    hightest_score_remark = $2
                WHERE id = $3
            `;
            await db.default.none(updateSql, [hightestScoreTitle, hightestScoreRemark, rec.id]);

        }







    }

}

export default FinalReportHelper;