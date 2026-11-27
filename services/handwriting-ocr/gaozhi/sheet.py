"""1Campus「我的稿紙」：依老師的稿紙設定產生 1Campus 稿紙 PDF（給辨識服務的 /sheet 用）。

和原型的表頭編輯器不同，這裡沒有自由排版：表頭位置固定，老師只決定
學校名稱、大標題（每次印可改）、要不要印班級座號姓名／日期／得分欄、要不要加印座號劃記；
學測稿紙另外選要印哪一題（知性題、情意題各 1 頁，或兩題都印）。
沒有身分碼（QR）。格子與四角定位標記照原樣，所以印出來的稿紙都能逐格辨識。
"""
import json
from pathlib import Path

from . import layout as L
from . import render

HEADERS = Path(__file__).resolve().parent.parent / "headers"
FORMATS = {"cap": {"label": "會考稿紙", "default_paper": "B4"},
           "gsat": {"label": "學測稿紙", "default_paper": "A3"},
           # 聯合報雲寫作教室（2026-11-20）：整頁照聯合報提供的原稿紙印、只加四角定位標記（第 4 版）。
           # 表頭是原稿紙上的，所以學校名稱、大標題、表頭欄位都不適用（給了也不印）。見 FIXED_SHEETS。
           # 座號劃記：國中稿紙可以加印（SEATMARKS），聯合盃不印。
           "udn": {"label": "聯合報國中寫作稿紙", "default_paper": "A3", "fixed_header": True},
           "ucup": {"label": "聯合盃作文大賽稿紙", "default_paper": "B4", "fixed_header": True}}
PAPERS = ("B4", "A3")
TITLE_MAX = 20
SCHOOL_MAX = 20
DEFAULT_TITLE = "寫作測驗答案卷"
# 學測稿紙要印哪一題（pages＝印樣式的第幾頁，0 起算）。和考場一樣，第一大題是知性題、第二大題是情意題。
# 四角定位標記記著是第 1 還是第 2 頁，上傳後 1Campus 依頁別預設簡易批改的版本；所以單面的情意題沿用
# 第二大題的格子與定位標記（只在上方加表頭），辨識不用改。
GSAT_QUESTIONS = {
    "analytical": {"label": "知性題", "detail": "第一大題・1 頁", "pages": [0]},
    "affective": {"label": "情意題", "detail": "第二大題・1 頁", "pages": [1]},
    "both": {"label": "兩題都印", "detail": "考場版・2 頁（正反面）", "pages": [0, 1]},
}
DEFAULT_GSAT_QUESTION = "both"        # 沒給時照舊印兩頁（還沒更新的呼叫端）
GSAT_PAGE_LABELS = ("知性題（第一大題）", "情意題（第二大題）")
PREVIEW_DPI = 90                      # 預覽圖：A3 約 1490×1050 像素，放大看得清楚校名與大標題
# 座號劃記的位置（樣式原始 mm）：印稿紙與判讀座號（gaozhi/seatread.py）共用。
# 會考稿紙印在第 1 頁右側；學測稿紙印在每一題那一頁的左上角（兩題都印時只有第一大題那一頁有）。
# 會考 x：341 → 338.4（2026-11-26 跟進 1Campus，右緣離紙邊 8mm）→ 334.9（2026-11-27 使用者看過印出來的樣子，
#   覺得還是太靠外）：右緣 352.5，和右上、右下定位標記的外緣切齊（B4 離紙邊 11.5mm、A3 13.2mm）。
#   位置是把左邊的填寫欄縮小一號、往格子靠才挪出來的（見 _cap），作答格沒有動。**和 1Campus 不一樣，跟進時不要被蓋掉。**
# 聯合報國中稿紙（2026-11-27 使用者看過示意圖、選定）：第 1 頁格子上方靠右——學生從右邊開始寫，表頭的姓名、座號欄也在右邊。
#   原稿紙那一帶是空的（y 10～38），不必動底圖；離「請從本行開始作答」的箭頭 3.5mm、離格子 6.7mm、離紙邊 9mm。
# 聯合盃稿紙**沒有**座號劃記（同一天決定）：稿紙印著「請勿填寫姓名、學校及足以辨識身份之記號」，
#   第一頁上方也只剩 25mm、放不下標準大小的圓圈。整疊掃描時照樣分成一人一份，由老師指定是誰的。
SEATMARKS = {"cap": {"x": 334.9, "y": 133, "size": 4, "orient": "col"},
             "gsat": {"x": 20, "y": 16, "size": 4, "orient": "row"},
             "udn": {"x": 250, "y": 9, "size": 4, "orient": "row"}}


class SheetError(ValueError):
    """請求內容有誤：訊息直接給老師看。"""


def ready():
    """有沒有稿紙字型（沒有就不能印；雲端映像檔建置時下載全字庫正楷體）。"""
    try:
        render.resolve_font("kai")
        return True
    except FileNotFoundError:
        return False


def options():
    return {"formats": [{"id": k, **v} for k, v in FORMATS.items()], "papers": list(PAPERS),
            "title_max": TITLE_MAX, "school_max": SCHOOL_MAX, "default_title": DEFAULT_TITLE,
            "gsat_questions": [{"id": k, "label": v["label"], "detail": v["detail"], "pages": len(v["pages"])}
                               for k, v in GSAT_QUESTIONS.items()]}


def _text(value, name, limit, required=False):
    s = "" if value is None else value
    if not isinstance(s, str):
        raise SheetError(f"{name}要是文字")
    s = " ".join(s.split())
    if required and not s:
        raise SheetError(f"請填{name}")
    if len(s) > limit:
        raise SheetError(f"{name}最多 {limit} 個字（現在 {len(s)} 個字）")
    return s


def _vtitle(text, x, y, room, size, step):
    """直排大標題：字少時照原本字級與字距，字多時一起縮小，整串放進 room（mm）。"""
    n = max(len(text), 1)
    step = min(step, room / n)
    size = min(size, step * render.MM * 0.92)
    return {"type": "text", "text": text, "x": x, "y": y, "size": round(size, 2), "char_step": round(step, 3)}


def _cap(school, title, fields, seat):
    """會考稿紙第 1 頁右側直排表頭（由右而左：學校、大標題、填寫欄）。座號劃記占用原本班級、座號兩行的位置。"""
    base = json.loads((HEADERS / "cap.json").read_text(encoding="utf-8"))
    keep = [e for e in base["pages"][0]["elements"]
            if e["type"] in ("line", "text") and e.get("text") != "寫作測驗答案卷"]
    els = keep + [_vtitle(title, 333, 22, 104, 32, 14)]
    if school:
        els.append({"type": "text", "text": school, "x": 352, "y": 20, "size": 13})
    if seat:
        els.append({"type": "seatmark", **SEATMARKS["cap"]})
        # 有座號劃記時右邊很擠（「請從本行開始作答」右緣 320.3 到定位標記外緣 352.5 之間只有 32mm，劃記就占 17.6）：
        # 填寫欄縮成 11pt、兩行各往格子靠，讓劃記整個收進定位標記以內。
        size = 11
        cols = [("班級", 331.9, 135, 30, "class"), ("姓名", 325.7, 135, 60, "name"),
                ("日期", 331.9, 182, 34, None), ("得分", 325.7, 210, 22, None)]
    else:
        size = 12
        cols = [("班級", 347.5, 135, 30, "class"), ("座號", 340.5, 135, 30, "seat"), ("姓名", 333.5, 135, 60, "name"),
                ("日期", 326.5, 135, 34, None), ("得分", 347.5, 182, 34, None)]
    for label, x, y, length, fill in cols:
        if (fill and fields.get("class_seat_name")) or (label == "日期" and fields.get("date")) \
                or (label == "得分" and fields.get("score")):
            els.append({"type": "field", "label": label, "x": x, "y": y, "size": size, "length": length})
    page2 = [e for e in base["pages"][1]["elements"] if e["type"] != "idcode"]
    return {"template": "cap", "title": title, "style": base["style"], "pages": [{"elements": els}, {"elements": page2}]}


def _gsat_header(school, fields, seat):
    """學測稿紙上方的橫排表頭：學校、填寫欄，座號劃記在左上角。第一、二大題的位置相同。"""
    els = []
    if school:
        els.append({"type": "text", "text": school, "x": 290, "y": 17, "size": 13, "vertical": False})
    if seat:
        els.append({"type": "seatmark", **SEATMARKS["gsat"]})
    if fields.get("class_seat_name"):
        els += [{"type": "field", "label": "班級", "x": 290, "y": 30, "vertical": False, "size": 12, "length": 18},
                {"type": "field", "label": "座號", "x": 323, "y": 30, "vertical": False, "size": 12, "length": 14},
                {"type": "field", "label": "姓名", "x": 352, "y": 30, "vertical": False, "size": 12, "length": 40}]
    if fields.get("date"):
        els.append({"type": "field", "label": "日期", "x": 225, "y": 30, "vertical": False, "size": 12, "length": 40})
    if fields.get("score"):
        els.append({"type": "field", "label": "得分", "x": 170, "y": 30, "vertical": False, "size": 12, "length": 30})
    return els


def _gsat(school, title, fields, seat, question):
    """學測稿紙。第 1 頁（第一大題）：上方橫排表頭，右側直排大標題。第 2 頁（第二大題）照考場沒有表頭；
    只印情意題時，第 2 頁上方加同樣的表頭，大標題改橫排置中在格子上方（右側的作答區標籤外面沒有位置直排）。"""
    base = json.loads((HEADERS / "gsat.json").read_text(encoding="utf-8"))
    keep = [e for e in base["pages"][0]["elements"]
            if e["type"] in ("line", "text", "box") and e.get("text") != "國語文寫作能力測驗"]
    page1 = keep + [{"type": "text", "text": title, "x": 411.0, "y": 62, "size": 22, "justify": 212}]   # 和考場一樣分散排滿
    page1 += _gsat_header(school, fields, seat)
    page2 = [e for e in base["pages"][1]["elements"] if e["type"] != "idcode"]
    if question == "affective":
        grid = L.load_template("gsat")["pages"][1]["grid"]
        x0, _, x1, _ = L.grid_frame(grid)
        page2 += [{"type": "text", "text": title, "x": x0, "y": 40.5, "size": 20, "vertical": False,
                   "align": "center", "w": round(x1 - x0, 3)}] + _gsat_header(school, fields, seat)
    return {"template": "gsat", "title": title, "style": base["style"], "pages": [{"elements": page1}, {"elements": page2}],
            "print_pages": GSAT_QUESTIONS[question]["pages"]}


# 照聯合報提供的原稿紙印的格式：格式 → (底圖 PDF, 標題, 每頁怎麼擺)。
# 每頁怎麼擺：None＝整頁照原樣；或是切塊重排的 pieces（見 render.build 的 background）。
# 樣式（templates/<格式>.json）的格子要和印出來的一模一樣：重排時移動格子，樣式的 x0／y0 要跟著改。
#
# 聯合盃第一頁（2026-11-20 使用者看過示意圖、選定）：原稿紙的紙用得很滿，四角放不下定位標記，所以
#   - 整片作答格往右 4mm（格子大小、行距不變）：左下角空出來，標記離格子 3mm；
#   - 初評分、複評分兩個框縮成 16mm，並排移到 Logo 正上方：讓出右上角；
#   - 入場證號碼往上 8mm：讓出右下角。
# Logo、大標題、「請勿填寫姓名」不動。四角標記都離紙邊 8mm（樣式的 marker_margins）。
UCUP_PAGE1 = [
    {"clip": [0, 0, 305.2, 257], "to": [4.0, 0]},                         # 作答格
    {"clip": [309, 30.5, 364, 226], "to": [309, 30.5]},                   # Logo、大標題、「請勿填寫姓名」
    {"clip": [305, 5, 327, 30.2], "to": [312.52, 15.12], "scale": 0.8},   # 複評分：框 x 313～329、y 16～32
    {"clip": [337.5, 5, 359.5, 30.2], "to": [330.52, 15.12], "scale": 0.8},  # 初評分：框 x 331～347
    {"clip": [310, 232.5, 354, 249], "to": [310, 224.5]},                 # 入場證號碼
]
FIXED_SHEETS = {
    "udn": ("headers/udn_original.pdf", "聯合報寫作教室 國中專用稿紙", [None, None]),
    "ucup": ("headers/ucup_original.pdf", "聯合盃作文大賽 專用稿紙", [UCUP_PAGE1, None]),
}


def _fixed(fmt, seat=False):
    """原稿紙當底圖的稿紙：兩頁都放原稿紙（Logo、QR Code、批改區、評分欄都是原稿紙的），不另畫格子與表頭。
    唯一另外畫的是座號劃記（seat=True、而且這種稿紙有位置放時，見 SEATMARKS），在第 1 頁。"""
    background, title, layouts = FIXED_SHEETS[fmt]
    pages = []
    for pno, pieces in enumerate(layouts):
        bg = {"path": background, "page": pno}
        if pieces:
            bg["pieces"] = pieces
        els = [{"type": "seatmark", **SEATMARKS[fmt]}] if seat and pno == 0 else []
        pages.append({"elements": els, "background": bg})
    return {"template": fmt, "title": title, "style": {"draw_grid": False}, "pages": pages, "print_pages": [0, 1]}


def config(req):
    """檢查請求並組成表頭設定。req：format、paper、school、title、fields{class_seat_name,date,score}、seat_marks，
    學測另有 gsat_question（analytical 知性題／affective 情意題／both 兩題都印；沒給時是 both）。
    回傳 (表頭設定, 紙張, 有沒有座號劃記)；表頭設定的 print_pages 是要印樣式的第幾頁（0 起算，會考一律兩頁）。"""
    if not isinstance(req, dict):
        raise SheetError("資料格式不對")
    fmt = req.get("format")
    if fmt not in FORMATS:
        raise SheetError("請選擇稿紙格式（會考稿紙、學測稿紙、聯合報國中寫作稿紙或聯合盃作文大賽稿紙）")
    paper = req.get("paper") or FORMATS[fmt]["default_paper"]
    if paper not in PAPERS:
        raise SheetError("紙張大小只能選 B4 或 A3")
    if FORMATS[fmt].get("fixed_header"):
        seat = bool(req.get("seat_marks")) and fmt in SEATMARKS      # 聯合盃沒有位置（也不該有）：給了也不印
        return _fixed(fmt, seat), paper, seat
    school = _text(req.get("school"), "學校名稱", SCHOOL_MAX)
    title = _text(req.get("title"), "大標題", TITLE_MAX, required=True)
    fields = req.get("fields") or {}
    if not isinstance(fields, dict):
        raise SheetError("表頭欄位格式不對")
    fields = {k: bool(fields.get(k)) for k in ("class_seat_name", "date", "score")}
    seat = bool(req.get("seat_marks"))
    if fmt == "cap":
        cfg = _cap(school, title, fields, seat)
        cfg["print_pages"] = [0, 1]
    else:
        question = req.get("gsat_question") or DEFAULT_GSAT_QUESTION
        if question not in GSAT_QUESTIONS:
            raise SheetError("請選擇要印哪一題（知性題、情意題或兩題都印）")
        cfg = _gsat(school, title, fields, seat, question)
    return cfg, paper, seat


def page_labels(cfg):
    """印出來的每一頁是哪一題（預覽圖的說明）。學測是「知性題（第一大題）」等，會考沒有。"""
    return [GSAT_PAGE_LABELS[i] if cfg["template"] == "gsat" else "" for i in cfg["print_pages"]]


def _render(cfg, paper, seat, subset=True):
    """只畫要印的頁：一頁時用 render.build 的 only_page（其他頁不放進文件）。"""
    pages = cfg["print_pages"]
    return render.build(cfg, paper=paper, context={"mode": "class"} if seat else None, subset=subset,
                        only_page=pages[0] if len(pages) == 1 else None)


def build(req):
    """回傳 (pymupdf.Document, 紙張, 每頁說明)。有字印不出來（字型缺字）或表頭擠到格子時丟 SheetError。"""
    cfg, paper, seat = config(req)
    doc, _, warnings = _render(cfg, paper, seat)
    missing = [w for w in warnings if "字型中找不到" in w]
    if missing:
        chars = "".join(sorted({c for w in missing for c in w.split("「", 1)[1].split("」", 1)[0]}))
        raise SheetError(f"這幾個字印不出來：{chars}，請換個寫法")
    if warnings:                                  # 版面本身有問題：屬於程式錯誤，不該發生
        raise RuntimeError("稿紙版面檢查沒過：" + "；".join(warnings))
    return doc, paper, page_labels(cfg)


def pdf(req):
    doc, paper, _ = build(req)
    return {"pdf": doc.tobytes(garbage=3, deflate=True), "pages": doc.page_count, "paper": paper}


def png(req, dpi=PREVIEW_DPI):
    """印前預覽：每一頁一張 PNG，和 PDF 同一份文件畫出來（印出來就是這個樣子）。png 是第 1 頁（舊的呼叫端用）。"""
    doc, paper, labels = build(req)
    images = [{"png": page.get_pixmap(dpi=dpi).tobytes("png"), "label": label} for page, label in zip(doc, labels)]
    return {"png": images[0]["png"], "images": images, "paper": paper}


def layout_ok(req):
    """測試用：要印的每一頁，表頭元素的外框（mm）兩兩不重疊，也沒有碰到作答格與定位標記。"""
    cfg, paper, seat = config(req)
    _, lay, warnings = _render(cfg, None, seat, subset=False)
    clashes = []
    for pi in cfg["print_pages"]:
        boxes = [e for e in lay["pages"][pi]["header_elements"] if e["bbox"]]
        clashes += [(a["text"], b["text"]) for k, a in enumerate(boxes) for b in boxes[k + 1:]
                    if L.rects_overlap(a["bbox"], b["bbox"], pad=0.5)]
    return warnings, clashes
