import Router from '@koa/router';
import { Context } from 'koa';
import { OAuthMiddleware } from '../middleware/oauth';
import GenAIHelper from '../dal/genai_helper';
import Util from '../util/util';
import StorageHelper from '../dal/storage_helper';
import { isModuleNamespaceObject } from 'node:util/types';

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

export default router;
