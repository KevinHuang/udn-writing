"""校對：老師在網頁上逐格確認、修改辨識結果，產生定稿全文。

每篇作文資料夾裡：
- 校對.json：老師的確認與修改（只記有動過的格子）
- 定稿.txt：套用修改後、依稿紙規則分段的全文（每次儲存都會更新）
老師改過的地方就是辨識錯的地方：完成校對的作文，評估工具會直接拿定稿當正確答案。

格子內容的寫法：
- 一個字或一個標點；行間補寫的字，直接接在插入點前一格的字後面（一格可以有好幾個字）
- 空字串：這一格其實是空白，或學生劃掉的字
- □：看不出來是什麼字
"""
import json
import os
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from . import fuse as F
from . import normalize as N
from . import prep

REVIEW_NAME = "校對.json"
FINAL_NAME = "定稿.txt"
REVIEW_FORMAT = 1
UNKNOWN = "□"
VIEW_PPM = 6.0                  # 校對畫面的圖：每 mm 像素
MARGIN_MM = 6.0                 # 作答格四周多留的範圍
MAX_CELL_TEXT = 12              # 一格最多幾個字（含行間補寫）
ATTENTION = ("single", "review")
SKIP_FOLDERS = {"未辨識"}


# ======================= 讀取 =======================

def resolve(root, essay_id):
    """篇名（相對於 root 的資料夾路徑）→ 資料夾。不允許跳出 root。"""
    root = Path(root).resolve()
    parts = str(essay_id or "").split("/")
    if not essay_id or "\\" in essay_id or any(p in ("", ".", "..") for p in parts):
        raise ValueError("篇名不正確")
    folder = (root / essay_id).resolve()
    if root not in folder.parents or not folder.is_dir() or not any(folder.glob("*_ocr.json")):
        raise ValueError("找不到這篇作文")
    return folder


def _fill_rects(ocr, warped, meta_path):
    """舊版的辨識結果沒有存每格的位置：重新做一次前處理補上（只在記憶體裡）。"""
    if all("rect" in c for c in ocr["cells"]):
        return
    meta = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    img = cv2.imdecode(np.fromfile(str(warped), np.uint8), cv2.IMREAD_COLOR)
    rects = {(c["col"], c["row"]): c["rect"] for c in prep.prepare(img, meta).cells}
    for c in ocr["cells"]:
        c.setdefault("rect", rects[(c["col"], c["row"])])


def load_pages(folder):
    pages = []
    for f in sorted(Path(folder).glob("*_ocr.json")):
        prefix = f.name[: -len("_ocr.json")]
        ocr = json.loads(f.read_text(encoding="utf-8"))
        warped = f.with_name(prefix + "_warped.png")
        _fill_rects(ocr, warped, f.with_name(prefix + "_meta.json"))
        pages.append({"prefix": prefix, "ocr": ocr, "warped": warped})
    pages.sort(key=lambda p: (p["ocr"]["page"].get("page", 0), p["prefix"]))
    return pages


def cell_key(prefix, c):
    return f"{prefix}:{c['col']}:{c['row']}"


def empty_review():
    return {"format": REVIEW_FORMAT, "done": False, "updated": None, "cells": {}}


def load_review(folder):
    p = Path(folder) / REVIEW_NAME
    if p.is_file():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("cells"), dict):
                return {**empty_review(), **data}
        except ValueError:
            pass
    return empty_review()


def progress(pages, review):
    need = [cell_key(p["prefix"], c) for p in pages for c in p["ocr"]["cells"] if c["status"] in ATTENTION]
    handled = sum(1 for k in need if k in review["cells"])
    edits = sum(1 for e in review["cells"].values() if e.get("action") == "edit")
    return {"attention": len(need), "handled": handled, "remaining": len(need) - handled, "edits": edits,
            "done": bool(review.get("done"))}


def list_essays(root):
    """root 底下每篇作文（含有 *_ocr.json 的資料夾）的校對進度。"""
    root = Path(root)
    if not root.is_dir():
        return []
    out = []
    for folder in sorted({p.parent for p in root.rglob("*_ocr.json")}):
        rel = folder.relative_to(root)
        if set(rel.parts) & SKIP_FOLDERS:
            continue
        pages = load_pages(folder)
        review = load_review(folder)
        out.append({"id": rel.as_posix(), "name": folder.name,
                    "group": rel.parent.as_posix() if rel.parent != Path(".") else "",
                    "pages": len(pages), "updated": review.get("updated"), **progress(pages, review)})
    return out


def _png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def _crop(ocr, size):
    """作答格範圍（加上邊界）在校正頁上的像素位置。"""
    ppm = float(ocr["page"].get("ppm", 10.0))
    rects = [c["rect"] for c in ocr["cells"]]
    m = MARGIN_MM * ppm
    W, H = size
    return (int(max(0, min(r[0] for r in rects) - m)), int(max(0, min(r[1] for r in rects) - m)),
            int(min(W, max(r[2] for r in rects) + m)), int(min(H, max(r[3] for r in rects) + m)))


def load_essay(root, essay_id):
    """校對畫面需要的資料：每頁的格子（位置以圖的比例表示）、辨識結果、老師的修改與目前的定稿。"""
    folder = resolve(root, essay_id)
    pages = load_pages(folder)
    review = load_review(folder)
    out = []
    for p in pages:
        ocr = p["ocr"]
        x0, y0, x1, y1 = _crop(ocr, _png_size(p["warped"]))
        cw, ch = x1 - x0, y1 - y0

        def box(r):
            return [round((r[0] - x0) / cw, 5), round((r[1] - y0) / ch, 5),
                    round((r[2] - r[0]) / cw, 5), round((r[3] - r[1]) / ch, 5)]

        cells = [{"key": cell_key(p["prefix"], c), "col": c["col"], "row": c["row"], "box": box(c["rect"]),
                  "text": c["text"], "status": c["status"], "kind": c["kind"], "reasons": c.get("reasons", []),
                  "engines": c.get("engines", {})} for c in ocr["cells"]]
        gaps = [{"box": box(i["rect"]), "text": i.get("text", ""), "from": i.get("from", "")}
                for i in ocr.get("insertions", []) if i.get("rect")]
        out.append({"prefix": p["prefix"], "page": ocr["page"].get("page"), "aspect": round(cw / ch, 5),
                    "cols": ocr["page"].get("cols"), "rows": ocr["page"].get("rows"), "cells": cells, "gaps": gaps})
    return {"id": essay_id, "name": folder.name, "pages": out, "review": review,
            "text": final_text(pages, review), "progress": progress(pages, review)}


def page_image(root, essay_id, prefix):
    """一頁作答格範圍的 JPEG（和校對畫面的格子位置對齊）。"""
    folder = resolve(root, essay_id)
    if not prefix or any(ch in prefix for ch in "/\\:") or ".." in prefix:
        raise ValueError("頁面不正確")
    ocr_path, warped = folder / f"{prefix}_ocr.json", folder / f"{prefix}_warped.png"
    if not ocr_path.is_file() or not warped.is_file():
        raise ValueError("找不到這一頁")
    ocr = json.loads(ocr_path.read_text(encoding="utf-8"))
    _fill_rects(ocr, warped, folder / f"{prefix}_meta.json")
    img = cv2.imdecode(np.fromfile(str(warped), np.uint8), cv2.IMREAD_COLOR)
    x0, y0, x1, y1 = _crop(ocr, (img.shape[1], img.shape[0]))
    f = VIEW_PPM / float(ocr["page"].get("ppm", 10.0))
    small = cv2.resize(img[y0:y1, x0:x1], None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    return cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes()


# ======================= 定稿 =======================

def apply(pages, review):
    """套用老師的修改，回傳修改後的各頁辨識結果（不動原檔）。"""
    out = []
    for p in pages:
        ocr = json.loads(json.dumps(p["ocr"]))
        for c in ocr["cells"]:
            e = review["cells"].get(cell_key(p["prefix"], c))
            if e and e.get("action") == "edit":
                c["text"] = e.get("text", "")
                c["status"] = "agree" if c["text"] else "blank"
        out.append(ocr)
    return out


def final_text(pages, review):
    return F.full_text(apply(pages, review))


# ======================= 儲存 =======================

def clean_review(data, valid_keys):
    """檢查網頁送來的校對資料：只接受這篇作文存在的格子，文字去掉空白、統一標點寫法、限制長度。"""
    if not isinstance(data, dict) or not isinstance(data.get("cells", {}), dict):
        raise ValueError("校對資料格式不正確")
    cells = {}
    for k, v in data.get("cells", {}).items():
        if k not in valid_keys or not isinstance(v, dict) or v.get("action") not in ("edit", "confirm"):
            continue
        entry = {"action": v["action"]}
        if v["action"] == "edit":
            entry["text"] = N.fold(str(v.get("text") or ""))[:MAX_CELL_TEXT]
        cells[k] = entry
    return {"format": REVIEW_FORMAT, "done": bool(data.get("done")),
            "updated": datetime.now().isoformat(timespec="seconds"), "cells": cells}


def save_review(root, essay_id, data):
    folder = resolve(root, essay_id)
    pages = load_pages(folder)
    keys = {cell_key(p["prefix"], c) for p in pages for c in p["ocr"]["cells"]}
    review = clean_review(data, keys)
    tmp = folder / (REVIEW_NAME + ".tmp")
    tmp.write_text(json.dumps(review, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, folder / REVIEW_NAME)                    # 先寫暫存檔再取代：存到一半不會壞掉
    text = final_text(pages, review)
    (folder / FINAL_NAME).write_text(text + "\n", encoding="utf-8")
    return {"review": review, "text": text, "progress": progress(pages, review)}
