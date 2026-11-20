"""格子前處理：依實際格線定位每一格、去除格線、量墨量，判斷每格是空白／字／標點／塗改。

輸入是 locate.py 校正後的頁面（每 mm ppm 像素，座標與樣式定義一致）與該頁的 meta；
輸出 PreparedPage：每一格在影像上的位置（已依實際格線微調）、類別與墨量、行間可能的補寫，
以及去除格線後的灰階影像（給辨識引擎用）。
"""
from dataclasses import dataclass, field

import cv2
import numpy as np

from .. import layout as L

DEFAULTS = {
    "snap_mm": 1.5,          # 格線位置微調的搜尋範圍（mm）
    "line_kernel_mm": 3.0,   # 長度超過此值的直線才當成格線
    "line_band_mm": 0.6,     # 只在格線附近這個寬度內去線，不動到遠處的筆畫
    "ink_delta": 0.35,       # 比紙色暗這個比例以上才算墨跡
    "inset": 0.08,           # 量墨量時每格內縮的比例（避開殘留格線）
    "speck_mm2": 0.15,       # 小於此面積的墨點視為雜點
    "blank_ink_max": 0.004,  # 墨量比例低於此值 → 空白
    "mark_box_max": 0.45,    # 墨跡外框最長邊小於格寬的此比例 → 像標點
    "dense_ink_min": 0.35,   # 墨量比例高於此值 → 可能塗改
    "gap_ink_min": 0.02,     # 行間空隙的墨量高於此值 → 可能補寫
}
KIND_NAMES = {"blank": "空白", "char": "字", "mark": "標點類", "dense": "可能塗改"}


@dataclass
class PreparedPage:
    meta: dict
    ppm: float
    image: np.ndarray            # 校正後原圖（BGR 或灰階）
    clean: np.ndarray            # 去除格線後的灰階
    line_mask: np.ndarray        # 被當成格線去掉的像素
    paper_level: float           # 紙張亮度
    cols: dict                   # col → (x0, x1) 像素（微調後）
    rows: dict                   # row → (y0, y1) 像素（微調後）
    frame: tuple                 # 作答格外框 (x0, y0, x1, y1) 像素
    cells: list                  # 每格：col,row,rect,kind,ink,box
    gaps: list = field(default_factory=list)   # 行間可能的補寫
    _index: dict = field(default_factory=dict, repr=False)

    def __post_init__(self):
        self._index = {(c["col"], c["row"]): c for c in self.cells}

    def cell(self, col, row):
        return self._index.get((col, row))

    def column_cells(self, col):
        return [c for c in self.cells if c["col"] == col]

    def nonblank_rows(self, col):
        return [c["row"] for c in self.column_cells(col) if c["kind"] != "blank"]

    def to_json(self):
        return {"meta": self.meta, "ppm": self.ppm, "paper_level": round(self.paper_level, 1),
                "frame": list(self.frame), "cols": {str(k): list(v) for k, v in self.cols.items()},
                "rows": {str(k): list(v) for k, v in self.rows.items()},
                "cells": self.cells, "gaps": self.gaps}


def _gray(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img


def _snap(profile, expected, window, min_strength):
    """在 expected ± window 內找格線最強的位置（取峰值附近的加權中心）；找不到就用原位置。"""
    lo, hi = max(0, int(expected - window)), min(len(profile), int(expected + window) + 1)
    if hi <= lo:
        return float(expected)
    seg = profile[lo:hi]
    i = int(np.argmax(seg))
    if seg[i] < min_strength:
        return float(expected)
    a, b = max(0, i - 2), min(len(seg), i + 3)
    w = seg[a:b].astype(float)
    return float(lo + (w * np.arange(a, b)).sum() / w.sum()) if w.sum() else float(lo + i)


def _component_ink(binary, speck_px):
    """去掉小雜點後的墨跡像素數與外框（相對座標 0~1）。"""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary.astype(np.uint8), connectivity=8)
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= speck_px]
    if not keep:
        return 0, None
    total = int(sum(stats[i, cv2.CC_STAT_AREA] for i in keep))
    x0 = min(stats[i, cv2.CC_STAT_LEFT] for i in keep)
    y0 = min(stats[i, cv2.CC_STAT_TOP] for i in keep)
    x1 = max(stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] for i in keep)
    y1 = max(stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] for i in keep)
    h, w = binary.shape
    return total, [round(x0 / w, 3), round(y0 / h, 3), round(x1 / w, 3), round(y1 / h, 3)]


def _color_dropout(img, line_mask):
    """彩色格線（粉紅、綠…）：把和格線同色相的像素也去掉。灰黑格線或灰階掃描則不處理。"""
    if img.ndim != 3 or not line_mask.any():
        return np.zeros(line_mask.shape, bool)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = (np.median(hsv[..., k][line_mask]) for k in range(3))
    if s < 50:            # 格線不是彩色（或掃描成灰階）
        return np.zeros(line_mask.shape, bool)
    dh = np.abs(hsv[..., 0].astype(int) - int(h))
    dh = np.minimum(dh, 180 - dh)
    return (dh <= 10) & (hsv[..., 1] >= 0.4 * s) & (hsv[..., 2] >= 0.5 * v)


def prepare(image, meta, cfg=None):
    """前處理一頁。image：校正後的頁面；meta：locate 輸出的頁面資料（樣式、紙張、頁碼、ppm）。"""
    p = {**DEFAULTS, **(cfg or {})}
    tpl = L.load_template(meta["template"])
    pi = meta["page_index"]
    pl = L.page_layout(tpl, pi, meta["paper"])
    t = L.paper_transform(tpl, meta["paper"])
    ppm = float(meta.get("ppm", 10.0))
    gray = _gray(image)
    H, W = gray.shape

    # 依樣式算出每行、每列的理論位置（像素）
    exp_cols, exp_rows = {}, {}
    for c in pl["cells"]:
        exp_cols.setdefault(c["col"], (c["x"] * ppm, (c["x"] + c["w"]) * ppm))
        exp_rows.setdefault(c["row"], (c["y"] * ppm, (c["y"] + c["h"]) * ppm))
    fx0, fy0, fx1, fy1 = (v * ppm for v in pl["grid_frame"])

    paper = float(np.percentile(gray, 90))
    dark = (gray < paper * 0.85).astype(np.uint8)
    k = max(5, int(p["line_kernel_mm"] * ppm))
    vmap = cv2.morphologyEx(dark, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, k)))
    hmap = cv2.morphologyEx(dark, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, 1)))

    # 格線位置微調：有行距的樣式，搜尋範圍不超過行距的一半，以免抓到隔壁行的線
    g = tpl["pages"][pi]["grid"]
    gutter = (g["col_pitch"] - g["cell_w"]) * t["scale"]
    window = p["snap_mm"] * ppm if gutter < 0.5 else min(p["snap_mm"], 0.45 * gutter) * ppm
    y_a, y_b = int(max(0, fy0)), int(min(H, fy1))
    x_a, x_b = int(max(0, fx0)), int(min(W, fx1))
    prof_x = vmap[y_a:y_b, :].sum(axis=0)
    prof_y = hmap[:, x_a:x_b].sum(axis=1)
    col_strength = 0.3 * (y_b - y_a)
    row_strength = 0.3 * sum(x1 - x0 for x0, x1 in exp_cols.values())
    cols = {c: (_snap(prof_x, x0, window, col_strength), _snap(prof_x, x1, window, col_strength))
            for c, (x0, x1) in exp_cols.items()}
    row_lines = sorted({y for pair in exp_rows.values() for y in pair})
    snapped_y = {y: _snap(prof_y, y, p["snap_mm"] * ppm, row_strength) for y in row_lines}
    rows = {r: (snapped_y[y0], snapped_y[y1]) for r, (y0, y1) in exp_rows.items()}
    frame = (min(x0 for x0, _ in cols.values()), snapped_y[row_lines[0]],
             max(fx1, max(x1 for _, x1 in cols.values())), snapped_y[row_lines[-1]])

    # 去除格線：只在格線附近的帶狀範圍內、且屬於長直線的像素
    band = max(1, int(round(p["line_band_mm"] * ppm)))
    band_mask = np.zeros((H, W), bool)
    ya, yb = int(max(0, frame[1] - band)), int(min(H, frame[3] + band + 1))
    xa, xb = int(max(0, frame[0] - band)), int(min(W, frame[2] + band + 1))
    for x in {v for pair in cols.values() for v in pair} | {frame[0], frame[2]}:
        band_mask[ya:yb, max(0, int(x) - band):min(W, int(x) + band + 1)] = True
    for y in set(snapped_y.values()):
        band_mask[max(0, int(y) - band):min(H, int(y) + band + 1), xa:xb] = True
    line_mask = ((vmap | hmap) > 0) & band_mask
    line_mask = cv2.dilate(line_mask.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & band_mask
    drop = line_mask | (_color_dropout(image, line_mask) & band_mask)
    clean = gray.copy()
    clean[drop] = int(paper)

    # 每格的墨量與類別
    threshold = paper * (1 - p["ink_delta"])
    speck_px = max(2, int(p["speck_mm2"] * ppm * ppm))
    cells = []
    for c in pl["cells"]:
        x0, x1 = cols[c["col"]]
        y0, y1 = rows[c["row"]]
        ix, iy = (x1 - x0) * p["inset"], (y1 - y0) * p["inset"]
        sub = clean[int(y0 + iy):int(y1 - iy), int(x0 + ix):int(x1 - ix)]
        area = max(1, sub.size)
        n_ink, box = _component_ink(sub < threshold, speck_px)
        ratio = n_ink / area
        if ratio < p["blank_ink_max"]:
            kind = "blank"
        elif ratio > p["dense_ink_min"]:
            kind = "dense"
        elif box and max(box[2] - box[0], box[3] - box[1]) < p["mark_box_max"]:
            kind = "mark"
        else:
            kind = "char"
        cells.append({"col": c["col"], "row": c["row"], "rect": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
                      "kind": kind, "ink": round(ratio, 4), "box": box})

    # 行間（兩行之間的空隙）若有墨跡，可能是補寫的字
    gaps = []
    ncols = len(cols)
    for c in range(1, ncols):
        right_x0 = cols[c][0]          # 第 c 行在右邊
        left_x1 = cols[c + 1][1]       # 第 c+1 行在左邊
        if right_x0 - left_x1 < 1.0 * ppm:
            continue
        gx0, gx1 = int(left_x1 + band + 1), int(right_x0 - band - 1)
        for r, (y0, y1) in rows.items():
            sub = clean[int(y0):int(y1), gx0:gx1]
            if sub.size == 0:
                continue
            n_ink, _ = _component_ink(sub < threshold, speck_px)
            if n_ink / sub.size >= p["gap_ink_min"]:
                gaps.append({"right_col": c, "left_col": c + 1, "row": r,
                             "rect": [gx0, round(y0, 1), gx1, round(y1, 1)], "ink": round(n_ink / sub.size, 4)})

    return PreparedPage(meta=dict(meta), ppm=ppm, image=image, clean=clean, line_mask=drop,
                        paper_level=paper, cols=cols, rows=rows, frame=frame, cells=cells, gaps=gaps)


KIND_COLORS = {"char": (200, 120, 30), "mark": (0, 150, 255), "dense": (40, 40, 220), "blank": (215, 215, 215)}


def overlay(page):
    """除錯用：在原圖上標出每格的判斷結果（藍＝字、橘＝標點類、紅＝可能塗改、灰＝空白、紫＝行間補寫）。"""
    base = page.image if page.image.ndim == 3 else cv2.cvtColor(page.image, cv2.COLOR_GRAY2BGR)
    out = base.copy()
    for c in page.cells:
        x0, y0, x1, y1 = (int(round(v)) for v in c["rect"])
        th = 1 if c["kind"] == "blank" else 2
        cv2.rectangle(out, (x0 + 2, y0 + 2), (x1 - 2, y1 - 2), KIND_COLORS[c["kind"]], th)
    for gp in page.gaps:
        x0, y0, x1, y1 = (int(round(v)) for v in gp["rect"])
        cv2.rectangle(out, (x0, y0), (x1, y1), (180, 50, 180), 2)
    return out
