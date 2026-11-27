"""座號劃記判讀（/seat-scan）：用稿紙產生器印的稿紙，模擬學生塗座號後掃描，讀回來的座號要對。

塗卡是程式畫的實心橢圓（不是真的學生筆跡）；掃描效果是輕微歪斜、雜訊與 JPEG 壓縮。
"""
import random

import cv2
import numpy as np
import pytest

from gaozhi import layout as L
from gaozhi import render, seatread as SR, sheet
from gaozhi.service import core, server

needs_font = pytest.mark.skipif(not render.available_fonts(), reason="這台電腦沒有稿紙字型（標楷體或全字庫正楷體）")
DPI = 200
PX = DPI / 25.4
_CACHE = {}


def printed(fmt, paper, seat_marks=True, question=None):
    """印出來的稿紙每一頁（灰階 200 dpi 的影像）。"""
    key = (fmt, paper, seat_marks, question)
    if key not in _CACHE:
        import pymupdf
        req = {"format": fmt, "paper": paper, "school": "示範中學", "title": "那一次，我學會了等待",
               "fields": {"class_seat_name": True, "date": True, "score": True}, "seat_marks": seat_marks}
        if question:
            req["gsat_question"] = question
        doc = pymupdf.open(stream=sheet.pdf(req)["pdf"], filetype="pdf")
        pages = []
        for pg in doc:
            pix = pg.get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY)
            pages.append(np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).copy())
        _CACHE[key] = pages
    return [p.copy() for p in _CACHE[key]]


def fill(img, fmt, paper, tens, ones, cover=0.95, rnd=None):
    """在座號劃記上塗 tens（十位，可以是 None 或清單）、ones（個位）。"""
    rnd = rnd or random.Random(1)
    geo = SR.paper_geometry(L.load_template(fmt), paper)
    want = {("tens", v) for v in (tens if isinstance(tens, list) else [tens]) if v is not None}
    want |= {("ones", v) for v in (ones if isinstance(ones, list) else [ones]) if v is not None}
    for b in geo["bubbles"]:
        if (b["place"], b["value"]) in want:
            c = (round((b["cx"] + rnd.uniform(-.25, .25)) * PX), round((b["cy"] + rnd.uniform(-.25, .25)) * PX))
            ax = (round(b["r"] * cover * PX), round(b["r"] * cover * 0.9 * PX))
            cv2.ellipse(img, c, ax, rnd.uniform(0, 180), 0, 360, 60, -1, cv2.LINE_AA)
    return img


def scanned(img, rot180=False, seed=3):
    rng = np.random.default_rng(seed)
    h, w = img.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), float(rng.uniform(-1, 1)), 1.0)
    img = cv2.warpAffine(img, m, (w, h), borderValue=255)
    img = np.clip(img.astype(np.int16) + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8)
    if rot180:
        img = cv2.rotate(img, cv2.ROTATE_180)
    return {"name": "p.jpg", "data": core.b64(cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 60])[1].tobytes())}


def scan_one(f):
    [p] = core.seat_scan([f])["pages"]
    return p


@needs_font
@pytest.mark.parametrize("fmt,paper", [("cap", "B4"), ("cap", "A3"), ("gsat", "A3"), ("gsat", "B4"),
                                       ("udn", "A3"), ("udn", "B4")])
@pytest.mark.parametrize("seat", [1, 7, 36, 59, 60, 99])
def test_reads_filled_seat(fmt, paper, seat):
    page = printed(fmt, paper, question="analytical" if fmt == "gsat" else None)[0]
    tens, ones = divmod(seat, 10)
    p = scan_one(scanned(fill(page, fmt, paper, tens, ones), rot180=seat % 2 == 0, seed=seat))
    assert (p["kind"], p["template"], p["page"], p["paper"]) == ("sheet", fmt, 1, paper)
    assert p["seat"]["state"] == "clear" and p["seat"]["seat"] == seat, p["seat"]
    assert p["crops"] and p["corners_missing"] == []


@needs_font
def test_only_ones_means_tens_zero():
    """只塗個位（例如 5 號沒塗十位的 0）當作 5 號。"""
    page = printed("cap", "B4")[0]
    assert scan_one(scanned(fill(page, "cap", "B4", None, 5)))["seat"]["seat"] == 5


@needs_font
def test_half_filled_still_reads():
    page = printed("cap", "B4")[0]
    p = scan_one(scanned(fill(page, "cap", "B4", 8, 8, cover=0.6)))
    assert p["seat"]["seat"] == 88


@needs_font
@pytest.mark.parametrize("tens,ones,state", [(None, None, "blank"), (1, [2, 3], "double"), ([1, 2], 3, "double")])
def test_unreadable_seat_is_not_guessed(tens, ones, state):
    page = printed("cap", "B4")[0]
    p = scan_one(scanned(fill(page, "cap", "B4", tens, ones)))
    assert p["seat"]["state"] == state and p["seat"]["seat"] is None


@needs_font
def test_page_two_has_no_seat():
    """會考第 2 頁沒有座號劃記：只回頁碼，交給呼叫端接在前一張第 1 頁後面。"""
    p = scan_one(scanned(printed("cap", "B4")[1]))
    assert (p["kind"], p["page"]) == ("sheet", 2) and "seat" not in p


@needs_font
def test_unprinted_seatmark_reads_blank():
    """沒勾「加印座號劃記」的稿紙：讀起來是沒塗，交給老師指定。"""
    p = scan_one(scanned(printed("cap", "B4", seat_marks=False)[0]))
    assert p["seat"]["state"] == "blank"


@needs_font
@pytest.mark.parametrize("paper", ["A3", "B4"])
def test_udn_page_two_and_unprinted(paper):
    """聯合報國中稿紙：第 2 頁沒有座號劃記；沒加印劃記的舊稿紙第 1 頁讀起來是沒塗，但表頭截圖照樣有。"""
    p2 = scan_one(scanned(printed("udn", paper)[1]))
    assert (p2["kind"], p2["template"], p2["page"]) == ("sheet", "udn", 2) and "seat" not in p2 and "crops" not in p2
    old = scan_one(scanned(printed("udn", paper, seat_marks=False)[0]))
    assert old["seat"]["state"] == "blank" and len(old["crops"]) == 2


@needs_font
@pytest.mark.parametrize("paper", ["B4", "A3"])
def test_ucup_has_no_seat_but_header_crop(paper):
    """聯合盃稿紙沒有座號劃記（不該有、也放不下）：不回 seat，第 1 頁附入場證號碼的截圖給老師指定。"""
    pages = printed("ucup", paper)
    p1, p2 = scan_one(scanned(pages[0])), scan_one(scanned(pages[1]))
    assert (p1["kind"], p1["template"], p1["page"]) == ("sheet", "ucup", 1)
    assert "seat" not in p1 and len(p1["crops"]) == 1
    assert p2["page"] == 2 and "seat" not in p2 and "crops" not in p2


def test_blank_and_unknown_pages():
    white = np.full((2000, 2800), 255, np.uint8)
    assert scan_one(scanned(white))["kind"] == "blank"
    other = white.copy()
    for y in range(200, 1800, 60):                        # 混進來的題目卷：一行一行的字
        cv2.line(other, (200, y), (2600, y), 0, 6)
    assert scan_one(scanned(other))["kind"] == "unknown"


@needs_font
def test_pdf_pages_keep_order():
    """整份 PDF 送進來：每一頁照順序回來。"""
    import pymupdf
    r = sheet.pdf({"format": "cap", "paper": "B4", "title": "寫作", "fields": {}, "seat_marks": True})
    p1, p2 = core.seat_scan([{"name": "class.pdf", "data": core.b64(r["pdf"])}])["pages"]
    assert (p1["name"], p1["page"], p2["name"], p2["page"]) == ("class.pdf_p1", 1, "class.pdf_p2", 2)
    assert p1["seat"]["state"] == "blank"
    assert pymupdf  # 只是確認 PDF 讀得到


def test_server_route_exists():
    with pytest.raises(core.ServiceError):
        core.seat_scan([])
    assert "/seat-scan" in (server.__doc__ or "")
