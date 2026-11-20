"""原版稿紙的對位：沒有我們印的定位標記時，直接用格線找出每一格的位置。

用途：用原版稿紙（學測、會考）寫的作文，例如評估用的舊樣本。
我們的樣式是照原版量出來的，格子位置一致；只要在掃描影像上找到格線，
就能換算成和定位標記相同的「標準頁面」，後面的前處理、辨識流程完全一樣。

步驟：
1. 細線強度：只留下比 1.5mm 細的深色結構（格線、筆畫），去掉大片底色；淺綠、淺紅的格線也看得到。
2. 校正歪斜：試不同角度，找直線投影最「尖」的角度。
3. 直線投影：把頁面切成多條橫帶，各自投影後取偏低的百分位數——格線每一條帶都有，
   手寫字只出現在部分帶，所以格線留下、字被壓低。
4. 對行：把樣式每一行左右邊線的位置（mm）和投影比對，同時找出比例（每 mm 幾像素）與位置。
5. 對列：同樣比對每一列的上下邊線（只看每一行格子的內部，避開表頭與行間空隙）。
6. 用找到的格子範圍再對一次行（排除表頭的直線），最後用每條線的實際位置做最小平方微調。

限制：
- 只看格線，無法分辨是第幾頁（各頁格子相同），頁碼要由使用者指定。
- 不處理上下顛倒或轉 90 度的掃描。
"""
import cv2
import numpy as np

from . import layout as L

THIN_MM = 1.5               # 比這個細的深色結構才算線條／筆畫
LINE_MM = 5.0               # 沿線方向至少連續這麼長才算格線（約半格；多數筆畫比這短）
WORK_PPM = 8.0              # 對位時的工作解析度（每 mm 像素），掃描解析度較高時先縮小以加快速度
BAND_MM = 10.0              # 投影時每條帶的寬度
BAND_QUANTILE = 30          # 各帶投影取這個百分位數（格線要出現在 70% 以上的帶裡才會留下）
SCALE_RANGE = (0.8, 1.25)   # 比例搜尋範圍（相對於預估值）：容許縮放列印
MIN_MATCHED = 0.85          # 至少這個比例的格線要對得上，才算對位成功


def darkness(img):
    """每個像素比紙暗多少（0～1）。取 B、G、R 的最小值，彩色（綠、紅）格線也會明顯。"""
    m = (cv2.min(cv2.min(img[:, :, 0], img[:, :, 1]), img[:, :, 2]) if img.ndim == 3 else img).astype(np.float32)
    paper = float(np.percentile(m[::4, ::4], 90))
    return np.clip((paper - m) / max(paper, 1.0), 0, 1)


def thin_strength(dark, vertical, width_px):
    """只留下比 width_px 細的結構（白頂帽運算）。vertical=True：找直線（橫向量寬度）。"""
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (width_px, 1) if vertical else (1, width_px))
    return cv2.morphologyEx(dark, cv2.MORPH_TOPHAT, k)


def line_strength(dark, vertical, width_px, length_px):
    """細而長的線：先留下細的結構，再要求沿線方向連續 length_px（灰階開運算，淺色的線也保留）。"""
    t = thin_strength(dark, vertical, width_px)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, length_px) if vertical else (length_px, 1))
    return cv2.morphologyEx(t, cv2.MORPH_OPEN, k)


def _rotate(a, deg):
    h, w = a.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
    return cv2.warpAffine(a, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=0), M


def _blur1d(p, sigma):
    return cv2.GaussianBlur(p.reshape(1, -1).astype(np.float32), (0, 0), sigma).ravel()


def estimate_skew(vstrength, px_per_mm, max_deg=3.0):
    """找出讓直線投影最尖的旋轉角度（度）。在約每 mm 3 像素的縮小圖上搜尋。"""
    f = min(1.0, 3.0 / px_per_mm)
    small = cv2.resize(vstrength, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)

    def score(deg):
        p = _rotate(small, deg)[0].sum(axis=0)
        hp = p - _blur1d(p, 4)
        return float((hp ** 2).sum())

    best = max(np.arange(-max_deg, max_deg + 1e-9, 0.2), key=score)
    best = max(np.arange(best - 0.2, best + 0.2 + 1e-9, 0.02), key=score)
    return float(best)


def _quantile_profile(sums, smooth):
    """sums：(帶數, 長度)。先沿長度方向稍微模糊（容許線條在各帶間偏 1、2 像素），再取百分位數。"""
    sums = cv2.GaussianBlur(sums.astype(np.float32), (0, 0), sigmaX=smooth, sigmaY=1e-3)
    return np.percentile(sums, BAND_QUANTILE, axis=0)


def x_profile(vstr, y_lo, y_hi, band):
    """直線投影：y_lo～y_hi 切成多條橫帶，各自對 x 投影，取百分位數。"""
    n = max(1, (y_hi - y_lo) // band)
    sums = np.stack([vstr[y_lo + i * band: y_lo + (i + 1) * band].sum(axis=0) for i in range(n)])
    return _quantile_profile(sums, 1.0)


def y_profile(hstr, col_ranges):
    """橫線投影：每一行格子的內部各自對 y 投影，取百分位數。"""
    sums = np.stack([hstr[:, a:b].sum(axis=1) for a, b in col_ranges if b > a])
    return _quantile_profile(sums, 1.0)


def _normalize(p, n_lines):
    """讓每條格線的貢獻差不多是 1：以最強的 n 個峰值的中位數為準，超過的截掉（粗外框不會主導）。"""
    inner = p[1:-1]
    peaks = inner[(inner >= p[:-2]) & (inner > p[2:])]
    if len(peaks) == 0:
        return p
    ref = float(np.median(np.sort(peaks)[::-1][:n_lines])) or 1.0
    return np.minimum(p / ref, 1.0)


def _search(p, rel, scales, sigma):
    """在各種比例 s 下，找位移 b 使 p[b + s·rel] 的總和最大。回傳 (分數, s, b)。"""
    q = _blur1d(p, sigma)
    best = (-1.0, None, None)
    for s in scales:
        pos = np.round(rel * s).astype(int)
        n = len(q) - pos[-1]
        if n <= 0:
            continue
        acc = np.zeros(n, np.float32)
        for d in pos:
            acc += q[d:d + n]
        i = int(np.argmax(acc))
        if acc[i] > best[0]:
            best = (float(acc[i]), float(s), i)
    return best


def fit_axis(profile, edges_mm, s_lo, s_hi, sigma_px):
    """把樣式的邊線位置（mm）對到投影上：先粗略（縮小 4 倍）再細部，最後用實際峰值做最小平方。

    回傳 {"scale", "offset"（第一條邊線的像素位置）, "matched"（對上的邊線比例）, "score"}。
    """
    edges = np.asarray(sorted(edges_mm), float)
    rel = edges - edges[0]
    span = rel[-1]
    p = _normalize(profile.astype(np.float32), len(edges))
    k = 4
    pc = p[: len(p) // k * k].reshape(-1, k).max(axis=1)
    sc = max(1.0, sigma_px / k)
    step = sc / (2 * span)
    _, s, _ = _search(pc, rel, np.arange(s_lo / k, s_hi / k + step, step), sc)
    if s is None:
        return None
    s *= k
    step = sigma_px / (2 * span)
    score, s, b = _search(p, rel, np.arange(s * 0.98, s * 1.02 + step, step), sigma_px)
    if s is None:
        return None
    xs, ys = [], []
    win = max(2, int(round(sigma_px * 1.5)))
    for r in rel:
        c = int(round(b + s * r))
        lo, hi = max(0, c - win), min(len(p), c + win + 1)
        if hi <= lo:
            continue
        seg = p[lo:hi]
        i = int(np.argmax(seg))
        if seg[i] < 0.3:
            continue
        a0, a1 = max(0, i - 2), min(len(seg), i + 3)
        w = seg[a0:a1]
        xs.append(r)
        ys.append(lo + float((w * np.arange(a0, a1)).sum() / w.sum()))
    matched = len(xs) / len(rel)
    if len(xs) >= 2:
        s, b = np.polyfit(xs, ys, 1)
    return {"scale": float(s), "offset": float(b), "matched": round(matched, 3), "score": round(score, 2)}


def _edges(lay):
    xs, ys = set(), set()
    for c in lay["cells"]:
        xs.update((round(c["x"], 2), round(c["x"] + c["w"], 2)))
        if c["col"] == 1:
            ys.update((round(c["y"], 2), round(c["y"] + c["h"], 2)))
    return sorted(xs), sorted(ys)


def register(img, tpl, page_index, paper=None, ppm=10.0, px_per_mm=None):
    """用格線把掃描頁對到樣式。回傳格式與 locate.locate 相同（另含 method="grid" 與 fit 診斷資料）。

    px_per_mm：掃描的大約解析度（PDF 已知），不給就假設影像剛好是整張原版紙張。
    """
    native = L.native_paper(tpl)
    ref = L.page_layout(tpl, page_index, native)        # 原版尺寸（mm）
    xs, ys = _edges(ref)
    W_mm, H_mm = ref["paper_mm"]
    H0, W0 = img.shape[:2]
    if (W0 > H0) != (W_mm > H_mm):
        return {"error": "影像方向（直式／橫式）和稿紙不同，請先把掃描轉正"}
    guess = px_per_mm or max(W0, H0) / max(W_mm, H_mm)
    f = min(1.0, WORK_PPM / guess)                        # 在工作解析度上對位
    work = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else img
    guess *= f
    h, w = work.shape[:2]

    dark = darkness(work)
    thin = max(3, int(round(THIN_MM * guess)))
    length = max(5, int(round(LINE_MM * guess)))
    angle = estimate_skew(thin_strength(dark, True, thin), guess)
    dark = _rotate(dark, angle)[0] if angle else dark
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    vstr = line_strength(dark, True, thin, length)
    hstr = line_strength(dark, False, thin, min(length, int(0.6 * min(c["w"] for c in ref["cells"]) * guess)))
    band = max(5, int(round(BAND_MM * guess)))
    sigma = max(1.0, 0.25 * guess)                        # 容許 0.25mm 的誤差

    fx = fit_axis(x_profile(vstr, int(h * 0.35), int(h * 0.75), band), xs,
                  guess * SCALE_RANGE[0], guess * SCALE_RANGE[1], sigma)
    if not fx:
        return {"error": "找不到直行格線"}
    fy = None
    for _ in range(2):
        s = fx["scale"]
        inset = 0.15
        cols = []
        for c in ref["cells"]:
            if c["row"] == 1:
                a = fx["offset"] + s * (c["x"] - xs[0])
                cols.append((max(0, int(a + inset * s * c["w"])), min(w, int(a + (1 - inset) * s * c["w"]))))
        fy = fit_axis(y_profile(hstr, cols), ys, s * 0.97, s * 1.03, sigma)
        if not fy:
            return {"error": "找不到橫向格線"}
        y_lo = max(0, int(fy["offset"]))
        y_hi = min(h, int(fy["offset"] + fy["scale"] * (ys[-1] - ys[0])) + 1)
        fx = fit_axis(x_profile(vstr, y_lo, y_hi, band), xs, s * 0.98, s * 1.02, sigma)
        if not fx:
            return {"error": "找不到直行格線"}

    fit = {"angle": round(angle, 3), "x": fx, "y": fy, "work_px_per_mm": round(guess, 3), "work_scale": round(f, 4)}
    if min(fx["matched"], fy["matched"]) < MIN_MATCHED:
        return {"error": f"格線對不上（行 {fx['matched']:.0%}、列 {fy['matched']:.0%}），可能不是這個樣式", "fit": fit}

    # 原始影像 → 工作解析度 → 旋轉後 → 原版 mm → 目標紙張 mm → 標準頁面像素
    S = np.diag([f, f, 1.0])
    R = np.vstack([M, [0, 0, 1]]) @ S
    A = np.array([[1 / fx["scale"], 0, xs[0] - fx["offset"] / fx["scale"]],
                  [0, 1 / fy["scale"], ys[0] - fy["offset"] / fy["scale"]],
                  [0, 0, 1]])
    t = L.paper_transform(tpl, paper)
    T = np.array([[t["scale"], 0, t["ox"]], [0, t["scale"], t["oy"]], [0, 0, 1]])
    Hm = np.diag([ppm, ppm, 1.0]) @ T @ A @ R
    lay = L.page_layout(tpl, page_index, t["paper"])
    PW, PH = lay["paper_mm"]
    warped = cv2.warpPerspective(img, Hm, (int(round(PW * ppm)), int(round(PH * ppm))),
                                 flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    return {"template": tpl, "paper": t["paper"], "page_index": page_index, "layout": lay, "warped": warped,
            "homography": Hm, "markers_used": [], "method": "grid", "fit": fit}
