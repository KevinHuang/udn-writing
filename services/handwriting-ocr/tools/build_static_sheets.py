"""產生「我的稿紙」（靜態版）放在網站上的空白稿紙 PDF 與預覽圖。

聯合報雲寫作教室的《我的稿紙》第一版是靜態的（2026-11-20 使用者決定）：稿紙在這裡先產生好、
放進 apps/web/public/sheets/，老師在網站上直接下載或列印，不用部署辨識服務、不用改資料庫。
四角一樣有定位標記，之後做逐格辨識時，這些已經印出去的稿紙照樣認得。

    cd services/handwriting-ocr
    .venv/Scripts/python.exe tools/build_static_sheets.py ../../apps/web/public/sheets

要先有全字庫正楷體（fonts/，見 README 的字型一節）。PDF 裡只要嵌了全字庫正楷體以外的字型
（例如這台電腦的標楷體）就停下來、不寫檔：那些是微軟授權給 Windows 用的，不能發給學校。

改了稿紙（樣式、表頭、這裡的清單）就重跑一次，連同產生的檔案一起 commit；
網站的清單在 apps/web/lib/answerSheets.ts，檔名要和這裡的 SHEETS 對得上（網站的測試會檢查檔案都在）。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf  # noqa: E402

from gaozhi import sheet  # noqa: E402

# 會考、學測：照 1Campus 的預設表頭（大標題「寫作測驗答案卷」、班級座號姓名、日期、得分）；
# 學校名稱留白，老師或學生手寫。學測兩題都印（考場版，正反面）。
STANDARD_HEADER = {"title": sheet.DEFAULT_TITLE, "school": "",
                   "fields": {"class_seat_name": True, "date": True, "score": True}, "seat_marks": False}

SHEETS = [
    {"format": "udn", "paper": "A3"},
    {"format": "udn", "paper": "B4"},
    {"format": "ucup", "paper": "B4"},
    {"format": "ucup", "paper": "A3"},
    {"format": "cap", "paper": "B4", **STANDARD_HEADER},
    {"format": "cap", "paper": "A3", **STANDARD_HEADER},
    {"format": "gsat", "paper": "A3", "gsat_question": "both", **STANDARD_HEADER},
    {"format": "gsat", "paper": "B4", "gsat_question": "both", **STANDARD_HEADER},
]
PREVIEW_DPI = 60          # A3 約 990×700 像素：網站上的縮圖、放大看得出版面就好


def file_stem(req):
    return f"{req['format']}_{req['paper']}"


def check_fonts(doc, name):
    fonts = {f[3] for page in doc for f in page.get_fonts()}
    bad = sorted(f for f in fonts if "TW-Kai" not in f and "TWKai" not in f.replace("-", ""))
    if bad:
        raise SystemExit(f"{name} 嵌了全字庫正楷體以外的字型：{bad}。請先把全字庫正楷體放進 fonts/。")
    return sorted(fonts)


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    if not sheet.ready():
        raise SystemExit("找不到稿紙字型（fonts/ 底下的全字庫正楷體）")
    built = []
    for req in SHEETS:
        stem = file_stem(req)
        doc, paper, _ = sheet.build(req)
        fonts = check_fonts(doc, stem)
        pdf = doc.tobytes(garbage=3, deflate=True)
        previews = [page.get_pixmap(dpi=PREVIEW_DPI).tobytes("png") for page in doc]
        built.append((stem, pdf, previews, fonts))
    # 全部產生成功、字型都檢查過才寫檔，免得留下一半新一半舊
    for stem, pdf, previews, fonts in built:
        (out / f"{stem}.pdf").write_bytes(pdf)
        for i, png in enumerate(previews, 1):
            (out / f"{stem}_p{i}.png").write_bytes(png)
        print(f"{stem}.pdf  {len(pdf) // 1024} KB  {len(previews)} 頁  字型：{', '.join(fonts) or '（沒有文字）'}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
