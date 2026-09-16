import { Storage } from '@google-cloud/storage';
import dotenv from 'dotenv';
dotenv.config();

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GCP_KEY_FILE_PATH, 
});

const bucketName = process.env.GCS_BUCKET_NAME || 'writing-classroom-storage';
const bucket = storage.bucket(bucketName);

export const uploadFile = async (fileName: string, fileContent: Buffer) => {
  const file = bucket.file(fileName);
  await file.save(fileContent);
  return `gs://${bucketName}/${fileName}`;
};

export const downloadFile = async (fileName: string) => {
  const file = bucket.file(fileName);
  const [content] = await file.download();
  return content;
};
