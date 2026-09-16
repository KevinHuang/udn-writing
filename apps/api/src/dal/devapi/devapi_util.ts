import config from '../../config';
// import fetch from 'node-fetch';

export function getDevapiHost() {
    return config.oauthConfig.devapiHost;
}

export function getClientId() {
    return config.oauthConfig.clientId;
}

export function getClientSecret() {
    return config.oauthConfig.clientSecret;
}

export async function getAccessToken(scope: string) {
    // console.log({ action: 'getIdentity', dsns, code });
    const devapi_host = getDevapiHost();
    const devapi_client_id = getClientId();
    const devapi_client_secret = getClientSecret();
    const url = `${devapi_host}/oauth/token?grant_type=client_credentials&client_id=${devapi_client_id}&client_secret=${devapi_client_secret}&scope=${scope}`;
    // console.log({ url });

    const resp = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    const token = await resp.json();

    // console.log({ token });

    return token;
}

export async function sendDevapiRequest(targetUrl: string, access_token: string) {
    /** 傳送 http get request 到 dev api */
    // console.log({ targetUrl, access_token });
    const resp = await fetch(targetUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${access_token}` }
    });
    return resp.text();
}

export async function postDevapiRequest(targetUrl: string, access_token: string, data: any) {
    /** 傳送 http post request 到 dev api */
    console.log('postDevapiRequest:', { targetUrl, access_token, data });
    const resp = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
        body: JSON.stringify(data)
    });

    if (!resp.ok) throw new Error(await resp.text());
    return resp.text();
}

