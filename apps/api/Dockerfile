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

# ── 第一階段：建置 ──────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /repo

# 先只複製 manifest，讓相依安裝這一層可以被快取
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# npm workspaces：一次裝好三個 workspace 的相依（含建置需要的 devDependencies）
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
FROM node:20-slim AS runtime
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
