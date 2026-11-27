import { GridOcrError } from './errors';

/**
 * 稿紙辨識服務（services/handwriting-ocr，Python）的呼叫端。移植自 1Campus Write 的 functions/lib/gridOcrService.js。
 *
 * 服務只做影像處理（找定位標記、拉正、切格、組回、比對錯字表），**不呼叫 AI**；
 * AI 由這邊直接打 Gemini（lib/grid_ocr/ai.ts）。
 *
 * 網址放環境變數 GRID_OCR_SERVICE_URL：
 *   正式：Cloud Run 網址，服務不開放匿名呼叫，帶這個服務帳戶的 ID token（audience＝服務網址）；
 *   本機：http://127.0.0.1:8090（python -m gaozhi.service.server），不需要 token。
 * 沒設定時 configured=false：代繳交照舊全部走 ocr-job。
 */

/** 服務一個請求最多 30MB；照片轉 base64 後超過就不送 */
export const MAX_PREPARE_BASE64_BYTES = 28 * 1024 * 1024;
/** 服務對照片或資料本身的錯誤回這幾種狀態碼，重送也一樣 */
const REJECTED_STATUSES = new Set([400, 413, 415, 422]);
const REQUEST_TIMEOUT_MS = 120_000;

export interface ServiceFile {
    name: string;
    /** base64（不含 data: 前綴） */
    data: string;
}

/** /check、/prepare 列出的稿紙問題 */
export interface SheetProblem {
    code?: string;
    message?: string;
    names?: string[];
}

export interface CheckResult {
    ours: boolean;
    ok?: boolean;
    original_gsat?: boolean;
    problems?: SheetProblem[];
    pages?: Array<{ name?: string; template?: string; format?: string; page?: number; paper?: string }>;
    reason?: string;
}

export interface PreparedStrip {
    index: number;
    cols: number[];
    prompt: string;
    images: Array<{ col: number; png: string }>;
}

export interface PreparedPage {
    page: number;
    template?: string;
    format?: string;
    paper?: string;
    meta: unknown;
    warped_jpeg: string;
    ink_cells?: number;
    strips: PreparedStrip[];
}

export interface PrepareResult extends CheckResult {
    pages?: PreparedPage[] & CheckResult['pages'];
    prompt_version?: number;
}

export interface AssembleResult {
    text: string;
    marked_text?: string;
    chars?: number;
    paragraphs?: number;
    completion?: number | null;
    format?: unknown[];
    warnings?: string[];
    pages?: Array<{ prefix: string; page: number; ocr: unknown }>;
    rule_marks?: unknown[];
    typo_request?: { prompt?: string };
}

export interface TyposResult {
    done: boolean;
    marks?: unknown[];
    lost?: number;
    zhuyin_request?: { prompt?: string };
}

/** GET /prompts：三個 preset 的系統指令、回傳格式（JSON Schema）與建議設定 */
export interface PromptPreset {
    version?: number;
    system: string;
    schema: object;
    settings: { model?: string; thinking_level?: string; media_resolution?: string; max_output_tokens?: number };
}
export interface PromptsResult {
    service_version?: string;
    '稿紙逐格辨識': PromptPreset;
    '找錯別字': PromptPreset;
    '注音補字': PromptPreset;
}

export interface GridServiceClient {
    configured: boolean;
    check(files: ServiceFile[]): Promise<CheckResult>;
    prepare(files: ServiceFile[]): Promise<PrepareResult>;
    assemble(pages: unknown[]): Promise<AssembleResult>;
    typos(body: { pages: unknown; rule_marks: unknown; ai_reply: string; zhuyin_reply?: string }): Promise<TyposResult>;
    prompts(): Promise<PromptsResult>;
    /** 整疊掃描：每一頁的稿紙頁碼與塗的座號（不用 AI）。回傳內容由 lib/seat_scan.ts 檢查後才給前端 */
    seatScan(files: ServiceFile[]): Promise<unknown>;
}

export const gridOcrServiceUrl = (): string =>
    (process.env.GRID_OCR_SERVICE_URL || '').trim().replace(/\/+$/, '');

export function isLocalUrl(url: string): boolean {
    try {
        return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
    } catch {
        return false;
    }
}

/** 照片總量是否在服務的請求上限內 */
export const fitsPrepareLimit = (files: ServiceFile[]): boolean =>
    files.reduce((sum, f) => sum + f.data.length, 0) <= MAX_PREPARE_BASE64_BYTES;

type FetchLike = typeof fetch;

/**
 * Cloud Run 上向 metadata server 拿這個服務帳戶的 ID token（audience＝服務網址），一小時到期、提早十分鐘換。
 * 不用 google-auth-library：正式映像檔只裝 apps/api 自己列的相依，它不在裡面（1Campus 印稿紙的呼叫端也這樣做）。
 */
const METADATA_IDENTITY_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
const ID_TOKEN_TTL_MS = 50 * 60 * 1000;
let cachedToken: { audience: string; value: string; expiresAt: number } | null = null;
async function idTokenHeader(audience: string): Promise<string | null> {
    if (isLocalUrl(audience)) return null;
    if (cachedToken && cachedToken.audience === audience && cachedToken.expiresAt > Date.now()) {
        return `Bearer ${cachedToken.value}`;
    }
    const res = await fetch(`${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}`, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`metadata identity ${res.status}`);
    cachedToken = { audience, value: (await res.text()).trim(), expiresAt: Date.now() + ID_TOKEN_TTL_MS };
    return `Bearer ${cachedToken.value}`;
}

export function createGridServiceClient(opts: {
    baseUrl?: string;
    fetchImpl?: FetchLike;
    getAuthorization?: (audience: string) => Promise<string | null>;
} = {}): GridServiceClient {
    const baseUrl = opts.baseUrl ?? gridOcrServiceUrl();
    const fetchImpl = opts.fetchImpl ?? fetch;
    const getAuthorization = opts.getAuthorization ?? idTokenHeader;

    const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
        if (!baseUrl) throw new GridOcrError('UNAVAILABLE', '稿紙辨識服務沒有設定', false);
        let response: Response;
        try {
            const authorization = await getAuthorization(baseUrl);
            response = await fetchImpl(`${baseUrl}${path}`, {
                method,
                headers: {
                    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                    ...(authorization ? { Authorization: authorization } : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (e) {
            // 不印照片內容，只印路徑與錯誤種類
            console.error('[grid-ocr] service unreachable', { path, error: e instanceof Error ? e.message : String(e) });
            throw new GridOcrError('UNAVAILABLE', '稿紙辨識服務暫時無法使用，請稍後再按「重新辨識」', true);
        }
        const text = await response.text();
        let payload: unknown = null;
        try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
        if (REJECTED_STATUSES.has(response.status)) {
            const reason = (payload as { error?: unknown })?.error;
            throw new GridOcrError('REJECTED', `稿紙辨識失敗：${typeof reason === 'string' ? reason : `狀態碼 ${response.status}`}`);
        }
        if (!response.ok || !payload || typeof payload !== 'object') {
            console.error('[grid-ocr] service error', { path, status: response.status });
            throw new GridOcrError('UNAVAILABLE', '稿紙辨識服務暫時無法使用，請稍後再按「重新辨識」', true);
        }
        return payload as T;
    };

    return {
        configured: Boolean(baseUrl),
        check: (files) => call<CheckResult>('POST', '/check', { files }),
        prepare: (files) => call<PrepareResult>('POST', '/prepare', { files }),
        assemble: (pages) => call<AssembleResult>('POST', '/assemble', { pages }),
        typos: (body) => call<TyposResult>('POST', '/typos', body),
        prompts: () => call<PromptsResult>('GET', '/prompts'),
        seatScan: (files) => call<unknown>('POST', '/seat-scan', { files }),
    };
}
