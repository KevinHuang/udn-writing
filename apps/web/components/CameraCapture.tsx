import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X, RotateCcw, Check, AlertCircle, Loader2 } from 'lucide-react';

interface CameraCaptureProps {
  /** 按下「完成」時把拍到的照片交出去。空陣列不會呼叫 */
  onCapture: (files: File[]) => void;
  onClose: () => void;
  /** 開不了鏡頭時的退路，通常接到「改用上傳」的檔案選擇器 */
  onFallbackToUpload?: () => void;
}

/**
 * 相機拍照。
 *
 * **為什麼不是 `<input type="file" capture="environment">`**：`capture` 只有
 * **行動裝置**的瀏覽器會理它，桌機 Chrome／Safari 完全忽略，結果是按下
 * 「繼續拍照」只會跳出一般的檔案選擇器 —— 跟「繼續上傳」一模一樣。
 * 要在桌機真的開鏡頭，只能走 `getUserMedia`。
 *
 * ⚠️ `getUserMedia` 需要**安全環境**：https 或 localhost。
 *    正式環境如果不是 https，這個功能會整個不能用（會落到下面的錯誤狀態）。
 *
 * 可以連拍多張 —— 一篇作文常常橫跨兩三頁稿紙，而後端的 OCR 本來就會
 * 依文意把多張重新排序（見 GenAIHelper.OCR）。
 */
export const CameraCapture: React.FC<CameraCaptureProps> = ({
  onCapture,
  onClose,
  onFallbackToUpload,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  /** 已經拍下來的張數。用 object URL 做縮圖預覽 */
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);

  /** 關掉鏡頭。**一定要做** —— 不停軌道的話相機指示燈會一直亮著 */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('這個瀏覽器不支援直接拍照。請改用「繼續上傳」選擇照片檔。');
        setIsStarting(false);
        return;
      }
      try {
        // environment = 後鏡頭（手機）。桌機只有一顆，這個條件會被忽略
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException)?.name;
        setError(
          name === 'NotAllowedError'
            ? '瀏覽器擋住了相機權限。請在網址列的權限設定裡允許使用相機，或改用「繼續上傳」。'
            : name === 'NotFoundError'
              ? '找不到可用的相機。請改用「繼續上傳」選擇照片檔。'
              : '無法開啟相機，請改用「繼續上傳」選擇照片檔。',
        );
      } finally {
        if (!cancelled) setIsStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [stopStream]);

  // object URL 用完要收回去，否則每拍一張就漏一份
  useEffect(() => () => { shots.forEach((s) => URL.revokeObjectURL(s.url)); }, [shots]);

  const takeShot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setShots((prev) => [...prev, { file, url: URL.createObjectURL(blob) }]);
      },
      'image/jpeg',
      0.92,
    );
  };

  const removeShot = (index: number) =>
    setShots((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });

  const finish = () => {
    stopStream();
    onCapture(shots.map((s) => s.file));
  };

  const close = () => {
    stopStream();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex flex-col animate-fade-in">
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 shrink-0">
        <h2 className="text-title font-bold text-on-solid flex items-center gap-2">
          <Camera size={20} /> 拍攝手寫稿
        </h2>
        <button
          id="cameracapture-btn-close"
          onClick={close}
          className="tap-target p-2 rounded-full text-on-solid hover:bg-ink-900/60 transition-colors"
          title="關閉"
        >
          <X size={22} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-4 sm:px-6">
        {error ? (
          <div className="bg-card rounded-brand p-6 max-w-sm text-center space-y-4">
            <AlertCircle size={32} className="mx-auto text-danger-600" />
            <p className="text-body text-text-primary leading-relaxed">{error}</p>
            {onFallbackToUpload && (
              <button
                id="cameracapture-btn-fallback"
                onClick={() => { close(); onFallbackToUpload(); }}
                className="w-full py-2.5 bg-primary text-on-accent rounded-xl text-body hover:bg-primary/90 transition-colors"
              >
                改用上傳照片
              </button>
            )}
          </div>
        ) : (
          <div className="relative w-full h-full flex items-center justify-center">
            {isStarting && (
              <div className="absolute inset-0 flex items-center justify-center text-on-solid gap-2">
                <Loader2 size={20} className="animate-spin" /> 正在開啟相機…
              </div>
            )}
            {/* playsInline 不能少 —— iOS Safari 沒有它會強制全螢幕播放 */}
            <video
              id="cameracapture-video"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="max-w-full max-h-full rounded-brand"
            />
          </div>
        )}
      </div>

      {!error && (
        <div className="shrink-0 px-4 sm:px-6 py-4 space-y-3">
          {shots.length > 0 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {shots.map((s, i) => (
                <div key={s.url} className="relative shrink-0">
                  <img src={s.url} alt={`第 ${i + 1} 張`} className="h-16 w-16 object-cover rounded-lg" />
                  <button
                    onClick={() => removeShot(i)}
                    className="absolute -right-1 -top-1 bg-ink-900/70 text-on-solid rounded-full p-0.5 hover:bg-danger-600 transition-colors"
                    title={`刪除第 ${i + 1} 張`}
                  >
                    <X size={12} />
                  </button>
                  <span className="absolute bottom-0 left-0 right-0 text-center text-caption text-on-solid bg-ink-900/60 rounded-b-lg">
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            {shots.length > 0 && (
              <button
                id="cameracapture-btn-clear"
                onClick={() => setShots([])}
                className="px-4 py-2.5 rounded-xl text-body text-on-solid hover:bg-ink-900/60 transition-colors flex items-center gap-2"
              >
                <RotateCcw size={16} /> 全部重拍
              </button>
            )}
            <button
              id="cameracapture-btn-shoot"
              onClick={takeShot}
              disabled={isStarting}
              className="w-16 h-16 rounded-full bg-on-solid border-4 border-ink-900/30 disabled:opacity-40 transition-transform active:scale-90"
              title="拍照"
            />
            {shots.length > 0 && (
              <button
                id="cameracapture-btn-done"
                onClick={finish}
                className="px-4 py-2.5 rounded-xl text-body bg-primary text-on-accent hover:bg-primary/90 transition-colors flex items-center gap-2"
              >
                <Check size={16} /> 完成（{shots.length} 張）
              </button>
            )}
          </div>

          <p className="text-caption text-on-solid/80 text-center">
            作文跨頁時可以連拍多張，系統會依文意自動排序。
          </p>
        </div>
      )}
    </div>
  );
};
