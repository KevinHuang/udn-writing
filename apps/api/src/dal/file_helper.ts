import { Context } from 'koa';
import config from '../config';
import fetch from 'node-fetch';

class FileHelper {

    /** 透過 identity code 取得登入者資訊 */
    public static async getUploadToken(dsns: string, access_token: string): Promise<any> {
        // console.log({ action: 'getIdentity', dsns, code });
        const url = `${config.storage.api_url}?access_token=${access_token}`;
        // console.log({ url, dsns });
        const objReq = {
            dsns,
            "remaining_uploads": 12,
            "max_size": 5242880,
            "expiry_hours": 0
        }
        // console.log( { url });
        const resp = await fetch(url, {
            method: "POST", // *GET, POST, PUT, DELETE, etc.
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(objReq), // body data type must match "Content-Type" header
        });
        const data = await resp.json();
        console.log({ data });

        return data;
    }

}

export default FileHelper;