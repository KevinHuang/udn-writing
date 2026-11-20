"""掃描定位工具：讀取掃描圖（或 PDF），偵測四角定位標記 → 自動判斷樣式與頁碼 → 校正成標準頁面，並標出每一格。
個人化稿紙還會讀取身分碼（每人專屬：學生；全班同一張：班級＋座號劃記），依「作業／學生」分資料夾存放，並產生繳交狀況表。

用法：
  python locate.py scan.pdf                      # 定位＋辨識學生，結果放在 output/located/
  python locate.py a.pdf b.pdf c.jpg             # 一次處理多個檔案
  python locate.py scan.pdf --crops              # 另外把每一格切成小圖（給之後 OCR 用）
  python locate.py scan.jpg --no-identify        # 只定位，不辨識學生
  python locate.py scan.jpg --ppm 12             # 校正後每 mm 的像素數（預設 10，約 254dpi）
  python locate.py scan.pdf --no-ai              # 全班同一張的稿紙：只用塗卡判讀座號，不送 AI 核對手寫座號
  python locate.py --assign output/located/<作業>_<批次碼>   # 依 待確認座號.csv 填好的座號，把頁面分到學生資料夾

全班同一張的稿紙（班級碼＋座號劃記）：發卷、收卷、掃描都不必照順序。座號以塗卡為主，手寫座號只剪下那兩格
（不含姓名）送 Gemini 核對；兩者不一致或讀不到時放到 待確認座號/（見 gaozhi/classscan.py）。

原版稿紙（沒有我們印的定位標記，例如舊的作文樣本）：指定樣式，改用格線對位。每個檔案當成一篇作文。
  python locate.py 學測01.pdf --original gsat --page 2     # 學測第二大題（各頁格子相同，頁碼要指定）
  python locate.py 會考01.pdf --original cap               # 檔案裡第 1、2 頁依序當成稿紙第 1、2 頁
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

from gaozhi import layout as L

HERE = Path(__file__).resolve().parent


def load_images(path, dpi=300):
    path = Path(path)
    if path.suffix.lower() == ".pdf":
        import pymupdf
        for i, p in enumerate(pymupdf.open(path)):
            pix = p.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB)
            img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
            yield f"{path.stem}_p{i + 1}", cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    else:
        img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)  # 支援中文路徑
        if img is None:
            raise ValueError(f"無法讀取影像：{path}")
        yield path.stem, img


def detect_markers(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(L.ARUCO_DICT_ID),
                                  cv2.aruco.DetectorParameters())
    corners, ids, _ = det.detectMarkers(gray)
    if ids is None:
        return {}
    return {int(i): c.reshape(4, 2).tolist() for i, c in zip(ids.flatten(), corners)}


def identify(detected):
    """依標記 ID 投票決定樣式、紙張、頁碼與標記版本。回傳 (樣式, 紙張, 頁, 版本, 票數)。"""
    codes = {}
    for mid in detected:
        d = L.decode_marker_id(mid)
        key = (d["marker_code"], d["paper"], d["page_index"], d["version"])
        codes[key] = codes.get(key, 0) + 1
    templates = [L.load_template(tid) for tid in L.list_templates()]
    # 票數多的先看；對不到樣式、或樣式沒有那一版標記的（例如學測稿紙沒有第 3 版，多半是誤讀）跳過，看下一組
    for (code, paper, page_index, version), votes in sorted(codes.items(), key=lambda kv: -kv[1]):
        for tpl in templates:
            if tpl["marker_code"] != code or page_index >= len(tpl["pages"]):
                continue
            if version not in L.template_marker_versions(tpl):
                continue
            if version in (3, 4) and paper not in L.template_marker_papers(tpl):
                continue
            return tpl, paper, page_index, version, votes
    return None


FULL_MARKER = np.float32([[0, 0], [6, 0], [6, 6], [0, 6]])     # 完整標記四角（以格為單位）


def locate(img, ppm=10.0, refine=True):
    """回傳 dict：template、page、warped（校正後影像）、layout、homography；失敗時含 error。

    先用 ArUco 找完整的標記；不到兩個時，再找外圈被印表機切掉一排的標記（gaozhi.markerscan）。
    照片轉了 90°、180° 也可以（靠標記 ID 對應四角）。refine：再依格線微調（gaozhi.gridrefine）。
    """
    from gaozhi import gridrefine, markerscan

    points = {mid: (np.float32(c), FULL_MARKER) for mid, c in detect_markers(img).items()}
    clipped = []
    found = identify(points)
    if not found or found[4] < 2:
        for mid, (box, local, _) in markerscan.find_clipped(img).items():
            if mid not in points:
                points[mid] = (box, local)
                clipped.append(mid)
        found = identify(points)
    if not found:
        return {"error": f"找不到可辨識的定位標記（偵測到 {len(points)} 個）"}
    tpl, paper, pi, version, _ = found
    lay = L.page_layout(tpl, pi, paper, marker_version=version)
    src, dst = [], []
    for m in lay["markers"]:
        if m["id"] in points:
            box, local = points[m["id"]]
            u = m["size"] / 6
            src.extend(box)
            dst.extend([[(m["x"] + a * u) * ppm, (m["y"] + b * u) * ppm] for a, b in local])
    if len(src) < 8:
        return {"error": "可用的定位標記不足（至少需要 2 個）"}
    # 先排除明顯不合的點（1.5mm），再用全部合格的點以最小平方重算（被切過的標記角點誤差約 0.3～0.5mm）
    src, dst = np.float32(src), np.float32(dst)
    Hm, ok = cv2.findHomography(src, dst, cv2.RANSAC, 1.5 * ppm)
    if Hm is not None and ok is not None and ok.sum() >= 8:
        Hm, _ = cv2.findHomography(src[ok.ravel() > 0], dst[ok.ravel() > 0], 0)
    if Hm is None:
        return {"error": "定位標記的位置不合理，無法校正"}
    W, H = lay["paper_mm"]
    info = None
    if refine:
        warped, info = gridrefine.refine(img, Hm, lay, ppm)
    else:
        warped = cv2.warpPerspective(img, Hm, (int(round(W * ppm)), int(round(H * ppm))),
                                     flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    used = sorted(m["id"] for m in lay["markers"] if m["id"] in points)
    return {"template": tpl, "paper": paper, "page_index": pi, "layout": lay, "warped": warped, "homography": Hm,
            "markers_used": used, "markers_clipped": sorted(set(clipped) & set(used)), "marker_version": version,
            "refine": info}


def draw_overlay(warped, lay, ppm):
    out = warped.copy()
    for c in lay["cells"]:
        p0 = (int(round(c["x"] * ppm)), int(round(c["y"] * ppm)))
        p1 = (int(round((c["x"] + c["w"]) * ppm)), int(round((c["y"] + c["h"]) * ppm)))
        cv2.rectangle(out, p0, p1, (255, 120, 0), 1)
        if c["row"] == 1:
            cv2.putText(out, str(c["col"]), (p0[0] + 2, p0[1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 0, 0), 1)
    return out


def save_png(img, path):
    cv2.imencode(".png", img)[1].tofile(str(path))   # 支援中文路徑


PAGE_META_FORMAT = 1


def page_meta(r, ppm, source="", extra=None):
    """一頁的基本資料（樣式、紙張、頁碼…），存在校正頁旁邊，讓辨識等後續模組不必重新偵測。"""
    meta = {"format": PAGE_META_FORMAT, "template": r["template"]["id"], "paper": r["paper"],
            "page_index": r["page_index"], "page": r["layout"]["page"], "ppm": ppm,
            "source": source, "markers_used": r.get("markers_used", [])}
    for k in ("marker_version", "markers_clipped", "refine"):
        if r.get(k):
            meta[k] = r[k]
    meta.update(extra or {})
    return meta


def save_page(r, folder, prefix, ppm, crops=False, source="", extra=None):
    """存校正後的頁面、頁面資料（_meta.json）、疊格檢查圖，以及（選用）每一格的小圖。"""
    folder.mkdir(parents=True, exist_ok=True)
    lay = r["layout"]
    save_png(r["warped"], folder / f"{prefix}_warped.png")
    (folder / f"{prefix}_meta.json").write_text(
        json.dumps(page_meta(r, ppm, source, extra), ensure_ascii=False, indent=1), encoding="utf-8")
    save_png(draw_overlay(r["warped"], lay, ppm), folder / f"{prefix}_overlay.png")
    if crops:
        cdir = folder / f"{prefix}_cells"
        cdir.mkdir(exist_ok=True)
        for c in lay["cells"]:
            x0, y0 = int(round(c["x"] * ppm)), int(round(c["y"] * ppm))
            x1, y1 = int(round((c["x"] + c["w"]) * ppm)), int(round((c["y"] + c["h"]) * ppm))
            save_png(r["warped"][y0:y1, x0:x1], cdir / f"c{c['col']:02d}_r{c['row']:02d}.png")
        (cdir / "cells.json").write_text(json.dumps(lay["cells"], ensure_ascii=False), encoding="utf-8")


def _pages(loader, path, log):
    """逐頁讀檔；檔案壞掉或讀不到時記一行就換下一個檔案，不讓整批停下來。"""
    try:
        yield from loader(path)
    except Exception as e:
        log(f"✗ {Path(path).name}：讀不到這個檔案（{e}）")


def process(paths, outdir, ppm=10.0, crops=False, identify_students=True, log=print, use_ai=True, hand_call=None,
            loader=None):
    """處理掃描檔：定位每一頁；辨識學生身分後依「批次／學生」分資料夾存放，並更新繳交狀況。

    全班同一張的稿紙（班級碼）先收集起來，全部讀完後一次核對手寫座號再分（gaozhi/classscan.py）。
    use_ai=False：只用塗卡判讀座號。hand_call：測試用的假 AI。loader：讀檔的函式（預設 load_images；網頁版要排隊用 PyMuPDF）。
    """
    from gaozhi import batch as B
    from gaozhi import classscan, idscan

    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    batches = B.load_all() if identify_students else {}
    touched, unidentified = {}, 0
    class_items = []
    for path in paths:
        prev = None                                     # 同一個檔案的上一頁（雙面掃描：第 2 頁跟著第 1 頁）
        for name, img in _pages(loader or load_images, path, log):
            r = locate(img, ppm)
            ok = "error" not in r
            where = f"{r['template']['name']}（{r['paper']}）第 {r['layout']['page']} 頁" if ok else ""
            if not identify_students:
                if not ok:
                    log(f"✗ {name}：{r['error']}")
                    continue
                save_page(r, outdir, name, ppm, crops, source=name)
                log(f"✓ {name}：{where}（{r['layout']['label']}），使用標記 {r['markers_used']}")
                continue

            who = idscan.identify(r if ok else None, img, batches, ppm)
            if who.get("kind") == "class" and not who.get("error"):
                prev = classscan.collect(name, img, r if ok else None, who, prev, ppm)
                class_items.append(prev)
                log(f"· {name}：{where or '找不到定位標記'}，{B.class_label(who['class_name'])}（{who['batch']['title']}），"
                    "座號等全部讀完再分")
                continue
            prev = None
            st = who.get("student")
            if st:
                b = who["batch"]
                sdir = outdir / B.folder_name(b) / B.student_folder(b, st)
                touched[b["id"]] = b
                if ok:
                    save_page(r, sdir, f"第{r['layout']['page']}頁_{name}", ppm, crops, source=name,
                              extra={"batch": b["id"], "no": st["no"]})
                    note = f"（⚠ {who['warning']}）" if who.get("warning") else ""
                    log(f"✓ {name}：{where} → {b['title']}（{b['id']}）{B.label(b, st)}{note}")
                else:
                    sdir.mkdir(parents=True, exist_ok=True)
                    save_png(img, sdir / f"頁碼未知_{name}.png")
                    log(f"△ {name}：{B.label(b, st)}（{b['title']}），但找不到四角定位標記，無法判斷頁碼")
                continue

            unidentified += 1
            udir = outdir / "未辨識"
            reason = who.get("error") or "沒有讀到身分碼"
            if ok:
                save_page(r, udir, name, ppm, crops, source=name)
                log(f"? {name}：{where}，{reason} → 未辨識/")
            else:
                udir.mkdir(parents=True, exist_ok=True)
                save_png(img, udir / f"{name}.png")
                log(f"✗ {name}：{r['error']}，{reason} → 未辨識/")

    pending = 0
    if class_items:
        res = classscan.settle(class_items, outdir, ppm, crops, use_ai=use_ai, hand_call=hand_call, log=log)
        touched.update(res["touched"])
        unidentified += res["unidentified"]
        pending = res["pending"]
    summaries = {}
    for bid, b in touched.items():
        s = idscan.write_status(outdir / B.folder_name(b), b)
        summaries[bid] = s
        log(f"【{b['title']}（{bid}）】已收 {s['received']}/{s['total']} 人 → {outdir / B.folder_name(b) / '繳交狀況.csv'}")
        dup = "同一座號有兩份（可能有人塗錯）" if b.get("mode") == "class" else "重複掃描"
        for title, names in (("未繳交", s["missing"]), ("缺頁", s["partial"]), (dup, s["duplicates"])):
            if names:
                log(f"  {title}：{'、'.join(names[:15])}{f' 等 {len(names)} 人' if len(names) > 15 else ''}")
        if s.get("pending"):
            pdir = outdir / B.folder_name(b) / idscan.PENDING_DIR
            log(f"  待確認座號：{s['pending']} 張 → 在網頁「整理掃描檔」看截圖打座號；或打開 {pdir / classscan.PENDING_HTML}，"
                f"在 {classscan.PENDING_CSV} 填正確座號後執行 python locate.py --assign \"{pdir.parent}\"")
    if unidentified:
        log(f"未辨識 {unidentified} 張 → {outdir / '未辨識'}")
    return {"batches": summaries, "unidentified": unidentified, "pending": pending}


PDF_DPI = 300


def original_folder(outdir, tid):
    return Path(outdir) / f"原卷_{tid}"


def process_original(paths, outdir, tid, pages=None, ppm=10.0, crops=False, log=print):
    """原版稿紙（沒有定位標記）：用格線對位。每個檔案是一篇作文，存到 原卷_<樣式>/<檔名>/。

    pages：檔案裡每一張依序對應稿紙的第幾頁（1 起算）；不給就依序 1、2、…。
    """
    from gaozhi import gridreg

    tpl = L.load_template(tid)
    n_pages = len(tpl["pages"])
    if pages and any(not 1 <= p <= n_pages for p in pages):
        raise ValueError(f"{tpl['name']} 只有 {n_pages} 頁")
    base = original_folder(outdir, tid)
    done, failed = 0, 0
    for path in paths:
        path = Path(path)
        folder = base / path.stem
        px_per_mm = PDF_DPI / 25.4 if path.suffix.lower() == ".pdf" else None
        for i, (name, img) in enumerate(load_images(path, dpi=PDF_DPI)):
            pi = (pages[i] if pages and i < len(pages) else (pages[-1] if pages else i + 1)) - 1
            if pi >= n_pages:
                log(f"✗ {name}：檔案頁數比 {tpl['name']} 多，略過")
                failed += 1
                continue
            r = gridreg.register(img, tpl, pi, ppm=ppm, px_per_mm=px_per_mm)
            if "error" in r:
                log(f"✗ {name}：{r['error']}")
                failed += 1
                continue
            fit = r["fit"]
            save_page(r, folder, f"第{pi + 1}頁_{name}", ppm, crops, source=name,
                      extra={"method": "grid", "grid_fit": {"angle": fit["angle"], "matched_cols": fit["x"]["matched"],
                                                            "matched_rows": fit["y"]["matched"]}})
            done += 1
            log(f"✓ {name}：{tpl['name']} 第 {pi + 1} 頁（{r['layout']['label']}），歪斜 {fit['angle']}°，"
                f"格線吻合 行 {fit['x']['matched']:.0%}／列 {fit['y']['matched']:.0%} → {folder}")
    return {"done": done, "failed": failed, "folder": str(base)}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="稿紙掃描定位與學生辨識")
    ap.add_argument("scans", nargs="*", help="掃描影像（jpg/png/tif）或 PDF，可一次給多個")
    ap.add_argument("--no-ai", action="store_true", help="全班同一張：只用塗卡判讀座號（不送 AI 核對手寫座號）")
    ap.add_argument("--assign", metavar="批次資料夾", help="依 待確認座號.csv 填好的座號，把頁面分到學生資料夾")
    ap.add_argument("-o", "--outdir", default=str(HERE / "output" / "located"))
    ap.add_argument("--ppm", type=float, default=10.0, help="校正後每 mm 像素數")
    ap.add_argument("--crops", action="store_true", help="輸出每一格的小圖")
    ap.add_argument("--no-identify", action="store_true", help="不辨識學生身分（只做定位）")
    ap.add_argument("--original", metavar="樣式", choices=L.list_templates(),
                    help="原版稿紙（沒有定位標記）：指定樣式，改用格線對位")
    ap.add_argument("--page", default="", help="搭配 --original：檔案裡各張依序是稿紙第幾頁，例如 2 或 1,2")
    a = ap.parse_args()
    if a.assign:
        from gaozhi import classscan
        res = classscan.assign(a.assign)
        print(f"分好 {res['moved']} 張，還有 {res['left']} 張待確認")
        return
    if not a.scans:
        ap.error("請指定掃描檔")
    if a.original:
        pages = [int(p) for p in a.page.replace("，", ",").split(",") if p.strip()] or None
        process_original(a.scans, a.outdir, a.original, pages=pages, ppm=a.ppm, crops=a.crops)
        return
    process(a.scans, a.outdir, ppm=a.ppm, crops=a.crops, identify_students=not a.no_identify, use_ai=not a.no_ai)


if __name__ == "__main__":
    main()
