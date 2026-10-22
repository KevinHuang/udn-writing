# ============================================================
# udn-writing-classroom —— 後端 + 前端打包成一個 Cloud Run 服務
# ============================================================
#
# ⚠️ **build context 是 repo 根目錄，不是 apps/api。**
#    這是 monorepo：前端在 apps/web、共用型別在 packages/shared。
#    建置指令要在根目錄下：
#
#        gcloud builds submit --config cloudbuild.yaml
#
#    （舊的 Dockerfile 假設 context 是 apps/api，改成 monorepo 之後
#      連 tsconfig.build.json 都沒複製進去，建置一定失敗。）
#
# 產出的映像檔長這樣：
#     /app/dist          apps/api 編譯後的 JS
#     /app/public        apps/web 的建置產物（後端用 koa-static 送出去）
#     /app/node_modules  只有 production 相依
#
# `/app/public` 這個位置是 app.ts 寫死的（`path.join(__dirname, '../public')`），
# 不要改。

# Node 版本。兩個階段共用這一個值，要升級只改這裡（本機的 .nvmrc 一起改）。
#
# 26.12.1 是 2026-10-21 安全更新（Brotli 遠端執行程式碼 CVE-2026-111497、
# TLS 主機名稱繞過 CVE-2026-106069 等）的最低版本，不要往回調。
# 原本是 node:20-slim —— Node 20 在 2026-04-30 就停止支援，這次的修補**根本不會出**
# （Docker Hub 上的 node:20-slim 最後一次更新是 2026-04-22）。
#
# 刻意釘到完整版號、不用浮動的 node:26-slim：每次建出來的東西要一樣，
# 代價是之後的安全更新要有人回來改這個數字。
# 26.12.1-slim 是 Debian 13（trixie），原本的 node:20-slim 是 Debian 12（bookworm）；
# 這裡沒有 apt-get 裝任何東西，所以沒有影響。
ARG NODE_VERSION=26.12.1

# ── 第一階段：建置 ──────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /repo

# 先只複製 manifest，讓相依安裝這一層可以被快取
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# npm workspaces：一次裝好三個 workspace 的相依（含建置需要的 devDependencies）
#
# Node 26 附的 npm 11 **預設不執行相依套件的安裝腳本**，建置紀錄最後會列出
# @google/genai、esbuild、fsevents、protobufjs 被略過（`npm warn install-scripts`）。這不是錯誤：
# esbuild 從各平台的 @esbuild/* 套件找原生檔，不靠 postinstall；fsevents 只在 macOS 用；
# protobufjs 的 postinstall 只是版本檢查；@google/genai 的 preinstall 只有一行 echo。
# 略過的情況下建置、測試都實測通過（2026-10-22）。
RUN npm ci

# 原始碼。
# ⚠️ 根目錄**沒有** tsconfig.json —— 每個 workspace 各自有一份。
#    先前寫 `COPY tsconfig*.json ./` 會因為找不到檔案而讓建置失敗。
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# 前端。產出在 apps/web/dist
RUN npm run build -w @udn/web

# 後端。tsconfig.build.json 會排除 src/test/**
RUN npm run build -w @udn/api

# ── 第二階段：執行 ──────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# apps/api 的相依是自足的（沒有用到 @udn/shared 的執行期程式碼），
# 所以這裡可以只裝它自己的 production 相依，不需要整個 workspace。
COPY apps/api/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/apps/web/dist ./public

# dist 裡的 .js 要當成 CommonJS 解讀。
# 根目錄的 package.json 沒有 "type"，預設就是 commonjs，這行是保險。
RUN echo '{"type":"commonjs"}' > dist/package.json

# Cloud Run 會注入 PORT，這裡只是本機直接跑時的預設值
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
