"""聯合報雲寫作教室加的東西（2026-11-20）：照原稿紙印的聯合報國中寫作稿紙、聯合盃作文大賽稿紙
（第 4 版定位標記），與只用開放授權字型。

這些錯都不會當掉，只會安靜地出事：
- 樣式的格子和底圖（原稿紙）差一點點 → 之後逐格辨識每一格都切歪；
- 定位標記壓到 Logo 或批改區 → 印出來難看，也可能讀不到標記；
- 第 4 版的 ID 和 1Campus 的撞號 → 聯合報的稿紙被認成會考稿紙；
- 嵌進 PDF 的是微軟字型 → 發給學校的稿紙有授權問題。
"""
import cv2
import numpy as np
import pymupdf
import pytest

from gaozhi import layout as L
from gaozhi import render, sheet
from gaozhi.service import core

MM = 72 / 25.4
needs_font = pytest.mark.skipif(not sheet.ready(), reason="沒有稿紙字型（fonts/ 底下的全字庫正楷體）")


FIXED = list(sheet.FIXED_SHEETS)                     # 照原稿紙印的格式：udn、ucup
PAPERS_OF = {"udn": ["A3", "B4"], "ucup": ["B4", "A3"]}
DPI = 300
PPM = DPI / 25.4                                     # 每 mm 幾個像素
_PRINTED = {}


def _printed(fmt, paper, page_index, with_markers=True):
    """印出來的那一頁（300 dpi 灰階，True＝有墨水）。with_markers=False 時把定位標記塗白，只剩其他印刷。

    量**印出來的圖**而不是原稿紙的向量：聯合盃第一頁是原稿紙切塊重排的（sheet.UCUP_PAGE1），
    向量的外框會照原稿紙整頁回報，量不準；圖上看得到什麼就是什麼。
    """
    key = (fmt, paper, page_index)
    if key not in _PRINTED:
        doc, _, _ = sheet.build({"format": fmt, "paper": paper})
        pix = doc[page_index].get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY)
        img = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w)
        _PRINTED[key] = img < 200
    ink = _PRINTED[key].copy()
    if not with_markers:
        for m in L.page_layout(L.load_template(fmt), page_index, paper)["markers"]:
            x0, y0 = int(m["x"] * PPM) - 2, int(m["y"] * PPM) - 2
            x1, y1 = int((m["x"] + m["size"]) * PPM) + 3, int((m["y"] + m["size"]) * PPM) + 3
            ink[y0:y1, x0:x1] = False
    return ink


# ---- 第 4 版定位標記 ----
def test_v4_marker_ids_are_unique_and_decode_back():
    seen = {}
    for code in range(4):
        for v in (1, 2, 3):
            for paper in ("A3", "B4"):
                for pi in range(2):
                    for ci in range(4):
                        seen[L.marker_id(code, paper, pi, ci, v)] = (code, v)
    for code in L.MARKER_V4_CODES:
        for paper in ("A3", "B4"):
            for pi in range(2):
                for ci in range(4):
                    mid = L.marker_id(code, paper, pi, ci, 4)
                    assert 192 <= mid < 250 and mid not in seen, (mid, seen.get(mid))
                    seen[mid] = (code, 4)
                    d = L.decode_marker_id(mid)
                    assert (d["marker_code"], d["paper"], d["page_index"], d["corner"], d["version"]) \
                        == (code, paper, pi, L.CORNERS[ci], 4)


def test_v4_codes_and_versions_do_not_mix():
    with pytest.raises(ValueError):
        L.marker_id(0, "A3", 0, 0, 4)       # 1Campus 的樣式代號不能用第 4 版
    with pytest.raises(ValueError):
        L.marker_id(4, "A3", 0, 0, 3)       # 聯合報的樣式代號不能用第 1～3 版


@pytest.mark.parametrize("fmt", FIXED)
def test_fixed_sheets_use_v4_only(fmt):
    tpl = L.load_template(fmt)
    assert L.template_marker_version(tpl) == 4
    assert L.template_marker_versions(tpl) == (4,)
    assert sorted(L.template_marker_papers(tpl)) == ["A3", "B4"]


def test_every_template_has_its_own_marker_code():
    codes = [L.load_template(tid)["marker_code"] for tid in L.list_templates()]
    assert len(codes) == len(set(codes)), codes


def test_campus_templates_unchanged():
    # 1Campus 的樣式照舊
    assert L.template_marker_versions(L.load_template("cap")) == (1, 2, 3)
    assert L.template_marker_versions(L.load_template("gsat")) == (1, 2)


# ---- 樣式的格子和印出來的一模一樣 ----
TOL = 0.2                                            # mm：格線要在樣式說的位置 ±0.2mm 內


@pytest.mark.parametrize("fmt", FIXED)
@pytest.mark.parametrize("page_index", [0, 1])
def test_fixed_grid_matches_what_is_printed(fmt, page_index):
    """每一格的左右緣都有一條印出來的直線、每一列之間都有橫線，就在樣式說的位置（±0.2mm）。
    之後逐格辨識切格子、在原稿上畫紅筆，都照樣式的座標；差一點，每一格都切歪、紅圈畫偏。"""
    paper = PAPERS_OF[fmt][0]
    ink = _printed(fmt, paper, page_index, with_markers=False)
    cells = L.page_layout(L.load_template(fmt), page_index, paper)["cells"]
    t = round(TOL * PPM)
    for c in cells:
        x0, x1 = c["x"] * PPM, (c["x"] + c["w"]) * PPM
        y0, y1 = c["y"] * PPM, (c["y"] + c["h"]) * PPM
        rows = slice(int(y0 + 2), int(y1 - 2))            # 直線：整格的高度都要有墨水
        for x in (x0, x1):
            band = ink[rows, int(x) - t:int(x) + t + 1]
            assert band.any(axis=1).mean() > 0.9, f"{fmt} 第 {page_index + 1} 頁 第{c['col']}行第{c['row']}字 x {x / PPM:.2f}mm 沒有直線"
        if c["row"] > 1:                                   # 和上一格之間的橫線
            band = ink[int(y0) - t:int(y0) + t + 1, int(x0 + 2):int(x1 - 2)]
            assert band.any(axis=0).mean() > 0.9, f"{fmt} 第 {page_index + 1} 頁 第{c['col']}行第{c['row']}字 y {c['y']:.2f}mm 沒有橫線"


# ---- 定位標記：正角落、離其他印刷至少 3mm ----
MIN_CLEAR = 3.0     # mm：逐格辨識裁切格子時會多留 2mm 邊，標記要再遠一點，才不會被切進格子當成字（同 layout.MARKER_FRAME_GAP）
MIN_EDGE = 8.0      # mm：有的印表機紙邊約 6mm 印不到（見 layout.MARKER_MARGIN_V2）


@pytest.mark.parametrize("fmt,paper", [(f, p) for f in FIXED for p in PAPERS_OF[f]])
@pytest.mark.parametrize("page_index", [0, 1])
def test_fixed_markers_in_corners_and_clear(fmt, paper, page_index):
    """四個標記都在正角落（離紙邊至少 8mm），離印出來的任何東西（格子、Logo、評分欄、文字）至少 3mm。"""
    ink = _printed(fmt, paper, page_index, with_markers=False)
    dist = cv2.distanceTransform((~ink).astype(np.uint8), cv2.DIST_L2, 5) / PPM
    tpl = L.load_template(fmt)
    W, H = L.paper_transform(tpl, paper)["paper_mm"]
    for m in L.page_layout(tpl, page_index, paper)["markers"]:
        x0, y0, x1, y1 = m["x"], m["y"], m["x"] + m["size"], m["y"] + m["size"]
        edge = min(x0, y0, W - x1, H - y1)
        assert edge >= MIN_EDGE, f"{fmt} {paper} 第 {page_index + 1} 頁 {m['corner']} 離紙邊只有 {edge:.1f}mm"
        clear = dist[int(y0 * PPM):int(y1 * PPM), int(x0 * PPM):int(x1 * PPM)].min()
        assert clear >= MIN_CLEAR, f"{fmt} {paper} 第 {page_index + 1} 頁 {m['corner']} 標記離印刷只有 {clear:.1f}mm"


def test_ucup_page1_rearranged_keeps_cells_and_moves_grid():
    """聯合盃第一頁重排過：格子大小不變，整片往右 4mm；第二頁照原樣。"""
    pages = L.load_template("ucup")["pages"]
    g1, g2 = pages[0]["grid"], pages[1]["grid"]
    assert {k: v for k, v in g1.items() if k != "x0"} == {k: v for k, v in g2.items() if k != "x0"}
    assert abs(g1["x0"] - (13.056 + 4.0)) < 1e-9 and g2["x0"] == 47.29


# ---- 印出來認得出來 ----
@pytest.mark.parametrize("fmt,paper", [(f, p) for f in FIXED for p in PAPERS_OF[f]])
def test_fixed_sheet_is_recognised(fmt, paper):
    """空白的原稿紙稿紙兩頁都認得出是哪種稿紙、第幾頁、哪種紙；格子裡沒有字
    （底圖上的東西、靠近格子的定位標記都不會被當成字）。"""
    r = sheet.pdf({"format": fmt, "paper": paper})
    assert r["pages"] == 2 and r["paper"] == paper
    doc = pymupdf.open(stream=r["pdf"], filetype="pdf")
    for i, pg in enumerate(doc):
        f = {"name": f"p{i}.png", "data": core.b64(pg.get_pixmap(dpi=100).tobytes("png"))}
        prep = core.prepare([f])
        assert prep["ours"] and prep["ok"], prep
        [p] = prep["pages"]
        assert (p["template"], p["page"], p["paper"], p["ink_cells"]) == (fmt, i + 1, paper, 0)


@pytest.mark.parametrize("fmt", FIXED)
def test_fixed_sheets_ignore_header_options(fmt):
    """表頭是原稿紙上的：沒有大標題也能印，給了學校名稱、座號劃記也不會多印東西。"""
    plain, _, _ = sheet.config({"format": fmt})
    extra, _, seat = sheet.config({"format": fmt, "school": "某某國中", "title": "期中", "seat_marks": True,
                                   "fields": {"date": True}})
    assert plain == extra and seat is False


# ---- 只嵌開放授權的字型 ----
@needs_font
@pytest.mark.parametrize("fmt", ["cap", "gsat"])
def test_sheet_embeds_only_open_fonts(fmt):
    """會考、學測稿紙嵌進 PDF 的字型只能是全字庫正楷體（TW-Kai）：標楷體、正黑體、細明體是微軟授權給 Windows 用的。"""
    r = sheet.pdf({"format": fmt, "title": "寫作測驗答案卷", "school": "臺北市立示範國民中學",
                   "fields": {"class_seat_name": True, "date": True, "score": True}})
    doc = pymupdf.open(stream=r["pdf"], filetype="pdf")
    names = {f[3] for pg in doc for f in pg.get_fonts()}
    assert names and all("TW-Kai" in n or "TWKai" in n.replace("-", "") for n in names), names


def test_open_font_is_preferred():
    """找楷書時先找全字庫正楷體，找不到才退回 Windows 的字型。"""
    for alias in ("kai", "ming", "hei", "hei-bold"):
        assert render.FONT_ALIASES[alias][0] == "TW-Kai-98_1.ttf"
    assert render.FALLBACK_FONTS[0].startswith("TW-Kai")
