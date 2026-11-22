"""合併多個辨識引擎的結果，並依稿紙規則組成全文。

每一格的狀態（顯示名稱見 model.STATUS_NAMES）：
- blank  空白：前處理判斷沒有字跡，引擎也沒讀到字
- agree  可信（綠）：只用一個引擎時，讀到字且沒有疑點；用兩個引擎時，兩個讀到同一個字
- single 建議看一下（黃）：只有一個引擎讀到、引擎自己標示不確定，或墨跡和讀到的字不太相符
  （墨跡很小卻讀成一個字 → 可能是標點；墨跡很多 → 可能有塗改）
- review 需確認（紅）：引擎讀到不同的字、有字跡卻沒讀到、空白格卻讀到字、無法辨識、可能劃掉、一格多字…

預設只用 Gemini（老師逐格核對樣本：幾乎沒有「Vision 對、Gemini 錯」的情形，Vision 只增加要看的格子）；
要再加 Vision 交叉比對，在 ocr_config.json 的 engines 加上 "vision"。

Vision 有逐字信心值：實測樣本中，信心 0.85 以上時和 Gemini 一致 99%，低於 0.7 時只有 67～81%。
所以 Vision「自己也不確定」（信心低於 weak_conf）的讀法只當參考：和 Gemini 不同時標黃色而不是紅色，
它附帶的旗標（例如一格多字）也不會讓格子變紅。
"""
from . import normalize as N
from .model import FLAG_NAMES, OCR_FORMAT, STATUS_NAMES, STATUS_ORDER

REVIEW_FLAGS = {"illegible", "crossed", "multi", "spill", "count_mismatch"}
WEAK_CONF = 0.7
UNREADABLE = "□"          # 有字跡卻沒讀到的格子（不用「？」，以免和真的問號混淆）
META_KEYS = ("template", "paper", "page_index", "page", "ppm", "source", "batch", "no")


def fuse(page, results, prefer=("gemini", "vision"), weak_conf=WEAK_CONF):
    """page：PreparedPage；results：EngineResult 清單。回傳一頁的辨識結果（可直接存成 _ocr.json）。
    weak_conf：引擎自己的信心值低於此值時，它的讀法只當參考（不會單獨讓格子變紅）。"""
    ok = [r for r in results if not r.error]
    names = [r.engine for r in ok]
    order = [n for n in prefer if n in names] + [n for n in names if n not in prefer]
    counts = {k: 0 for k in STATUS_ORDER}
    cells = []
    for c in page.cells:
        pos = (c["col"], c["row"])
        reads = {r.engine: r.readings.get(pos) for r in ok}
        weak = {n for n, rd in reads.items() if rd is not None and rd.conf is not None and rd.conf < weak_conf}
        flags = sorted({f for n, rd in reads.items() if rd and n not in weak for f in rd.flags})
        texts = {n: N.fold(rd.text) for n, rd in reads.items() if rd is not None}
        nonempty = {n: t for n, t in texts.items() if t}
        reasons = []
        if not nonempty and "crossed" not in flags:
            if c["kind"] == "blank":
                status, text = "blank", ""
            else:
                status, text = "review", UNREADABLE
                reasons.append("有字跡但沒有讀到")
        elif not nonempty:                                   # 只有「劃掉」的判斷
            status, text = "review", ""
        else:
            text = next(nonempty[n] for n in order if n in nonempty)
            sure = {N.key(t) for n, t in nonempty.items() if n not in weak}
            if len(sure) > 1:
                status = "review"
                reasons.append("辨識結果不一致")
            elif len({N.key(t) for t in nonempty.values()}) > 1:   # 只有「自己也不確定」的引擎讀法不同
                status = "single"
                odd = sorted(n for n, t in nonempty.items() if n in weak and N.key(t) != N.key(text))
                reasons.append(f"{'、'.join(odd)} 讀法不同，但它自己也不確定")
            elif c["kind"] == "blank":
                status = "review"
                reasons.append("空白格卻讀到字")
            elif len(nonempty) == len(ok):                  # 只用一個引擎、或所有引擎都讀到同一個字
                status = "agree"
                if c["kind"] == "mark" and not N.is_punct(text):
                    status = "single"
                    reasons.append("墨跡很小，卻讀成一個字（可能是標點）")
                elif c["kind"] == "dense":
                    status = "single"
                    reasons.append("墨跡很多（可能有塗改）")
            else:
                status = "single"
                reasons.append("只有一個引擎讀到")
        reasons += [FLAG_NAMES[f] for f in flags if f in FLAG_NAMES]
        if REVIEW_FLAGS & set(flags):
            status = "review"
        elif "uncertain" in flags and status == "agree":
            status = "single"
        counts[status] += 1
        cells.append({"col": c["col"], "row": c["row"], "rect": c["rect"], "kind": c["kind"], "ink": c["ink"],
                      "text": text,
                      "status": status, "reasons": reasons,
                      "engines": {n: rd.to_json() for n, rd in reads.items() if rd is not None}})

    insertions = [{**i, "from": r.engine} for r in ok for i in r.insertions]
    seen = {(i["right_col"], i["row"]) for i in insertions}
    for g in page.gaps:
        if (g["right_col"], g["row"]) not in seen:
            insertions.append({"right_col": g["right_col"], "left_col": g["left_col"], "row": g["row"],
                               "rect": g["rect"], "text": "", "from": "prep"})
    return {
        "format": OCR_FORMAT,
        "page": {**{k: page.meta[k] for k in META_KEYS if k in page.meta},
                 "cols": len(page.cols), "rows": len(page.rows)},
        "runs": {r.engine: {"settings": r.settings, "usage": r.usage, "seconds": round(r.seconds, 2),
                            **({"error": r.error} if r.error else {}),
                            **({"warnings": r.warnings} if r.warnings else {})} for r in results},
        "prefer": order,
        "cells": cells,
        "insertions": insertions,
        "summary": counts,
    }


# ======================= 全文 =======================

def column_cells(ocr, engine=None):
    """依閱讀順序（第 1 行起）回傳每行由上到下的格子文字；空白（或劃掉）為 None。

    engine 指定時，改用該引擎自己的讀法（評估時比較各引擎用），空白格仍依前處理判斷。
    """
    by_col = {}
    for c in ocr["cells"]:
        if engine:
            rd = c["engines"].get(engine)
            t = N.fold(rd["text"]) if rd and c["kind"] != "blank" else ""
        else:
            t = c["text"] if c["status"] != "blank" else ""
        by_col.setdefault(c["col"], {})[c["row"]] = t or None
    return [(col, [rows[r] for r in sorted(rows)]) for col, rows in sorted(by_col.items())]


def grid_text(ocr, engine=None):
    """格子文字：每行一列，空白格以全形空格表示，方便和原稿逐格對照。"""
    return "\n".join(f"{col:>2}　" + "".join(t or "　" for t in seq) for col, seq in column_cells(ocr, engine))


def paragraphs(ocrs, engine=None):
    """依稿紙規則組成段落：一行開頭空兩格以上 → 新段落；整行空白 → 段落結束；行內空格略過。"""
    paras, cur = [], None
    for ocr in ocrs:
        for _, seq in column_cells(ocr, engine):
            filled = [i for i, t in enumerate(seq) if t]
            if not filled:
                if cur:
                    paras.append(cur)
                    cur = None
                continue
            text = "".join(t for t in seq if t)
            if cur is None or filled[0] >= 2:
                if cur:
                    paras.append(cur)
                cur = text
            else:
                cur += text
    if cur:
        paras.append(cur)
    return paras


def full_text(ocrs, engine=None):
    return "\n".join("　　" + p for p in paragraphs(ocrs, engine))


def review_rows(ocr):
    """需要確認的格子（給老師看的清單）。"""
    out = []
    for c in ocr["cells"]:
        if c["status"] in ("review", "single"):
            readings = "；".join(f"{n}：{rd['text'] or '（劃掉）'}" for n, rd in c["engines"].items())
            out.append({"頁": ocr["page"].get("page", ""), "行": c["col"], "格": c["row"], "目前": c["text"],
                        "狀態": STATUS_NAMES[c["status"]],
                        "原因": "、".join(c["reasons"]), "各引擎": readings})
    for i in ocr["insertions"]:
        out.append({"頁": ocr["page"].get("page", ""), "行": f"{i['right_col']}～{i['left_col']} 之間", "格": i["row"],
                    "目前": i["text"], "狀態": "行間補寫", "原因": "行與行之間有字跡", "各引擎": i["from"]})
    return out
