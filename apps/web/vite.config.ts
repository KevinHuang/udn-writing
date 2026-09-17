import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        // Vite 預設在 port 被佔用時**安靜地換一個**。那在這個專案會壞掉：
        // OAuth 的 CLIENT_HOME_PAGE 寫死指向 :3000，後端也在 :3001 ——
        // 換 port 之後 proxy 失效、登入導回不到，而畫面上看起來只是
        // 「API 都回 200 但拿到 HTML」，非常難查（實際踩過一次）。
        // 寧可起不來也不要起在錯的地方。
        strictPort: true,
        host: '0.0.0.0',
        proxy: {
          // 既有後端的路徑前綴就是這兩個，**不是 /api**
          //（apps/api/src/routes/index.ts 掛在 /service，auth 掛在 /auth）。
          // 走 proxy 而不是跨網域直連，前端才和後端同源 —— session cookie
          // 就能用 SameSite=lax，也不需要 CORS。正式環境是後端直接
          // serve 前端，同樣同源。
          //
          // ⚠️ **用正規式，不要用字串前綴。** Vite 的字串 key 是
          //    `startsWith` 比對，所以 '/service' 會**連 `/services/…` 一起吃掉**
          //    —— 當時前端有一個 `services/geminiService.ts`（Phase 5 已刪，
          //    但這條規則照樣要守，下一個 `services/` 開頭的路徑會再中一次）。
          //    它被轉到後端之後拿到的是 SPA fallback 的 index.html，
          //    瀏覽器報「Expected a JavaScript module but got text/html」，
          //    整個畫面空白。實際踩過一次，症狀離原因非常遠。
          //    `^/service/` 要求後面必須是 `/`，`/services/` 就不會中。
          '^/service/': { target: 'http://localhost:3001', changeOrigin: false },
          '^/auth/': { target: 'http://localhost:3001', changeOrigin: false },
        },
      },
      plugins: [
        react(),
        tailwindcss(),
      ],
      /*
        這裡曾經有一段 define，把 GEMINI_API_KEY 字面替換進前端 bundle ——
        任何人打開 devtools 都看得到。Phase 5 已經把 AI 呼叫整個移到後端
        （apps/web/api/ai.ts → /service/gemini/*），前端不再需要任何金鑰。
        **不要把它加回來。**
      */
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
        // monorepo 裡 npm 有可能把 react 與 react-dom 提升到不同層，
        // 兩份 React 進到同一個 bundle 會變成「Invalid hook call」——
        // 而且不是編譯期錯誤，是打開畫面才炸。實際發生過：
        // 裝 react-router-dom 時 react-dom 被重新解析到 19.3.0，
        // react 卻留在 19.2.4，兩者的 peer 要求對不上。
        dedupe: ['react', 'react-dom'],
      }
    };
});
