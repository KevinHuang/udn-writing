"""找錯別字：AI 先標出可能的錯別字，老師在校對畫面逐一確認；老師的決定存在作文資料夾的 錯別字.json。

四種錯別字（老師決定的範圍）：
- 別字：寫成另一個存在的字（在／再、的／得／地、做／作…）            → AI 讀全文找（錯詞表、成語的程式先標）
- 簡體字、不規範寫法（学、着…）                                      → 程式直接找＋AI 讀全文找
- 注音或符號代替（用ㄅㄆㄇ、英文或符號代替不會寫的字）                → 程式直接找注音（一律標出，正確的字由
  AI 依上下文補上）＋AI 讀全文找
- 錯字：字形寫錯（多一筆、少一筆、部件錯）——全文看不出來，要看手寫圖  → image_check（之後加入）
程式只做幾乎不會誤判的幾項（rules.py）；辭典只用來比對成語（其他辭典比對誤判太多，老師決定不用）。

全文優先用老師校對後的定稿；還沒校對的作文用辨識結果（可能把辨識錯誤誤當成錯別字）。
AI 回報的位置用「原文片段」表示，程式再對回是哪一格：不讓 AI 自己數第幾個字（容易數錯）。
"""
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

from ..ocr import normalize as N
from ..ocr import review as RV
from ..ocr.engines.gemini import FLEX_TIMEOUT_S, RETRY_CODES, GeminiError, _explain, add_usage, served_tier, with_tier
from . import rules

TYPOS_NAME = "錯別字.json"
TYPOS_FORMAT = 1
TYPES = ("別字", "錯字", "簡體字", "不規範寫法", "注音代替", "符號代替")
TEXT_MODEL = "gemini-3.8-flash"
TEXT_PROMPT_VERSION = 1
# 思考程度：2026-10-07 用手寫測試短文（18 個已知的錯）各測兩次——高 16/16、誤報 0、約 NT$0.6；
# 中 16/16、誤報 0、約 NT$0.35；低 16/17、誤報 1/0、約 NT$0.2。
# 2026-10-27 Enzo 定案用高（同「工程師回覆與決策」第四節），gpt.1campus.net preset 後台照此設定。
TEXT_THINKING = "high"

TEXT_SYSTEM = """你是台灣國中、高中的國文老師，負責找出學生作文裡的錯別字。只找下列幾種：
1. 別字：寫成另一個存在的字，例如「再」寫成「在」、「得」寫成「的」、「作」寫成「做」、「已」寫成「以」、
   「像」寫成「象」、「即」寫成「既」，或同音、形近、意思相近而用錯的字。
2. 簡體字：例如「学」「着」「双」「这」。
3. 不規範寫法：不是教育部標準字體、也不是常用異體的寫法。「台／臺」「裡／裏」「峰／峯」這類常見異體字不要標。
4. 注音代替、符號代替：用注音、英文字母或其他符號代替不會寫的字。

不要標：文法、標點、詞語是否恰當、句子是否通順、內容好壞（那些是之後的批改項目）；
也不要標人名、地名等專有名詞，或引用的原文。沒有把握的不要硬找，寧可少標也不要標錯。

每一個錯別字回報：
- context：包含這個錯字的原文片段，一字不差照抄原文（含標點），長度 6～12 個字，讓人能在全文中找到唯一的位置
- wrong：原文裡寫錯的那個字（照抄；一次只標一個字，兩個字都錯就分成兩筆）
- correct：應該寫成的字
- type：別字、簡體字、不規範寫法、注音代替、符號代替 其中之一
- reason：一句話說明（例如「『再』表示又一次，這裡應用『再』」）
- confidence：high（確定）、medium（很可能）或 low（不確定）"""

TEXT_USER = "以下是一篇學生作文的全文（每段一行，行首的數字是段落編號）。請找出錯別字：\n\n{text}"

TEXT_SCHEMA = {
    "type": "object",
    "properties": {"errors": {"type": "array", "items": {"type": "object", "properties": {
        "context": {"type": "string"}, "wrong": {"type": "string"}, "correct": {"type": "string"},
        "type": {"type": "string", "enum": ["別字", "簡體字", "不規範寫法", "注音代替", "符號代替"]},
        "reason": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]}},
        "required": ["context", "wrong", "correct", "type", "reason", "confidence"]}}},
    "required": ["errors"],
}


# ======================= 全文與格子的對應 =======================

def text_cells(pages, review):
    """定稿全文的每個字在哪一格：[[(字, 格子), …], …]（每段一個 list，分段規則和定稿相同）。"""
    ocrs = RV.apply(pages, review)
    paras, cur = [], None
    for p, ocr in zip(pages, ocrs):
        by_col = {}
        for c in ocr["cells"]:
            t = c["text"] if c["status"] != "blank" else ""
            by_col.setdefault(c["col"], {})[c["row"]] = (t, RV.cell_key(p["prefix"], c))
        for col in sorted(by_col):
            seq = [by_col[col][r] for r in sorted(by_col[col])]
            filled = [i for i, (t, _) in enumerate(seq) if t]
            if not filled:
                if cur:
                    paras.append(cur)
                    cur = None
                continue
            chars = [(ch, k) for t, k in seq if t for ch in t]
            if cur is None or filled[0] >= 2:
                if cur:
                    paras.append(cur)
                cur = chars
            else:
                cur += chars
    if cur:
        paras.append(cur)
    return paras


def load_essay_text(folder):
    """(各頁, 校對資料, 每段的字與格子, 來源說明)。"""
    pages = RV.load_pages(folder)
    review = RV.load_review(folder)
    source = "老師校對後的定稿" if review.get("done") else "辨識結果（尚未完成校對）"
    return pages, review, text_cells(pages, review), source


def locate(paras, context, wrong, used):
    """在全文中找到 context，再找出 wrong 在其中的位置 → 對應的格子。找不到回傳 None。"""
    flat = [(ch, k, pi) for pi, p in enumerate(paras) for ch, k in p]
    text = "".join(N.fold(ch) or ch for ch, _, _ in flat)
    ctx, w = N.fold(context), N.fold(wrong)
    if not ctx or not w:
        return None
    starts = [m.start() for m in re.finditer(re.escape(ctx), text)]
    if not starts:                                             # 片段抄得不完全一樣：退而只找錯字本身（全文唯一時）
        hits = [m.start() for m in re.finditer(re.escape(w), text)]
        starts, ctx = (hits, w) if len(hits) == 1 else ([], ctx)
    for s in starts:
        j = ctx.find(w)
        if j < 0:
            continue
        span = range(s + j, s + j + len(w))
        keys = [flat[i][1] for i in span]
        if not any((k, i) in used for k, i in zip(keys, span)):
            used.update(zip(keys, span))
            return keys
    return None


# ======================= 呼叫 Gemini（只送文字） =======================

def call_gemini_json(api_key, model, system, prompt, schema, thinking_level="high", max_output_tokens=16384,
                     timeout_s=180, service_tier="standard"):
    """送出一段文字，要求依 schema 回傳 JSON。回傳 {"data", "usage", "seconds"}。失敗時丟出 GeminiError（不含金鑰）。

    service_tier="flex"：半價但要排隊（見 engines.gemini.with_tier）；整批找錯別字時用，批改畫面上按的不用。
    """
    from google import genai
    from google.genai import errors, types

    if service_tier == "flex":
        timeout_s = max(timeout_s, FLEX_TIMEOUT_S)
    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=int(timeout_s * 1000)))

    def send(tier):
        cfg = types.GenerateContentConfig(
            system_instruction=system, response_mime_type="application/json", response_json_schema=schema,
            thinking_config=types.ThinkingConfig(thinking_level=thinking_level.upper()),
            max_output_tokens=max_output_tokens, service_tier=types.ServiceTier.FLEX if tier == "flex" else None,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
        try:
            resp = client.models.generate_content(model=model, contents=prompt, config=cfg)
        except errors.APIError as e:
            msg = str(e.message or "").replace(api_key, "…")[:300]
            raise GeminiError(_explain(e.code or 0, msg), retry=(e.code or 0) in RETRY_CODES) from None
        except Exception as e:                              # 連線逾時、網路中斷
            raise GeminiError(f"無法連線到 Google：{type(e).__name__}", retry=True) from None
        u = resp.usage_metadata
        return resp, {"input_tokens": (u and u.prompt_token_count) or 0,
                      "output_tokens": (u and u.candidates_token_count) or 0,
                      "thinking_tokens": (u and u.thoughts_token_count) or 0, "tier": served_tier(u, tier)}

    t0 = time.perf_counter()
    usage = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0}
    for attempt in (1, 2):
        try:
            (resp, u), fell_back = with_tier(send, service_tier)
        except GeminiError as e:
            if e.retry and attempt == 1:
                time.sleep(3)
                continue
            raise
        usage["calls"] += 1
        if fell_back:
            usage["fallback"] = usage.get("fallback", 0) + 1
        add_usage(usage, u)
        try:
            data = json.loads(resp.text or "")
        except ValueError:
            if attempt == 1:
                continue
            raise GeminiError("回應格式不對") from None
        return {"data": data, "usage": usage, "seconds": round(time.perf_counter() - t0, 2)}
    raise GeminiError("沒有成功取得回應")


# ======================= 找錯別字 =======================

def detect_text(paras, api_key, model=TEXT_MODEL, thinking_level=TEXT_THINKING, call=None, service_tier="standard"):
    """讀全文找別字、簡體字、不規範寫法、注音／符號代替。回傳 (marks, run 紀錄, 對不回位置的項目)。"""
    lines = ["".join(ch for ch, _ in p) for p in paras]
    prompt = TEXT_USER.format(text="\n".join(f"{i}　{t}" for i, t in enumerate(lines, 1)))
    call = call or call_gemini_json
    res = call(api_key, model, TEXT_SYSTEM, prompt, TEXT_SCHEMA, thinking_level, **_tier(service_tier))
    used, marks, lost = set(), [], []
    for e in res["data"].get("errors") or []:
        if not isinstance(e, dict) or e.get("type") not in TYPES:
            continue
        keys = locate(paras, str(e.get("context", "")), str(e.get("wrong", "")), used)
        if not keys:
            lost.append({k: e.get(k) for k in ("context", "wrong", "correct", "type")})
            continue
        marks.append({"keys": keys, "wrong": N.fold(str(e["wrong"])), "correct": N.fold(str(e.get("correct", ""))),
                      "type": e["type"], "reason": str(e.get("reason", ""))[:200],
                      "confidence": e.get("confidence", "medium"), "source": "ai-text"})
    run = {"kind": "text", "model": model, "prompt": TEXT_PROMPT_VERSION, "thinking_level": thinking_level,
           "service_tier": service_tier,
           "usage": res["usage"], "seconds": res["seconds"], "lost": len(lost),
           "time": datetime.now().isoformat(timespec="seconds")}
    return marks, run, lost


ZHUYIN_SYSTEM = """你是台灣國中、高中的國文老師。學生寫作文時，遇到不會寫的字會用注音代替。
請依上下文和注音的讀音（含聲調），判斷學生想寫的是哪個字。只回答國字，字數和注音的音節數相同；
沒有把握時 confidence 填 low。"""

ZHUYIN_USER = """下面每一行是一處，【】裡是學生寫的注音。請回答每一處應該寫的字：

{items}"""
ZHUYIN_THINKING = "low"           # 只是依上下文挑一個同音字：思考程度設低（設 high 時一篇多花約 US$0.05）

ZHUYIN_SCHEMA = {
    "type": "object",
    "properties": {"answers": {"type": "array", "items": {"type": "object", "properties": {
        "n": {"type": "integer", "description": "第幾處（行首的編號）"},
        "correct": {"type": "string", "description": "應該寫的字"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]}},
        "required": ["n", "correct", "confidence"]}}},
    "required": ["answers"],
}


def merge_ai(rule, ai):
    """把 AI 讀全文找到的錯別字併進程式比對的結果：和程式標的「注音代替」在同一個地方時，只留程式的那一個
    （程式還沒有正確字、AI 有時，補上 AI 的）。"""
    zh = [m for m in rule if m["type"] == "注音代替"]
    out = []
    for a in ai:
        hit = next((z for z in zh if set(a["keys"]) & set(z["keys"])), None)
        if hit is None:
            out.append(a)
        elif not hit["correct"] and a["correct"] and CJK_ONLY.match(a["correct"]):
            hit["correct"] = a["correct"][:4]
            hit["reason"] += f"；AI 依上下文判斷應為「{hit['correct']}」"
            hit["confidence"] = a.get("confidence", "medium")
    return rule + out


CJK_ONLY = re.compile(r"^[㐀-䶿一-鿿]+$")


def _tier(service_tier):
    """只有用 Flex 時才多傳參數（測試用的假呼叫函式不必認得它）。"""
    return {"service_tier": service_tier} if service_tier != "standard" else {}


def resolve_zhuyin(marks, paras, api_key, model=TEXT_MODEL, thinking_level=ZHUYIN_THINKING, call=None,
                   service_tier="standard"):
    """還沒有正確字的注音代替：只送那幾處前後文（不是全文），請 AI 依上下文補上正確的字。回傳 run 紀錄。"""
    todo = [m for m in marks if m["type"] == "注音代替" and not m["correct"]]
    if not todo:
        return None
    lines = []
    for i, m in enumerate(todo, 1):
        ctx = context_of(paras, set(m["keys"]), width=12) or ["", "", ""]
        lines.append(f"{i}　{ctx[0]}【{m.get('zhuyin') or m['wrong']}】{ctx[2]}")
    call = call or call_gemini_json
    res = call(api_key, model, ZHUYIN_SYSTEM, ZHUYIN_USER.format(items="\n".join(lines)), ZHUYIN_SCHEMA, thinking_level,
               **_tier(service_tier))
    filled = 0
    for a in (res["data"].get("answers") or []) if isinstance(res.get("data"), dict) else []:
        try:
            n = int(a.get("n"))
        except (AttributeError, TypeError, ValueError):
            continue
        c = N.fold(str(a.get("correct") or ""))
        if not 1 <= n <= len(todo) or not CJK_ONLY.match(c) or todo[n - 1]["correct"]:
            continue
        m = todo[n - 1]
        m["correct"] = c[:4]
        m["reason"] += f"；AI 依上下文判斷應為「{m['correct']}」"
        m["confidence"] = a.get("confidence") if a.get("confidence") in ("high", "medium", "low") else "medium"
        filled += 1
    return {"kind": "zhuyin", "model": model, "thinking_level": thinking_level, "asked": len(todo), "filled": filled,
            "usage": res["usage"], "seconds": res["seconds"], "time": datetime.now().isoformat(timespec="seconds")}


# ======================= 存檔 =======================

def empty_typos():
    return {"format": TYPOS_FORMAT, "updated": None, "done": False, "runs": [], "marks": []}


def load_typos(folder):
    p = Path(folder) / TYPOS_NAME
    if p.is_file():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("marks"), list):
                return {**empty_typos(), **data}
        except ValueError:
            pass
    return empty_typos()


def save_typos(folder, data):
    data = {**data, "format": TYPOS_FORMAT, "updated": datetime.now().isoformat(timespec="seconds")}
    tmp = Path(folder) / (TYPOS_NAME + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, Path(folder) / TYPOS_NAME)
    return data


RULE_SOURCES = ("rule", "dict", "dict2")       # 程式檢查（不連網）產生的建議：dict 是成語比對；dict2 是已停用的
                                               # 兩字詞比對（列在這裡，重做程式檢查時才會清掉舊資料裡還沒確認的）
AI_SOURCES = ("ai-text",)                      # AI 讀全文產生的建議


def merge_marks(old, new, sources=RULE_SOURCES + AI_SOURCES):
    """重新偵測時保留老師的決定：同一格、同一個錯字的建議沿用原本的狀態與編號；老師自己加的保留。
    老師確認或排除過的，正確字與類型也照老師的；這次沒有正確字、上次有（例如 AI 補的）時沿用上次的。
    sources：這次有做的偵測會產生哪些來源。其他來源的建議原樣保留——例如只重做程式檢查時，
    上次 AI 找到、老師還沒看的建議不會不見。"""
    sources = set(sources)
    sig_of = lambda m: (tuple(m["keys"]), m["wrong"])          # noqa: E731
    out = [m for m in old if m.get("source") == "teacher" or m.get("source") not in sources]
    kept = {sig_of(m) for m in out}
    known = {sig_of(m): m for m in old if m.get("source") in sources}
    n = max([int(str(m.get("id", "m0"))[1:] or 0) for m in old] + [0])
    seen = set()
    for m in new:
        sig = sig_of(m)
        if sig in seen or sig in kept:
            continue
        seen.add(sig)
        prev = known.get(sig)
        if prev:
            st = prev.get("status", "pending")
            keep = {}
            if st != "pending":
                keep = {"correct": prev.get("correct", ""), "type": prev.get("type", m["type"])}
            elif not m.get("correct") and prev.get("correct"):
                keep = {"correct": prev["correct"], "reason": prev.get("reason", m.get("reason", "")),
                        "confidence": prev.get("confidence", m.get("confidence"))}
            out.append({**m, **keep, "id": prev["id"], "status": st})
        else:
            n += 1
            out.append({**m, "id": f"m{n}", "status": "pending"})
    for m in old:                                          # 老師已經確認、這次沒再找到的，也保留
        if m.get("source") in sources and m.get("status") == "confirmed" and sig_of(m) not in seen:
            out.append(m)
    return out


def sort_marks(marks, paras):
    """依在全文中的位置排序（閱讀順序）；找不到位置的（例如老師標在空白格）排在最後。"""
    pos = {}
    for i, (ch, k) in enumerate(c for p in paras for c in p):
        pos.setdefault(k, i)
    return sorted(marks, key=lambda m: min((pos.get(k, 10 ** 9) for k in m["keys"]), default=10 ** 9))


def run_essay(folder, api_key=None, model=TEXT_MODEL, thinking_level=TEXT_THINKING, call=None, log=print, use_ai=True,
              service_tier="standard"):
    """一篇作文找錯別字：程式比對一定做（不連網）；use_ai 時再請 AI 讀全文。和原本的結果合併後存檔。"""
    folder = Path(folder)
    pages, review, paras, source = load_essay_text(folder)
    data = load_typos(folder)
    from . import dictionary
    d = dictionary.load()                                   # 沒有下載萌典資料時是 None：只是不比對成語
    marks = rules.rule_marks(paras, dictionary=d)
    sources = RULE_SOURCES
    data["runs"] = (data.get("runs") or []) + [{"kind": "rules", "version": rules.RULES_VERSION, "found": len(marks),
                                               "source": source, "dictionary": d is not None,
                                               "time": datetime.now().isoformat(timespec="seconds")}]
    if use_ai and any(paras):
        ai, run, lost = detect_text(paras, api_key, model, thinking_level, call, service_tier)
        marks = merge_ai(marks, ai)
        sources = RULE_SOURCES + AI_SOURCES
        run["source"] = source
        data["runs"] = (data.get("runs") or []) + [run]
        if lost:
            log(f"  ⚠ {folder.name}：有 {len(lost)} 個 AI 找到的錯別字對不回位置，已略過")
        known = {(tuple(m["keys"]), m["wrong"]): m for m in data.get("marks") or []}
        open_ = [m for m in marks if m["type"] == "注音代替" and not m["correct"]
                 and not (known.get((tuple(m["keys"]), m["wrong"])) or {}).get("correct")]
        z = resolve_zhuyin(open_, paras, api_key, model, call=call, service_tier=service_tier)   # 注音的正確字
        if z:
            data["runs"].append(z)
    data["marks"] = sort_marks(merge_marks(data.get("marks") or [], marks, sources), paras)
    return save_typos(folder, data)


# ======================= 批改畫面 =======================

STATUSES = ("pending", "confirmed", "rejected")


def counts(data):
    c = {s: 0 for s in STATUSES}
    for m in data.get("marks") or []:
        c[m.get("status", "pending")] = c.get(m.get("status", "pending"), 0) + 1
    return c


def rules_stale(folder, data):
    """要不要重做程式比對（不連網、免費；批改畫面打開時自動做）：還沒做過、比對規則更新了，
    或上次比對之後校對結果、辨識結果有改過。"""
    runs = [r for r in data.get("runs") or [] if r.get("kind") == "rules"]
    if not runs or runs[-1].get("version") != rules.RULES_VERSION:
        return True
    last = runs[-1].get("time") or ""
    files = [Path(folder) / RV.REVIEW_NAME, *Path(folder).glob("*_ocr.json")]
    newest = max((f.stat().st_mtime for f in files if f.is_file()), default=0)
    return datetime.fromtimestamp(newest).isoformat(timespec="seconds") > last


def context_of(paras, keys, width=10):
    """錯字前後各幾個字（只取同一段），給老師看上下文：[前文, 錯字, 後文]；找不到位置時 None。"""
    def join(seq):
        return "".join(ch for ch, _ in seq)

    for p in paras:
        idx = [i for i, (_, k) in enumerate(p) if k in keys]
        if idx:
            a, b = idx[0], idx[-1] + 1
            return [join(p[max(0, a - width):a]), join(p[a:b]), join(p[b:b + width])]
    return None


def trusted(m, status):
    """這個標記能不能直接畫紅筆：老師自己加的可以；AI 的建議要每一格都是「可信」（辨識沒有疑點）。
    辨識不確定的格子，錯字可能是讀錯的，不直接畫紅筆，留給老師看。"""
    return m.get("source") == "teacher" or all(status.get(k) == "agree" for k in m["keys"])


def red_pen(marks):
    """考試批改時學生會看到的紅筆：老師確認的，加上還沒處理、而且在可信格子上的 AI 建議（要先有 trusted 欄位）。"""
    return [m for m in marks if m.get("status") == "confirmed" or (m.get("status") == "pending" and m.get("trusted"))]


def load_grading(root, essay_id):
    """批改畫面需要的資料：每頁的格子（位置、定稿的字）、錯別字標記（含上下文、能不能直接畫紅筆）。"""
    folder = RV.resolve(root, essay_id)
    essay = RV.load_essay(root, essay_id)
    pages, review, paras, source = load_essay_text(folder)
    final, status = {}, {}
    for ocr, p in zip(RV.apply(pages, review), pages):
        for c in ocr["cells"]:
            final[RV.cell_key(p["prefix"], c)] = c["text"] if c["status"] != "blank" else ""
            status[RV.cell_key(p["prefix"], c)] = c["status"]
    out_pages = [{"prefix": pg["prefix"], "page": pg["page"], "aspect": pg["aspect"],
                  "cells": [{"key": c["key"], "col": c["col"], "row": c["row"], "box": c["box"],
                             "text": final.get(c["key"], "")} for c in pg["cells"]]} for pg in essay["pages"]]
    data = load_typos(folder)
    marks = [{**m, "context": context_of(paras, set(m["keys"])), "trusted": trusted(m, status)} for m in data["marks"]]
    return {"id": essay_id, "name": folder.name, "pages": out_pages, "source": source,
            "reviewed": bool(review.get("done")), "typos": {**data, "marks": marks}, "counts": counts(data),
            "stale": rules_stale(folder, data)}


def save_decisions(root, essay_id, payload):
    """老師在批改畫面的決定：確認／排除 AI 的建議、修改正確字、自己加或刪除標記、完成批改。"""
    folder = RV.resolve(root, essay_id)
    if not isinstance(payload, dict) or not isinstance(payload.get("marks", []), list):
        raise ValueError("批改資料格式不正確")
    pages = RV.load_pages(folder)
    valid = {RV.cell_key(p["prefix"], c) for p in pages for c in p["ocr"]["cells"]}
    data = load_typos(folder)
    old = {m["id"]: m for m in data["marks"]}
    n = max([int(str(m.get("id", "m0"))[1:] or 0) for m in data["marks"]] + [0])
    out, seen = [], set()
    for m in payload.get("marks", []):
        if not isinstance(m, dict):
            continue
        prev = old.get(m.get("id"))
        status = m.get("status") if m.get("status") in STATUSES else "pending"
        correct = N.fold(str(m.get("correct") or ""))[:4]
        mtype = m.get("type") if m.get("type") in TYPES else None
        if prev:
            seen.add(prev["id"])
            out.append({**prev, "status": status, "correct": correct if "correct" in m else prev.get("correct", ""),
                        "type": mtype or prev.get("type", "別字")})
        else:                                              # 老師自己加的
            keys = [k for k in (m.get("keys") or []) if k in valid][:4]
            if not keys:
                continue
            n += 1
            out.append({"id": f"m{n}", "keys": keys, "wrong": N.fold(str(m.get("wrong") or ""))[:4],
                        "correct": correct, "type": mtype or "別字", "reason": str(m.get("reason") or "")[:200],
                        "confidence": "high", "source": "teacher", "status": "confirmed"})
    for mid, prev in old.items():                          # AI 的建議不能刪，只能排除；老師自己加的可以刪
        if mid not in seen and prev.get("source") != "teacher":
            out.append(prev)
    _, review, paras, _ = load_essay_text(folder)
    data["marks"] = sort_marks(out, paras)
    data["done"] = bool(payload.get("done"))
    saved = save_typos(folder, data)
    status = {RV.cell_key(p["prefix"], c): c["status"] for ocr, p in zip(RV.apply(pages, review), pages) for c in ocr["cells"]}
    return {"typos": {**saved, "marks": [{**m, "context": context_of(paras, set(m["keys"])), "trusted": trusted(m, status)}
                                         for m in saved["marks"]]},
            "counts": counts(saved)}


# ======================= 整批 =======================

def essay_folders(root):
    """root 底下每篇已辨識的作文資料夾。"""
    return sorted({p.parent for p in Path(root).rglob("*_ocr.json") if "未辨識" not in p.parts})


def run_all(root, api_key, service_tier="standard", workers=12, prices=None, log=print, call=None):
    """整批找錯別字（程式比對＋AI），好幾篇同時送出（用 Flex 時一起排隊）。回傳合計。"""
    from concurrent.futures import ThreadPoolExecutor

    from ..ocr.cost import run_cost

    folders = essay_folders(root)
    totals = {"essays": 0, "marks": 0, "failed": 0, "cost": 0.0, "fallback": 0}

    def one(folder):
        try:
            return folder, run_essay(folder, api_key, call=call, log=log, service_tier=service_tier), None
        except GeminiError as e:
            return folder, None, str(e)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        for folder, data, err in ex.map(one, folders):
            if err:
                totals["failed"] += 1
                log(f"  ✗ {folder.name}：{err}")
                continue
            totals["essays"] += 1
            c = counts(data)
            totals["marks"] += c.get("pending", 0)
            start = max(i for i, r in enumerate(data["runs"]) if r.get("kind") == "rules")   # 這次的紀錄從程式比對開始
            for r in data["runs"][start + 1:]:
                totals["fallback"] += (r.get("usage") or {}).get("fallback", 0)
                if prices is not None:
                    totals["cost"] += run_cost("gemini", {"usage": r.get("usage"), "settings": {"model": r["model"]}},
                                               prices) or 0.0
            log(f"  {folder.name}：待確認 {c.get('pending', 0)} 個")
    return totals
