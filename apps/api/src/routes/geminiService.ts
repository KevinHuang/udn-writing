import Router from '@koa/router';
import { Context } from 'koa';
import { OAuthMiddleware } from '../middleware/oauth';
import GenAIHelper from '../dal/genai_helper';
import { isAiConfigured, simulateGrading, simulatedDelayMs } from '../dal/simulated_grading';
import Util from '../util/util';
import StorageHelper from '../dal/storage_helper';

const router = new Router({ prefix: '/gemini' });

/**
 * 透過 Gemini OCR 辨識圖片中的手寫文字
 */
router.post('/ocr', OAuthMiddleware.requireLogin, async (ctx: Context) => {
  try {
    const { base64Images, mimeType, assignmentId, userId } = ctx.request.body as { base64Images: string[], mimeType: string, assignmentId: string, userId: string };
    if (!base64Images || !mimeType || !assignmentId || !userId) {
      Util.returnError(ctx, 400, 'Missing required fields.');
      return;
    }
    // console.log({ msg: 'start ocr', bytes: base64Images.length, mimeType });
    const genAIHelper = new GenAIHelper();
    const result = await genAIHelper.OCR(base64Images, mimeType);
    // console.log({ result })

    // save to cloud stroage
    // 將 base64 圖片存成 cloud storage 檔案
    const bucketFolder = `submit/assign_${assignmentId}`;
    const dt = new Date();
    const fileNames = await Promise.all(base64Images.map(async img => {
      const base64Data = `data:image/jpeg;base64,${img}`;
      const fileName = await StorageHelper.uploadImageIfBase64(base64Data, bucketFolder, `sub_${assignmentId}_${userId}_${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDay()).padStart(2, '0')}-${String(dt.getHours()).padStart(2, '0')}${String(dt.getMinutes()).padStart(2, '0')}_`);
      return fileName;
    }));

    const orderedFiles: string[] = [];
    if (fileNames.length === 1) {
      orderedFiles.push(fileNames[0]);
    } else {
      result.order?.forEach((index: number) => {
        orderedFiles.push(fileNames[index]);
      })
    }

    // console.log({ result });
    ctx.body = { text: result.text, files: orderedFiles.map(fileName => `${bucketFolder}/${fileName}`) };
    // Util.returnMsg(ctx, 200, result);
  }
  catch (error) {
    console.log(error);
    Util.returnError(ctx, 500, 'Failed to get assignments for current user.');
  }
});

/*
 * ─────────────────────────────────────────────
 * Phase 5：以下四支取代前端的 services/geminiService.ts。
 *
 * 那支原本在瀏覽器裡直接呼叫 Gemini，金鑰經由 vite 的 define 打進 bundle，
 * 任何人開開發者工具就拿得到。提示詞原樣搬到 GenAIHelper，行為不變。
 *
 * 四支全部要求登入。單張圖片、單次呼叫，不寫資料庫 ——
 * 會寫進資料庫的批改走 POST /service/instructor/grading/:submissionId。
 * ─────────────────────────────────────────────
 */

/** 圖片 base64 的上限。約 8 MB 的原始資料，避免有人拿超大檔案打 AI 額度 */
const MAX_IMAGE_BASE64 = 11 * 1024 * 1024;

/** 取出並檢查 { base64Image, mimeType }。不合法就回 400 並回傳 null */
function readImageBody(ctx: Context): { base64Image: string; mimeType: string } | null {
  const { base64Image, mimeType } = ctx.request.body as { base64Image?: string; mimeType?: string };
  if (!base64Image || !mimeType) {
    Util.returnError(ctx, 400, 'Missing base64Image or mimeType.');
    return null;
  }
  if (!/^image\//.test(mimeType)) {
    Util.returnError(ctx, 400, 'mimeType must be an image type.');
    return null;
  }
  if (base64Image.length > MAX_IMAGE_BASE64) {
    Util.returnError(ctx, 413, 'Image too large.');
    return null;
  }
  return { base64Image, mimeType };
}

/**
 * 單張圖片 OCR，只回文字。
 *
 * 與上面的 /ocr 不同：那支是繳交流程用的，會把圖片存進 Cloud Storage 並排序多頁，
 * 需要 assignmentId 與 userId。這支給「編輯器裡插入辨識文字」用，不留檔。
 */
router.post('/ocr_text', OAuthMiddleware.requireLogin, async (ctx: Context) => {
  const img = readImageBody(ctx);
  if (!img) return;
  try {
    const result = await new GenAIHelper().OCR([img.base64Image], img.mimeType);
    ctx.body = { text: result.text || '' };
  } catch (error) {
    console.error('Error in OCR:', error);
    Util.returnError(ctx, 502, 'OCR 文字提取失敗');
  }
});

/** 看圖寫作的出題參考：描述圖片內容 */
router.post('/analyze_image', OAuthMiddleware.requireLogin, async (ctx: Context) => {
  const img = readImageBody(ctx);
  if (!img) return;
  try {
    ctx.body = { text: await new GenAIHelper().describeImage(img.base64Image, img.mimeType) };
  } catch (error) {
    console.error('Error analyzing image:', error);
    Util.returnError(ctx, 502, 'AI 圖片分析失敗');
  }
});

/** 依題目與說明產生評分規準 */
router.post('/rubric', OAuthMiddleware.requireLogin, async (ctx: Context) => {
  const { topic, description } = ctx.request.body as { topic?: string; description?: string };
  if (!topic || !description) {
    Util.returnError(ctx, 400, 'Missing topic or description.');
    return;
  }
  try {
    ctx.body = { text: await new GenAIHelper().createRubric(topic, description) };
  } catch (error) {
    console.error('Error generating rubric:', error);
    Util.returnError(ctx, 502, 'AI 產生評分規準失敗');
  }
});

/**
 * 試批改：教師在題庫頁貼一段文字，試跑某一題的評分效果。
 *
 * **不寫資料庫** —— 那段文字不屬於任何學生。真正的批改走
 * POST /service/instructor/grading/:submissionId，那支才會存版本與 token 用量。
 *
 * 沒有 Vertex AI 憑證時走決定性的模擬批改，評語標明「示範模式」。
 */
router.post('/grade', OAuthMiddleware.requireLogin, async (ctx: Context) => {
  const { content, topic, criteria, aiModel } = ctx.request.body as {
    content?: string; topic?: string; criteria?: string; aiModel?: string;
  };
  if (!content || !topic) {
    Util.returnError(ctx, 400, 'Missing content or topic.');
    return;
  }
  try {
    if (!isAiConfigured()) {
      await new Promise((r) => setTimeout(r, simulatedDelayMs(content)));
      ctx.body = simulateGrading(content, topic);
      return;
    }
    ctx.body = await new GenAIHelper().gradeAdhoc(
      content, topic, criteria || '', aiModel || '預設批改模型',
    );
  } catch (error) {
    console.error('Error grading essay:', error);
    Util.returnError(ctx, 502, 'AI 批改失敗');
  }
});

export default router;
