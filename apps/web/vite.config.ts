import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // 既有後端的路徑前綴就是這兩個，**不是 /api**
          //（apps/api/src/routes/index.ts 掛在 /service，auth 掛在 /auth）。
          // 走 proxy 而不是跨網域直連，前端才和後端同源 —— session cookie
          // 就能用 SameSite=lax，也不需要 CORS。正式環境是後端直接
          // serve 前端，同樣同源。
          '/service': { target: 'http://localhost:3001', changeOrigin: false },
          '/auth': { target: 'http://localhost:3001', changeOrigin: false },
        },
      },
      plugins: [
        react(),
        tailwindcss(),
      ],
      define: {
        // 注意：這是把金鑰字面替換進前端 bundle。展示原型可以接受，
        // 但任何人打開 devtools 都看得到 —— 真的要上線時，Gemini 呼叫
        // 必須移到後端，前端只呼叫自己的 API。
        // env.API_KEY 這個舊名稱已經沒有程式在讀，故不再注入。
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY ?? ''),
      },
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
