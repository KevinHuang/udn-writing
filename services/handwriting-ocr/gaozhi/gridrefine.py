"""用定位標記校正之後，再依格線做局部微調。

四角的標記只能校正「整張的透視」；手機拍照時紙張沒完全攤平、鏡頭的些微彎曲，會讓紙張中間偏掉 1～2mm。
作答格沒有行距時（例如學測），這樣的偏差會讓每一行的圖裁到隔壁行的筆畫。

做法：
1. 在校正後的頁面上，把作答格切成幾條帶，量每條格線的實際位置和應該的位置差多少。
2. 先擬合平滑的位移場（3 次多項式，排除離群值）——修正整體的彎曲。
3. 再量一次，剩下的偏差用 3×3 中位數濾掉零星誤抓（摺痕、筆畫），內插後疊加——修正局部的翹起。
4. 從原圖一次重新取樣（只內插一次，影像不會變糊）。
微調後的誤差沒有比較小、或位移大得不合理時，就不採用，維持標記校正的結果。
"""
import warnings

import cv2
import numpy as np

from . import gridreg as G

BANDS_V = 8            # 量直線時，作答格由上到下切幾條帶
BANDS_H = 12           # 量橫線時，由左到右切幾條帶
SEARCH_MM = 2.0        # 每條線在應有位置的 ±這個範圍內找
MAX_SHIFT_MM = 4.0     # 位移超過這個就不合理（可能對錯格子），不採用
LOCAL_CLIP_MM = 2.0
MIN_FOUND = 0.5        # 至少這個比例的線量得到才微調
STEP = 8               # 位移場的取樣間距（像素）


def _edges_px(lay, ppm):
    xs, ys = G._edges(lay)
    return np.array(xs) * ppm, np.array(ys) * ppm


def _strengths(img, lay, ppm):
    dark = G.darkness(img)
    thin, length = int(round(1.5 * ppm)), int(round(5 * ppm))
    cw = min(c["w"] for c in lay["cells"])
    return (G.line_strength(dark, True, thin, length),
            G.line_strength(dark, False, thin, min(length, int(0.6 * cw * ppm))))


def _peak(p, c, win, ref):
    """c 附近 ±win 內「離 c 最近」的明顯峰值位置（加權重心，次像素）；沒有就傳回 None。

    取最近的、不取最強的：作答格外框旁邊有時印著更粗的框線（例如學測表頭），最強的不一定是格線。
    """
    lo, hi = max(0, int(c) - win), min(len(p), int(c) + win + 1)
    seg = p[lo:hi]
    if len(seg) < 3:
        return None
    floor = max(0.15 * ref, 0.3 * float(seg.max()))
    peaks = [i for i in range(1, len(seg) - 1) if seg[i] >= floor and seg[i] >= seg[i - 1] and seg[i] > seg[i + 1]]
    if not peaks:
        return None
    i = min(peaks, key=lambda i: abs(lo + i - c))
    a0, a1 = max(0, i - 2), min(len(seg), i + 3)
    w = seg[a0:a1]
    return lo + float((w * np.arange(a0, a1)).sum() / w.sum())


def measure(img, lay, ppm, bands_v=BANDS_V, bands_h=BANDS_H):
    """回傳 (直線偏差表 帶×線, 帶中心 y, 橫線偏差表 帶×線, 帶中心 x)，單位像素，量不到是 NaN。"""
    xs, ys = _edges_px(lay, ppm)
    vstr, hstr = _strengths(img, lay, ppm)
    win = int(round(SEARCH_MM * ppm))
    ya, yb, xa, xb = ys[0], ys[-1], xs[0], xs[-1]
    gv, yc = np.full((bands_v, len(xs)), np.nan), []
    for k in range(bands_v):
        lo, hi = ya + k * (yb - ya) / bands_v, ya + (k + 1) * (yb - ya) / bands_v
        yc.append((lo + hi) / 2)
        p = vstr[int(lo):int(hi)].sum(axis=0).astype(np.float32)
        ref = float(np.percentile(p, 99)) or 1.0
        for i, e in enumerate(xs):
            pk = _peak(p, e, win, ref)
            if pk is not None:
                gv[k, i] = pk - e
    gh, xc = np.full((bands_h, len(ys)), np.nan), []
    for k in range(bands_h):
        lo, hi = xa + k * (xb - xa) / bands_h, xa + (k + 1) * (xb - xa) / bands_h
        xc.append((lo + hi) / 2)
        p = hstr[:, int(lo):int(hi)].sum(axis=1).astype(np.float32)
        ref = float(np.percentile(p, 99)) or 1.0
        for i, e in enumerate(ys):
            pk = _peak(p, e, win, ref)
            if pk is not None:
                gh[k, i] = pk - e
    return gv, np.array(yc), gh, np.array(xc)


def error_mm(gv, gh, ppm):
    """格線偏差的代表值（mm）：所有量到的線的偏差，取 3×3 中位數濾波後的平均絕對值（零星誤抓不算）。"""
    v = np.abs(_median3(gv)) if np.isfinite(gv).any() else np.zeros(1)
    h = np.abs(_median3(gh)) if np.isfinite(gh).any() else np.zeros(1)
    return float(np.concatenate([v.ravel(), h.ravel()]).mean() / ppm)


def _poly_terms(x, y, deg=3):
    return np.stack([x ** i * y ** j for i in range(deg + 1) for j in range(deg + 1 - i)], axis=-1)


def _robust_fit(x, y, v, tol):
    A = _poly_terms(x, y)
    keep = np.ones(len(v), bool)
    coef = np.zeros(A.shape[1])
    for _ in range(4):
        if keep.sum() < A.shape[1] * 2:
            break
        coef, *_ = np.linalg.lstsq(A[keep], v[keep], rcond=None)
        res = v - A @ coef
        mad = np.median(np.abs(res[keep])) + 1e-6
        keep = np.abs(res) < max(tol, 4 * mad)
    return coef


def _median3(a):
    """NaN 先用鄰近值補，再做 3×3 中位數。"""
    a = a.astype(float).copy()
    for _ in range(max(a.shape)):
        nan = np.isnan(a)
        if not nan.any():
            break
        pad = np.pad(a, 1, constant_values=np.nan)
        nb = np.stack([pad[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3)])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)          # 周圍全是 NaN 的格子：下一輪再補
            fill = np.nanmedian(nb, axis=0)
        a[nan] = fill[nan]
    a = np.nan_to_num(a)
    pad = np.pad(a, 1, mode="edge")
    nb = np.stack([pad[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3)])
    return np.median(nb, axis=0)


def _interp(v, xc, yc, X, Y):
    """v：(len(yc), len(xc)) 的規則格點值 → 雙線性內插到 (len(Y), len(X))；範圍外沿用邊界值。"""
    fx = np.interp(X, xc, np.arange(len(xc)))
    fy = np.interp(Y, yc, np.arange(len(yc)))
    i0 = np.clip(np.floor(fx).astype(int), 0, max(0, len(xc) - 2))
    j0 = np.clip(np.floor(fy).astype(int), 0, max(0, len(yc) - 2))
    i1, j1 = np.minimum(i0 + 1, len(xc) - 1), np.minimum(j0 + 1, len(yc) - 1)
    wx, wy = (fx - i0)[None, :], (fy - j0)[:, None]
    top = v[j0][:, i0] * (1 - wx) + v[j0][:, i1] * wx
    bot = v[j1][:, i0] * (1 - wx) + v[j1][:, i1] * wx
    return (top * (1 - wy) + bot * wy).astype(np.float32)


def refine(img, Hm, lay, ppm):
    """img：原始掃描；Hm：原圖 → 標準頁面（ppm 像素／mm）的單應矩陣。

    回傳 (校正後頁面, 診斷資料)。診斷資料的 applied=False 表示沒有採用微調（頁面就是標記校正的結果）。
    """
    W, H = lay["paper_mm"]
    size = (int(round(W * ppm)), int(round(H * ppm)))
    base = cv2.warpPerspective(img, Hm, size, flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    gv, yc, gh, xc = measure(base, lay, ppm)
    found = (np.isfinite(gv).mean() + np.isfinite(gh).mean()) / 2
    before = error_mm(gv, gh, ppm)
    info = {"applied": False, "before_mm": round(before, 3), "found": round(float(found), 2)}
    if found < MIN_FOUND:
        return base, info

    xs, ys = _edges_px(lay, ppm)
    xa, xb, ya, yb = xs[0], xs[-1], ys[0], ys[-1]
    nx = lambda x: (np.clip(x, xa, xb) - (xa + xb) / 2) / ((xb - xa) / 2)    # noqa: E731
    ny = lambda y: (np.clip(y, ya, yb) - (ya + yb) / 2) / ((yb - ya) / 2)    # noqa: E731
    tol = 0.4 * ppm
    vk, vi = np.nonzero(np.isfinite(gv))
    hk, hi = np.nonzero(np.isfinite(gh))
    cx = _robust_fit(nx(xs[vi]), ny(yc[vk]), gv[vk, vi], tol)
    cy = _robust_fit(nx(xc[hk]), ny(ys[hi]), gh[hk, hi], tol)
    # 位移場很平滑：每 STEP 像素算一次，再用 remap 內插到每個像素（快很多，結果幾乎相同）
    xg = np.arange(0, size[0] + STEP, STEP, dtype=np.float32)
    yg = np.arange(0, size[1] + STEP, STEP, dtype=np.float32)
    X, Y = np.meshgrid(xg, yg)
    T = _poly_terms(nx(X), ny(Y))
    dx, dy = (T @ cx).astype(np.float32), (T @ cy).astype(np.float32)
    fx, fy = np.meshgrid(np.arange(size[0], dtype=np.float32) / STEP, np.arange(size[1], dtype=np.float32) / STEP)
    Hi = np.linalg.inv(Hm)

    def resample(dx, dy):
        # 微調後頁面的 (X,Y) ← 標記校正頁面的 (X+dx, Y+dy) ← 原圖（反算單應矩陣）
        sx, sy = X + dx, Y + dy
        den = Hi[2, 0] * sx + Hi[2, 1] * sy + Hi[2, 2]
        mu = ((Hi[0, 0] * sx + Hi[0, 1] * sy + Hi[0, 2]) / den).astype(np.float32)
        mv = ((Hi[1, 0] * sx + Hi[1, 1] * sy + Hi[1, 2]) / den).astype(np.float32)
        mu = cv2.remap(mu, fx, fy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        mv = cv2.remap(mv, fx, fy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        return cv2.remap(img, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))

    first = resample(dx, dy)
    lv, lyc, lh, lxc = measure(first, lay, ppm)
    lim = LOCAL_CLIP_MM * ppm
    ldx = _interp(np.clip(_median3(lv), -lim, lim), xs, lyc, X[0], Y[:, 0]) if np.isfinite(lv).any() else 0
    ldy = _interp(np.clip(_median3(lh), -lim, lim).T, lxc, ys, X[0], Y[:, 0]) if np.isfinite(lh).any() else 0
    dx, dy = dx + ldx, dy + ldy
    shift = float(max(np.abs(dx).max(), np.abs(dy).max()) / ppm)
    info["max_shift_mm"] = round(shift, 2)
    if shift > MAX_SHIFT_MM:
        return base, info
    out = resample(dx, dy)
    av, _, ah, _ = measure(out, lay, ppm)
    after = error_mm(av, ah, ppm)
    info["after_mm"] = round(after, 3)
    if after >= before:
        return base, info
    info["applied"] = True
    return out, info
