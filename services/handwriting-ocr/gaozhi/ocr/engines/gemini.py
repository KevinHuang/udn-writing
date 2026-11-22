"""Gemini 引擎：一行一張圖（格線變淡、左邊標上格子編號），幾行一組送出，要求逐格照抄、不得更正錯字，
並回報每個字在「第幾行、第幾格」。

為什麼一行一張圖、還要標格子編號：早期版本把 6 行放在同一張圖、只告訴 Gemini 每行有幾格有字，
它會為了湊格數把字挪到下一行，整行跟著錯位（樣卷實際發生）。現在每張圖就是一行，
字的位置以格子編號回報：讀錯只影響那一格，不會把後面的字一起推走。

- 用 generate_content（每次獨立、不保存對話）。請用付費方案的金鑰：免費方案的內容可能被用來改善服務。
- Gemini 3 沒有逐字信心值；可信度靠和 Vision 互相比對。
- 思考程度設為 low：照抄不需要推理，想太多反而容易「自作聰明」改字。
- 只送作答格，空白格先塗白；沒有字的行不送。
- service_tier="flex"：Google 的 Flex 方案，半價但要排隊（官方目標 1～15 分鐘）。太忙時 Google 回 503／429、
  不會自動改用一般價格，所以這裡自己重送（最多等約 5 分鐘），都不行才改用一般價格（with_tier）。
"""
import json
import time
from concurrent.futures import ThreadPoolExecutor

from .. import normalize as N
from ..model import CellReading, EngineResult
from ..views import chunks, single_column_view
from .base import Engine

PROMPT_VERSION = 2
VIEW_VERSION = 2
DEFAULT_MODEL = "gemini-3.8-flash"

SYSTEM = """你是一位逐字抄寫員，負責把學生手寫的中文作文「照原樣」抄成文字，給老師批改用。

最重要的規則：學生寫什麼就抄什麼。
- 絕對不要更正錯字、別字、漏字、多字或標點錯誤。學生寫錯的字照錯的抄（例如把「再」寫成「在」，就抄「在」）。
- 不要依上下文猜「應該是什麼字」，只依字形判斷；字形介於兩個字之間時，選字形最接近的。
- 不要加字、刪字、改寫或潤飾。

圖片格式：
- 每張圖是稿紙的「一行」（直行），圖的前面會寫明是第幾行。字由上往下寫，每一格最多一個字或一個標點。
- 每張圖左邊的藍色數字是格子編號（由上往下 1、2、3…）。回報每個字時，寫出它所在格子的編號。
- 只回報那張圖裡的字，絕對不要把字移到別的行；空白的格子已經塗白，不要回報。
- 標點用一般全形橫式寫法輸出：，。、；：？！「」『』（）《》〈〉。直式寫法（例如 ︐ ﹁ ﹂）也換成橫式。
- 刪節號「……」佔兩格，每一格輸出「…」；破折號「——」佔兩格，每一格輸出「—」。
- 看不出是什麼字的格子輸出 [?]；學生劃掉、塗掉的字輸出 [x]。
- 寫在兩行之間的補字（通常有插入記號）不要放進格子裡，放在 margin，並註明它在哪一行旁邊。"""

USER = """以上是第 {cols} 行，各一張圖。請逐行列出有字的格子：格子編號（row）與內容（text）。
電腦判斷有字的格子（僅供參考，請以圖為準）：{hints}。"""

SCHEMA = {
    "type": "object",
    "properties": {
        "columns": {"type": "array", "items": {"type": "object", "properties": {
            "col": {"type": "integer", "description": "第幾行（圖前面寫的行號）"},
            "cells": {"type": "array", "items": {"type": "object", "properties": {
                "row": {"type": "integer", "description": "格子編號（圖左邊的藍色數字）"},
                "text": {"type": "string", "description": "格子裡的字或標點"}},
                "required": ["row", "text"]}}},
            "required": ["col", "cells"]}},
        "margin": {"type": "array", "items": {"type": "object", "properties": {
            "col": {"type": "integer", "description": "補字旁邊的行號"},
            "text": {"type": "string"}}, "required": ["col", "text"]}},
    },
    "required": ["columns"],
}

RETRY_CODES = {429, 500, 502, 503, 504}
FLEX_TIMEOUT_S = 900          # Flex 可能要排隊好幾分鐘：每次請求最多等 15 分鐘（Google 建議 10 分鐘以上）
FLEX_RETRIES = 6              # Flex 太忙時重送幾次（等 5、10、20、40、80、160 秒，合計約 5 分鐘），之後改用一般價格
                              # 2026-10-09 實測：只重送 3 次（合計 35 秒）時，14 次請求有 4 次改用一般價格，只省約 27%
FLEX_DELAY_S = 5
TIERS = ("standard", "flex")


class GeminiError(RuntimeError):
    def __init__(self, message, retry=False):
        super().__init__(message)
        self.retry = retry


def _explain(code, message):
    if "API key not valid" in message or "API_KEY_INVALID" in message:
        return "金鑰無效：Google 不認得這把金鑰（可能貼錯、貼了不只一次，或金鑰已被刪除）"
    if "SERVICE_DISABLED" in message or "has not been used in project" in message:
        return f"這個 Google 專案還沒有啟用 Gemini API（{message}）"
    if code in (401, 403):
        return f"金鑰無效或沒有權限（{message}）"
    if code == 400:
        return f"要求被拒絕，可能是模型名稱不對（{message}）"
    if code == 404:
        return f"找不到這個模型（{message}）"
    if code == 429:
        return f"超過用量限制，請稍後再試（{message}）"
    return f"Google 伺服器暫時有問題（{code}）"


def with_tier(send, tier, sleep=time.sleep):
    """send(方案) → 回應（usage 裡的 "tier" 是實際處理的方案）。tier="flex" 時：太忙就等一下重送，
    重送 FLEX_RETRIES 次都不行，改用一般價格送一次。回傳 (回應, 是否改用了一般價格)。"""
    if tier != "flex":
        return send("standard"), False
    for i in range(FLEX_RETRIES):
        try:
            return send("flex"), False
        except GeminiError as e:
            if not e.retry:
                raise
            sleep(FLEX_DELAY_S * 2 ** i)
    return send("standard"), True


def served_tier(usage_metadata, asked):
    """回應實際用哪個方案處理：看 traffic_type；沒有回報時當作照要求的方案（Google 不會自動換方案）。"""
    tt = str(getattr(usage_metadata, "traffic_type", "") or "")
    if "FLEX" in tt:
        return "flex"
    if tt and "UNSPECIFIED" not in tt:
        return "standard"
    return asked


def add_usage(total, u):
    """把一次呼叫的用量加進合計；Flex 處理的 token 另外記在 flex_*（算費用時打五折）。"""
    for k in ("input_tokens", "output_tokens", "thinking_tokens"):
        total[k] = total.get(k, 0) + u.get(k, 0)
        if u.get("tier") == "flex":
            total[f"flex_{k}"] = total.get(f"flex_{k}", 0) + u.get(k, 0)


class SdkCaller:
    """用 google-genai 套件呼叫 Gemini。金鑰一律明確傳入（不讀環境變數 GOOGLE_API_KEY）。"""

    def __init__(self, api_key, timeout_s=180):
        from google import genai
        from google.genai import types
        self.types = types
        self.api_key = api_key
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=int(timeout_s * 1000)))

    def __call__(self, model, images, prompt, s):
        """images：[(行號, PNG)]，每行一張圖，前面加上「第幾行」的文字。"""
        from google.genai import errors
        t = self.types
        tier = s.get("service_tier", "standard")
        cfg = t.GenerateContentConfig(
            system_instruction=SYSTEM, response_mime_type="application/json", response_json_schema=SCHEMA,
            thinking_config=t.ThinkingConfig(thinking_level=s["thinking_level"].upper()),
            max_output_tokens=s["max_output_tokens"],
            service_tier=t.ServiceTier.FLEX if tier == "flex" else None,
            automatic_function_calling=t.AutomaticFunctionCallingConfig(disable=True))   # 沒有用到工具呼叫
        parts = []
        for col, png in images:
            parts.append(t.Part.from_text(text=f"第 {col} 行："))
            parts.append(t.Part.from_bytes(data=png, mime_type="image/png", media_resolution=s["media_resolution"]))
        parts.append(t.Part.from_text(text=prompt))
        try:
            resp = self.client.models.generate_content(model=model, contents=parts, config=cfg)
        except errors.APIError as e:
            msg = str(e.message or "").replace(self.api_key, "…")[:300]
            raise GeminiError(_explain(e.code or 0, msg), retry=(e.code or 0) in RETRY_CODES) from None
        except Exception as e:                              # 連線逾時、網路中斷
            raise GeminiError(f"無法連線到 Google：{type(e).__name__}", retry=True) from None
        u = resp.usage_metadata
        cand = resp.candidates[0] if resp.candidates else None
        finish = cand.finish_reason.name if cand is not None and cand.finish_reason else ""
        return {"text": resp.text or "", "finish": finish,
                "usage": {"input_tokens": (u and u.prompt_token_count) or 0,
                          "output_tokens": (u and u.candidates_token_count) or 0,
                          "thinking_tokens": (u and u.thoughts_token_count) or 0,
                          "tier": served_tier(u, tier)}}


def parse_reply(text, cols):
    """回應 → ({行: [(格子編號, 字)] 或 [字…]（舊格式）}, [補字])。格式不對時丟出 ValueError。"""
    data = json.loads(text)
    if not isinstance(data, dict) or not isinstance(data.get("columns"), list):
        raise ValueError("回應裡沒有 columns")
    out = {}
    for c in data["columns"]:
        try:
            col = int(c["col"])
        except (KeyError, TypeError, ValueError):
            continue
        if col not in cols or not isinstance(c.get("cells"), list):
            continue
        items = []
        for x in c["cells"]:
            if isinstance(x, dict):
                try:
                    items.append((int(x["row"]), "" if x.get("text") is None else str(x["text"])))
                except (KeyError, TypeError, ValueError):
                    continue
            else:
                items.append("" if x is None else str(x))
        out.setdefault(col, []).extend(items)
    margin = []
    for m in data.get("margin") or []:
        try:
            if int(m["col"]) in cols and str(m.get("text", "")).strip():
                margin.append({"col": int(m["col"]), "text": N.fold(str(m["text"]))})
        except (KeyError, TypeError, ValueError):
            continue
    return out, margin


def to_reading(entry):
    s = (entry or "").strip()
    bare = s.replace(" ", "").lower()
    if bare in ("[?]", "[？]", "［?］", "［？］"):
        return CellReading("", None, ["illegible"])
    if bare in ("[x]", "［x］", "[ｘ]"):
        return CellReading("", None, ["crossed"])
    s = s.replace("[?]", "□")
    body = [ch for ch in N.key(s) if ch not in "…—"]
    return CellReading(s, None, ["multi"] if len(body) > 1 else [])


def place_column(items, col, rows):
    """依格子編號把字放進格子。同一格回報兩次 → 串起來並標示 multi；不存在的編號 → 略過。
    回傳 (readings, 略過的項目數)。"""
    out, skipped = {}, 0
    for row, text in items:
        if row not in rows:
            skipped += 1
            continue
        rd = to_reading(text)
        if (col, row) in out:
            prev = out[(col, row)]
            prev.text += rd.text
            prev.flags = sorted(set(prev.flags + rd.flags + ["multi"]))
        else:
            out[(col, row)] = rd
    return out, skipped


def _compatible(entry, cell):
    k = N.key(entry.strip())
    if not k or k.startswith("["):
        return True
    return N.is_punct(k) == (cell["kind"] == "mark")


def align_column(entries, cells):
    """（舊格式用）把一行讀到的項目依序對到有字的格子（由上到下）。數量相同就一對一；
    不同時依「字／標點」的類別找最合理的對法，多出來的字併到前一格，並把這一行標成「字數對不上」。"""
    if len(entries) == len(cells):
        return {(c["col"], c["row"]): to_reading(e) for e, c in zip(entries, cells)}
    n, m = len(entries), len(cells)
    D = [[0] * (m + 1) for _ in range(n + 1)]
    B = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        D[i][0], B[i][0] = i, 1
    for j in range(1, m + 1):
        D[0][j], B[0][j] = j, 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            opts = (D[i - 1][j - 1] + (0 if _compatible(entries[i - 1], cells[j - 1]) else 1), D[i - 1][j] + 1,
                    D[i][j - 1] + 1)
            B[i][j] = min((1, 0, 2), key=lambda k: opts[k])     # 平手時把多出來的字併到較後面的格子
            D[i][j] = opts[B[i][j]]
    pairs, extra, i, j = {}, {}, n, m
    while i > 0 or j > 0:
        b = B[i][j]
        if b == 0:
            pairs[j - 1] = entries[i - 1]
            i, j = i - 1, j - 1
        elif b == 1:                                    # 多出來的項目：記在它前面最近的格子
            extra.setdefault(j - 1, []).insert(0, entries[i - 1])
            i -= 1
        else:
            j -= 1
    out = {}
    for j, c in enumerate(cells):
        text = pairs.get(j, "")
        more = extra.get(j, [])
        rd = to_reading(text + "".join(more)) if more else to_reading(text)
        if more and "multi" not in rd.flags:
            rd.flags.append("multi")
        rd.flags.append("count_mismatch")
        out[(c["col"], c["row"])] = rd
    if -1 in extra and cells:                           # 第一格之前多出來的字
        first = (cells[0]["col"], cells[0]["row"])
        rd = out.get(first) or CellReading("", None, ["count_mismatch"])
        rd.text = "".join(extra[-1]) + rd.text
        if "multi" not in rd.flags:
            rd.flags.append("multi")
        out[first] = rd
    return out


def _ranges(rows):
    """[1,2,3,5,7,8] → "1–3、5、7–8"。"""
    out, start, prev = [], None, None
    for r in sorted(rows) + [None]:
        if start is None:
            start = prev = r
        elif r is not None and r == prev + 1:
            prev = r
        else:
            out.append(f"{start}" if start == prev else f"{start}–{prev}")
            start = prev = r
    return "、".join(out)


class GeminiEngine(Engine):
    name = "gemini"

    def __init__(self, api_key=None, model=DEFAULT_MODEL, cols_per_strip=6, media_resolution="MEDIA_RESOLUTION_HIGH",
                 thinking_level="low", max_output_tokens=16384, workers=4, cache=None, timeout_s=180, call=None,
                 service_tier="standard"):
        """call：測試時換成假的呼叫函式 (model, [(行號, PNG)], prompt, settings) → {"text","finish","usage"}。

        service_tier："standard"（一般價格）或 "flex"（半價、要排隊，見 with_tier）。"""
        if service_tier not in TIERS:
            raise ValueError(f"不認得的方案「{service_tier}」（可用：{'、'.join(TIERS)}）")
        self.api_key = api_key
        self.model = model
        self.cols_per_strip = cols_per_strip
        self.media_resolution = media_resolution
        self.thinking_level = thinking_level
        self.max_output_tokens = max_output_tokens
        self.workers = workers
        self.cache = cache
        self.service_tier = service_tier
        self.timeout_s = max(timeout_s, FLEX_TIMEOUT_S) if service_tier == "flex" else timeout_s
        self._call = call

    def settings(self):
        return {"model": self.model, "cols_per_strip": self.cols_per_strip, "media_resolution": self.media_resolution,
                "thinking_level": self.thinking_level, "max_output_tokens": self.max_output_tokens,
                "prompt": PROMPT_VERSION, "view": VIEW_VERSION, "service_tier": self.service_tier}

    def jobs(self, page):
        """要送出的每一組：([(行號, 影像)], 這組的行, 提示文字)。只送有字的行，每 cols_per_strip 行一組。"""
        cols = [c for c in sorted(page.cols) if page.nonblank_rows(c)]
        out = []
        for cs in chunks(cols, self.cols_per_strip):
            views = [(c, single_column_view(page, c)) for c in cs]
            hints = "；".join(f"第 {c} 行 {_ranges(page.nonblank_rows(c))} 格" for c in cs)
            out.append((views, cs, USER.format(cols="、".join(str(c) for c in cs), hints=hints)))
        return out

    def _caller(self):
        if self._call is None:
            self._call = SdkCaller(self.api_key, self.timeout_s)
        return self._call

    def _run(self, images, prompt, cols):
        """送出一組（含快取與重試）。回傳 (解析後的結果, 用量)。"""
        s = self.settings()
        same = {k: v for k, v in s.items() if k != "service_tier"}     # 方案不影響結果：快取共用
        key = self.cache.key(self.name, same, SYSTEM, prompt, *[png for _, png in images]) if self.cache else None
        hit = self.cache.get(self.name, key) if self.cache else None
        if hit is not None:
            try:
                parsed = parse_reply(hit["text"], cols)
                old = hit.get("usage") or {}
                return parsed, {"cached": 1, **{f"cached_{k}": old.get(k, 0)
                                                for k in ("input_tokens", "output_tokens", "thinking_tokens")},
                                **({f"cached_flex_{k}": old.get(k, 0)
                                    for k in ("input_tokens", "output_tokens", "thinking_tokens")}
                                   if old.get("tier") == "flex" else {}),
                                "cached_seconds": hit.get("seconds", 0.0)}
            except (ValueError, KeyError, TypeError):
                pass                                    # 快取壞了就重新送
        if not self.api_key and self._call is None:
            raise GeminiError("沒有設定 Gemini 的 API 金鑰")
        usage = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0}
        problem = ""
        call = self._caller()
        for attempt in (1, 2):
            run = dict(s)
            if attempt == 2 and problem == "truncated":
                run["max_output_tokens"] = s["max_output_tokens"] * 2
            t_call = time.perf_counter()
            try:
                r, fell_back = with_tier(lambda tier: call(self.model, images, prompt, {**run, "service_tier": tier}),
                                         self.service_tier)
            except GeminiError as e:
                if e.retry and attempt == 1:
                    time.sleep(3)
                    continue
                raise
            usage["calls"] += 1
            if fell_back:
                usage["fallback"] = usage.get("fallback", 0) + 1
            add_usage(usage, {**r["usage"], "tier": r["usage"].get("tier", run["service_tier"] if not fell_back
                                                                   else "standard")})
            if r["finish"] == "MAX_TOKENS":
                problem = "truncated"
                continue
            try:
                parsed = parse_reply(r["text"], cols)
            except ValueError:
                problem = "format"
                continue
            if self.cache:
                self.cache.put(self.name, key, {"text": r["text"], "usage": r["usage"], "finish": r["finish"],
                                                "seconds": round(time.perf_counter() - t_call, 2)})
            return parsed, usage
        raise GeminiError("回應被截斷（輸出上限太小）" if problem == "truncated" else "回應格式不對", retry=False)

    def recognize(self, page):
        t0 = time.perf_counter()
        jobs = self.jobs(page)
        usage = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "cached": 0, "strips": len(jobs)}
        readings, insertions, warnings = {}, [], []
        rows = set(page.rows)

        def one(job):
            views, cs, prompt = job
            try:
                return job, self._run([(c, v.png()) for c, v in views], prompt, set(cs)), None
            except GeminiError as e:
                return job, None, str(e).replace(self.api_key or "\0", "…")

        if jobs and self._call is None and self.api_key:
            self._caller()                              # 先建立連線用的物件，避免多個執行緒同時建立
        with ThreadPoolExecutor(max_workers=max(1, self.workers)) as ex:
            done = list(ex.map(one, jobs))
        failed = 0
        for (views, cs, _), res, err in done:
            if err:
                failed += 1
                warnings.append(f"第 {cs[0]}～{cs[-1]} 行：{err}")
                continue
            (by_col, margin), u = res
            for k, v in u.items():
                usage[k] = usage.get(k, 0) + v
            for c in cs:
                items = by_col.get(c)
                if items is None:
                    warnings.append(f"第 {c} 行：Gemini 沒有回傳這一行")
                    continue
                placed = [x for x in items if isinstance(x, tuple)]
                if placed:
                    got, skipped = place_column(placed, c, rows)
                    readings.update(got)
                    if skipped:
                        warnings.append(f"第 {c} 行：有 {skipped} 個字的格子編號不存在，已略過")
                else:                                   # 舊格式：沒有格子編號，只能依序對
                    cells = sorted((x for x in page.column_cells(c) if x["kind"] != "blank"), key=lambda x: x["row"])
                    readings.update(align_column(items, cells))
            for m in margin:
                insertions.append(_margin_to_insertion(page, m))
        error = None
        if jobs and failed == len(jobs):
            error = warnings[0].split("：", 1)[-1] if warnings else "全部失敗"
        return EngineResult(self.name, self.settings(), readings, insertions, usage=usage,
                            seconds=time.perf_counter() - t0, error=error, warnings=warnings)


def _margin_to_insertion(page, m):
    """Gemini 只說補字在哪一行旁邊；位置（哪兩行之間、第幾格）用前處理找到的行間墨跡推測。"""
    col = m["col"]
    for g in page.gaps:
        if g["right_col"] == col or g["left_col"] == col:
            return {"right_col": g["right_col"], "left_col": g["left_col"], "row": g["row"], "text": m["text"]}
    return {"right_col": col, "left_col": col + 1, "row": None, "text": m["text"]}
