"""送給辨識引擎的影像：只含作答格（不含表頭的姓名、QR 碼），並記得影像座標和校正頁面座標的對應。

排法：
- 原樣（spacing_mm=None）：把指定的幾行照原樣裁下來。
- 拉開（spacing_mm=數字）：每一行切成直條，條與條之間留白。沒有行距的稿紙（例如學測）
  左右相鄰的字靠得很近，辨識引擎容易把同一列的字橫著連起來讀；拉開之後只會由上往下讀。
直條一律由右而左排（第一行在最右邊），和稿紙相同。
"""
from dataclasses import dataclass

import cv2
import numpy as np

LABEL_COLOR = (200, 80, 0)      # 行號標示用的藍色（BGR）


@dataclass
class Strip:
    col: int          # 稿紙第幾行
    page_x0: float    # 在校正頁面上的左邊界（像素）
    view_x0: int      # 在送出的影像上的左邊界
    width: int


@dataclass
class View:
    image: np.ndarray
    page_y0: float    # 頁面內容最上緣的頁面 y（像素）
    view_y0: int      # 頁面內容在影像上的起始 y（上方可能留了標示行號的空間）
    strips: list      # 由左到右

    @property
    def cols(self):
        return sorted(s.col for s in self.strips)

    def _strip_at(self, x):
        for s in self.strips:
            if s.view_x0 <= x < s.view_x0 + s.width:
                return s
        return min(self.strips, key=lambda s: abs(x - (s.view_x0 + s.width / 2)))

    def to_page(self, x, y, strip=None):
        s = strip or self._strip_at(x)
        return s.page_x0 + (x - s.view_x0), self.page_y0 + (y - self.view_y0)

    def box_to_page(self, box):
        """影像上的外框 → 頁面上的外框（依外框中心所在的直條換算）。"""
        x0, y0, x1, y1 = box
        s = self._strip_at((x0 + x1) / 2)
        a, b = self.to_page(x0, y0, s), self.to_page(x1, y1, s)
        return (a[0], a[1], b[0], b[1])

    def from_page(self, x, y, col):
        s = next(s for s in self.strips if s.col == col)
        return s.view_x0 + (x - s.page_x0), self.view_y0 + (y - self.page_y0)

    def png(self):
        return cv2.imencode(".png", self.image)[1].tobytes()


def base_image(page, mode="clean"):
    """mode="clean"：去掉格線的灰階；"faded"：格線變淡（保留格子的樣子，方便辨識引擎數格子）。"""
    if mode == "clean":
        return page.clean.copy()
    gray = page.image if page.image.ndim == 2 else cv2.cvtColor(page.image, cv2.COLOR_BGR2GRAY)
    img = gray.copy()
    m = page.line_mask
    img[m] = (0.3 * img[m].astype(np.float32) + 0.7 * page.paper_level).astype(np.uint8)
    return img


def whiten_blank(img, page, inset_px=3):
    """把前處理判斷為空白的格子塗白（只塗格子內部，格線保留）：減少雜點被讀成字。"""
    v = int(page.paper_level)
    for c in page.cells:
        if c["kind"] == "blank":
            x0, y0, x1, y1 = (int(round(t)) for t in c["rect"])
            img[y0 + inset_px:y1 - inset_px, x0 + inset_px:x1 - inset_px] = v
    return img


def column_view(page, cols, mode="clean", spacing_mm=None, margin_mm=1.0, top_mm=0.0, whiten=True,
                labels=False):
    """把指定的幾行排成一張圖。margin_mm：格子左右上下多留的範圍（不超過與鄰行之間空隙的一半）。"""
    ppm = page.ppm
    img = base_image(page, mode)
    if whiten:
        img = whiten_blank(img, page)
    H, W = img.shape[:2]
    fx0, fy0, fx1, fy1 = page.frame
    m = margin_mm * ppm
    y0, y1 = int(max(0, fy0 - m)), int(min(H, fy1 + m))
    order = sorted(cols, reverse=True)                     # 由左到右：行號大的在左

    def span(c):
        x0, x1 = page.cols[c]
        left = page.cols.get(c + 1)                         # 左邊的鄰行
        right = page.cols.get(c - 1)                        # 右邊的鄰行
        ml = min(m, (x0 - left[1]) / 2) if left else m
        mr = min(m, (right[0] - x1) / 2) if right else m
        return int(max(0, x0 - max(0, ml))), int(min(W, x1 + max(0, mr)))

    if spacing_mm is None:
        a, b = span(order[0])[0], span(order[-1])[1]
        pieces = [(order, a, b)]
    else:
        pieces = [([c], *span(c)) for c in order]
    gap = int(round((spacing_mm or 0) * ppm))
    top = int(round(top_mm * ppm))
    total_w = sum(b - a for _, a, b in pieces) + gap * (len(pieces) + 1 if spacing_mm is not None else 0)
    canvas = np.full((top + (y1 - y0), total_w), int(page.paper_level), np.uint8)
    strips, x = [], gap if spacing_mm is not None else 0
    for cs, a, b in pieces:
        canvas[top:, x:x + (b - a)] = img[y0:y1, a:b]
        if len(cs) == 1:
            strips.append(Strip(cs[0], float(a), x, b - a))
        else:                                               # 原樣：一整塊，但每一行仍各自記錄位置
            for c in cs:
                ca, cb = span(c)
                strips.append(Strip(c, float(ca), x + (ca - a), cb - ca))
        x += (b - a) + gap
    strips.sort(key=lambda s: s.view_x0)
    out = cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR) if labels else canvas
    if labels and top:
        for s in strips:
            x0, x1 = page.cols[s.col]
            cx = s.view_x0 + (x0 + x1) / 2 - s.page_x0
            text = str(s.col)
            scale = top / 40
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)
            cv2.putText(out, text, (int(cx - tw / 2), int(top * 0.75)), cv2.FONT_HERSHEY_SIMPLEX, scale,
                        LABEL_COLOR, 2, cv2.LINE_AA)
    return View(out, float(y0), top, strips)


def single_column_view(page, col, mode="faded", margin_mm=1.0, label_mm=9.0, whiten=True):
    """一行一張圖，左邊用藍色標上格子編號（由上往下 1、2、3…）。

    辨識引擎回報「第幾格是什麼字」，不必自己數格子，也不會把字放到別行；讀錯只影響那一格。
    """
    v = column_view(page, [col], mode=mode, margin_mm=margin_mm, whiten=whiten)
    gray = v.image if v.image.ndim == 2 else cv2.cvtColor(v.image, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape
    lw = int(round(label_mm * page.ppm))
    canvas = np.full((H, lw + W), int(page.paper_level), np.uint8)
    canvas[:, lw:] = gray
    out = cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)
    row_h = float(np.median([y1 - y0 for y0, y1 in page.rows.values()]))
    scale = 0.42 * row_h / 22.0                             # Hershey 字型 scale=1 時數字約 22 像素高
    for r, (y0, y1) in sorted(page.rows.items()):
        cy = (y0 + y1) / 2 - v.page_y0 + v.view_y0
        (tw, th), _ = cv2.getTextSize(str(r), cv2.FONT_HERSHEY_SIMPLEX, scale, 2)
        cv2.putText(out, str(r), (int(lw * 0.9 - tw), int(cy + th / 2)), cv2.FONT_HERSHEY_SIMPLEX, scale,
                    LABEL_COLOR, 2, cv2.LINE_AA)
    strips = [Strip(s.col, s.page_x0, s.view_x0 + lw, s.width) for s in v.strips]
    return View(out, v.page_y0, v.view_y0, strips)


def chunks(cols, size):
    """把行號（由 1 起，閱讀順序）每 size 行分成一組。"""
    cols = sorted(cols)
    return [cols[i:i + size] for i in range(0, len(cols), size)]
