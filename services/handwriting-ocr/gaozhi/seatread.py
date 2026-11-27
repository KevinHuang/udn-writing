"""稿紙的座號劃記：判讀學生塗的座號（整疊掃描時自動認人用）。

2026-11-27 從 1Campus Write 的 feat/batch-scan（22d5671）搬來；它移植自原型專案的 gaozhi/seatread.py
（塗卡那一半；手寫座號送 AI 核對還沒決定，先不搬）。聯合報這邊多了國中稿紙、聯合盃稿紙的設定。
在拉正的頁面上量每個圓圈內圈的墨跡比例，同一排用中位數當基準：印的黑框、圓圈裡的數字、掃描太黑都會被扣掉。
十位、個位各要「明顯只有一格塗黑」才算讀到；寧可請老師看，也不要分錯人。

座號劃記的位置照 gaozhi/sheet.py 的 SEATMARKS（稿紙的表頭位置固定，不必另存表頭設定）。
"""
import cv2
import numpy as np

from . import layout as L
from . import sheet

INK = 0.45            # 比紙暗這麼多才算筆跡
FILLED = 0.35         # 圓圈內圈有這個比例是筆跡（扣掉同一排的基準）才算塗了
EMPTY = 0.15          # 低於這個算沒塗；介於兩者之間算「看不清」
INNER = 0.7           # 只看圓圈內圈（半徑的 70%），避開印的外框

# 哪一種稿紙的第幾頁有座號劃記（page_index 0 起算）。會考只有第 1 頁有；學測每一題那一頁的左上角都可能有
# （兩題都印時第二大題那一頁沒有，讀起來就是「沒塗」）。
# 聯合報國中稿紙只有第 1 頁有；聯合盃稿紙沒有座號劃記（不在這裡），由老師看表頭截圖指定。
SEAT_PAGES = {"cap": {0}, "gsat": {0, 1}, "udn": {0}}

# 給老師核對的表頭截圖（樣式原始 mm）：格式 → {第幾頁（0 起算）: [範圍]}。座號劃記加上旁邊的姓名、班級欄。
# 國中稿紙：座號劃記（格子上方靠右）、原稿紙右下的填寫欄（學校、年級、班別、座號、姓名、日期）。
# 聯合盃：只有第 1 頁右下的入場證號碼（sheet.UCUP_PAGE1 往上移 8mm 之後的位置）。
_CAP = [(320.0, 126.0, 358.0, 222.0)]
_GSAT = [(16.0, 12.0, 90.0, 42.0), (285.0, 22.0, 398.0, 40.0)]
CROPS = {"cap": {0: _CAP},
         "gsat": {0: _GSAT, 1: _GSAT},
         "udn": {0: [(246.0, 6.0, 321.0, 35.0), (333.0, 186.0, 409.0, 266.0)]},
         "ucup": {0: [(306.0, 220.0, 358.0, 245.0)]}}
CROP_PPM = 6.0        # 截圖解析度（像素／mm）
CROP_QUALITY = 80


def has_seatmark(template_id, page_index):
    return page_index in SEAT_PAGES.get(template_id, set())


def paper_geometry(template, paper):
    """這種稿紙的座號劃記換算到目標紙張 mm（和拉正的頁面同一個座標）。"""
    e = sheet.SEATMARKS[template["id"]]
    t = L.paper_transform(template, paper)
    k, ox, oy = t["scale"], t["ox"], t["oy"]
    g = L.seatmark_geometry(e)
    tr = lambda r: (ox + k * r[0], oy + k * r[1], ox + k * r[2], oy + k * r[3])    # noqa: E731
    return {"bubbles": [{**b, "cx": ox + k * b["cx"], "cy": oy + k * b["cy"], "r": k * b["r"]} for b in g["bubbles"]],
            "boxes": {p: tr(r) for p, r in g["boxes"].items()}, "bbox": tr(g["bbox"])}


def _ink(warped, ppm):
    m = cv2.min(cv2.min(warped[:, :, 0], warped[:, :, 1]), warped[:, :, 2]) if warped.ndim == 3 else warped
    m = cv2.GaussianBlur(m, (0, 0), 0.25 * ppm).astype(np.float32)       # 0.25mm：雷射印表機的灰色網點平均掉
    paper = float(np.percentile(m[::4, ::4], 90))
    return (paper - m) / max(paper, 1.0) > INK


def _fill(ink, b, ppm):
    r = INNER * b["r"] * ppm
    cx, cy = b["cx"] * ppm, b["cy"] * ppm
    x0, x1 = int(cx - r), int(cx + r) + 1
    y0, y1 = int(cy - r), int(cy + r) + 1
    if x0 < 0 or y0 < 0 or x1 > ink.shape[1] or y1 > ink.shape[0]:
        return 0.0
    Y, X = np.ogrid[y0:y1, x0:x1]
    disc = (X - cx) ** 2 + (Y - cy) ** 2 <= r * r
    return float(ink[y0:y1, x0:x1][disc].mean())


def _place(vals):
    """一排圓圈的塗黑比例 → {"state", "value"?, "fills"}。"""
    v = np.array([x for _, x in vals])
    base = float(np.median(v))                    # 大部分格子沒塗：用中位數當基準
    ex = v - base
    order = np.argsort(ex)[::-1]
    best, second = ex[order[0]], (ex[order[1]] if len(ex) > 1 else 0.0)
    out = {"fills": [round(float(x), 2) for x in v]}
    if best >= FILLED and second >= FILLED:
        out["state"] = "double"
    elif best >= FILLED and second < EMPTY:
        out.update(state="clear", value=vals[order[0]][0])
    elif best < EMPTY:
        out["state"] = "blank"
    else:
        out["state"] = "unclear"
    return out


def read_bubbles(warped, geo, ppm=10.0):
    """塗卡 → {"state": clear/blank/double/unclear, "seat", "tens", "ones"}。
    十位沒塗、個位清楚時當作十位是 0（例如 5 號只塗個位）。"""
    ink = _ink(warped, ppm)
    res = {}
    for place in ("tens", "ones"):
        vals = [(b["value"], _fill(ink, b, ppm)) for b in geo["bubbles"] if b["place"] == place]
        res[place] = _place(vals)
    t, o = res["tens"], res["ones"]
    if o["state"] == "clear" and t["state"] in ("clear", "blank"):
        seat = (t.get("value", 0)) * 10 + o["value"]
        res.update(state="clear" if seat > 0 else "unclear", seat=seat if seat > 0 else None)
    else:
        bad = [s for s in (t["state"], o["state"]) if s != "clear"]
        state = "double" if "double" in bad else ("blank" if all(s == "blank" for s in bad) else "unclear")
        res.update(state=state, seat=None)
    return res


def header_crops(warped, template, paper, page_index=0, ppm=10.0):
    """表頭截圖（JPEG bytes 的清單）：老師在核對畫面看學生寫的姓名、座號。這一頁沒有表頭時是空清單。"""
    t = L.paper_transform(template, paper)
    k, ox, oy = t["scale"], t["ox"], t["oy"]
    out = []
    for x0, y0, x1, y1 in CROPS.get(template["id"], {}).get(page_index, []):
        X0, Y0 = max(0, int((ox + k * x0) * ppm)), max(0, int((oy + k * y0) * ppm))
        X1, Y1 = min(warped.shape[1], int((ox + k * x1) * ppm)), min(warped.shape[0], int((oy + k * y1) * ppm))
        if X1 <= X0 or Y1 <= Y0:
            continue
        crop = warped[Y0:Y1, X0:X1]
        s = CROP_PPM / ppm
        crop = cv2.resize(crop, (max(1, round(crop.shape[1] * s)), max(1, round(crop.shape[0] * s))),
                          interpolation=cv2.INTER_AREA)
        out.append(cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, CROP_QUALITY])[1].tobytes())
    return out


def blank_page(img):
    """找不到定位標記的頁是不是空白頁（掃描機多掃到的白紙）：幾乎沒有深色的地方。"""
    g = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    s = 800 / max(g.shape[:2])
    if s < 1:
        g = cv2.resize(g, (max(1, round(g.shape[1] * s)), max(1, round(g.shape[0] * s))), interpolation=cv2.INTER_AREA)
    paper = float(np.percentile(g, 90))
    dark = (paper - g.astype(np.float32)) / max(paper, 1.0) > 0.35
    return float(dark.mean()) < 0.003
