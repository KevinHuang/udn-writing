"""把樣式（格子）＋表頭設定畫成 PDF。座標單位 mm，原點左上。"""
import json
import os
import re
from pathlib import Path

import cv2
import numpy as np
import pymupdf

from . import layout as L

MM = 72 / 25.4  # mm → pt
BASE_DIR = Path(__file__).resolve().parent.parent   # 稿紙生成器/，圖片等相對路徑以此為準

# 找字型的資料夾：環境變數 GAOZHI_FONT_DIR、本專案 fonts/（雲端映像檔放這裡）、Windows 字型資料夾
FONT_DIRS = [Path(d) for d in [os.environ.get("GAOZHI_FONT_DIR")] if d] + [
    BASE_DIR / "fonts", Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts",
    Path.home() / "AppData/Local/Microsoft/Windows/Fonts"]
# 別名 → 依序嘗試的字型檔。
# 聯合報雲寫作教室（2026-11-20）：一律**先找全字庫正楷體**（TW-Kai，政府資料開放授權，fonts/ 底下），找不到才用 Windows 內建字型。
# 稿紙 PDF 會嵌入字型、發給學校，標楷體、正黑體、細明體是微軟授權給 Windows 用的，不能這樣散布。
# 雲端（Linux）本來就只有 TW-Kai，所以這樣排序後本機與雲端印出來的一樣。原專案是 Windows 字型優先。
FONT_ALIASES = {
    "kai": ("TW-Kai-98_1.ttf", "kaiu.ttf"),           # 楷書
    "ming": ("TW-Kai-98_1.ttf", "mingliu.ttc"),        # 細明體（沒有開放授權的明體，用楷書代替）
    "hei": ("TW-Kai-98_1.ttf", "msjh.ttc"),            # 黑體（同上）
    "hei-bold": ("TW-Kai-98_1.ttf", "msjhbd.ttc"),     # 黑體 粗（同上）
}
FONT_LABELS = {"kai": "標楷體", "ming": "細明體", "hei": "微軟正黑體", "hei-bold": "微軟正黑體（粗）"}

# 直排時改用直排字形（若字型有），否則旋轉 90 度
VERTICAL_FORMS = {"（": "︵", "）": "︶", "「": "﹁", "」": "﹂", "『": "﹃", "』": "﹄",
                  "《": "︽", "》": "︾", "〈": "︿", "〉": "﹀", "【": "︻", "】": "︼",
                  "〔": "︹", "〕": "︺", "｛": "︷", "｝": "︸"}
ROTATE_IN_VERTICAL = set("—…～－─ー〜()[]{}<>-~")
CORNER_NAMES = {"tl": "左上", "tr": "右上", "br": "右下", "bl": "左下"}

# 主要字型缺字時依序改用（罕見姓名用字）：全字庫正楷體的擴充字面，最後才用細明體（同上，先找開放授權的）
FALLBACK_FONTS = ("TW-Kai-Ext-B-98_1.ttf", "TW-Kai-Plus-98_1.ttf", "mingliu.ttc", "mingliub.ttc")

# 行號與字數刻度比原本再往外移的距離（mm）：之後辨識時裁切格子就算多留一點邊，也不會切到數字
NUMBER_GAP = 2.0

# 個人化列印的代換文字
PLACEHOLDER = re.compile(r"\{(班級|座號|姓名|學號|作業名稱|編號|題目名稱|第二頁題目)\}")
CTX_KEYS = {"班級": "class", "座號": "seat", "姓名": "name", "學號": "sid", "作業名稱": "title", "編號": "no_text",
            "題目名稱": "question_label", "第二頁題目": "question_label_2"}

QR_ECC = {"L": cv2.QRCodeEncoder_CORRECT_LEVEL_L, "M": cv2.QRCodeEncoder_CORRECT_LEVEL_M,
          "Q": cv2.QRCodeEncoder_CORRECT_LEVEL_Q, "H": cv2.QRCodeEncoder_CORRECT_LEVEL_H}

DEFAULT_STYLE = {
    "font": "kai",
    "text_color": "#000000",
    "grid_color": "#e8609a",
    "grid_width": 0.5,          # pt
    "frame_width": 1.0,         # pt
    "markers": True,
    # False：不畫格子。給整頁用原稿紙當底圖的版型（見 build 的 background）：格子已經在底圖裡，
    # 再畫一次會疊出兩條線。格子的座標照樣以樣式為準（辨識用），樣式要和底圖量得一模一樣。
    "draw_grid": True,
    "column_numbers": None,     # 例：{"top": true, "bottom": true, "size": 7}
    "row_numbers": None,        # 例：{"every": 5, "left": true, "right": false, "size": 7}
}

_FONT_CACHE = {}


def hex_rgb(c):
    if isinstance(c, (list, tuple)):
        return tuple(c)
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))


def resolve_font(name):
    names = FONT_ALIASES.get(name, (name,))
    for fname in names:
        p = Path(fname)
        if p.is_file():
            return p
        for d in FONT_DIRS:
            if (d / fname).is_file():
                return d / fname
    raise FileNotFoundError(f"找不到字型 '{name}'（{'／'.join(names)}）。可用別名：{', '.join(FONT_ALIASES)}，或填入字型檔完整路徑。")


def available_fonts():
    out = []
    for alias in FONT_ALIASES:
        try:
            resolve_font(alias)
        except FileNotFoundError:
            continue
        out.append(alias)
    return out


def _xref_of(val):
    return int(val.split()[0])


def _add_font_ref(page, ref, font_xref):
    """在頁面的 /Resources/Font 加入已嵌入字型物件的參照（字典可能是直接或間接物件）。"""
    doc = page.parent
    entry = f"{font_xref} 0 R"
    kind, val = doc.xref_get_key(page.xref, "Resources")
    if kind == "xref":
        holder, prefix = _xref_of(val), ""
    elif kind == "dict":
        holder, prefix = page.xref, "Resources/"
    else:
        doc.xref_set_key(page.xref, "Resources", f"<</Font<</{ref} {entry}>>>>")
        return
    kind, val = doc.xref_get_key(holder, prefix + "Font")
    if kind == "xref":
        doc.xref_set_key(_xref_of(val), ref, entry)
    elif kind == "dict":
        doc.xref_set_key(holder, f"{prefix}Font/{ref}", entry)
    else:
        doc.xref_set_key(holder, prefix + "Font", f"<</{ref} {entry}>>")


def font_metrics(path):
    key = str(path)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = pymupdf.Font(fontfile=key)
    return _FONT_CACHE[key]


class Canvas:
    """包一層 pymupdf.Page。

    - 元素程式碼一律使用「樣式原始尺寸」的 mm 座標（原點左上）；xf（等比例縮放＋位移，
      A3／B4 互轉用）在這裡統一套用，所以同一份表頭設定可以輸出成兩種紙張。
    - 線條與文字都累積在同一個 Shape，flush() 時一次寫入頁面（逐筆寫入非常慢）。
    - fonts：同一份文件共用的字型登記表，讓每個字型只嵌入一次。
    - ctx：個人化列印時這位學生的資料（None = 一般稿紙）；preview：是否為編輯器預覽。
    - 主要字型缺字時自動改用備援字型；所有字型都沒有的字記在 missing。
    """

    def __init__(self, page, style, xf=None, fonts=None, ctx=None, preview=False):
        self.page = page
        self.style = style
        self.ctx = ctx
        self.preview = preview
        self.missing = set()
        self.sh = page.new_shape()
        self._fonts = {}
        self._registry = fonts if fonts is not None else {}
        self.s = xf["scale"] if xf else 1.0
        self.ox = xf["ox"] if xf else 0.0
        self.oy = xf["oy"] if xf else 0.0
        self._morph = None
        if abs(self.s - 1) > 1e-9:
            # 以固定點 F 縮放：p' = (p − F)·s + F = p·s + o  ⇒  F = o / (1 − s)
            fx, fy = self.ox * MM / (1 - self.s), self.oy * MM / (1 - self.s)
            self._morph = (pymupdf.Point(fx, fy), pymupdf.Matrix(self.s, self.s))
        elif abs(self.ox) > 1e-9 or abs(self.oy) > 1e-9:
            raise ValueError("不支援只有位移、沒有縮放的轉換")

    def flush(self):
        self.sh.commit()

    # ---- 座標轉換（原始 pt → 目標頁面 pt）----
    def _xp(self, p):
        if self._morph is None:
            return p
        return pymupdf.Point(self.ox * MM + self.s * p.x, self.oy * MM + self.s * p.y)

    def rect(self, x0, y0, x1, y1):
        """原始 mm 矩形 → 目標頁面 pt 矩形。"""
        a, b = self._xp(pymupdf.Point(x0 * MM, y0 * MM)), self._xp(pymupdf.Point(x1 * MM, y1 * MM))
        return pymupdf.Rect(a, b)

    # ---- 字型 ----
    def font(self, name):
        name = name or self.style["font"]
        if name not in self._fonts:
            path = resolve_font(name)
            ref = "F" + "".join(ch for ch in path.stem if ch.isalnum())
            key = str(path)
            if key in self._registry:   # 文件中已嵌入：只在本頁資源加上參照
                _add_font_ref(self.page, ref, self._registry[key])
            else:
                self._registry[key] = self.page.insert_font(fontname=ref, fontfile=key)
            self._fonts[name] = (ref, font_metrics(path))
        return self._fonts[name]

    def font_for(self, ch, font=None):
        """能顯示 ch 的字型：回傳 (字型名稱, Font)。主要字型就有時名稱原樣傳回（繪製呼叫與以前完全相同）。"""
        _, f = self.font(font)
        if ch.isspace() or f.has_glyph(ord(ch)):
            return font, f
        for fb in FALLBACK_FONTS:
            try:
                fm = font_metrics(resolve_font(fb))
            except FileNotFoundError:
                continue
            if fm.has_glyph(ord(ch)):
                self.font(fb)          # 真的用到才嵌入
                return fb, fm
        self.missing.add(ch)
        return font, f

    def _runs(self, line, font):
        """把一行文字切成「同一字型」的連續片段：[[字型名稱, 文字, Font], ...]。"""
        runs = []
        for ch in line:
            fname, ff = self.font_for(ch, font)
            if runs and runs[-1][0] == fname:
                runs[-1][1] += ch
            else:
                runs.append([fname, ch, ff])
        return runs

    def text_width(self, text, size=12, font=None):
        """單行橫排文字的寬度（mm，含備援字型）。"""
        return sum(ff.text_length(t, fontsize=size) for _, t, ff in self._runs(text, font)) / MM

    def subst(self, s):
        """代換 {班級}{座號}{姓名}{學號}{作業名稱}{編號}：一般稿紙換成空白，編輯器預覽保留原樣。"""
        if not isinstance(s, str) or "{" not in s:
            return s
        if self.ctx is None:
            return s if self.preview else PLACEHOLDER.sub("", s)
        return PLACEHOLDER.sub(lambda m: str(self.ctx.get(CTX_KEYS[m.group(1)], "")), s)

    @staticmethod
    def baseline_ratio(fobj):
        span = fobj.ascender - fobj.descender
        return fobj.ascender / span if span > 0 else 0.86

    def _text(self, pt, s, size, font, color, bold, morph=None):
        ref, _ = self.font(font)
        rgb = hex_rgb(color or self.style["text_color"])
        if self._morph is not None:
            pt, size = self._xp(pt), size * self.s
            if morph:
                morph = (self._xp(morph[0]), morph[1])
        kw = dict(fontsize=size, fontname=ref, color=rgb, fill=rgb, morph=morph)
        if bold:
            kw.update(render_mode=2, border_width=0.04)
        self.sh.insert_text(pt, s, **kw)

    # ---- 直排文字 ----
    def vtext(self, text, x, y, size=12, font=None, color=None, bold=False,
              char_step=None, col_step=None, wrap=None, justify=None):
        """x = 第一（最右）行的中心線，y = 頂端。多行用 \\n 分隔，由右往左排。

        char_step：字距（mm，預設 = 字高）；col_step：行距（mm，預設 1.35 倍字高）；
        wrap：超過此高度（mm）自動換行；justify：單行文字平均分散到此高度（mm）。
        回傳外框 (x0, y0, x1, y1)。
        """
        ref, f = self.font(font)
        s_mm = size / MM
        step = char_step or s_mm
        cstep = col_step or s_mm * 1.35
        columns = []
        for line in text.split("\n"):
            if wrap:
                per = max(1, int((wrap - s_mm) // step) + 1)
                columns.extend(line[i:i + per] for i in range(0, max(len(line), 1), per))
            else:
                columns.append(line)
        if justify and len(columns) == 1 and len(columns[0]) > 1:
            step = (justify - s_mm) / (len(columns[0]) - 1)
        max_len = 0
        for ci, col in enumerate(columns):
            cx = x - ci * cstep
            for k, ch in enumerate(col):
                top = y + k * step
                cy_pt = (top + s_mm / 2) * MM
                if ch in VERTICAL_FORMS and f.has_glyph(ord(VERTICAL_FORMS[ch])):
                    ch = VERTICAL_FORMS[ch]
                fname, ff = self.font_for(ch, font)
                br = self.baseline_ratio(ff)
                adv = ff.text_length(ch, fontsize=size)
                base = pymupdf.Point(cx * MM - adv / 2, top * MM + size * br)
                morph = None
                if ch in ROTATE_IN_VERTICAL:
                    base = pymupdf.Point(cx * MM - adv / 2, cy_pt + size * (br - 0.5))
                    morph = (pymupdf.Point(cx * MM, cy_pt), pymupdf.Matrix(90))
                self._text(base, ch, size, fname, color, bold, morph)
            max_len = max(max_len, len(col))
        h = (max_len - 1) * step + s_mm if max_len else 0
        return (x - (len(columns) - 1) * cstep - s_mm / 2, y, x + s_mm / 2, y + h)

    # ---- 橫排文字 ----
    def htext(self, text, x, y, size=12, font=None, color=None, bold=False, align="left", w=None,
              line_step=None):
        """x, y = 左上角；align 為 center/right 時需給 w（對齊區寬度）。"""
        ref, f = self.font(font)
        s_mm = size / MM
        lstep = line_step or s_mm * 1.3
        br = self.baseline_ratio(f)
        x0s, x1s = [], []
        lines = text.split("\n")
        for i, line in enumerate(lines):
            runs = self._runs(line, font)
            lw = sum(ff.text_length(t, fontsize=size) for _, t, ff in runs) / MM
            if align == "center":
                lx = x + ((w or 0) - lw) / 2
            elif align == "right":
                lx = x + (w or 0) - lw
            else:
                lx = x
            base_y = (y + i * lstep) * MM + size * br
            cx = lx
            for fname, t, ff in runs:   # 只有一段時與以前完全相同；缺字的片段改用備援字型接著畫
                self._text(pymupdf.Point(cx * MM, base_y), t, size, fname, color, bold)
                cx += ff.text_length(t, fontsize=size) / MM
            x0s.append(lx)
            x1s.append(lx + lw)
        return (min(x0s), y, max(x1s), y + (len(lines) - 1) * lstep + s_mm)

    # ---- 線條 ----
    def shape(self):
        """回傳本頁共用的 Shape：畫完一組路徑後呼叫 finish()，不需要 commit。"""
        return self.sh

    def finish(self, sh, color="#000000", width=0.6, fill=None, dash=None, round_cap=False):
        dashes = None
        if dash == "dotted":
            dashes = "[0 2.5] 0"
        elif dash == "dashed":
            dashes = "[3 2] 0"
        elif dash:
            dashes = dash
        sh.finish(color=hex_rgb(color) if color else None, width=width,
                  fill=hex_rgb(fill) if fill else None, dashes=dashes,
                  lineCap=1 if (round_cap or dash == "dotted") else 0, closePath=False,
                  morph=self._morph)


def mm_rect(x0, y0, x1, y1):
    return pymupdf.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM)


# ======================= 表頭元素 =======================

def el_text(cv, e):
    kw = dict(size=e.get("size", 12), font=e.get("font"), color=e.get("color"), bold=e.get("bold", False))
    text = cv.subst(e["text"])
    if e.get("vertical", True):
        return cv.vtext(text, e["x"], e["y"], char_step=e.get("char_step"), col_step=e.get("col_step"),
                        wrap=e.get("wrap"), justify=e.get("justify"), **kw)
    return cv.htext(text, e["x"], e["y"], align=e.get("align", "left"), w=e.get("w"),
                    line_step=e.get("line_step"), **kw)


def el_field(cv, e):
    """填寫欄：「標籤：」後面接一段書寫線。

    fill（class／seat／name／sid）：個人化列印時把學生資料印在書寫空間；匿名列印時整欄隱藏，
    以免空白的「姓名：」引導學生自己寫上名字。
    """
    fill = e.get("fill")
    if fill and cv.ctx is not None and cv.ctx.get("anonymous"):
        return None
    value = str(cv.ctx.get(fill, "")) if (fill and cv.ctx is not None) else ""
    size = e.get("size", 12)
    s_mm = size / MM
    label = e["label"] + e.get("colon", "：")
    length = e.get("length", 40)
    line = e.get("line", "solid")
    color = e.get("line_color", "#000000")
    if e.get("vertical", True):
        bb = cv.vtext(label, e["x"], e["y"], size=size, font=e.get("font"), color=e.get("color"),
                      bold=e.get("bold", False), char_step=e.get("char_step"))
        end = bb[3] + length
        if line != "none":
            lx = e["x"] - s_mm / 2 - 0.8
            sh = cv.shape()
            sh.draw_line(pymupdf.Point(lx * MM, (bb[3] + 0.5) * MM), pymupdf.Point(lx * MM, end * MM))
            cv.finish(sh, color, e.get("line_width", 0.5), dash=None if line == "solid" else line)
        if value:   # 同一行、接在標籤下方；太長就縮小字級（最小 6pt）
            room = max(length - 1.5, 1.0)
            vsize = size if len(value) * s_mm <= room else max(6.0, size * room / (len(value) * s_mm))
            cv.vtext(value, e["x"], bb[3] + 1.0, size=vsize, font=e.get("font"), color=e.get("color"),
                     bold=e.get("bold", False))
        return (bb[0] - 1, bb[1], bb[2], end)
    bb = cv.htext(label, e["x"], e["y"], size=size, font=e.get("font"), color=e.get("color"),
                  bold=e.get("bold", False))
    end = bb[2] + length
    if line != "none":
        ly = bb[3] + 0.6
        sh = cv.shape()
        sh.draw_line(pymupdf.Point(bb[2] * MM, ly * MM), pymupdf.Point(end * MM, ly * MM))
        cv.finish(sh, color, e.get("line_width", 0.5), dash=None if line == "solid" else line)
    if value:   # 接在標籤後面、同一條基準線；太長就縮小字級（最小 6pt）
        room = max(length - 1.5, 1.0)
        w = cv.text_width(value, size, e.get("font"))
        vsize = size if w <= room else max(6.0, size * room / w)
        br = cv.baseline_ratio(cv.font(e.get("font"))[1])
        cv.htext(value, bb[2] + 1.0, e["y"] + (size - vsize) / MM * br, size=vsize, font=e.get("font"),
                 color=e.get("color"), bold=e.get("bold", False))
    return (bb[0], bb[1], end, bb[3] + 1)


def el_box(cv, e):
    """方框，可附標籤。label_pos：below / above / inside-top / strip-right（右側直排標籤欄）。"""
    x, y, w, h = e["x"], e["y"], e["w"], e["h"]
    sh = cv.shape()
    sh.draw_rect(mm_rect(x, y, x + w, y + h), radius=e.get("radius") or None)
    strip = e.get("strip")
    if strip:
        sh.draw_line(pymupdf.Point((x + w - strip) * MM, y * MM), pymupdf.Point((x + w - strip) * MM, (y + h) * MM))
    cv.finish(sh, e.get("color", "#000000"), e.get("line_width", 0.8), fill=e.get("fill"), dash=e.get("dash"))
    bbox = [x, y, x + w, y + h]
    label = e.get("label")
    if label:
        ls = e.get("label_size", 10)
        l_mm = ls / MM
        pos = e.get("label_pos", "strip-right" if strip else "below")
        kw = dict(size=ls, font=e.get("font"), color=e.get("label_color"), bold=e.get("label_bold", False))
        if pos == "strip-right":
            sw = strip or l_mm + 2
            cv.vtext(label, x + w - sw / 2, y + e.get("label_offset", 3), char_step=e.get("label_step"), **kw)
        elif pos == "inside-top":
            cv.htext(label, x, y + 1, align="center", w=w, **kw)
        elif pos == "above":
            cv.htext(label, x, y - l_mm - 1, align="center", w=w, **kw)
            bbox[1] = y - l_mm - 1
        else:  # below
            cv.htext(label, x, y + h + 1, align="center", w=w, **kw)
            bbox[3] = y + h + 1 + l_mm
    return tuple(bbox)


def el_table(cv, e):
    """表格。col_widths / row_heights（mm），cells 為列優先的二維文字陣列（左→右）。"""
    x, y = e["x"], e["y"]
    cws, rhs = e["col_widths"], e["row_heights"]
    xs = [x + sum(cws[:i]) for i in range(len(cws) + 1)]
    ys = [y + sum(rhs[:j]) for j in range(len(rhs) + 1)]
    fill_rows = min(e.get("header_rows", 0), len(rhs))
    sh = cv.shape()
    if fill_rows and e.get("header_fill"):
        sh.draw_rect(mm_rect(xs[0], ys[0], xs[-1], ys[fill_rows]))
        cv.finish(sh, None, 0, fill=e["header_fill"])
    for xx in xs:
        sh.draw_line(pymupdf.Point(xx * MM, ys[0] * MM), pymupdf.Point(xx * MM, ys[-1] * MM))
    for yy in ys:
        sh.draw_line(pymupdf.Point(xs[0] * MM, yy * MM), pymupdf.Point(xs[-1] * MM, yy * MM))
    cv.finish(sh, e.get("color", "#000000"), e.get("line_width", 0.6))
    size = e.get("size", 9)
    s_mm = size / MM
    for j, row in enumerate(e.get("cells", [])):
        for i, txt in enumerate(row):
            txt = cv.subst(txt)
            if not txt or i >= len(cws) or j >= len(rhs):
                continue
            n = txt.count("\n") + 1
            th = (n - 1) * s_mm * 1.3 + s_mm
            cv.htext(txt, xs[i], ys[j] + (rhs[j] - th) / 2, size=size, font=e.get("font"),
                     align="center", w=cws[i])
    return (xs[0], ys[0], xs[-1], ys[-1])


def el_minigrid(cv, e):
    """小型方格區（例如錯字訂正格），參數同樣式中的 grid。"""
    g = {"x0": e["x"], "y0": e["y"], "cols": e["cols"], "rows": e["rows"], "cell_w": e["cell_w"],
         "cell_h": e.get("cell_h", e["cell_w"]), "col_pitch": e.get("col_pitch", e["cell_w"]),
         "trailing_gutter": e.get("trailing_gutter", False), "breaks": e.get("breaks", [])}
    if g["cols"] < 1 or g["rows"] < 1:
        raise ValueError("行數與列數至少要 1")
    draw_grid(cv, g, e.get("color", "#000000"), e.get("line_width", 0.5), e.get("frame_width", 0.8))
    return L.grid_frame(g)


def el_line(cv, e):
    if len(e["points"]) < 2:
        raise ValueError("線條至少需要 2 個點")
    pts = [pymupdf.Point(px * MM, py * MM) for px, py in e["points"]]
    color = e.get("color", "#000000")
    sh = cv.shape()
    sh.draw_polyline(pts)
    cv.finish(sh, color, e.get("width", 0.6), dash=e.get("dash"))
    if e.get("arrow"):
        a, b = pts[-2], pts[-1]
        v = (b - a)
        ln = abs(v) or 1
        u = pymupdf.Point(v.x / ln, v.y / ln)
        n = pymupdf.Point(-u.y, u.x)
        sz = e.get("arrow_size", 1.8) * MM
        p1 = b - u * sz + n * (sz * 0.45)
        p2 = b - u * sz - n * (sz * 0.45)
        sh.draw_polyline([p1, b, p2, p1])
        cv.finish(sh, color, 0.3, fill=color)
    xs = [p[0] for p in e["points"]]
    ys = [p[1] for p in e["points"]]
    return (min(xs), min(ys), max(xs), max(ys))


def qr_matrix(data, ecc=None):
    """QR 的模組矩陣（True = 黑），已去掉編碼器自帶的白邊。ecc：'L'／'M'／'Q'／'H'，None = OpenCV 預設。"""
    if ecc is None:
        enc = cv2.QRCodeEncoder.create()
    else:
        prm = cv2.QRCodeEncoder_Params()
        prm.correction_level = QR_ECC[ecc]
        enc = cv2.QRCodeEncoder.create(prm)
    mat = enc.encode(data) < 128
    ys, xs = np.where(mat)
    return mat[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def draw_modules(cv, mat, x, y, size):
    """把 QR 模組畫成實心方塊（同一列相連的黑格合併成一個長方形，避免接縫）。"""
    n = mat.shape[0]
    m = size / n
    sh = cv.shape()
    for r in range(n):
        c = 0
        while c < n:
            if not mat[r, c]:
                c += 1
                continue
            c0 = c
            while c < n and mat[r, c]:
                c += 1
            sh.draw_rect(mm_rect(x + c0 * m, y + r * m, x + c * m, y + (r + 1) * m))
    cv.finish(sh, None, 0, fill="#000000")


def el_qr(cv, e):
    if not e.get("data"):
        raise ValueError("請輸入 QR Code 內容")
    draw_modules(cv, qr_matrix(e["data"]), e["x"], e["y"], e["size"])
    return (e["x"], e["y"], e["x"] + e["size"], e["y"] + e["size"])


def el_idcode(cv, e):
    """身分碼：個人化列印時印出 QR 與下方說明文字。

    每人專屬：QR 是「批次碼＋學生編號」，說明印班級座號姓名；全班同一張：QR 是「批次碼＋班級序號」（同一班都一樣），
    說明只印班級，座號由學生在座號劃記塗寫。

    一般稿紙不印（回傳 None）；編輯器預覽且沒有學生資料時畫虛線框示意位置。
    外框包含 QR 四周必須留白的範圍，讓碰撞檢查一併保護留白區。
    """
    x, y = e["x"], e["y"]
    size = e.get("size", L.IDCODE_SIZE)
    qx0, qy0, qx1, qy1 = L.idcode_quiet_rect(e)
    ctx = cv.ctx
    if ctx is None and not cv.preview:
        return None
    if ctx is None:
        sh = cv.shape()
        sh.draw_rect(mm_rect(x, y, x + size, y + size))
        cv.finish(sh, "#98a2ae", 0.6, dash="dashed")
        cv.htext("身分碼", x, y + size / 2 - 1.4, size=7.5, font="hei", color="#7b8794", align="center", w=size)
        caption, color = "（個人化列印時印出）", "#98a2ae"
    else:
        mat = qr_matrix(ctx["payload"], "Q")
        if mat.shape[0] != L.IDCODE_MODULES:
            raise ValueError("身分碼內容過長")
        draw_modules(cv, mat, x, y, size)
        caption, color = ctx.get("caption", ""), e.get("color")
    bbox = [qx0, qy0, qx1, qy1]
    if caption and e.get("caption", True):
        cs = e.get("caption_size", 8)
        room = max(qx1 - qx0, 30.0)
        lines = [caption]
        if cv.text_width(caption, cs, e.get("font")) > room and " " in caption:
            head, _, tail = caption.rpartition(" ")   # 太長先分兩行：「班級 座號」／「姓名」
            lines = [head, tail]
        widest = max(cv.text_width(s, cs, e.get("font")) for s in lines)
        if widest > room:   # 還是太長就縮小（最小 5.5pt）
            cs = max(5.5, cs * room / widest)
        bb = cv.htext("\n".join(lines), x, qy1, size=cs, font=e.get("font"), color=color, align="center", w=size)
        bbox = [min(bbox[0], bb[0]), bbox[1], max(bbox[2], bb[2]), max(bbox[3], bb[3])]
    return tuple(bbox)


SEATMARK_COLOR = "#aab3be"     # 圓圈與裡面的數字：淺灰，塗黑的才會被掃描判讀當成有塗


def el_seatmark(cv, e):
    """座號劃記：兩格手寫座號，加上十位、個位的圓圈（gaozhi/layout.py seatmark_geometry）。

    只在「全班同一張」的個人化列印印出（一般稿紙、每人專屬的稿紙都不印）；編輯器預覽時照樣畫出，並註明何時印出。
    """
    ctx = cv.ctx
    if ctx is None and not cv.preview:
        return None
    if ctx is not None and ctx.get("mode") != "class":
        return None
    g = L.seatmark_geometry(e)
    col = e.get("color", SEATMARK_COLOR)
    sh = cv.shape()
    for b in g["bubbles"]:
        sh.draw_circle(pymupdf.Point(b["cx"] * MM, b["cy"] * MM), b["r"] * MM)
    cv.finish(sh, col, 0.45)
    sh = cv.shape()
    for r in g["boxes"].values():
        sh.draw_rect(mm_rect(*r))
    cv.finish(sh, "#4a4f57", 0.5)
    for b in g["bubbles"]:
        ds = b["r"] * 2 * 1.3                       # 數字字級（pt）：約圓圈的一半高
        cv.htext(str(b["value"]), b["cx"] - b["r"], b["cy"] - ds / MM * 0.5, size=ds, font="hei", color=col,
                 align="center", w=2 * b["r"])
    for t in g["texts"]:
        cv.htext(t["text"], t["x"], t["y"], size=t["size"], font="hei", color="#3d434b", align=t.get("align", "center"),
                 w=t["w"])
    x0, y0, x1, y1 = g["bbox"]
    if ctx is None:                                 # 編輯器預覽
        cv.htext("（全班同一張時印出）", x0, y1 + 0.8, size=6.5, font="hei", color="#98a2ae", align="center", w=x1 - x0)
        y1 += 0.8 + 6.5 / MM
    return (x0, y0, x1, y1)


def _draw_bubbles_and_boxes(cv, g, col):
    sh = cv.shape()
    for b in g.get("bubbles", []):
        sh.draw_circle(pymupdf.Point(b["cx"] * MM, b["cy"] * MM), b["r"] * MM)
    if g.get("bubbles"):
        cv.finish(sh, col, 0.45)
    sh = cv.shape()
    for r in g["boxes"].values():
        sh.draw_rect(mm_rect(*r))
    cv.finish(sh, "#4a4f57", 0.5)
    for b in g.get("bubbles", []):
        ds = b["r"] * 2 * 1.3                       # 字級（pt）：約圓圈的一半高
        cv.htext(b.get("label", str(b["value"])), b["cx"] - b["r"], b["cy"] - ds / MM * 0.5, size=ds, font="hei",
                 color=col, align="center", w=2 * b["r"])
    for t in g["texts"]:
        cv.htext(t["text"], t["x"], t["y"], size=t["size"], font="hei", color="#3d434b", align=t.get("align", "center"),
                 w=t["w"])


def _exam_only(cv, g, note):
    """考試版稿紙的元素：只在「全年級同一張」（mode="exam"）印出；編輯器預覽照樣畫，並註明何時印出。"""
    x0, y0, x1, y1 = g["bbox"]
    if cv.ctx is None:
        cv.htext(note, x0, y1 + 0.8, size=6.5, font="hei", color="#98a2ae", align="center", w=x1 - x0)
        y1 += 0.8 + 6.5 / MM
    return (x0, y0, x1, y1)


def el_idmark(cv, e):
    """身分劃記（考試版稿紙正面）：年級塗卡，班級（班序）與座號手寫＋塗卡（gaozhi/layout.py idmark_geometry）。"""
    ctx = cv.ctx
    if (ctx is None and not cv.preview) or (ctx is not None and ctx.get("mode") != "exam"):
        return None
    g = L.idmark_geometry(e)
    _draw_bubbles_and_boxes(cv, g, e.get("color", SEATMARK_COLOR))
    return _exam_only(cv, g, "（考試版稿紙印出）")


def el_idhand(cv, e):
    """背面的手寫班級、座號（雙面考試版稿紙），用來和正面核對（gaozhi/layout.py idhand_geometry）。"""
    ctx = cv.ctx
    if (ctx is None and not cv.preview) or (ctx is not None and ctx.get("mode") != "exam"):
        return None
    g = L.idhand_geometry(e)
    _draw_bubbles_and_boxes(cv, g, e.get("color", SEATMARK_COLOR))
    return _exam_only(cv, g, "（考試版稿紙印出）")


def el_image(cv, e):
    if not e.get("path"):
        raise ValueError("請先選擇圖片")
    path = Path(e["path"])
    if not path.is_absolute():
        path = BASE_DIR / path
    if not path.is_file():
        raise FileNotFoundError(f"找不到圖片 {e['path']}")
    r = (e["x"], e["y"], e["x"] + e["w"], e["y"] + e["h"])
    cv.page.insert_image(cv.rect(*r), filename=str(path), keep_proportion=True)
    return r


ELEMENTS = {"text": el_text, "field": el_field, "box": el_box, "table": el_table,
            "minigrid": el_minigrid, "line": el_line, "qr": el_qr, "image": el_image, "idcode": el_idcode,
            "seatmark": el_seatmark, "idmark": el_idmark, "idhand": el_idhand}


# ======================= 格子與定位標記 =======================

def draw_grid(cv, g, color, width, frame_width):
    rows = L.grid_rows(g)
    sh = cv.shape()
    for (x0, x1) in L.grid_columns(g):
        sh.draw_line(pymupdf.Point(x0 * MM, rows[0][0] * MM), pymupdf.Point(x0 * MM, rows[-1][1] * MM))
        sh.draw_line(pymupdf.Point(x1 * MM, rows[0][0] * MM), pymupdf.Point(x1 * MM, rows[-1][1] * MM))
        for (y0, _) in rows[1:]:
            sh.draw_line(pymupdf.Point(x0 * MM, y0 * MM), pymupdf.Point(x1 * MM, y0 * MM))
    cv.finish(sh, color, width)
    sh.draw_rect(mm_rect(*L.grid_frame(g)))
    cv.finish(sh, color, frame_width)


def draw_numbers(cv, g, style):
    """畫行號與字數刻度；回傳每個數字的外框（原始 mm），供身分碼留白區檢查。"""
    rects = []
    color = style["grid_color"]
    cols = list(reversed(L.grid_columns(g)))
    fx0, fy0, fx1, fy1 = L.grid_frame(g)
    cn = style.get("column_numbers")
    if cn:
        size = cn.get("size", 7)
        s_mm = size / MM
        for i, (x0, x1) in enumerate(cols, 1):
            if cn.get("top", True):
                rects.append(cv.htext(str(i), x0, fy0 - s_mm - 0.6 - NUMBER_GAP, size=size, font="hei", color=color,
                                      align="center", w=x1 - x0))
            if cn.get("bottom", True):
                rects.append(cv.htext(str(i), x0, fy1 + 0.8 + NUMBER_GAP, size=size, font="hei", color=color,
                                      align="center", w=x1 - x0))
    rn = style.get("row_numbers")
    if rn:
        size = rn.get("size", 7)
        s_mm = size / MM
        every = rn.get("every", 5)
        for j, (y0, y1) in enumerate(L.grid_rows(g), 1):
            if j % every:
                continue
            ty = (y0 + y1) / 2 - s_mm / 2
            if rn.get("left", True):
                rects.append(cv.htext(str(j), fx0 - 8.5 - NUMBER_GAP, ty, size=size, font="hei", color=color,
                                      align="right", w=7.5))
            if rn.get("right", False):
                rects.append(cv.htext(str(j), fx1 + 1.0 + NUMBER_GAP, ty, size=size, font="hei", color=color))
    return rects


def draw_marker(cv, m):
    bits = L.marker_bits(m["id"])
    n = bits.shape[0]
    u = m["size"] / n
    sh = cv.shape()
    for r in range(n):
        for c in range(n):
            if bits[r, c]:
                sh.draw_rect(mm_rect(m["x"] + c * u, m["y"] + r * u, m["x"] + (c + 1) * u, m["y"] + (r + 1) * u))
    cv.finish(sh, None, 0, fill="#000000")


def draw_debug(cv, paper, page_layout):
    """除錯用：10mm 參考格線與格子序號，方便調整表頭座標（以樣式原始尺寸的 mm 標示）。"""
    W, H = paper
    sh = cv.shape()
    for x in range(0, int(W) + 1, 10):
        sh.draw_line(pymupdf.Point(x * MM, 0), pymupdf.Point(x * MM, H * MM))
    for y in range(0, int(H) + 1, 10):
        sh.draw_line(pymupdf.Point(0, y * MM), pymupdf.Point(W * MM, y * MM))
    cv.finish(sh, "#33aaff", 0.2)
    for x in range(0, int(W) + 1, 50):
        cv.htext(str(x), x + 0.5, 0.5, size=6, font="hei", color="#0077cc")
    for y in range(50, int(H) + 1, 50):
        cv.htext(str(y), 0.5, y + 0.5, size=6, font="hei", color="#0077cc")
    for c in page_layout["cells"]:
        if c["row"] == 1 or c["col"] == 1:
            label = f'{c["col"]}' if c["row"] == 1 else f'{c["row"]}'
            cv.htext(label, c["x"], c["y"] + c["h"] / 2 - 1, size=5, font="hei", color="#0077cc", align="center", w=c["w"])


# ======================= 組頁 =======================

def _to_paper(bbox, t):
    k, ox, oy = t["scale"], t["ox"], t["oy"]
    return (ox + k * bbox[0], oy + k * bbox[1], ox + k * bbox[2], oy + k * bbox[3])


def _describe_error(ex):
    if isinstance(ex, KeyError):
        return f"缺少參數 {ex.args[0]}"
    if isinstance(ex, (FileNotFoundError, ValueError)):
        return str(ex)
    return f"{type(ex).__name__}：{ex}"


def _element_issues(kind, bbox, frame, markers, paper_mm, use_markers):
    issues = []
    if kind != "minigrid" and L.rects_overlap(bbox, frame, pad=-0.2):
        issues.append("與作答格重疊")
    if use_markers:
        for m in markers:
            mr = (m["x"], m["y"], m["x"] + m["size"], m["y"] + m["size"])
            if L.rects_overlap(bbox, mr, pad=L.MARKER_QUIET):
                issues.append(f"太靠近{CORNER_NAMES[m['corner']]}定位標記，可能影響掃描定位")
    PW, PH = paper_mm
    if bbox[0] < 4 or bbox[1] < 4 or bbox[2] > PW - 4 or bbox[3] > PH - 4:
        issues.append("距紙邊不到 4mm，部分印表機可能印不到")
    return issues


def _check_idcodes(elements, infos, number_rects, t):
    """身分碼四周的留白區不能有其他東西，印出的尺寸也不能太小，否則掃描時可能讀不到。"""
    for e, info in zip(elements, infos):
        if e.get("type") != "idcode" or info["bbox"] is None:
            continue
        quiet = _to_paper(L.idcode_quiet_rect(e), t)
        for other in infos:
            if other is info or other["bbox"] is None:
                continue
            if L.rects_overlap(quiet, other["bbox"], pad=-0.01):
                info["issues"].append(f"元素#{other['index'] + 1}（{other['text'][:8]}）在身分碼四周的留白區內，可能無法辨識")
        if any(L.rects_overlap(quiet, r, pad=-0.01) for r in number_rects):
            info["issues"].append("行號或字數刻度在身分碼四周的留白區內，可能無法辨識")
        printed = e.get("size", L.IDCODE_SIZE) * t["scale"]
        if printed < 15:
            info["issues"].append(f"印出後只有 {printed:.1f}mm，建議至少 15mm")


SEATMARK_MIN_MM = 3.0          # 座號劃記的圓圈印出後至少這麼大，學生才好塗、掃描才讀得準


def _check_seatmarks(elements, infos, number_rects, t):
    """座號劃記不能和其他東西重疊（塗卡判讀會被干擾），圓圈也不能縮得太小。"""
    for e, info in zip(elements, infos):
        if e.get("type") not in ("seatmark", "idmark", "idhand") or info["bbox"] is None:
            continue
        for other in infos:
            if other is info or other["bbox"] is None or other["type"] == "idcode":   # 身分碼另外檢查留白區
                continue
            if L.rects_overlap(info["bbox"], other["bbox"], pad=-0.01):
                info["issues"].append(f"和元素#{other['index'] + 1}（{other['text'][:8]}）重疊，可能影響座號判讀")
        if any(L.rects_overlap(info["bbox"], r, pad=-0.01) for r in number_rects):
            info["issues"].append("與行號或字數刻度重疊")
        printed = e.get("size", L.SEATMARK_SIZE) * t["scale"]
        if e["type"] != "idhand" and printed < SEATMARK_MIN_MM:
            info["issues"].append(f"圓圈印出後只有 {printed:.1f}mm，建議至少 {SEATMARK_MIN_MM:.0f}mm")


def _check_numbers(infos, number_rects):
    """行號、字數刻度不能壓到表頭元素（身分碼的留白區已由 _check_idcodes 檢查）。"""
    for info in infos:
        if info["bbox"] is None or any("行號或字數刻度" in msg for msg in info["issues"]):
            continue
        if any(L.rects_overlap(info["bbox"], r, pad=-0.01) for r in number_rects):
            info["issues"].append("與行號或字數刻度重疊")


def build(config, paper=None, debug=False, subset=True, doc=None, fonts=None, only_page=None,
          context=None, preview=False):
    """config：表頭設定（dict）；paper：'A3' / 'B4'，省略則用樣式原始紙張。

    表頭座標一律以樣式原始尺寸為準；換成另一種紙張時，整頁（格子＋表頭）等比例縮放後置中，
    定位標記則直接畫在目標紙張四角、不縮放。

    個人化列印：context 為一位學生的資料（見 batch.context），None 表示一般稿紙；
    preview=True 表示編輯器預覽（沒有學生資料時，身分碼畫成虛線框、代換文字保留原樣）。

    預覽加速用參數：subset=False 不做字型子集化；doc／fonts 可傳入常駐文件與其字型登記表，
    新頁面接在文件最後（字型不重複嵌入）；only_page 只畫指定頁（其餘頁 header_elements 為 None）。
    回傳 (pymupdf.Document, layout dict, warnings list)。
    """
    tpl = L.load_template(config["template"])
    style = {**DEFAULT_STYLE, **config.get("style", {})}
    t = L.paper_transform(tpl, paper)
    W, H = tpl["paper_mm"]
    PW, PH = t["paper_mm"]
    if doc is None:
        doc = pymupdf.open()
    if fonts is None:
        fonts = {}
    warnings = []
    pages_cfg = config.get("pages", [])
    layout = {"template": tpl["id"], "template_name": tpl["name"], "title": config.get("title", ""),
              "paper": t["paper"], "paper_mm": t["paper_mm"],
              "unit": "mm", "origin": "page top-left", "reading_order": "直書：由右而左、由上而下",
              "aruco_dict": "DICT_4X4_250", "pages": []}
    seq = 0
    for pi, tp in enumerate(tpl["pages"]):
        pl = L.page_layout(tpl, pi, t["paper"])
        for c in pl["cells"]:
            seq += 1
            c["seq"] = seq
        layout["pages"].append(pl)
        if only_page is not None and pi != only_page:
            pl["header_elements"] = None
            continue
        page = doc.new_page(width=PW * MM, height=PH * MM)
        cv = Canvas(page, style, xf=t, fonts=fonts, ctx=context, preview=preview)
        pcfg = pages_cfg[pi] if pi < len(pages_cfg) else {}

        # 整頁底圖（聯合報的版型）：把原稿紙那一頁（向量）放上來，和其他東西一樣跟著紙張等比例縮放。
        # pieces：把原稿紙切成幾塊重新擺（為了讓出四角給定位標記），每塊 {clip: 原稿紙上的範圍, to: 放到哪（左上角）,
        # scale: 縮放，預設 1}，單位都是樣式原始 mm。沒有 pieces 就整頁照原樣放。
        # 底圖上的 Logo、QR Code、批改區不經過下面的表頭檢查；它們和定位標記的距離由測試（量印出來的圖）把關。
        bg = pcfg.get("background")
        if bg:
            path = Path(bg["path"])
            if not path.is_absolute():
                path = BASE_DIR / path
            with pymupdf.open(path) as src:
                pno = bg.get("page", 0)
                pieces = bg.get("pieces")
                if not pieces:
                    page.show_pdf_page(cv.rect(0, 0, W, H), src, pno, keep_proportion=False)
                for piece in pieces or []:
                    x0, y0, x1, y1 = piece["clip"]
                    tx, ty = piece["to"]
                    k = piece.get("scale", 1.0)
                    page.show_pdf_page(cv.rect(tx, ty, tx + (x1 - x0) * k, ty + (y1 - y0) * k), src, pno,
                                       clip=pymupdf.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM), keep_proportion=False)

        g = tp["grid"]
        if debug:
            draw_debug(cv, (W, H), L.page_layout(tpl, pi))
        if style["draw_grid"]:
            draw_grid(cv, g, style["grid_color"], style["grid_width"], style["frame_width"])
        number_rects = [_to_paper(r, t) for r in draw_numbers(cv, g, style)]

        frame = pl["grid_frame"]
        elements = pcfg.get("elements", [])
        infos = []
        for k, e in enumerate(elements):
            kind = e.get("type", "text")
            desc = {"idcode": "身分碼", "seatmark": "座號劃記", "idmark": "身分劃記", "idhand": "背面座號"}.get(kind) \
                or str(e.get("text", e.get("label", e.get("data", ""))))
            info = {"index": k, "type": kind, "text": desc, "bbox": None, "issues": []}
            if kind not in ELEMENTS:
                info["issues"].append(f"未知的元素類型「{kind}」，已略過")
            else:
                cv.missing.clear()
                try:
                    raw = ELEMENTS[kind](cv, e)
                    if raw is not None:   # None：這次不印（例如一般稿紙上的身分碼、匿名時的姓名欄）
                        bbox = _to_paper(raw, t)
                        info["bbox"] = [round(v, 2) for v in bbox]
                        info["issues"] = _element_issues(kind, bbox, frame, pl["markers"], t["paper_mm"],
                                                         style["markers"])
                except Exception as ex:  # 單一元素有誤不影響整頁
                    info["issues"].append(f"無法繪製：{_describe_error(ex)}")
                if cv.missing:
                    info["issues"].append(f"字型中找不到「{''.join(sorted(cv.missing))}」，會印成空白")
            infos.append(info)
        _check_idcodes(elements, infos, number_rects, t)
        _check_seatmarks(elements, infos, number_rects, t)
        _check_numbers(infos, number_rects)
        if any(r[0] < 4 or r[1] < 4 or r[2] > PW - 4 or r[3] > PH - 4 for r in number_rects):
            warnings.append(f"第{pi + 1}頁 行號或字數刻度距紙邊不到 4mm，部分印表機可能印不到")
        for info in infos:
            for msg in info["issues"]:
                warnings.append(f"第{pi + 1}頁 元素#{info['index'] + 1}（{info['type']}：{info['text'][:10]}）{msg}")
        cv.flush()
        pl["header_elements"] = infos

        if style["markers"]:
            mcv = Canvas(page, style)
            for m in pl["markers"]:
                draw_marker(mcv, m)
                mr = (m["x"], m["y"], m["x"] + m["size"], m["y"] + m["size"])
                if L.rects_overlap(mr, frame, pad=L.MARKER_QUIET):
                    warnings.append(f"第{pi + 1}頁 {CORNER_NAMES[m['corner']]}定位標記太靠近作答格")
            mcv.flush()
    if subset:
        doc.subset_fonts()
    return doc, layout, warnings


def build_batch(config, contexts, paper=None):
    """個人化列印：依序為每位學生（contexts 每一筆）產生全部頁面，合成一份 PDF。

    共用同一份文件與字型登記（字型只嵌入一次），最後才子集化。每個人都有的警告只列一次。
    回傳 (pymupdf.Document, layout dict, warnings list)。
    """
    doc = pymupdf.open()
    fonts = {}
    layout = None
    who = {}
    for ctx in contexts:
        _, lay, warns = build(config, paper=paper, subset=False, doc=doc, fonts=fonts, context=ctx)
        layout = layout or lay
        for w in warns:
            who.setdefault(w, []).append(ctx.get("label", ""))
    warnings = []
    for w, names in who.items():
        if len(names) == len(contexts):
            warnings.append(w)
        else:
            more = f"等 {len(names)} 人" if len(names) > 3 else ""
            warnings.append(f"{'、'.join(names[:3])}{more}：{w}")
    doc.subset_fonts()
    return doc, layout, warnings


def glyph_report(text, font="kai"):
    """名單預檢：回傳 {"fallback": 要改用備援字型的字, "missing": 所有字型都沒有、會印成空白的字}。"""
    primary = font_metrics(resolve_font(font))
    fallbacks = []
    for fb in FALLBACK_FONTS:
        try:
            fallbacks.append(font_metrics(resolve_font(fb)))
        except FileNotFoundError:
            pass
    fallback, missing = [], []
    for ch in dict.fromkeys(text):
        if ch.isspace() or primary.has_glyph(ord(ch)):
            continue
        (fallback if any(f.has_glyph(ord(ch)) for f in fallbacks) else missing).append(ch)
    return {"fallback": "".join(fallback), "missing": "".join(missing)}


def save(config, out_pdf, paper=None, debug=False, png_dpi=None):
    doc, layout, warnings = build(config, paper=paper, debug=debug)
    out_pdf = Path(out_pdf)
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_pdf, garbage=4, deflate=True)
    out_json = out_pdf.with_suffix(".layout.json")
    out_json.write_text(json.dumps(layout, ensure_ascii=False, indent=1), encoding="utf-8")
    pngs = []
    if png_dpi:
        for i, p in enumerate(doc):
            path = out_pdf.with_name(f"{out_pdf.stem}_p{i + 1}.png")
            p.get_pixmap(dpi=png_dpi).save(path)
            pngs.append(path)
    return out_pdf, out_json, pngs, warnings
