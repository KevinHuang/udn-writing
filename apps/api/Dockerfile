# 使用 Node.js 20 輕量版作為基礎映像檔
FROM node:20-slim

# 設定工作目錄
WORKDIR /app

# 複製 package.json 與 package-lock.json (若有)
COPY package*.json ./

# 安裝所有相依套件（包含編譯 TypeScript 需要的 devDependencies）
RUN npm install

# 複製原始碼與 TypeScript 設定
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# 執行編譯 (產出 dist 目錄)
RUN npm run build

# 修正 ESM 衝突：在 dist 目錄建立一個 package.json 宣告為 commonjs
RUN echo '{"type": "commonjs"}' > dist/package.json

# 移除開發用的套件，只保留運行所需的生產環境套件
RUN npm prune --production

# 設定環境變數
ENV PORT=8080

# Expose port (Cloud Run 預設會看 $PORT 環境變數，通常是 8080)
EXPOSE 8080

# 啟動指令
CMD ["npm", "start"]
