import { useEffect, useState } from 'react';

const read = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * 瀏覽器可視範圍的寬高，轉動手機（orientationchange）或縮放視窗時更新。
 * 掃描畫面用它決定快門那一排放底部還是右側（lib/scan/orientation.ts）。
 *
 * 兩個事件都聽：有些 Android 瀏覽器轉向時只發 orientationchange，
 * 而且發的當下 innerWidth 還是舊值；隨後的 resize 才拿得到新尺寸。
 */
export const useViewportSize = () => {
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () => setSize(read());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return size;
};
