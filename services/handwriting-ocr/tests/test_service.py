"""辨識服務（不連網）：/prepare → 假的 AI 回應 → /assemble → /typos，擋下的情況，以及產生稿紙 /sheet。

稿紙圖在 tests/fixtures/，是電腦合成的範例（印上去的字），不是學生作文。
"""
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import pytest

from gaozhi import render, sheet
from gaozhi.service import core, server

FIX = Path(__file__).parent / "fixtures"
# 會考稿紙第 1 頁：第 1 行兩格空白後「我很放心在家」，第 2 行從第 1 格「，再見」（標點在行首）
TEXT = {(1, 3): "我", (1, 4): "很", (1, 5): "放", (1, 6): "心", (1, 7): "在", (1, 8): "家",
        (2, 1): "，", (2, 2): "再", (2, 3): "見"}


def f(name):
    return {"name": name, "data": core.b64((FIX / name).read_bytes())}


def reply_for(strip, truth):
    """假的「稿紙逐格辨識」preset 回應：照正確答案，格式和真的 preset 一樣。"""
    cols = [{"col": c, "cells": [{"row": r, "text": t} for (cc, r), t in sorted(truth.items()) if cc == c]}
            for c in strip["cols"]]
    return json.dumps({"columns": cols, "margin": []}, ensure_ascii=False)


def assemble(page, truth):
    return core.assemble([{"meta": page["meta"], "warped_jpeg": page["warped_jpeg"],
                           "replies": [{"index": s["index"], "text": reply_for(s, truth)} for s in page["strips"]]}])


@pytest.fixture(scope="module")
def page():
    prep = core.prepare([f("cap_p1.png")])
    assert prep["ours"] and prep["ok"]
    [p] = prep["pages"]
    return p


def test_full_flow(page):
    assert page["template"] == "cap" and page["page"] == 1 and page["strips"]
    assert page["strips"][0]["cols"][:2] == [1, 2] and page["strips"][0]["images"][0]["png"]
    asm = assemble(page, TEXT)
    assert asm["text"].replace("\n", "") == "　　我很放心在家，再見"
    assert asm["chars"] == 9 and asm["paragraphs"] == 1 and asm["completion"] == 1.0
    assert [x["type"] for x in asm["format"]] == ["標點在行首"]
    assert asm["typo_request"]["prompt"].endswith("1　我很放心在家，再見")
    ai = {"errors": [{"context": "放心在家", "wrong": "在", "correct": "再", "type": "別字", "reason": "示範",
                      "confidence": "high"}]}
    res = core.typos(asm["pages"], asm["rule_marks"], json.dumps(ai, ensure_ascii=False))
    [m] = res["marks"]
    assert res["done"] and m["keys"] == ["第1頁:1:7"] and m["kind"] == "typo" and m["trusted"]


def test_indent_and_uncertain(page):
    asm = assemble(page, {**TEXT, (2, 1): "再", (2, 2): "見", (2, 3): "啊"})
    assert [(x["type"], x["keys"]) for x in asm["format"]] == [("段首空兩格", ["第1頁:2:1"])]
    asm = assemble(page, {**TEXT, (1, 7): "[?]"})
    assert core.MARK in asm["marked_text"] and asm["completion"] < 1
    ai = {"errors": [{"context": "心□家", "wrong": "□", "correct": "再", "type": "錯字", "reason": "x", "confidence": "low"}]}
    res = core.typos(asm["pages"], asm["rule_marks"], json.dumps(ai, ensure_ascii=False))
    assert all(m["kind"] == "check" for m in res["marks"])            # 辨識不確定：只能是待確認


def test_missing_reply_is_a_warning(page):
    asm = core.assemble([{"meta": page["meta"], "warped_jpeg": page["warped_jpeg"], "replies": []}])
    assert asm["warnings"] and asm["counts"]["agree"] == 0


def test_blocked_cases():
    blank = {"name": "blank.png", "data": core.b64(cv2.imencode(".png", np.full((500, 400, 3), 255, np.uint8))[1].tobytes())}
    assert core.prepare([blank])["ours"] is False                                  # 一般稿紙：改用原本的辨識
    assert core.prepare([f("cap_p1.png"), blank])["problems"][0]["code"] == "markers_missing"
    assert [p["code"] for p in core.prepare([f("cap_p1.png"), f("cap_p1.png")])["problems"]] == ["duplicate_page"]
    assert core.prepare([f("cap_p1.png"), f("cap_p2.png")])["ok"]                   # 會考兩頁是同一篇
    r = core.prepare([f("gsat_p1.png"), f("gsat_p2.png")])
    assert [p["code"] for p in r["problems"]] == ["two_questions"]                  # 學測兩題混在一起
    with pytest.raises(core.ServiceError):
        core.prepare([{"name": "bad", "data": "不是base64"}])


def without_corner(name, corner):
    """把稿紙圖某一角的定位標記塗白（模擬標記沒拍清楚）。"""
    img = cv2.imread(str(FIX / name))
    h, w = img.shape[:2]
    bw, bh = int(w * 0.05), int(h * 0.065)
    y0 = 0 if corner[0] == "t" else h - bh
    x0 = 0 if corner[1] == "l" else w - bw
    img[y0:y0 + bh, x0:x0 + bw] = 255
    return {"name": "第1張", "data": core.b64(cv2.imencode(".png", img)[1].tobytes())}


def test_check():
    ok = core.check([f("cap_p1.png"), f("cap_p2.png")])
    assert ok["ours"] and ok["ok"] and [p["page"] for p in ok["pages"]] == [1, 2]
    assert "strips" not in ok["pages"][0]                                           # 只檢查，不切小圖
    blank = {"name": "blank.png", "data": core.b64(cv2.imencode(".png", np.full((500, 400, 3), 255, np.uint8))[1].tobytes())}
    assert core.check([blank])["ours"] is False
    assert [p["code"] for p in core.check([f("cap_p1.png"), f("cap_p1.png")])["problems"]] == ["duplicate_page"]


def test_three_corners_needs_reshoot():
    sheet3 = without_corner("cap_p1.png", "bl")
    for result in (core.check([sheet3]), core.prepare([sheet3])):                   # 兩邊判斷一致
        assert result["ours"] and not result["ok"]
        [problem] = result["problems"]
        assert problem["code"] == "markers_incomplete" and problem["names"] == ["第1張"]
        assert problem["message"].startswith("第1張的左下角定位標記看不清楚")


def without_markers(name, rotate=None):
    """把稿紙圖四個角的定位標記都塗白：模擬考場原版（或學校影印）的答案卷，格子一樣、沒有定位標記。"""
    img = cv2.imread(str(FIX / name))
    h, w = img.shape[:2]
    bw, bh = int(w * 0.05), int(h * 0.065)
    for y0 in (0, h - bh):
        for x0 in (0, w - bw):
            img[y0:y0 + bh, x0:x0 + bw] = 255
    if rotate is not None:
        img = cv2.rotate(img, rotate)
    return {"name": "第1張", "data": core.b64(cv2.imencode(".png", img)[1].tobytes())}


def test_original_gsat_sheet_is_flagged():
    # 直拍的照片（轉了 90°）也認得出來
    for photo in (without_markers("gsat_p1.png"), without_markers("gsat_p2.png", cv2.ROTATE_90_CLOCKWISE)):
        for result in (core.check([photo]), core.prepare([photo])):                 # 兩邊判斷一致
            assert result["ours"] is False and result["original_gsat"] is True
            assert result["original_gsat_names"] == ["第1張"]
            assert "原版學測答案卷" in result["reason"]


def test_other_sheets_are_not_original_gsat():
    blank = {"name": "blank.png", "data": core.b64(cv2.imencode(".png", np.full((500, 700, 3), 255, np.uint8))[1].tobytes())}
    for photo in (without_markers("cap_p1.png"), blank):                            # 會考格子、白紙：照舊整張辨識
        result = core.check([photo])
        assert result["ours"] is False and "original_gsat" not in result
    assert core.check([f("gsat_p1.png")])["ours"] is True                           # 1Campus 學測稿紙照常逐格辨識


def test_misaligned_grid_needs_reshoot(monkeypatch):
    real = core.LC.locate

    def skewed(img, ppm=10.0, refine=True):
        """格線微調沒套用、只靠定位標記拉正偏 1.15mm（2026-11-04 照片縮成 1600 時實際遇到的數字）。"""
        r = real(img, ppm, refine=refine)
        if refine and "error" not in r:
            r["refine"] = {"applied": False, "before_mm": 1.15, "found": 0.65}
        return r

    monkeypatch.setattr(core.LC, "locate", skewed)
    assert core.check([f("cap_p1.png")])["ok"]                                       # 先檢查不微調：還發現不了
    result = core.prepare([f("cap_p1.png")])
    assert result["ours"] and not result["ok"]
    [problem] = result["problems"]
    assert problem["code"] == "grid_misaligned" and problem["names"] == ["cap_p1.png"]
    assert problem["message"] == "cap_p1.png的格子對不準，請重拍（紙要攤平、從正上方拍）"


def test_misaligned_threshold():
    assert core.misaligned({"refine": {"applied": False, "before_mm": 1.15}})
    assert not core.misaligned({"refine": {"applied": False, "before_mm": 0.3}})     # 只靠標記拉正也夠準
    assert not core.misaligned({"refine": {"applied": True, "before_mm": 1.5}})      # 微調過了
    assert not core.misaligned({"refine": None})                                      # /check 沒有微調資料


def test_http():
    srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        with urllib.request.urlopen(base + "/healthz") as r:
            assert json.loads(r.read())["ok"]
        with urllib.request.urlopen(base + "/prompts") as r:
            assert "照原樣" in json.loads(r.read())["稿紙逐格辨識"]["system"]
        req = urllib.request.Request(base + "/prepare", data=b"{}", method="POST", headers={"Content-Type": "application/json"})
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req)
        assert e.value.code == 400
    finally:
        srv.shutdown()
        srv.server_close()


# ---- 產生稿紙（/sheet）----
needs_font = pytest.mark.skipif(not render.available_fonts(), reason="這台電腦沒有稿紙字型（標楷體或全字庫正楷體）")
ALL = {"class_seat_name": True, "date": True, "score": True}


def sheet_req(**kw):
    return {"format": "cap", "school": "臺北市立示範國民中學", "title": "寫作練習：我的志願", "fields": ALL, **kw}


@needs_font
@pytest.mark.parametrize("fmt", ["cap", "gsat"])
@pytest.mark.parametrize("seat", [False, True])
@pytest.mark.parametrize("title", ["寫作", "一一四學年度第一學期七年級寫作練習三"])
def test_sheet_layout(fmt, seat, title):
    warnings, clashes = sheet.layout_ok(sheet_req(format=fmt, seat_marks=seat, title=title,
                                                  school="臺北市立第一示範國民中學附設實驗班"))
    mine = {"", title, "臺北市立第一示範國民中學附設實驗班", "班級", "座號", "姓名", "日期", "得分", "座號劃記"}
    assert warnings == []
    assert [c for c in clashes if c[0] in mine and c[1] in mine] == []        # 新加的表頭彼此不重疊


@needs_font
@pytest.mark.parametrize("question", ["analytical", "affective"])
@pytest.mark.parametrize("seat", [False, True])
@pytest.mark.parametrize("title", ["寫作", "一一四學年度第一學期高三國寫練習三"])
def test_gsat_single_layout(question, seat, title):
    """學測單面稿紙（只印知性題／只印情意題）：表頭不壓到格子、定位標記，彼此也不重疊。"""
    school = "臺北市立第一示範國民中學附設實驗班"
    warnings, clashes = sheet.layout_ok(sheet_req(format="gsat", gsat_question=question, seat_marks=seat, title=title,
                                                  school=school))
    mine = {"", title, school, "班級", "座號", "姓名", "日期", "得分", "座號劃記"}
    assert warnings == []
    assert [c for c in clashes if c[0] in mine and c[1] in mine] == []


def _printed_pages(pdf_bytes, dpi=100):
    import pymupdf
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    return [{"name": f"p{i}.png", "data": core.b64(pg.get_pixmap(dpi=dpi).tobytes("png"))} for i, pg in enumerate(doc)]


@needs_font
@pytest.mark.parametrize("fmt,paper", [("cap", "B4"), ("cap", "A3"), ("gsat", "A3"), ("gsat", "B4")])
def test_sheet_is_recognised(fmt, paper):
    """印出來的稿紙兩頁都認得出格式、頁碼與紙張（辨識服務靠四角定位標記）。"""
    r = sheet.pdf(sheet_req(format=fmt, paper=paper, seat_marks=True))
    assert r["pages"] == 2 and r["paper"] == paper and r["pdf"][:4] == b"%PDF"
    for i, f1 in enumerate(_printed_pages(r["pdf"])):
        prep = core.prepare([f1])
        assert prep["ours"] and prep["ok"], prep
        [p] = prep["pages"]
        assert (p["template"], p["page"], p["paper"]) == (fmt, i + 1, paper)


@needs_font
@pytest.mark.parametrize("question,page", [("analytical", 1), ("affective", 2)])
@pytest.mark.parametrize("paper", ["A3", "B4"])
def test_gsat_single_is_recognised(question, page, paper):
    """單面只有 1 頁：知性題認成第 1 頁、情意題認成第 2 頁（1Campus 依頁別預設簡易批改的版本）；
    加在情意題上方的表頭與大標題不會被當成格子裡的字。"""
    r = sheet.pdf(sheet_req(format="gsat", gsat_question=question, paper=paper, seat_marks=True))
    assert r["pages"] == 1 and r["paper"] == paper
    [f1] = _printed_pages(r["pdf"])
    prep = core.prepare([f1])
    assert prep["ours"] and prep["ok"], prep
    [p] = prep["pages"]
    assert (p["template"], p["page"], p["paper"], p["ink_cells"]) == ("gsat", page, paper, 0)


@needs_font
def test_gsat_previews():
    """預覽圖：每一頁一張、附上是哪一題。只印知性題那一頁和兩題都印的第 1 頁一模一樣；情意題單面多了表頭。"""
    both = sheet.png(sheet_req(format="gsat"))
    analytical = sheet.png(sheet_req(format="gsat", gsat_question="analytical"))
    affective = sheet.png(sheet_req(format="gsat", gsat_question="affective"))
    assert [x["label"] for x in both["images"]] == ["知性題（第一大題）", "情意題（第二大題）"]
    assert [x["label"] for x in analytical["images"]] == ["知性題（第一大題）"]
    assert [x["label"] for x in affective["images"]] == ["情意題（第二大題）"]
    assert analytical["images"][0]["png"] == both["images"][0]["png"]
    assert affective["images"][0]["png"] != both["images"][1]["png"]
    assert both["png"] == both["images"][0]["png"]                                   # 舊的呼叫端讀 png：第 1 頁
    cap = sheet.png(sheet_req(format="cap", gsat_question="affective"))                # 會考不分題，一律兩頁
    assert [x["label"] for x in cap["images"]] == ["", ""]


def test_sheet_options_and_errors():
    o = sheet.options()
    # udn、ucup：聯合報雲寫作教室加的聯合報國中寫作稿紙、聯合盃作文大賽稿紙（見 test_udn.py）
    assert [(f["id"], f["default_paper"]) for f in o["formats"]] == [("cap", "B4"), ("gsat", "A3"), ("udn", "A3"), ("ucup", "B4")]
    assert o["title_max"] == 20 and o["default_title"] == "寫作測驗答案卷"
    assert [(q["id"], q["label"], q["pages"]) for q in o["gsat_questions"]] == [
        ("analytical", "知性題", 1), ("affective", "情意題", 1), ("both", "兩題都印", 2)]
    for req, msg in [({"title": "寫作"}, "稿紙格式"), (sheet_req(paper="A4"), "B4 或 A3"), (sheet_req(title="  "), "大標題"),
                     (sheet_req(title="字" * 21), "最多 20 個字"), (sheet_req(school="校" * 21), "最多 20 個字"),
                     (sheet_req(format="gsat", gsat_question="essay"), "要印哪一題")]:
        with pytest.raises(sheet.SheetError, match=msg):
            sheet.config(req)
    assert sheet.config(sheet_req(title=" 寫作\n練習 "))[0]["title"] == "寫作 練習"   # 換行、多餘空白收成一格
    assert sheet.config(sheet_req(format="gsat", paper=None))[1] == "A3"            # 沒給紙張：跟著格式預設
    assert sheet.config(sheet_req(format="gsat"))[0]["print_pages"] == [0, 1]       # 沒選哪一題：照舊兩題都印
    assert sheet.config(sheet_req(format="gsat", gsat_question="affective"))[0]["print_pages"] == [1]
    assert sheet.config(sheet_req(gsat_question="affective"))[0]["print_pages"] == [0, 1]   # 會考不分題


@needs_font
def test_sheet_http():
    srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"

    def post(body):
        req = urllib.request.Request(base + "/sheet", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req).read())
    try:
        with urllib.request.urlopen(base + "/sheet-options") as r:
            assert json.loads(r.read())["papers"] == ["B4", "A3"]
        assert core.unb64(post(sheet_req())["pdf"])[:4] == b"%PDF"
        assert core.unb64(post(sheet_req(output="png"))["png"])[1:4] == b"PNG"
        single = post(sheet_req(format="gsat", gsat_question="affective"))
        assert single["pages"] == 1 and core.unb64(single["pdf"])[:4] == b"%PDF"
        preview = post(sheet_req(format="gsat", gsat_question="affective", output="png"))
        assert [x["label"] for x in preview["images"]] == ["情意題（第二大題）"]
        assert core.unb64(preview["images"][0]["png"])[1:4] == b"PNG" and preview["paper"] == "A3"
        with pytest.raises(urllib.error.HTTPError) as e:
            post({"title": "寫作"})
        assert e.value.code == 400 and "稿紙格式" in json.loads(e.value.read())["error"]
    finally:
        srv.shutdown()
        srv.server_close()


# ---- 定位標記第 3 版（會考稿紙往內移，油印、影印時不容易被裁到）----
def test_marker_ids_do_not_overlap_between_versions():
    from gaozhi import layout as L
    seen = {}
    for code in range(4):
        for paper in ("A3", "B4"):
            for pi in range(2):
                for ci in range(4):
                    for v in (1, 2, 3):
                        mid = L.marker_id(code, paper, pi, ci, v)
                        assert mid < 250 and mid not in seen, (mid, seen.get(mid))
                        seen[mid] = (code, paper, pi, ci, v)
                        d = L.decode_marker_id(mid)
                        assert (d["marker_code"], d["paper"], d["page_index"], d["version"]) == (code, paper, pi, v)
    with pytest.raises(ValueError):
        L.marker_id(4, "A3", 0, 0, 1)


def test_cap_uses_v3_markers_further_from_the_edge():
    from gaozhi import layout as L
    from gaozhi import markerscan
    cap, gsat = L.load_template("cap"), L.load_template("gsat")
    assert L.template_marker_version(cap) == 3 and L.template_marker_version(gsat) == 2
    for paper, margin in (("B4", 11.5), ("A3", 12.0)):
        for pi in (0, 1):
            lay = L.page_layout(cap, pi, paper)
            W, H = lay["paper_mm"]
            for m in lay["markers"]:
                assert L.decode_marker_id(m["id"])["version"] == 3
                dx = m["x"] if m["corner"] in ("tl", "bl") else W - m["x"] - m["size"]
                dy = m["y"] if m["corner"] in ("tl", "tr") else H - m["y"] - m["size"]
                assert (dx, dy) == (margin, margin)
                assert not L.rects_overlap((m["x"], m["y"], m["x"] + 6, m["y"] + 6), lay["grid_frame"], pad=3)
    # 已經印出去的第 2 版：掃描時照讀到的版本算位置，和以前一樣離紙邊 8mm
    old = L.page_layout(cap, 0, "B4", marker_version=2)["markers"][0]
    assert (old["x"], old["y"]) == (8.0, 8.0)
    ids = {mid for _, (_, meta) in markerscan.patterns().items() for mid, _ in meta}
    assert L.marker_id(1, "B4", 0, 0, 3) in ids and L.marker_id(0, "A3", 0, 0, 3) not in ids


def test_identify_skips_v3_ids_of_templates_without_v3():
    """學測稿紙沒有第 3 版：誤讀出第 3 版的 ID 時跳過（不能丟例外），有別組票就用別組。"""
    import locate as LC
    from gaozhi import layout as L
    gsat_v3 = [L.marker_id(0, "A3", 0, ci, 3) for ci in range(3)]
    assert LC.identify({mid: None for mid in gsat_v3}) is None
    gsat_v2 = [L.marker_id(0, "A3", 0, ci, 2) for ci in range(2)]
    tpl, paper, page_index, version, votes = LC.identify({mid: None for mid in gsat_v3 + gsat_v2})
    assert (tpl["id"], paper, page_index, version, votes) == ("gsat", "A3", 0, 2, 2)
    cap_v3 = [L.marker_id(1, "B4", 1, ci, 3) for ci in range(4)]
    tpl, paper, page_index, version, votes = LC.identify({mid: None for mid in cap_v3})
    assert (tpl["id"], paper, page_index, version, votes) == ("cap", "B4", 1, 3, 4)


@needs_font
@pytest.mark.parametrize("paper", ["B4", "A3"])
def test_old_v2_cap_sheet_still_recognised(paper, monkeypatch):
    """新的會考稿紙用第 3 版；之前印出去的第 2 版（離紙邊 8mm）照樣認得出、格子對得準。"""
    from gaozhi import layout as L
    orig = L.load_template
    monkeypatch.setattr(L, "load_template",
                        lambda tid: {k: v for k, v in orig(tid).items() if k != "marker_margins"})
    old_pdf = sheet.pdf(sheet_req(paper=paper))["pdf"]
    monkeypatch.setattr(L, "load_template", orig)
    new_pdf = sheet.pdf(sheet_req(paper=paper))["pdf"]
    for pdf_bytes, version in ((old_pdf, 2), (new_pdf, 3)):
        for i, f1 in enumerate(_printed_pages(pdf_bytes)):
            prep = core.prepare([f1])
            assert prep["ours"] and prep["ok"], prep
            [p] = prep["pages"]
            assert (p["page"], p["meta"]["marker_version"], p["ink_cells"]) == (i + 1, version, 0)
            assert p["meta"]["refine"]["before_mm"] < 0.3
