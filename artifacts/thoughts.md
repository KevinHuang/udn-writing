
# initial ideas #

1. 調整程式架構：目前程式是 vite + reactjs + tailwindCSS 建立的 ui prototype，需要調整成 full stack 架構，前端仍保留 vite + reactjs + tailwindCSS，後端則採用 node.js + typescript + fastify + postgres, 另外使用者登入後的 session 要存在 postgres 中。

2. 調整前端程式架構： 請使用 react-router-dom 調整前端 react 程式，使的功能都有對應的網址。

3. 根據提供的 database schema 與 ui 畫面需求，產生後端相關的 api，並套用到前端畫面上。

4. 建立相關測試案例，方便自動化測試。