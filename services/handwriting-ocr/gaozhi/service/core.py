"""辨識服務的三個步驟（純函式，不連網、不存檔）。HTTP 介面在 server.py。

資料都用 JSON：影像是 base64；每一頁的資料（meta、拉正的稿紙圖）由呼叫端（1Campus）保存，下一步再送回來，
所以服務本身沒有狀態，可以隨時重新啟動、同時開好幾份。
"""
import base64
import json
import threading

import cv2
import numpy as np

import locate as LC
from .. import gridreg
from .. import layout as L
from ..grading import dictionary, rules
from ..grading import typos as TY
from ..ocr import fuse as F
from ..ocr import prep
from ..ocr import review as RV
from ..ocr.engines import gemini as GM

SERVICE_VERSION = 1
PPM = 10.0
JPEG_QUALITY = 92
COLS_PER_STRIP = 6
PDF_DPI = 300
NOT_AT_LINE_START = set("，。、；：？！」』）》〉…—")      # 標點不放在一行的第一格（開頭的「『（ 可以）
MARK = "〔?〕"                                          # 全文裡，辨識沒把握的字後面加這個記號
PDF_LOCK = threading.Lock()                            # PyMuPDF 不能同時在兩個執行緒用
# 認原版學測答案卷時先把照片縮到這個長邊：高解析時手寫筆畫會干擾格線比對，學測稿紙照片原檔、3200 一張都對不上，
# 1600～2000 才認得出來（2026-11-04 本機量測，9 張認出 8 張）
GSAT_PROBE_LONG_SIDE = 2000
# 格線微調沒有套用、只靠定位標記拉正又偏這麼多（mm）時，格子對不準：照樣切格子，空白格會被當成有字。
# 對準的照片偏差在 0.18～0.46mm，對不準的 1.1～1.5mm（2026-11-04 本機量測）
MISALIGNED_MM = 0.8


class ServiceError(ValueError):
    """呼叫端送來的資料有問題（回 400／422），訊息可以直接給老師看。"""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def b64(data):
    return base64.b64encode(data).decode("ascii")


def unb64(s, what="影像"):
    try:
        return base64.b64decode(str(s or ""), validate=True)
    except (ValueError, TypeError):
        raise ServiceError(f"{what}不是正確的 base64")


def load_pages(name, data):
    """一個上傳的檔案 → [(頁名, 影像)]。JPEG、PNG 是一頁；PDF 每頁轉成 300 dpi 影像。"""
    if data[:4] == b"%PDF":
        import pymupdf
        out = []
        with PDF_LOCK:
            doc = pymupdf.open("pdf", data)
            for i, p in enumerate(doc):
                pix = p.get_pixmap(dpi=PDF_DPI, colorspace=pymupdf.csRGB)
                img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
                out.append((f"{name}_p{i + 1}", cv2.cvtColor(img, cv2.COLOR_RGB2BGR)))
            doc.close()
        return out
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ServiceError(f"讀不到這個檔案：{name}（只收 JPEG、PNG、PDF）")
    return [(name, img)]


def _engine(call=None):
    return GM.GeminiEngine(cols_per_strip=COLS_PER_STRIP, call=call, workers=1)


def _prepared(warped_jpeg, meta):
    img = cv2.imdecode(np.frombuffer(warped_jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ServiceError("拉正的稿紙圖讀不到")
    return prep.prepare(img, meta)


# ======================= 1. /check、/prepare =======================

CORNER_NAMES = {"tl": "左上角", "tr": "右上角", "br": "右下角", "bl": "左下角"}


def _locate_all(files, refine=True):
    """每個檔案的每一頁找四角定位標記 → (找到的 [(頁名, locate 結果)], 找不到的 [{name, error}], 找不到的那幾頁影像)。"""
    if not isinstance(files, list) or not files:
        raise ServiceError("沒有收到照片")
    located, failed, unlocated = [], [], []
    for f in files:
        name = str((f or {}).get("name") or "page")
        for pname, img in load_pages(name, unb64((f or {}).get("data"))):
            r = LC.locate(img, PPM, refine=refine)
            if "error" in r:
                failed.append({"name": pname, "error": r["error"]})
                unlocated.append(img)
            else:
                located.append((pname, r))
    return located, failed, unlocated


_GSAT_TEMPLATE = []


def looks_like_original_gsat(img):
    """沒有 1Campus 定位標記的照片，格子是不是和學測答案卷一樣（考場原版或學校影印的）。

    只比對格線（gaozhi.gridreg，和定位標記無關），不用 AI，一張約 1 秒。學測答案卷是橫式：直拍的照片先轉成橫的。
    照片要是整張紙（掃描 App、1Campus 的拍照都是）；連桌面一起拍的多半對不上，就當作不是，照舊整張辨識。
    """
    if not _GSAT_TEMPLATE:
        _GSAT_TEMPLATE.append(L.load_template("gsat"))
    h, w = img.shape[:2]
    if h > w:
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        h, w = w, h
    s = GSAT_PROBE_LONG_SIDE / max(h, w)
    if s < 1:
        img = cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    return "error" not in gridreg.register(img, _GSAT_TEMPLATE[0], 0)


def _not_ours(failed, unlocated):
    """這些照片都不是 1Campus 稿紙：呼叫端改用整張辨識。其中有原版學測答案卷時另外標出——整張辨識讀它錯字很多，
    呼叫端不辨識，請老師改用 1Campus 學測稿紙（docs/adr/0012）。認出一張就停，不必每張都比。"""
    out = {"ours": False, "reason": "找不到 1Campus 稿紙的四角定位標記", "failed": failed}
    for x, img in zip(failed, unlocated):
        if looks_like_original_gsat(img):
            out.update(reason="這是原版學測答案卷（沒有 1Campus 稿紙的定位標記）", original_gsat=True,
                       original_gsat_names=[x["name"]])
            break
    return out


def missing_corners(r):
    """locate 結果裡沒用到的角落（左上、右上、右下、左下的順序）。"""
    used = set(r.get("markers_used") or [])
    return [CORNER_NAMES[m["corner"]] for m in r["layout"]["markers"] if m["id"] not in used]


def misaligned(r):
    """格線微調沒有套用，只靠定位標記拉正又偏太多（MISALIGNED_MM）：照樣切格子，格線殘段會被當成字。
    只有 /prepare 會微調；/check 沒有微調資料，一律當作沒問題。"""
    info = r.get("refine") or {}
    return bool(info) and not info.get("applied") and (info.get("before_mm") or 0) >= MISALIGNED_MM


def _sheet_problems(located, failed):
    """要老師處理的問題（重拍、刪重複頁、撤回重傳）與每頁摘要。/check 與 /prepare 共用，兩邊判斷才會一致
    （格子對不準例外：要微調過才知道，只有 /prepare 會發現）。"""
    problems = []
    if failed:
        problems.append({"code": "markers_missing", "names": [x["name"] for x in failed],
                         "message": f"有 {len(failed)} 張看不到稿紙四角的定位標記，請重拍（四個角都要拍進去）"})
    # 只認到三個角時，拉正會歪 1～2mm，空白格會被當成有字（2026-11-03 正式站）：四個角都要認到
    incomplete = [(pname, missing_corners(r)) for pname, r in located if missing_corners(r)]
    if incomplete:
        detail = "、".join(f"{pname}的{'、'.join(corners)}" for pname, corners in incomplete)
        problems.append({"code": "markers_incomplete", "names": [pname for pname, _ in incomplete],
                         "message": f"{detail}定位標記看不清楚，請重拍（四個角都要清楚拍進去）"})
    # 四個角都認到、格線卻對不上（照片太小、紙沒攤平、拍得太斜）：缺角的頁已經要重拍，不重複列
    skewed = [pname for pname, r in located if not missing_corners(r) and misaligned(r)]
    if skewed:
        problems.append({"code": "grid_misaligned", "names": skewed,
                         "message": f"{'、'.join(skewed)}的格子對不準，請重拍（紙要攤平、從正上方拍）"})
    seen = {}
    for pname, r in located:
        key = (r["template"]["id"], r["layout"]["page"])
        if key in seen:
            problems.append({"code": "duplicate_page", "names": [seen[key], pname],
                             "message": f"第 {key[1]} 頁傳了兩次，請刪掉其中一張"})
        seen.setdefault(key, pname)
    kinds = {r["template"]["id"] for _, r in located}
    if len(kinds) > 1:
        problems.append({"code": "mixed_formats", "message": "這幾張不是同一種稿紙，請確認是不是放錯了"})
    if kinds == {"gsat"} and {p for (_, p) in seen} >= {1, 2}:
        problems.append({"code": "two_questions",
                         "message": "學測第一、二大題混在一起，這份作業只能放一題，請撤回後重傳正確的那一面"})
    summary = [{"source": n, "template": r["template"]["id"], "format": r["template"]["name"], "paper": r["paper"],
                "page": r["layout"]["page"]} for n, r in located]
    return problems, summary


def check(files):
    """老師一上傳就先檢查（不拉正細修、不切小圖，約 0.5 秒一張）：要不要重拍，判斷和 /prepare 完全相同。

    回傳：{"ours": False} 不是我們的稿紙（原版學測答案卷另帶 "original_gsat": True）；
    {"ours": True, "ok": False, "problems", "pages"} 要老師處理；{"ours": True, "ok": True, "pages"} 可以辨識。
    """
    located, failed, unlocated = _locate_all(files, refine=False)
    if not located:
        return _not_ours(failed, unlocated)
    problems, summary = _sheet_problems(located, failed)
    if problems:
        return {"ours": True, "ok": False, "problems": problems, "pages": summary, "failed": failed}
    return {"ours": True, "ok": True, "pages": summary}


def prepare(files):
    """一位學生的所有頁 → 每頁拉正的稿紙圖與要送「逐格辨識」preset 的小圖。

    files：[{"name": 檔名, "data": base64}]。
    回傳：
      {"ours": False}                         這些照片都不是我們的稿紙：呼叫端改用整張辨識
      {"ours": False, "original_gsat": True}  其中有原版學測答案卷：呼叫端不辨識，請改用 1Campus 學測稿紙
      {"ours": True, "ok": False, "problems"} 是我們的稿紙，但要老師處理（重拍、撤回重傳）
      {"ours": True, "ok": True, "pages"}     每頁的 meta、warped_jpeg、strips（每組要送的圖與文字）
    """
    located, failed, unlocated = _locate_all(files)
    if not located:
        return _not_ours(failed, unlocated)
    problems, summary = _sheet_problems(located, failed)
    if problems:
        return {"ours": True, "ok": False, "problems": problems, "pages": summary, "failed": failed}

    pages = []
    for (pname, r), s in sorted(zip(located, summary), key=lambda x: x[1]["page"]):
        meta = LC.page_meta(r, PPM, source=pname)
        jpeg = cv2.imencode(".jpg", r["warped"], [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])[1].tobytes()
        page = _prepared(jpeg, meta)                      # 和 /assemble 用同一張 JPEG 前處理，格子判斷才會一致
        strips = [{"index": i, "cols": cs, "prompt": prompt,
                   "images": [{"col": c, "png": b64(v.png())} for c, v in views]}
                  for i, (views, cs, prompt) in enumerate(_engine().jobs(page))]
        pages.append({**s, "label": r["layout"]["label"], "meta": meta, "warped_jpeg": b64(jpeg),
                      "ink_cells": sum(1 for c in page.cells if c["kind"] != "blank"), "strips": strips})
    return {"ours": True, "ok": True, "pages": pages, "preset": "稿紙逐格辨識", "prompt_version": GM.PROMPT_VERSION}


# ======================= 2. /assemble =======================

def _recognize(p):
    """一頁：把呼叫端送回的每組 AI 回應放回格子（解析規則和本機辨識完全相同）。"""
    page = _prepared(unb64(p.get("warped_jpeg"), "拉正的稿紙圖"), p.get("meta") or {})
    texts = {}
    for x in p.get("replies") or []:
        try:
            texts[int(x["index"])] = str(x.get("text") or "")
        except (KeyError, TypeError, ValueError):
            raise ServiceError("replies 的每一項要有 index 和 text")
    jobs = _engine().jobs(page)
    order = {prompt: i for i, (_, _, prompt) in enumerate(jobs)}

    def replay(model, images, prompt, settings):
        i = order.get(prompt)
        if i is None or i not in texts:
            raise GM.GeminiError(f"沒有第 {i} 組的回應", retry=False)
        return {"text": texts[i], "finish": "STOP", "usage": {}}

    result = _engine(call=replay).recognize(page)
    ocr = F.fuse(page, [result], prefer=("gemini",))
    ocr["prep"] = {"gaps": len(page.gaps)}
    return ocr


def _prefix(ocr, i):
    return f"第{ocr['page'].get('page', i + 1)}頁"


def essay_pages(ocrs):
    ocrs = sorted(ocrs, key=lambda o: o["page"].get("page", 0))
    return [{"prefix": _prefix(o, i), "ocr": o} for i, o in enumerate(ocrs)]


def _status(pages):
    return {RV.cell_key(p["prefix"], c): c["status"] for p in pages for c in p["ocr"]["cells"]}


def marked_text(paras, status):
    """全文，辨識沒把握的格子在字後面加〔?〕（送批改模型用）；每段一行。"""
    lines = []
    for p in paras:
        out = []
        for i, (ch, k) in enumerate(p):
            out.append(ch)
            last_of_cell = i + 1 == len(p) or p[i + 1][1] != k
            if last_of_cell and status.get(k) != "agree":
                out.append(MARK)
        lines.append("".join(out))
    return "\n".join(lines)


def format_checks(pages):
    """只看格子判斷的格式問題：標點在一行的第一格、段首沒空兩格（上一行沒寫滿、這一行從第一格開始）。"""
    out, prev_last, started = [], None, False
    for p in pages:
        rows = max((c["row"] for c in p["ocr"]["cells"]), default=0)
        by_col = {}
        for c in p["ocr"]["cells"]:
            if c["status"] != "blank" and c["text"]:
                by_col.setdefault(c["col"], {})[c["row"]] = c["text"]
        for col in sorted({c["col"] for c in p["ocr"]["cells"]}):
            filled = sorted(by_col.get(col, {}))
            if not filled:
                prev_last = 0 if started else None
                continue
            key = RV.cell_key(p["prefix"], {"col": col, "row": filled[0]})
            first = by_col[col][filled[0]]
            if filled[0] == 1 and first[:1] in NOT_AT_LINE_START:
                out.append({"type": "標點在行首", "keys": [key], "text": first,
                            "why": "標點符號不要寫在一行的第一格，可以和上一行最後一個字寫在同一格。"})
            # 上一行最後一格空著常是為了不讓標點落在行首，不算；這一行以標點開頭的是接續上一句，也不算
            if (filled[0] == 1 and started and prev_last is not None and prev_last < rows - 1
                    and first[:1] not in NOT_AT_LINE_START):
                out.append({"type": "段首空兩格", "keys": [key], "text": first,
                            "why": "每一段開頭要空兩格，閱卷老師一眼就看得出分段。"})
            prev_last, started = filled[-1], True
    return out


class _Captured(Exception):
    def __init__(self, prompt):
        super().__init__("captured")
        self.prompt = prompt


def _capture(*args, **kw):
    raise _Captured(args[3])


def typo_prompt(paras):
    """「找錯別字」preset 要送的文字（和本機 TY.detect_text 送的完全一樣）。"""
    try:
        TY.detect_text(paras, None, call=_capture)
    except _Captured as c:
        return c.prompt
    return None


def assemble(pages):
    """每頁的 meta、warped_jpeg、replies → 每格的字、全文、格式檢查、字數、完成度、程式找到的錯字。"""
    if not isinstance(pages, list) or not pages:
        raise ServiceError("沒有收到頁面")
    ocrs = [_recognize(p) for p in pages]
    ep = essay_pages(ocrs)
    paras = TY.text_cells(ep, RV.empty_review())
    status = _status(ep)
    ink = sum(1 for s in status.values() if s != "blank")
    agree = sum(1 for s in status.values() if s == "agree")
    warnings = [w for o in ocrs for r in o.get("runs", {}).values() for w in (r.get("warnings") or [])]
    marks = rules.rule_marks(paras, dictionary=dictionary.load())
    return {"pages": [{"prefix": p["prefix"], "page": p["ocr"]["page"].get("page"), "ocr": p["ocr"]} for p in ep],
            "text": F.full_text([p["ocr"] for p in ep]), "marked_text": marked_text(paras, status),
            "chars": sum(len(p) for p in paras), "paragraphs": len(paras),
            "completion": round(agree / ink, 4) if ink else None,
            "counts": {k: sum(1 for s in status.values() if s == k) for k in ("agree", "single", "review", "blank")},
            "format": format_checks(ep), "rule_marks": marks, "warnings": warnings,
            "typo_request": {"preset": "找錯別字", "prompt": typo_prompt(paras)} if any(paras) else None}


# ======================= 3. /typos =======================

def _reply_call(reply, what):
    try:
        data = json.loads(reply) if isinstance(reply, str) else reply
    except ValueError:
        raise ServiceError(f"{what}的回應不是 JSON", 422)
    if not isinstance(data, dict):
        raise ServiceError(f"{what}的回應格式不對", 422)
    return lambda *a, **k: {"data": data, "usage": {}, "seconds": 0}


def typos(pages, rule_marks, ai_reply, zhuyin_reply=None):
    """「找錯別字」（和「注音補字」）preset 的回應 → 最後的錯字清單。

    pages、rule_marks：/assemble 回傳的。回傳 {"done": False, "zhuyin_request"}（還要問注音補字）
    或 {"done": True, "marks"}：每個標記有 trusted（辨識可信、可直接畫紅圈）與 kind（typo 確定／check 待確認）。
    """
    ep = [{"prefix": p["prefix"], "ocr": p["ocr"]} for p in pages or []]
    if not ep:
        raise ServiceError("沒有收到頁面")
    paras = TY.text_cells(ep, RV.empty_review())
    status = _status(ep)
    ai, _, lost = TY.detect_text(paras, None, call=_reply_call(ai_reply, "找錯別字"))
    marks = TY.merge_ai(json.loads(json.dumps(rule_marks or [])), ai)
    todo = [m for m in marks if m["type"] == "注音代替" and not m["correct"]]
    if todo:
        if zhuyin_reply is None:
            try:
                TY.resolve_zhuyin(todo, paras, None, call=_capture)
            except _Captured as c:
                return {"done": False, "zhuyin_request": {"preset": "注音補字", "prompt": c.prompt}}
        else:
            TY.resolve_zhuyin(todo, paras, None, call=_reply_call(zhuyin_reply, "注音補字"))
    out = []
    for m in TY.sort_marks(marks, paras):
        ok = TY.trusted(m, status)
        out.append({**m, "status": "pending", "trusted": ok, "kind": "typo" if ok else "check",
                    "context": TY.context_of(paras, set(m["keys"]))})
    return {"done": True, "marks": out, "lost": len(lost)}


def prompts():
    """三個 preset 的系統指令與回傳格式（給工程師貼進 gpt.1campus.net 後台）。"""
    return {"service_version": SERVICE_VERSION,
            "稿紙逐格辨識": {"version": GM.PROMPT_VERSION, "system": GM.SYSTEM, "schema": GM.SCHEMA,
                         "settings": {"model": GM.DEFAULT_MODEL, "media_resolution": "MEDIA_RESOLUTION_HIGH",
                                      "thinking_level": "low", "max_output_tokens": 16384}},
            "找錯別字": {"version": TY.TEXT_PROMPT_VERSION, "system": TY.TEXT_SYSTEM, "schema": TY.TEXT_SCHEMA,
                     "settings": {"model": TY.TEXT_MODEL, "thinking_level": TY.TEXT_THINKING}},
            "注音補字": {"system": TY.ZHUYIN_SYSTEM, "schema": TY.ZHUYIN_SCHEMA,
                     "settings": {"model": TY.TEXT_MODEL, "thinking_level": TY.ZHUYIN_THINKING}}}
