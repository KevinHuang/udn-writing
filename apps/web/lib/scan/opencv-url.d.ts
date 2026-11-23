/*
  Vite 的 `?url` 匯入：回傳檔案部署後的網址，不把內容打包進 JS。
  tsconfig 的 types 只有 node（沒有 vite/client），所以在這裡補上這一種就好。
  目前只有 lib/scan/opencv.ts 用它把 OpenCV.js 跟著網站一起部署。
*/
declare module '*?url' {
  const url: string;
  export default url;
}
