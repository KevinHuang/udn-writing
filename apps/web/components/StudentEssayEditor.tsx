import { useNavigate } from 'react-router-dom';
import { routes } from '../lib/routes';
import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, 
  Send, 
  Save, 
  Clock, 
  CheckCircle2, 
  Loader2, 
  Info, 
  FileText,
  ScanLine,
  Keyboard,
  Image as ImageIcon,
  X,
  AlertCircle
} from 'lucide-react';
import { Assignment, Question, Submission } from '../types';
import { extractTextFromImage } from '../api/ai';
import { ApiError } from '../api/client';
import { fileToBase64 } from '../lib/fileToBase64';
import {
  hasDeadline,
  deadlineLabel,
  NO_DEADLINE_LABEL,
  assignmentPhase,
  canStudentSubmit,
} from '../lib/assignments';
import { DocumentScannerModal, type ScannedPage } from './scan/DocumentScannerModal';
import { blobToBase64 } from '../lib/scan/image';
import { countWords } from '../lib/wordCount';

/**
 * 送出／存草稿失敗時給學生看的話。
 *
 * 後端有講原因的（截止了、已經批改過）照實說 —— 那是學生能理解、也能據以行動的；
 * 其餘才當作網路問題。一律寫「請檢查網路連線」會讓截止後才交的學生一直重試。
 */
function failureMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.status === 409 ? err.message : fallback;
}

interface StudentEssayEditorProps {
  assignment: Assignment;
  question: Question;
  existingSubmission?: Submission;
  onBack?: () => void;
  canGoBack?: boolean;
  /**
   * 送出。wordCount 由這個元件算好一起帶出去，不要在別處重算。
   * picFiles 是手寫原稿在 GCS 的相對路徑。
   */
  onSubmit: (content: string, wordCount: number, picFiles: string[]) => Promise<void>;
  /** 存草稿。存起來但不算送出（submission.is_submitted = false） */
  onSaveDraft: (content: string, wordCount: number, picFiles: string[]) => Promise<void>;
}

export const StudentEssayEditor: React.FC<StudentEssayEditorProps> = ({
  assignment,
  question,
  existingSubmission,
  onBack,
  canGoBack,
  onSubmit,
  onSaveDraft
}) => {
  const navigate = useNavigate();
  const [content, setContent] = useState(existingSubmission?.content || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  /**
   * 稿紙掃描視窗（components/scan）。取代了原本的相機視窗 ——
   * 掃描視窗自己有即時相機（getUserMedia）與相簿兩個入口，
   * 拍下來會拉正、去陰影再送辨識，辨識率比直接拍照好很多。
   */
  const [scannerOpen, setScannerOpen] = useState(false);

  /**
   * 手寫原稿在 GCS 的相對路徑。
   *
   * 繳交時一起送出去存進 `submission.pic_files`，老師才看得到原稿。
   * 既有的紀錄先帶進來，這樣「再上傳一張」不會把先前那幾張蓋掉。
   */
  const [picFiles, setPicFiles] = useState<string[]>(existingSubmission?.picFiles ?? []);
  /**
   * 這次打開頁面之後掃過沒有。
   *
   * **重掃是整份覆蓋**（依新版的規則）：這次第一次掃描時，先前留存的原稿全部換掉，
   * 之後同一次掃的每一頁接在後面。不這樣做的話，學生重掃一次就會留下
   * 兩套原稿，老師批改時分不出哪一份才是現在這篇作文。
   * 用 ref 不用 state —— 連掃兩頁時第二頁的回呼要馬上讀得到。
   */
  const scannedThisSession = React.useRef(false);
  /** 這次掃了幾頁。給掃描視窗顯示「第 N 頁」用（render 裡不能讀 ref） */
  const [sessionScanCount, setSessionScanCount] = useState(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [showMethodSelector, setShowMethodSelector] = useState(!existingSubmission?.content);

  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [ocrProgress, setOcrProgress] = useState({ current: 0, total: 0 });

  // 字數是從 content 直接算得出來的，不需要另外存一份 state。
  // 原本用 effect 回寫 state，等於每打一個字就多跑一輪 render。
  // 規則收在 lib/wordCount.ts —— 送給後端的也是同一個值（見 onSubmit / onSaveDraft）。
  const wordCount = useMemo(
    () => countWords(content, question.subject),
    [content, question.subject],
  );

  /**
   * 這一份現在是什麼狀態。
   *
   * 以前標頭只看本地的 `lastSaved`，所以**重新打開一份已經提交過的作文，
   * 標頭照樣寫「尚未儲存」** —— 學生會以為自己沒交。狀態要從
   * existingSubmission 來，本地的存檔時間只是疊在上面的補充。
   */
  const isGraded = existingSubmission?.status === 'Graded'
    || existingSubmission?.status === 'Published';
  const isSubmitted = existingSubmission?.status === 'Pending' || isGraded;
  const isDraft = existingSubmission?.status === 'Draft';

  /**
   * 已截止且不收遲交（或老師改回了未開放）。學生仍看得到自己的作文，但不能再改。
   * 規則是 lib/assignments.ts 的 canStudentSubmit()，後端 /student/submit 也擋同一條。
   */
  const isEnded = !canStudentSubmit(assignment);
  /** 已截止但允許遲交：可以交，但要先講清楚會被標示遲交 */
  const isLateWindow = !isEnded && assignmentPhase(assignment) === 'ended';

  /**
   * 不能再編輯的兩種情形：
   *   已批改 —— 後端也擋（submit 的 UPDATE WHERE），這裡只是不要讓人白打一篇
   *   已截止 —— 過了截止時間又不收遲交
   */
  const isLocked = isGraded || isEnded;
  /**
   * 正在選「直接打字／掃描稿紙／上傳照片」。
   * 已截止或已批改就不給選 —— 選了也交不出去，只是讓人白做（新版也這樣擋）。
   */
  const showMethodChooser = !isLocked && showMethodSelector && !content;

  /**
   * 存草稿。
   *
   * ⚠️ 這支以前只是 `setLastSaved(new Date())`，註解寫著「In a real app,
   *    this would save to a backend」—— **畫面顯示「已儲存」但什麼都沒存**，
   *    學生關掉分頁作文就沒了。實際點下去才看得出來（沒有發出任何請求）。
   */
  const handleSaveDraft = async () => {
    if (!content.trim() || isSavingDraft || isLocked) return;
    setIsSavingDraft(true);
    setError(null);
    try {
      await onSaveDraft(content, wordCount, picFiles);
      setLastSaved(new Date());
    } catch (err) {
      console.error('Save draft failed:', err);
      setError(failureMessage(err, '草稿儲存失敗，請檢查網路連線'));
    } finally {
      setIsSavingDraft(false);
    }
  };

  const processImages = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0 || isLocked) return;

    setIsOcrLoading(true);
    setOcrProgress({ current: 0, total: fileArray.length });
    
    let combinedText = '';
    let successCount = 0;

    try {
      for (let i = 0; i < fileArray.length; i++) {
        setOcrProgress({ current: i + 1, total: fileArray.length });
        const file = fileArray[i];
        
        const base64 = await fileToBase64(file);
        /*
          ⚠️ 帶 assignment.id 進去，後端才會把原圖存進 GCS。
             回傳的是 { text, files } —— 以前這裡當成字串直接串接，
             TypeScript 不會擋（string + object 合法），但作文裡會被塞進
             「[object Object]」。
        */
        const ocr = await extractTextFromImage(base64, file.type, assignment.id);
        if (ocr.files.length) setPicFiles((prev) => [...prev, ...ocr.files]);
        if (ocr.text) {
          combinedText += (combinedText ? '\n\n' : '') + ocr.text;
          successCount++;
        }
      }

      if (combinedText) {
        setContent(prev => prev ? prev + '\n\n' + combinedText : combinedText);
        setShowMethodSelector(false);
        if (successCount < fileArray.length) {
          alert(`部分圖片辨識失敗。成功提取了 ${successCount}/${fileArray.length} 張圖片的文字。`);
        }
      } else {
        alert('無法從圖片中提取文字，請嘗試更清晰的照片。');
      }
    } catch (error) {
      console.error('OCR failed:', error);
      alert('文字提取失敗，請稍後再試。');
    } finally {
      setIsOcrLoading(false);
      setOcrProgress({ current: 0, total: 0 });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) processImages(files);
  };

  /**
   * 掃好一頁：辨識出來的文字接在作文後面，全解析度原稿由後端存進 GCS。
   *
   * 一頁有兩份影像：縮到 2000px 的送辨識（傳得快、AI 讀得夠），
   * 全解析度的留給老師對照 —— 同一個請求一起送，不會辨識成功卻沒存到原稿。
   */
  const handleScannedPage = async (page: ScannedPage) => {
    if (isLocked) return;
    setIsOcrLoading(true);
    setOcrProgress({ current: 1, total: 1 });
    try {
      const [ocrBase64, fullBase64] = await Promise.all([
        blobToBase64(page.ocrBlob),
        blobToBase64(page.fullBlob),
      ]);
      const ocr = await extractTextFromImage(ocrBase64, page.ocrBlob.type, assignment.id, {
        base64Image: fullBase64,
        mimeType: page.fullBlob.type,
      });
      if (ocr.files.length) {
        // 這次第一次掃描：換掉先前留存的原稿（見 scannedThisSession）
        const first = !scannedThisSession.current;
        scannedThisSession.current = true;
        setPicFiles((prev) => [...(first ? [] : prev), ...ocr.files]);
        setSessionScanCount((n) => n + 1);
      }
      if (ocr.text) {
        setContent((prev) => (prev ? prev + '\n\n' + ocr.text : ocr.text));
        setShowMethodSelector(false);
      } else {
        alert('這一張沒有辨識出文字，可以重掃一次或直接打字。');
      }
    } catch (err) {
      console.error('OCR failed:', err);
      alert('文字提取失敗，請稍後再試。');
    } finally {
      setIsOcrLoading(false);
      setOcrProgress({ current: 0, total: 0 });
    }
  };

  const handleSubmit = async () => {
    if (!content.trim() || isLocked) return;
    setShowConfirmModal(true);
  };

  const confirmSubmit = async () => {
    setShowConfirmModal(false);
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(content, wordCount, picFiles);
      navigate(routes.studentAssignments());
    } catch (err) {
      console.error('Submission failed:', err);
      setError(failureMessage(err, '提交失敗，請檢查網路連線'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-20">
      {/*
        ⚠️ 這兩個隱藏的 file input **必須掛在最外層，不能放進任何條件區塊**。

        它們原本在「選擇作文提供方式」那張覆蓋層裡（`showMethodSelector && !content`）。
        學生一旦有了內容，那個區塊就卸載，兩個 ref 變成 null ——
        而工具列的「繼續拍照／繼續上傳」是 `ref.current?.click()`，
        那個 `?.` 把失敗安靜地吞掉，**按鈕按下去完全沒有反應也沒有錯誤**。
        覆蓋層裡的按鈕能用、工具列的不能用，因為只有前者與 input 同時存在。

        已批改時整組按鈕會收起來（isLocked），所以 input 留著也不會被觸發。
      */}
      <input id="studentessayeditor-input-file-upload"
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
        multiple
        className="hidden"
      />

      {scannerOpen && (
        <DocumentScannerModal
          subtitle={assignment.title}
          pageCount={sessionScanCount}
          onClose={() => setScannerOpen(false)}
          onPage={handleScannedPage}
        />
      )}
      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div id="studentessayeditor-confirmmodal" className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-card rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-border/50 space-y-6">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mx-auto">
              <Send size={32} />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-title font-bold text-text-primary">確認提交作業？</h3>
              {/*
                ⚠️ 這段原本寫「提交後將無法再進行修改，AI 將立即開始為您的作文
                   進行初步評分」—— **兩句都不是真的**（實際提交後測出來的）：
                   提交之後編輯區照樣能改、能重新提交；而學生的 submit 端點
                   完全沒有碰 AI，批改一律由教師觸發。
                   對學生說了不會發生的事，比不說更糟。
              */}
              <p className="text-body text-text-secondary">提交後老師就看得到這一份，並會安排批改。</p>
            </div>
            <div className="flex gap-3">
              <button 
                id="studentessayeditor-btn-confirm-cancel"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-3 rounded-xl font-bold text-text-secondary hover:bg-surface-soft transition-colors"
              >
                取消
              </button>
              <button 
                id="studentessayeditor-btn-confirm-submit"
                onClick={confirmSubmit}
                className="flex-1 py-3 bg-primary text-on-accent rounded-xl font-bold hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95"
              >
                確認提交
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-danger-600 text-on-accent px-6 py-3 rounded-full shadow-xl flex items-center gap-3 animate-slide-in-up">
          <AlertCircle size={20} />
          <span className="text-body">{error}</span>
          <button id="studentessayeditor-btn-close-error" onClick={() => setError(null)} className="p-1 hover:bg-card/20 rounded-full">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between bg-card p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-sm border border-border/50 sticky top-0 z-20 gap-4">
        <div className="flex items-center gap-3 sm:gap-4 w-full md:w-auto">
          <button 
            id="studentessayeditor-btn-back"
            onClick={() => (canGoBack && onBack) ? onBack() : navigate(routes.studentAssignments())}
            className="p-2 -ml-2 hover:bg-card/50 rounded-xl transition-colors text-text-primary active:scale-90 shrink-0"
          >
            <ArrowLeft size={20} className="sm:size-6" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-bold text-title text-text-primary truncate">{assignment.title}</h1>
              <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-md text-body border border-primary/20 uppercase tracking-wider animate-pulse-subtle shrink-0">
                {wordCount} {question.subject !== 'English' ? '字' : '單字'}
              </span>
            </div>
            <p className="text-body text-text-secondary flex items-center gap-1 mt-1">
              <Clock size={12} className="sm:size-3.5" /> {hasDeadline(assignment) ? `截止時間：${deadlineLabel(assignment, { withTime: true })}` : NO_DEADLINE_LABEL}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 w-full md:w-auto justify-end">
          <div className="hidden md:flex items-center gap-2 text-caption text-text-secondary mr-2 sm:mr-4">
            {isGraded ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 size={12} className="text-success-500" /> 已批改，不能再修改
              </span>
            ) : isEnded ? (
              <span className="flex items-center gap-1">
                <Clock size={12} /> 已截止
              </span>
            ) : isSubmitted ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 size={12} className="text-success-500" /> 已提交
              </span>
            ) : lastSaved ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 size={12} className="text-success-500" />
                草稿已於 {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 儲存
              </span>
            ) : isDraft ? (
              <span className="flex items-center gap-1">
                <Save size={12} /> 草稿已儲存
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Clock size={12} /> 尚未儲存
              </span>
            )}
          </div>
          {!isLocked && <button 
            id="studentessayeditor-btn-savedraft"
            onClick={handleSaveDraft}
            className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-body text-text-primary hover:bg-card/50 transition-colors flex items-center gap-1.5 sm:gap-2 flex-1 md:flex-none justify-center border border-border/50 md:border-transparent bg-card/50 md:bg-transparent"
          >
            <Save size={16} className="sm:size-[18px]" /> <span className="hidden sm:inline">儲存草稿</span><span className="sm:hidden">儲存</span>
          </button>}
          {!isLocked && <button 
            id="studentessayeditor-btn-submit"
            onClick={handleSubmit}
            disabled={isSubmitting || !content.trim()}
            className="bg-primary text-on-accent px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl text-body hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 flex items-center gap-1.5 sm:gap-2 disabled:opacity-50 disabled:cursor-not-allowed flex-1 md:flex-none justify-center"
          >
            {isSubmitting ? <Loader2 size={16} className="sm:size-[18px] animate-spin" /> : <Send size={16} className="sm:size-[18px]" />}
            提交作業
          </button>}
        </div>
      </div>

      {/* 已批改的有自己的狀態字樣，不必再疊一條截止橫幅 */}
      {isEnded && !isGraded && (
        <div
          id="studentessayeditor-banner-ended"
          className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-mauve-100 border border-mauve-200 text-mauve-700 text-body"
        >
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>
            這份作業已經截止，不能再繳交或修改。
            {isSubmitted && ' 你之前交的作品仍然保留，老師發還後就看得到成績。'}
          </span>
        </div>
      )}
      {isLateWindow && !isGraded && (
        <div
          id="studentessayeditor-banner-late"
          className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-warning-100 border border-warning-200 text-warning-700 text-body"
        >
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>已經過了截止時間。老師允許遲交，但現在繳交會標示為「遲交」。</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Editor Area */}
        <div className="lg:col-span-2 space-y-4">
          {/*
            ⚠️ 這張卡片一定要 relative。兩張覆蓋層（選輸入方式、OCR 辨識中）都是
            absolute inset-0，沒有定位祖先時會以整頁為基準 —— 實測它們蓋到整個頁面，
            再被 sticky 的標題列壓在上面，標題與說明文字被切掉一半（手機、桌機都是）。

            選輸入方式時不要鎖高度：三張方式卡片在手機上是直向排列，
            鎖 500px 會變成卡片裡再捲一層。
          */}
          <div className={`bg-card rounded-2xl sm:rounded-3xl shadow-sm border border-border/50 overflow-hidden flex flex-col relative ${
            showMethodChooser ? '' : 'h-[500px] sm:h-[600px]'
          }`}>
            <div className="bg-card/50 px-4 sm:px-6 py-3 border-b border-border/50 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="text-body text-text-secondary uppercase tracking-widest hidden sm:inline">寫作區域</span>
                <div className="hidden sm:block h-4 w-px bg-border/50"></div>
                <span className="text-body font-normal text-text-secondary flex items-center gap-1.5">
                  {question.subject !== 'English' ? '字數統計' : '單字統計'}：
                  <span className="text-primary font-bold text-ui">{wordCount}</span>
                </span>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                {/* 已批改就不給改，那兩顆 OCR 也要跟著收起來 —— 留一顆按不動的按鈕，
                    跟先前那顆什麼都沒存的「儲存草稿」是同一類問題 */}
                {!isLocked && <button 
                  id="studentessayeditor-btn-ocr-camera"
                  onClick={() => setScannerOpen(true)}
                  className="p-1.5 sm:p-2 hover:bg-card rounded-lg sm:rounded-xl text-primary transition-colors flex items-center gap-1 sm:gap-1.5 text-body"
                  title="再掃一張稿紙"
                >
                  <ScanLine size={14} className="sm:size-[16px]" /> <span className="hidden sm:inline">再掃一張</span><span className="sm:hidden">掃描</span>
                </button>}
                {!isLocked && <button 
                  id="studentessayeditor-btn-ocr-upload"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 sm:p-2 hover:bg-card rounded-lg sm:rounded-xl text-primary transition-colors flex items-center gap-1 sm:gap-1.5 text-body"
                  title="繼續上傳"
                >
                  <ImageIcon size={14} className="sm:size-[16px]" /> <span className="hidden sm:inline">繼續上傳</span><span className="sm:hidden">上傳</span>
                </button>}
                <button id="studentessayeditor-btn-info" className="p-1.5 sm:p-2 hover:bg-card rounded-lg sm:rounded-xl text-text-primary transition-colors">
                  <Info size={16} className="sm:size-[18px]" />
                </button>
              </div>
            </div>
            {/*
              已批改就唯讀。後端也擋（submit 的 UPDATE WHERE 會把它濾掉），
              但讓人打完一整篇才在送出時被拒絕太糟 —— 兩邊都要擋。
            */}
            <textarea id="studentessayeditor-textarea-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              readOnly={isLocked}
              placeholder="在此開始你的創作..."
              className={`flex-1 p-4 sm:p-8 text-title font-essay leading-loose focus:outline-none resize-none no-scrollbar text-text-primary bg-card/50 ${
                isLocked ? 'cursor-default' : ''
              } ${showMethodChooser ? 'hidden' : ''}`}
            />

            {showMethodChooser && (
              <div className="flex items-center justify-center p-4 sm:p-6 md:p-10">
                <div className="max-w-4xl w-full space-y-6 sm:space-y-10 text-center">
                  <div className="space-y-2 sm:space-y-4">
                    <h2 className="text-title sm:text-heading font-bold text-text-primary tracking-tight">選擇作文提供方式</h2>
                    {/* 一句話講完就好：手機上大標＋兩行說明會佔掉半個畫面（使用者回報） */}
                    <p className="text-body sm:text-ui text-text-secondary max-w-xl mx-auto">
                      直接打字，或拍手寫稿讓 AI 轉成文字。
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 px-2 sm:px-0">
                    {/* Keyboard Option */}
                    <button 
                      id="studentessayeditor-btn-method-keyboard"
                      onClick={() => setShowMethodSelector(false)}
                      className="group relative p-6 sm:p-8 bg-card border-2 border-border/50 rounded-2xl sm:rounded-3xl hover:border-primary hover:shadow-xl hover:shadow-primary/10 transition-all flex flex-row sm:flex-col items-center text-left sm:text-center gap-4 sm:gap-6 active:scale-95"
                    >
                      <div className="w-14 h-14 sm:w-20 sm:h-20 bg-ink-100 rounded-xl sm:rounded-2xl flex items-center justify-center text-ink-600 group-hover:bg-primary group-hover:text-on-accent transition-all duration-500 sm:rotate-3 group-hover:rotate-0 shrink-0">
                        <Keyboard size={28} className="sm:size-[40px]" strokeWidth={1.5} />
                      </div>
                      <div className="space-y-1 sm:space-y-2 flex-1">
                        <div className="font-bold text-text-primary text-title">直接打字</div>
                        <div className="text-body text-text-secondary leading-relaxed">
                          使用鍵盤直接輸入您的作文內容，適合在電腦上直接創作。
                        </div>
                      </div>
                    </button>

                    {/* Camera OCR Option - FEATURED */}
                    <button 
                      id="studentessayeditor-btn-method-camera"
                      onClick={() => setScannerOpen(true)}
                      className="group relative p-6 sm:p-8 bg-card border-2 border-border/50 rounded-2xl sm:rounded-3xl hover:border-primary hover:shadow-xl hover:shadow-primary/10 transition-all flex flex-row sm:flex-col items-center text-left sm:text-center gap-4 sm:gap-6 active:scale-95"
                    >
                      <div className="w-14 h-14 sm:w-20 sm:h-20 bg-ink-100 rounded-xl sm:rounded-2xl flex items-center justify-center text-ink-600 group-hover:bg-primary group-hover:text-on-accent transition-all duration-500 sm:rotate-3 group-hover:rotate-0 shrink-0">
                        <ScanLine size={28} className="sm:size-[40px]" strokeWidth={1.5} />
                      </div>
                      <div className="space-y-1 sm:space-y-2 flex-1">
                        <div className="font-bold text-text-primary text-title">掃描稿紙</div>
                        <div className="text-body text-text-secondary leading-relaxed">
                          拍攝手寫稿紙，系統會自動拉正、去陰影，再由 AI 轉成文字。最推薦。
                        </div>
                      </div>
                    </button>

                    {/* File Upload Option */}
                    <button 
                      id="studentessayeditor-btn-method-upload"
                      onClick={() => fileInputRef.current?.click()}
                      className="group relative p-6 sm:p-8 bg-card border-2 border-border/50 rounded-2xl sm:rounded-3xl hover:border-primary hover:shadow-xl hover:shadow-primary/10 transition-all flex flex-row sm:flex-col items-center text-left sm:text-center gap-4 sm:gap-6 active:scale-95"
                    >
                      <div className="w-14 h-14 sm:w-20 sm:h-20 bg-ink-100 rounded-xl sm:rounded-2xl flex items-center justify-center text-ink-600 group-hover:bg-primary group-hover:text-on-accent transition-all duration-500 sm:-rotate-3 group-hover:rotate-0 shrink-0">
                        <ImageIcon size={28} className="sm:size-[40px]" strokeWidth={1.5} />
                      </div>
                      <div className="space-y-1 sm:space-y-2 flex-1">
                        <div className="font-bold text-text-primary text-title">上傳照片檔</div>
                        <div className="text-body text-text-secondary leading-relaxed">
                          從相簿中選擇照片，由 AI 自動轉為文字。適合已拍好的照片。
                        </div>
                      </div>
                    </button>
                  </div>

                  <div className="pt-2 sm:pt-4 pb-4 sm:pb-0">
                    <p id="studentessayeditor-ocr-hint" className="text-body text-text-secondary flex items-center justify-center gap-1.5 sm:gap-2 px-4">
                      <Info size={12} className="sm:size-[14px] shrink-0" /> 提示：OCR 功能支援手寫與印刷體，請確保光線充足且字跡清晰。
                    </p>
                  </div>

                </div>
              </div>
            )}

            {isOcrLoading && (
              <div className="absolute inset-0 z-20 bg-card/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-primary/10 rounded-full"></div>
                  <div className="absolute inset-0 w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                  {ocrProgress.total > 1 && (
                    <div className="absolute inset-0 flex items-center justify-center text-caption text-primary">
                      {ocrProgress.current}/{ocrProgress.total}
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <p id="studentessayeditor-ocr-loading-text" className="font-bold text-primary">
                    {ocrProgress.total > 1 ? `正在辨識第 ${ocrProgress.current} 張圖片...` : 'AI 文字提取中...'}
                  </p>
                  <p className="text-caption text-primary">正在辨識圖片中的手寫文字，請稍候</p>
                </div>
              </div>
            )}
          </div>

          {!isLocked && !showMethodSelector && !content && (
            <button 
              id="studentessayeditor-btn-retry-method"
              onClick={() => setShowMethodSelector(true)}
              className="text-caption text-primary flex items-center gap-1 hover:underline"
            >
              <X size={14} /> 重新選擇輸入方式
            </button>
          )}
        </div>

        {/* Sidebar: Prompt & Feedback */}
        <div className="space-y-4 sm:space-y-6">


          {/* Prompt Card */}
          <div className="bg-card p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-sm border border-border/50">
            <h3 className="font-bold text-text-primary mb-3 sm:mb-4 flex items-center gap-2 text-ui">
              <FileText size={18} className="text-primary sm:size-[20px]" />
              題目說明
            </h3>
            <div className="prose prose-sm max-w-none text-text-secondary leading-relaxed max-h-[300px] sm:max-h-[500px] overflow-y-auto pr-2 no-scrollbar text-body">
              {question.content}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
