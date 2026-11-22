"""辨識引擎的共同介面與共用工具。

每個引擎只要實作 recognize(page) → EngineResult。之後要加本機模型，也只是多一個引擎。
"""
import hashlib
import json
from bisect import bisect_right
from pathlib import Path

from ..model import CellReading


class Engine:
    name = "engine"

    def settings(self):
        """影響辨識結果的設定（寫進結果、也用來區分快取）。"""
        return {}

    def recognize(self, page):
        raise NotImplementedError


class ResponseCache:
    """把引擎的原始回應存起來：同一張圖、同樣設定再跑一次時不必重新付費。

    內容含作文文字，所以放在 output/ 底下（與其他學生資料一樣不進版本庫、不分享）。
    """

    def __init__(self, folder):
        self.folder = Path(folder) if folder else None

    @staticmethod
    def key(*parts):
        h = hashlib.sha256()
        for p in parts:
            h.update(p if isinstance(p, bytes) else json.dumps(p, sort_keys=True, ensure_ascii=False).encode())
        return h.hexdigest()[:32]

    def get(self, engine, key):
        if not self.folder:
            return None
        f = self.folder / engine / f"{key}.json"
        if f.is_file():
            try:
                return json.loads(f.read_text(encoding="utf-8"))
            except ValueError:
                return None
        return None

    def put(self, engine, key, data):
        if not self.folder:
            return
        d = self.folder / engine
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{key}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def assign_points(page, points):
    """把「以位置表示」的辨識結果（例如 Vision 每個字的外框）對回格子。

    points：[{"text", "conf", "box": (x0, y0, x1, y1)}]，座標為校正後頁面的像素。
    中心點落在格子裡 → 那一格；落在兩行之間的空隙 → 行間補寫；其他（格外的行號、雜點）→ 忽略。
    一格裡多個字 → 由上到下串起來並標示 multi；外框大半超出格子 → 標示 spill。
    回傳 (readings, insertions)。
    """
    cols = sorted(page.cols.items(), key=lambda kv: kv[1][0])        # 由左到右
    col_x0 = [x0 for _, (x0, _) in cols]
    rows = sorted(page.rows.items(), key=lambda kv: kv[1][0])        # 由上到下
    row_y0 = [y0 for _, (y0, _) in rows]
    fy0, fy1 = page.frame[1], page.frame[3]
    per_cell, insertions = {}, []
    for p in points:
        x0, y0, x1, y1 = p["box"]
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if not (fy0 <= cy <= fy1):
            continue
        ri = bisect_right(row_y0, cy) - 1
        if ri < 0 or cy > rows[ri][1][1]:
            continue
        row = rows[ri][0]
        ci = bisect_right(col_x0, cx) - 1
        if ci >= 0 and cx <= cols[ci][1][1]:
            per_cell.setdefault((cols[ci][0], row), []).append(p)
        elif 0 <= ci < len(cols) - 1:      # 在第 ci（左）與 ci+1（右）兩行之間
            left_col, right_col = cols[ci][0], cols[ci + 1][0]
            insertions.append({"right_col": right_col, "left_col": left_col, "row": row, "text": p["text"]})
    readings = {}
    for (col, row), pts in per_cell.items():
        pts.sort(key=lambda q: (q["box"][1] + q["box"][3]) / 2)
        flags = ["multi"] if len(pts) > 1 else []
        cx0, cx1 = page.cols[col]
        cy0, cy1 = page.rows[row]
        for q in pts:
            bx0, by0, bx1, by1 = q["box"]
            area = max(1e-6, (bx1 - bx0) * (by1 - by0))
            inside = max(0, min(bx1, cx1) - max(bx0, cx0)) * max(0, min(by1, cy1) - max(by0, cy0))
            if inside / area < 0.6 and "spill" not in flags:
                flags.append("spill")
        confs = [q["conf"] for q in pts if q.get("conf") is not None]
        readings[(col, row)] = CellReading("".join(q["text"] for q in pts), min(confs) if confs else None, flags)
    return readings, insertions
