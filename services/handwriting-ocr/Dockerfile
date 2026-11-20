# 辨識服務（給 1Campus Write 呼叫）：Cloud Run，asia-east1。說明見 README.md
FROM python:3.14-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY locate.py ./
COPY gaozhi ./gaozhi
COPY templates ./templates
COPY headers ./headers
# 稿紙字型：全字庫正楷體（TW-Kai，國家發展委員會全字庫，政府資料開放授權條款第 1 版）。雲端沒有 Windows 的標楷體。
# 下載失敗不擋建置（辨識照常），但 /sheet 不能用：/healthz 的 sheet_ready 會是 false。
# 全字庫網站的憑證缺 Subject Key Identifier，Python 3.13 起預設的嚴格檢查（VERIFY_X509_STRICT）會擋下，
# 所以只關掉這一項；憑證鏈與主機名稱照常驗證。
RUN mkdir -p fonts && python -c "import io, ssl, urllib.request, zipfile; ctx = ssl.create_default_context(); ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT; z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen('https://www.cns11643.gov.tw/opendata/Fonts_Kai.zip', timeout=600, context=ctx).read())); [open('fonts/' + n, 'wb').write(z.read(n)) for n in z.namelist() if n.startswith('TW-Kai-') and n.endswith('.ttf')]" || echo "TW-Kai skipped"
# 教育部《重編國語辭典修訂本》（CC BY-ND 3.0 TW，g0v moedict-data），只用來比對成語錯字。
# 建置時下載並建好索引；下載失敗不擋建置，服務照樣能跑，只是不比對成語。
RUN python -c "from gaozhi.grading import dictionary as d; d.download(); d.load()" || echo "moedict skipped"

ENV PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8
CMD ["python", "-m", "gaozhi.service.server"]
