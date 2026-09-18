#!/usr/bin/env bash
#
# 部署後的冒煙測試。用法：
#
#     npm run deploy:smoke          # 自動取得 Cloud Run 網址
#     bash scripts/smoke.sh http://localhost:3000
#
# ⚠️ 全部通過**不代表資料庫連得上** —— 這四項都沒有碰到資料庫。
#    /service/* 會被登入守門擋在 401，走不到 Postgres。
#    資料庫要到實際登入（寫 session）才會用到。
set -uo pipefail

URL="${1:?用法: smoke.sh <base-url>}"
URL="${URL%/}"
fail=0

check() {
  local path="$1" want_code="$2" want_type="$3" note="$4"
  local out code type
  out=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$URL$path")
  code="${out%% *}"; type="${out#* }"

  if [[ "$code" != "$want_code" ]]; then
    printf '  ✗ %-22s 狀態碼 %s，預期 %s  (%s)\n' "$path" "$code" "$want_code" "$note"
    fail=1
  elif [[ -n "$want_type" && "$type" != *"$want_type"* ]]; then
    printf '  ✗ %-22s 型態 %s，預期含 %s  (%s)\n' "$path" "$type" "$want_type" "$note"
    fail=1
  else
    printf '  ✓ %-22s %s %s\n' "$path" "$code" "$type"
  fi
}

echo "冒煙測試：$URL"
check /                  200 text/html         "首頁送得出前端"
check /auth/me           401 ""                "未登入應為 401，不是 500"
check /service/nonsense  404 application/json  "打錯的 API 要回 JSON，不能回 index.html"
check /courses           200 text/html         "SPA fallback：前端路由要拿得到 index.html"

if [[ $fail -eq 0 ]]; then
  echo "全部通過（但資料庫連線仍未驗證 —— 要實際登入一次）"
else
  echo "有項目失敗"
fi
exit $fail
