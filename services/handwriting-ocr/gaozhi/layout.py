"""稿紙幾何：格子座標、定位標記位置。所有長度單位皆為 mm，原點在頁面左上角。

這個模組不碰 PDF，之後的掃描定位／OCR 流程也會共用它，確保「生成」與「辨識」用同一套座標。
"""
import json
from pathlib import Path

import cv2
import numpy as np

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"

ARUCO_DICT_ID = cv2.aruco.DICT_4X4_250
MARKER_SIZE = 6.0      # 定位標記邊長
MARKER_MARGIN = 5.0    # 第 1 版標記與紙張邊緣的距離（2026-10 以前印的稿紙）
MARKER_QUIET = 1.0     # 標記周圍需保持空白的寬度
# 第 2 版：實際列印發現有的印表機上下緣約 6mm 印不到，第 1 版標記的外圈會被切掉一排。
# 新稿紙的標記離紙邊 8mm；某個角落會碰到作答格時，那個角落往外退到不碰為止（最少 5mm）。
# 第 2 版用另一組 ID，掃描時看 ID 就知道標記在哪個位置，舊稿紙照樣能讀。
MARKER_MARGIN_V2 = 8.0
MARKER_MARGIN_MIN = 5.0
MARKER_FRAME_GAP = 3.0  # 第 2 版標記和作答格外框至少隔這麼遠（辨識裁切格子時多留 2mm 邊，不會切到標記）
MARKER_V2_OFFSET = 128
# 第 3 版（2026-11-19）：油印、影印時紙邊常被裁掉幾 mm，第 2 版離紙邊 8mm 的標記有時會被裁到。
# 樣式寫了 marker_margins（每種紙張四角都離紙邊幾 mm）時，新稿紙改用第 3 版：格子大小、位置都不動，只把標記往內移。
# 第 3 版用另一組 ID（再加 MARKER_V3_OFFSET；樣式代號 0～3 剛好用到 127，不會和第 2 版重疊），
# 掃描時看 ID 就知道標記在哪，已經印出去的第 1、2 版稿紙照樣能讀。
MARKER_V3_OFFSET = 64
# 第 4 版（聯合報雲寫作教室，2026-11-20）：聯合報自己的稿紙版型（例如聯合報國中寫作稿紙）專用的一組 ID。
# 第 1～3 版的樣式代號 0～3 已經被 1Campus 的會考、學測、英文稿紙用完，再加會和別版重疊；
# 字典 DICT_4X4_250 還剩 192～249，所以另開一版：樣式代號 4～6（每份 16 個 ID → 192～239），四角邊距同第 3 版看 marker_margins。
# 掃描時看 ID 就知道是聯合報的版型，和 1Campus 的稿紙不會互相認錯。
MARKER_V4_OFFSET = 192
MARKER_V4_CODES = range(4, 7)
MARKER_VERSION = 2     # 新產生的稿紙用的版本（樣式有 marker_margins 時用第 3 版，見 template_marker_version）
CORNERS = ("tl", "tr", "br", "bl")

# 身分碼（QR，版本 1 = 21×21 模組）：生成與掃描共用同一套幾何
IDCODE_SIZE = 18.0      # 預設邊長（mm，樣式原始尺寸）
IDCODE_MODULES = 21
IDCODE_QUIET = 4        # QR 四周必須留白的模組數


def idcode_square(e):
    """身分碼 QR 本體 (x0, y0, x1, y1)，樣式原始 mm。"""
    s = e.get("size", IDCODE_SIZE)
    return (e["x"], e["y"], e["x"] + s, e["y"] + s)


def idcode_quiet_rect(e):
    """QR 本體加上四周留白區。"""
    s = e.get("size", IDCODE_SIZE)
    q = IDCODE_QUIET * s / IDCODE_MODULES
    x0, y0, x1, y1 = idcode_square(e)
    return (x0 - q, y0 - q, x1 + q, y1 + q)


# 座號劃記（全班同一張稿紙時，學生自己寫座號並塗卡）：生成與掃描共用同一套幾何
SEATMARK_SIZE = 4.0     # 圓圈直徑（mm，樣式原始尺寸）
SEATMARK_MAX_TENS = 9   # 十位 0～9（最多 99 號）。外框本來就照個位的 10 個圓圈留位置，十位補滿不會變大（2026-11-26 跟進 1Campus，原本到 5）


def seatmark_geometry(e):
    """座號劃記的每個部分（樣式原始 mm）。

    orient="row"（橫式表頭）：左上兩格手寫座號，下面一排十位圓圈、一排個位圓圈。
    orient="col"（直式表頭）：上面兩格手寫座號，十位、個位圓圈各一直行，分別在左格、右格下面。
    回傳 {"bubbles": [{"place": "tens"/"ones", "value", "cx", "cy", "r"}], "boxes": {"tens": 矩形, "ones": 矩形},
          "texts": [{"text", "x", "y", "w", "size"(pt)}], "bbox": 矩形}。
    """
    x, y = e["x"], e["y"]
    d = e.get("size", SEATMARK_SIZE)
    max_tens = max(1, min(9, int(e.get("max_tens", SEATMARK_MAX_TENS))))
    p, bs, lw = 1.5 * d, 2.2 * d, 1.8 * d          # 圓圈間距、手寫格邊長、標籤寬
    pt = round(d * 1.9, 1)                         # 標籤字級（pt）
    bubbles, texts = [], []
    if e.get("orient", "row") == "col":
        texts.append({"text": "座號", "x": x, "y": y, "w": 2 * bs, "size": pt})
        by = y + lw
        boxes = {"tens": (x, by, x + bs, by + bs), "ones": (x + bs, by, x + 2 * bs, by + bs)}
        ly = by + bs + 0.3 * d
        texts += [{"text": "十位", "x": x, "y": ly, "w": bs, "size": pt * 0.8},
                  {"text": "個位", "x": x + bs, "y": ly, "w": bs, "size": pt * 0.8}]
        top = ly + 0.9 * lw
        for place, cx, n in (("tens", x + bs / 2, max_tens + 1), ("ones", x + 1.5 * bs, 10)):
            bubbles += [{"place": place, "value": k, "cx": cx, "cy": top + p * (k + 0.5), "r": d / 2} for k in range(n)]
        bbox = (x, y, x + 2 * bs, top + 10 * p)
    else:
        boxes = {"tens": (x + lw, y, x + lw + bs, y + bs), "ones": (x + lw + bs, y, x + lw + 2 * bs, y + bs)}
        texts.append({"text": "座號", "x": x, "y": y + bs / 2 - d * 0.35, "w": lw, "size": pt})
        texts.append({"text": "請寫座號，並把十位、個位各塗黑一格", "x": x + lw + 2 * bs + 0.5 * d,
                      "y": y + bs / 2 - d * 0.3, "w": 10 * p - 2 * bs - 0.5 * d, "size": pt * 0.75, "align": "left"})
        for place, row, n in (("tens", 0, max_tens + 1), ("ones", 1, 10)):
            cy = y + bs + 0.5 * d + p * (row + 0.5)
            texts.append({"text": "十位" if place == "tens" else "個位", "x": x, "y": cy - d * 0.35, "w": lw,
                          "size": pt * 0.8})
            bubbles += [{"place": place, "value": k, "cx": x + lw + p * (k + 0.5), "cy": cy, "r": d / 2} for k in range(n)]
        bbox = (x, y, x + lw + 10 * p, y + bs + 0.5 * d + 2 * p)
    return {"bubbles": bubbles, "boxes": boxes, "texts": texts, "bbox": bbox}


# 身分劃記（考試版稿紙，全年級同一張）：學生劃年級、班序、座號。生成與掃描共用同一套幾何。
IDMARK_SIZE = 4.0
IDMARK_FIELDS = ("grade", "class", "seat")
IDMARK_LABELS = {"grade": "年級", "class": "班級", "seat": "座號"}


def idmark_geometry(e):
    """身分劃記的每個部分（樣式原始 mm）。

    年級：3 個圓圈（只塗卡，旁邊印的字由 e["grade_words"] 決定，例如 七八九／一二三；值記成 1～3）。
    班級（班序）、座號：各兩格手寫＋十位、個位圓圈。班級十位最多到 e["class_max_tens"]，座號十位最多到 5。
    orient="col"（直式表頭）：第一排年級；下面班級、座號並排，圓圈各成直行。
    orient="row"（橫式表頭）：年級、班級、座號由左到右排開，圓圈各成橫列。
    回傳 {"bubbles": [{"field", "place"("grade"/"tens"/"ones"), "value", "cx", "cy", "r", "label"}],
          "boxes": {(field, place): 矩形}, "texts": [...], "bbox": 矩形}。
    """
    x, y = e["x"], e["y"]
    d = e.get("size", IDMARK_SIZE)
    words = list(e.get("grade_words") or ("1", "2", "3"))[:3]
    tens_max = {"class": max(0, min(9, int(e.get("class_max_tens", 2)))), "seat": SEATMARK_MAX_TENS}
    p, bs, lh = 1.5 * d, 2.2 * d, 1.8 * d          # 圓圈間距、手寫格邊長、標籤高（寬）
    pt = round(d * 1.9, 1)
    bubbles, texts, boxes = [], [], {}

    def bubble(field, place, value, cx, cy, label=None):
        bubbles.append({"field": field, "place": place, "value": value, "cx": cx, "cy": cy, "r": d / 2,
                        "label": str(value) if label is None else label})

    if e.get("orient", "col") == "col":
        width = 4 * bs + 0.6 * d
        texts.append({"text": "年級", "x": x, "y": y + p / 2 - d * 0.35, "w": 2.4 * d, "size": pt})
        for k in range(3):
            bubble("grade", "grade", k + 1, x + 2.4 * d + p * (k + 0.5), y + p / 2, words[k])
        y2 = y + p + 0.5 * d
        by = y2 + lh
        ly = by + bs + 0.3 * d
        top = ly + 0.9 * lh
        for field, gx in (("class", x), ("seat", x + 2 * bs + 0.6 * d)):
            texts.append({"text": IDMARK_LABELS[field], "x": gx, "y": y2, "w": 2 * bs, "size": pt})
            boxes[(field, "tens")] = (gx, by, gx + bs, by + bs)
            boxes[(field, "ones")] = (gx + bs, by, gx + 2 * bs, by + bs)
            texts += [{"text": "十位", "x": gx, "y": ly, "w": bs, "size": pt * 0.8},
                      {"text": "個位", "x": gx + bs, "y": ly, "w": bs, "size": pt * 0.8}]
            for place, cx, n in (("tens", gx + bs / 2, tens_max[field] + 1), ("ones", gx + 1.5 * bs, 10)):
                for k in range(n):
                    bubble(field, place, k, cx, top + p * (k + 0.5))
        bbox = (x, y, x + width, top + 10 * p)
    else:
        gap = 1.2 * d
        texts.append({"text": "年級", "x": x, "y": y + bs / 2 - d * 0.35, "w": 3 * p, "size": pt})
        row1 = y + bs + 0.5 * d + p / 2
        for k in range(3):
            bubble("grade", "grade", k + 1, x + p * (k + 0.5), row1, words[k])
        gx = x + 3 * p + gap
        for field in ("class", "seat"):
            texts.append({"text": IDMARK_LABELS[field], "x": gx, "y": y + bs / 2 - d * 0.35, "w": lh, "size": pt})
            boxes[(field, "tens")] = (gx + lh, y, gx + lh + bs, y + bs)
            boxes[(field, "ones")] = (gx + lh + bs, y, gx + lh + 2 * bs, y + bs)
            hint = "寫兩位數字，再把十位、個位各塗黑一格" if field == "class" else "例：5 號寫 0 5"
            texts.append({"text": hint, "x": gx + lh + 2 * bs + 0.5 * d, "y": y + bs / 2 - d * 0.3,
                          "w": 10 * p - 2 * bs - 0.5 * d, "size": pt * 0.75, "align": "left"})
            for place, cy, n in (("tens", row1, tens_max[field] + 1), ("ones", row1 + p, 10)):
                texts.append({"text": "十位" if place == "tens" else "個位", "x": gx, "y": cy - d * 0.35, "w": lh,
                              "size": pt * 0.8})
                for k in range(n):
                    bubble(field, place, k, gx + lh + p * (k + 0.5), cy)
            gx += lh + 10 * p + gap
        bbox = (x, y, gx - gap, y + bs + 0.5 * d + 2 * p)
    return {"bubbles": bubbles, "boxes": boxes, "texts": texts, "bbox": bbox}


def idhand_geometry(e):
    """背面的手寫班級、座號（雙面考試版稿紙）：「班級」兩格＋「座號」兩格，只手寫不塗卡，用來和正面核對。"""
    x, y = e["x"], e["y"]
    d = e.get("size", IDMARK_SIZE)
    bs, lw, gap = 2.2 * d, 2.0 * d, 1.2 * d
    pt = round(d * 1.9, 1)
    boxes, texts, gx = {}, [], x
    if e.get("orient") == "col":                    # 直式：標籤在上，班級、座號上下排
        gy = y
        for field in ("class", "seat"):
            texts.append({"text": IDMARK_LABELS[field], "x": x, "y": gy, "w": 2 * bs, "size": pt})
            gy += 1.8 * d
            boxes[(field, "tens")] = (x, gy, x + bs, gy + bs)
            boxes[(field, "ones")] = (x + bs, gy, x + 2 * bs, gy + bs)
            gy += bs + gap
        texts.append({"text": "（和正面\n寫的一樣）", "x": x, "y": gy - gap + 0.4 * d, "w": 2 * bs, "size": pt * 0.7})
        return {"boxes": boxes, "texts": texts, "bbox": (x, y, x + 2 * bs, gy - gap + 0.4 * d + 2 * pt * 0.7 / 2.835 * 1.3)}
    for field in ("class", "seat"):
        texts.append({"text": IDMARK_LABELS[field], "x": gx, "y": y + bs / 2 - d * 0.35, "w": lw, "size": pt})
        boxes[(field, "tens")] = (gx + lw, y, gx + lw + bs, y + bs)
        boxes[(field, "ones")] = (gx + lw + bs, y, gx + lw + 2 * bs, y + bs)
        gx += lw + 2 * bs + gap
    right = gx - gap
    texts.append({"text": "（和正面寫的一樣）", "x": x, "y": y + bs + 0.4 * d, "w": right - x, "size": pt * 0.75})
    return {"boxes": boxes, "texts": texts, "bbox": (x, y, right, y + bs + 0.4 * d + pt * 0.75 / 2.835 * 1.3)}


# 支援的輸出紙張（mm，橫向）。A3 與 JIS B4 長寬比幾乎相同，可像影印機 86%／115% 縮放般整頁等比例轉換。
PAPERS = {"A3": (420.0, 297.0), "B4": (364.0, 257.0)}
PAPER_CODES = {"A3": 0, "B4": 1}


def list_templates():
    return sorted(p.stem for p in TEMPLATE_DIR.glob("*.json"))


def load_template(tid):
    path = TEMPLATE_DIR / f"{tid}.json"
    if not path.exists():
        raise FileNotFoundError(f"找不到稿紙樣式 '{tid}'，可用：{', '.join(list_templates())}")
    return json.loads(path.read_text(encoding="utf-8"))


def grid_columns(g):
    """回傳每一行（直行）的 (左, 右) x 座標，由左到右排列。"""
    extra = {b["after"]: b["extra"] for b in g.get("breaks", [])}
    cols, x = [], g["x0"]
    for i in range(g["cols"]):
        cols.append((x, x + g["cell_w"]))
        x += g["col_pitch"] + extra.get(i + 1, 0.0)
    return cols


def grid_rows(g):
    return [(g["y0"] + j * g["cell_h"], g["y0"] + (j + 1) * g["cell_h"]) for j in range(g["rows"])]


def grid_frame(g):
    cols, rows = grid_columns(g), grid_rows(g)
    right = cols[-1][1]
    if g.get("trailing_gutter"):
        right += g["col_pitch"] - g["cell_w"]
    return (cols[0][0], rows[0][0], right, rows[-1][1])


def grid_cells(g):
    """依直書閱讀順序（由右而左、由上而下）列出所有格子。

    col 從 1 起算，1 = 最右邊（第一行）；row 從 1 起算，1 = 最上面。
    """
    cols = list(reversed(grid_columns(g)))
    rows = grid_rows(g)
    cells = []
    for ci, (x0, x1) in enumerate(cols, 1):
        for ri, (y0, y1) in enumerate(rows, 1):
            cells.append({"col": ci, "row": ri, "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0})
    return cells


def native_paper(tpl):
    """樣式原始的紙張名稱。"""
    w, h = tpl["paper_mm"]
    for name, (pw, ph) in PAPERS.items():
        if abs(pw - w) < 1 and abs(ph - h) < 1:
            return name
    raise ValueError(f"樣式 {tpl['id']} 的紙張 {w}×{h}mm 不在支援清單 {list(PAPERS)}")


def paper_transform(tpl, paper=None):
    """原始樣式座標 → 目標紙張座標：x' = ox + s·x，y' = oy + s·y（等比例縮放並置中）。"""
    paper = paper or native_paper(tpl)
    if paper not in PAPERS:
        raise ValueError(f"不支援的紙張 '{paper}'，可用：{', '.join(PAPERS)}")
    W, H = PAPERS[paper]
    w, h = tpl["paper_mm"]
    s = min(W / w, H / h)
    return {"paper": paper, "paper_mm": [W, H], "scale": s, "ox": (W - w * s) / 2, "oy": (H - h * s) / 2}


VERSION_OFFSETS = {1: 0, 2: MARKER_V2_OFFSET, 3: MARKER_V3_OFFSET, 4: MARKER_V4_OFFSET}


def marker_id(marker_code, paper, page_index, corner_index, version=1):
    """每份樣式 16 個 ID：紙張(A3/B4) × 頁(0/1) × 角落(tl,tr,br,bl)。第 2、3 版再加各自的 offset。
    第 4 版（聯合報）只給樣式代號 4～6，在自己的 offset 裡從 0 算起。"""
    if version == 4:
        if marker_code not in MARKER_V4_CODES:
            raise ValueError("第 4 版定位標記只給樣式代號 4～6（聯合報的版型）")
        code = marker_code - MARKER_V4_CODES[0]
    elif marker_code > 3:
        raise ValueError("樣式代號 0～3 才能用第 1～3 版定位標記：再大第 1 版的 ID 會和第 3 版重疊")
    else:
        code = marker_code
    mid = ((code * 2 + PAPER_CODES[paper]) * 2 + page_index) * 4 + corner_index
    return mid + VERSION_OFFSETS[version]


def decode_marker_id(mid):
    version = 4 if mid >= MARKER_V4_OFFSET else 2 if mid >= MARKER_V2_OFFSET else 3 if mid >= MARKER_V3_OFFSET else 1
    m = mid - VERSION_OFFSETS[version]
    paper = {v: k for k, v in PAPER_CODES.items()}[(m // 8) % 2]
    code = m // 16 + (MARKER_V4_CODES[0] if version == 4 else 0)
    return {"marker_code": code, "paper": paper, "page_index": (m // 4) % 2, "corner": CORNERS[m % 4],
            "version": version}


def _corner_margins(paper, size, frame):
    """第 2 版：每個角落的 (左右, 上下) 邊距。優先 8mm；離作答格不到 MARKER_FRAME_GAP 時，找「較小邊距最大」的位置；
    怎麼放都不夠遠時，退而求其次只要求 MARKER_QUIET 的留白。"""
    W, H = PAPERS[paper]
    steps = np.arange(MARKER_MARGIN_V2, MARKER_MARGIN_MIN - 1e-9, -0.5)
    out = {}
    for name in CORNERS:
        best = None
        for gap in (MARKER_FRAME_GAP, MARKER_QUIET):
            for mx in steps:
                for my in steps:
                    x = mx if name in ("tl", "bl") else W - mx - size
                    y = my if name in ("tl", "tr") else H - my - size
                    if frame is not None and rects_overlap((x, y, x + size, y + size), frame, pad=gap):
                        continue
                    key = (min(mx, my), mx + my)
                    if best is None or key > best[0]:
                        best = (key, float(mx), float(my))
            if best:
                break
        out[name] = (best[1], best[2]) if best else (MARKER_MARGIN_MIN, MARKER_MARGIN_MIN)
    return out


def template_marker_version(tpl):
    """這份樣式新產生的稿紙用第幾版定位標記：聯合報的版型（樣式代號 4～6）用第 4 版（四角邊距看 marker_margins），
    有 marker_margins 的用第 3 版，其他照 MARKER_VERSION。"""
    if tpl.get("marker_code", 0) in MARKER_V4_CODES:
        return 4
    return 3 if tpl.get("marker_margins") else MARKER_VERSION


def template_marker_versions(tpl):
    """這份樣式的稿紙可能印著哪幾版定位標記（掃描時的候選；越少越不容易認錯）。"""
    v = template_marker_version(tpl)
    return (4,) if v == 4 else (1, 2, 3) if v == 3 else (1, 2)


def page_markers(paper, marker_code, page_index, size=MARKER_SIZE, margin=MARKER_MARGIN, version=1, frame=None):
    """定位標記固定放在目標紙張四角（不隨版面縮放），確保印得到、大小一致。

    version=1、3、4：四角都離紙邊 margin（第 3、4 版的 margin 是樣式的 marker_margins）。
    version=2：見 MARKER_MARGIN_V2（frame：作答格外框，避開用）。
    """
    W, H = PAPERS[paper]
    if version == 2:
        mg = _corner_margins(paper, size, frame)
    else:
        mg = {name: (margin, margin) for name in CORNERS}
    pos = {"tl": (mg["tl"][0], mg["tl"][1]), "tr": (W - mg["tr"][0] - size, mg["tr"][1]),
           "br": (W - mg["br"][0] - size, H - mg["br"][1] - size), "bl": (mg["bl"][0], H - mg["bl"][1] - size)}
    out = []
    for ci, name in enumerate(CORNERS):
        x, y = pos[name]
        out.append({
            "id": marker_id(marker_code, paper, page_index, ci, version), "corner": name,
            "x": x, "y": y, "size": size,
            # 標記四角，順序與 OpenCV ArUco 偵測結果一致（左上、右上、右下、左下）
            "corners": [[x, y], [x + size, y], [x + size, y + size], [x, y + size]],
        })
    return out


def marker_bits(mid):
    """回傳 6×6 布林陣列（含 1 格黑邊），True = 黑。"""
    d = cv2.aruco.getPredefinedDictionary(ARUCO_DICT_ID)
    img = cv2.aruco.generateImageMarker(d, mid, 6, borderBits=1)
    return img < 128


def page_layout(tpl, page_index, paper=None, marker_version=None):
    """單頁的完整定位資料（給 OCR 流程使用），座標已換算到目標紙張。

    marker_version：定位標記的版本（省略＝新產生的稿紙用的 template_marker_version；掃描時依讀到的標記 ID 決定）。
    """
    if marker_version is None:
        marker_version = template_marker_version(tpl)
    page = tpl["pages"][page_index]
    g = page["grid"]
    t = paper_transform(tpl, paper)
    k, ox, oy = t["scale"], t["ox"], t["oy"]
    fx0, fy0, fx1, fy1 = grid_frame(g)
    cells = []
    for c in grid_cells(g):
        cells.append({"col": c["col"], "row": c["row"],
                      "x": round(ox + k * c["x"], 3), "y": round(oy + k * c["y"], 3),
                      "w": round(k * c["w"], 3), "h": round(k * c["h"], 3)})
    frame = [round(v, 3) for v in (ox + k * fx0, oy + k * fy0, ox + k * fx1, oy + k * fy1)]
    return {
        "page": page_index + 1,
        "label": page.get("label", ""),
        "paper": t["paper"],
        "paper_mm": t["paper_mm"],
        "scale_from_template": round(k, 5),
        "grid_frame": frame,
        "cols": g["cols"], "rows": g["rows"],
        "marker_version": marker_version,
        "markers": page_markers(t["paper"], tpl["marker_code"], page_index, version=marker_version, frame=frame,
                                margin=_v3_margin(tpl, t["paper"]) if marker_version in (3, 4) else MARKER_MARGIN),
        "cells": cells,
    }


def template_marker_papers(tpl):
    """這份樣式的第 3、4 版定位標記有定義在哪些紙張上（掃描時對不上的票直接跳過）。"""
    return list((tpl.get("marker_margins") or {}).keys())


def _v3_margin(tpl, paper):
    margins = tpl.get("marker_margins") or {}
    if paper not in margins:
        raise ValueError(f"樣式 {tpl['id']} 沒有 {paper} 的第 3、4 版定位標記邊距（marker_margins）")
    return float(margins[paper])


def rects_overlap(a, b, pad=0.0):
    return not (a[2] + pad <= b[0] or b[2] + pad <= a[0] or a[3] + pad <= b[1] or b[3] + pad <= a[1])


def homography_from_markers(detected, layout, px_per_mm):
    """detected: {marker_id: 4x2 角點(px)}；回傳 掃描影像 → 標準頁面(px_per_mm) 的單應矩陣。"""
    src, dst = [], []
    for m in layout["markers"]:
        if m["id"] in detected:
            src.extend(detected[m["id"]])
            dst.extend([[x * px_per_mm, y * px_per_mm] for x, y in m["corners"]])
    if len(src) < 8:  # 至少兩個標記
        return None
    Hm, _ = cv2.findHomography(np.float32(src), np.float32(dst), cv2.RANSAC, 3.0)
    return Hm
