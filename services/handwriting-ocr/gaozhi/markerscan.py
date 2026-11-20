"""讀不到完整定位標記時的備援：認得「外圈被印表機切掉一排」的標記。

實際列印發現：有的印表機上下緣約 6mm 印不到，第 1 版標記（離紙邊 5mm、邊長 6mm）外圈少一排，
OpenCV 的 ArUco 偵測就認不出來（它要求四邊黑框完整）。這裡改用自己的方法：
1. 找候選黑色塊：影像四角附近的連通區塊，加上 ArUco 偵測時「找到方框但解不出 ID」的候選框。
2. 把候選框切成 6×6、6×5、5×6 格取樣，和所有可能的標記比對（四種旋轉 × 完整或切掉某一邊的一排）。
   吻合 90% 以上才採用。
3. 回傳看得到的那一塊在影像上的四個角，以及它們在標記上的位置（以格為單位，0～6），
   定位時就能換算成紙上的 mm，照樣算出透視校正。
"""
import cv2
import numpy as np

from . import layout as L

MIN_SCORE = 0.9              # 取樣的格子至少這個比例要和標記相同
CORNER_WINDOW = 0.25         # 在影像四角各取寬、高的這個比例找候選
CLIPS = ("none", "top", "bottom", "left", "right")

_PATTERNS = None


def patterns():
    """所有可能的標記（每份樣式、紙張、頁、角落、版本）× 切掉哪一邊 × 四種旋轉，依取樣形狀分組：
    {(列, 行): (圖案陣列 N×列×行, [(標記 ID, 對應的標記格座標 4×2), …])}。"""
    global _PATTERNS
    if _PATTERNS is None:
        ids = set()
        for tid in L.list_templates():
            tpl = L.load_template(tid)
            code = tpl["marker_code"]
            # 第 3 版只有寫了 marker_margins 的樣式有、第 4 版只有聯合報的版型有（候選圖案越少，認錯的機會越小）
            versions = L.template_marker_versions(tpl)
            for paper in L.PAPERS:
                for pi in range(2):
                    for ci in range(4):
                        for v in versions:
                            ids.add(L.marker_id(code, paper, pi, ci, v))
        groups = {}
        for mid in sorted(ids):
            bits = L.marker_bits(mid)
            for clip in CLIPS:
                u0, v0, u1, v1 = _visible(clip)
                part = bits[v0:v1, u0:u1]
                local = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]          # 左上、右上、右下、左下
                for k in range(4):
                    pat = np.rot90(part, k)                                # 逆時針轉 k 次
                    # 轉了 k 次之後，影像上的第 i 個角是標記原本的第 (i + k) 個角
                    corners = np.float32([local[(i + k) % 4] for i in range(4)])
                    g = groups.setdefault(pat.shape, ([], []))
                    g[0].append(pat)
                    g[1].append((mid, corners))
        _PATTERNS = {shape: (np.array(pats), meta) for shape, (pats, meta) in groups.items()}
    return _PATTERNS


def _order(box):
    """四個點排成 左上、右上、右下、左下（影像座標）。"""
    s, d = box.sum(axis=1), box[:, 0] - box[:, 1]
    return np.array([box[np.argmin(s)], box[np.argmax(d)], box[np.argmax(s)], box[np.argmin(d)]], np.float32)


def _sample(gray, box, rows, cols, cell=12):
    dst = np.array([[0, 0], [cols * cell, 0], [cols * cell, rows * cell], [0, rows * cell]], np.float32)
    patch = cv2.warpPerspective(gray, cv2.getPerspectiveTransform(box, dst), (cols * cell, rows * cell))
    thr = cv2.threshold(patch, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0]
    m = cell // 4
    return np.array([[patch[r * cell + m:(r + 1) * cell - m, c * cell + m:(c + 1) * cell - m].mean() < thr
                      for c in range(cols)] for r in range(rows)])


def _visible(clip):
    """切掉某一邊後，看得到的範圍（標記上的格座標）：u0, v0, u1, v1。"""
    return {"none": (0, 0, 6, 6), "top": (0, 1, 6, 6), "bottom": (0, 0, 6, 5),
            "left": (1, 0, 6, 6), "right": (0, 0, 5, 6)}[clip]


def match(gray, box):
    """候選框 → (吻合度, 標記 ID, 影像四角, 對應的標記格座標)；認不出來回傳 None。"""
    best = None
    for shape, (pats, meta) in patterns().items():
        sample = _sample(gray, box, *shape)
        scores = (pats == sample).mean(axis=(1, 2))
        i = int(np.argmax(scores))
        if best is None or scores[i] > best[0]:
            best = (float(scores[i]), meta[i][0], box, meta[i][1])
    return best if best and best[0] >= MIN_SCORE else None


def _candidates(gray):
    """候選框：四角附近大小合理的黑色塊，加上 ArUco 解不出 ID 的方框。"""
    h, w = gray.shape
    L_ = max(h, w)
    lo, hi = 0.006 * L_, 0.04 * L_                       # 標記看得到的部分約佔長邊的 1～3%
    boxes = []
    ww, wh = int(w * CORNER_WINDOW), int(h * CORNER_WINDOW)
    for x0, y0 in ((0, 0), (w - ww, 0), (0, h - wh), (w - ww, h - wh)):
        g = gray[y0:y0 + wh, x0:x0 + ww]
        bw = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        n, lab, st, _ = cv2.connectedComponentsWithStats(bw)
        for i in range(1, n):
            bx, by, bw_, bh_, area = st[i]
            if not (lo < bw_ < hi and lo < bh_ < hi) or not 0.6 < bw_ / bh_ < 1.6 or area < 0.35 * bw_ * bh_:
                continue
            pts = np.ascontiguousarray(np.column_stack(np.nonzero(lab == i))[:, ::-1] + (x0, y0), dtype=np.float32)
            boxes.append(_order(cv2.boxPoints(cv2.minAreaRect(pts)).astype(np.float32)))
    det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(L.ARUCO_DICT_ID), cv2.aruco.DetectorParameters())
    _, _, rejected = det.detectMarkers(gray)
    for r in rejected:
        q = r.reshape(4, 2).astype(np.float32)
        side = np.linalg.norm(q[0] - q[1])
        cx, cy = q[:, 0].mean(), q[:, 1].mean()
        near = min(cx, w - cx) < ww and min(cy, h - cy) < wh
        if near and lo < side < hi:
            boxes.append(_order(q))
    return boxes


def find_clipped(img):
    """回傳 {標記 ID: (影像四角 4×2, 標記格座標 4×2, 吻合度)}，同一個 ID 只留吻合度最高的。"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    found = {}
    for box in _candidates(gray):
        m = match(gray, box)
        if m and (m[1] not in found or m[0] > found[m[1]][2]):
            found[m[1]] = (m[2], m[3], m[0])
    return found
