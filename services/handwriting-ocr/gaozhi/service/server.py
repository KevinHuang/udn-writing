"""辨識服務的 HTTP 介面（Cloud Run 上執行：python -m gaozhi.service.server，連接埠看環境變數 PORT）。

只接受 JSON：
  GET  /healthz    健康檢查
  GET  /prompts    三個 preset 的系統指令與回傳格式（給工程師設定 gpt.1campus.net 後台）
  POST /check      {"files": [{"name", "data"(base64)}]}  只檢查要不要重拍（老師一上傳就先問）
  POST /prepare    {"files": [{"name", "data"(base64)}]}
  POST /assemble   {"pages": [{"meta", "warped_jpeg", "replies": [{"index", "text"}]}]}
  POST /typos      {"pages", "rule_marks", "ai_reply", "zhuyin_reply"?}
  GET  /sheet-options  稿紙格式、紙張、字數上限（「印稿紙」視窗用）
  POST /sheet      {"format", "paper", "school", "title", "fields", "seat_marks", "gsat_question"?, "output": "pdf"|"png"}

不記錄作文內容：日誌只寫網址、狀態碼與花了多久。存取控制交給 Cloud Run（只允許 Functions 的服務帳戶呼叫）。
"""
import json
import os
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .. import sheet
from . import core

MAX_BODY = 30 * 1024 * 1024          # Cloud Run 一個請求最多 32 MB


def make_sheet(req):
    try:
        with core.PDF_LOCK:                      # PyMuPDF 不能同時在兩個執行緒用（印前預覽會連續送好幾次）
            if req.get("output", "pdf") == "png":
                r = sheet.png(req)
                return {"png": core.b64(r["png"]), "paper": r["paper"],
                        "images": [{"png": core.b64(x["png"]), "label": x["label"]} for x in r["images"]]}
            r = sheet.pdf(req)
            return {"pdf": core.b64(r["pdf"]), "pages": r["pages"], "paper": r["paper"]}
    except sheet.SheetError as e:
        raise core.ServiceError(str(e))


class Handler(BaseHTTPRequestHandler):
    server_version = "gaozhi-service"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            raise core.ServiceError("需要 JSON 資料", 415)
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise core.ServiceError("資料太大（上限 30 MB）", 413)
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            raise core.ServiceError("JSON 格式錯誤")
        if not isinstance(data, dict):
            raise core.ServiceError("JSON 要是一個物件")
        return data

    def _handle(self, method):
        t0 = time.perf_counter()
        status = 200
        try:
            path = self.path.split("?", 1)[0]
            if method == "GET" and path == "/healthz":
                out = {"ok": True, "service_version": core.SERVICE_VERSION, "sheet_ready": sheet.ready()}
            elif method == "GET" and path == "/prompts":
                out = core.prompts()
            elif method == "POST" and path == "/check":
                out = core.check(self._body().get("files"))
            elif method == "POST" and path == "/prepare":
                out = core.prepare(self._body().get("files"))
            elif method == "POST" and path == "/assemble":
                out = core.assemble(self._body().get("pages"))
            elif method == "POST" and path == "/typos":
                b = self._body()
                out = core.typos(b.get("pages"), b.get("rule_marks"), b.get("ai_reply"), b.get("zhuyin_reply"))
            elif method == "GET" and path == "/sheet-options":
                out = sheet.options()
            elif method == "POST" and path == "/sheet":
                out = make_sheet(self._body())
            else:
                status, out = 404, {"error": "找不到這個網址"}
        except core.ServiceError as e:
            status, out = e.status, {"error": str(e)}
        except Exception as e:                                   # 不把內容印進日誌，只印錯誤種類與位置
            traceback.print_exc()
            status, out = 500, {"error": f"服務內部錯誤：{type(e).__name__}"}
        try:
            self._send(status, out)
        except (ConnectionError, BrokenPipeError):
            pass
        print(f"{method} {self.path.split('?', 1)[0]} {status} {time.perf_counter() - t0:.2f}s", flush=True)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def main():
    port = int(os.environ.get("PORT") or 8080)
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"辨識服務已啟動：連接埠 {port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
