
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Save, CheckCircle2, PenTool, Highlighter, FileText, Layout, PanelLeftClose, PanelLeftOpen, BookOpen, Image as ImageIcon, X, Sparkles, Bot, ChevronDown, RotateCcw, Send, ChevronLeft, ChevronRight } from 'lucide-react';
import { Submission, GradingResult } from '../types';
/*
  評語編輯器延後載入。它背後是 TipTap／ProseMirror（兩百多 KB），
  而且在 import 當下就要碰 document —— 靜態匯入會讓沒有 DOM 的環境
  （node:test 跑的路由測試）在載入模組時就炸掉，學生端也得白白下載這包。
*/
const FeedbackEditor = React.lazy(() =>
  import('./FeedbackEditor').then((m) => ({ default: m.FeedbackEditor })),
);
import { useSplitPane, MIN_PCT, MAX_PCT } from '../lib/useSplitPane';

/** 左右比例記在哪、預設多少（左欄 60%：稿紙比評語面板寬一點） */
const SPLIT_KEY = 'udn.grading.split';
const DEFAULT_SPLIT = 60;
/** 桌機版面的分界，與 Tailwind 的 lg 一致 */
const DESKTOP_MIN_WIDTH = 1024;
import { imageUrlOf } from '../api/ai';
import { MAX_LEVEL, MIN_LEVEL, toLevel } from '../lib/scoring';
import { StatusBadge } from './StatusBadge';
import {
  canMark,
  hasMark,
  type MarkKind,
  type SubmissionMarks,
} from '../lib/submissionMarks';
import { SubmissionStampRow } from './SubmissionStamp';
import { SHOW_AI_MODEL_PICKER } from '../lib/features';

/**
 * 批改結果的比較用字串。欄位固定順序序列化，
 * 不要直接 JSON.stringify(物件) —— 鍵的順序不同就會誤判成「有改動」。
 */
const snapshot = (r?: GradingResult): string =>
  r
    ? JSON.stringify([
        r.totalScore,
        r.categoryScores.content,
        r.categoryScores.structure,
        r.categoryScores.grammar,
        r.categoryScores.vocabulary,
        r.feedback,
        r.isAi,
        r.isPublished,
      ])
    : '';

interface GradingEditorProps {
  submission: Submission;
  assignmentTitle?: string;
  assignmentContent?: string;
  referenceImageUrl?: string;
  selectedAiModel?: string | null;
  availableModels?: string[];
  preferredAiModel?: string;
  onBack: () => void;
  onSave: (submissionId: string, result: GradingResult, shouldBack?: boolean) => void;
  onSelectAiModel?: (model: string) => void;
  onResetGrading?: (submissionId: string) => void;
  /** 單筆發還。改完一位就先讓他看到，不必等整班改完 */
  onPublish?: (submissionId: string) => void;
  /**
   * 用 AI 批改這一篇。**會直接存進資料庫**（後端寫一筆 is_ai = true 的版本），
   * 所以按完不需要再按儲存。失敗時要 reject，這裡才跳得出錯誤訊息。
   */
  onAutoGrade?: (submissionId: string) => Promise<void>;
  /** 全部的作品標記。這裡只讀自己這一篇的那幾筆 */
  marks?: SubmissionMarks;
  onToggleMark?: (submissionId: string, kind: MarkKind) => void;
  /** 在批改佇列中的位置，例如第 3 / 28 位。沒有佇列時不給 */
  queuePosition?: { index: number; total: number };
  /** 上一位／下一位。到頭或到尾時不給，按鈕會自動變成停用 */
  onPrevStudent?: () => void;
  onNextStudent?: () => void;
}

export const GradingEditor: React.FC<GradingEditorProps> = ({ 
  submission, 
  assignmentTitle, 
  assignmentContent, 
  referenceImageUrl, 
  selectedAiModel,
  availableModels = [],
  preferredAiModel,
  onBack, 
  onSave,
  onSelectAiModel,
  onResetGrading,
  onPublish,
  onAutoGrade,
  marks,
  onToggleMark,
  queuePosition,
  onPrevStudent,
  onNextStudent,
}) => {
  const [result, setResult] = useState<GradingResult | undefined>(submission.result);
  /**
   * 上次存檔時的內容。用來判斷「還沒存」——
   * 老師改了分數卻忘了存，按下一位就沒了，按鈕要看得出差別。
   */
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(submission.result));
  
  // AI Grading State
  const [isGrading, setIsGrading] = useState(false);
  
  // 控制手寫原稿視窗的開關
  const [showHandwritten, setShowHandwritten] = useState(false);

  // Mobile Tab State: 'essay' or 'grading'
  const [mobileTab, setMobileTab] = useState<'essay' | 'grading'>('essay');

  // Desktop View State: Toggle Essay Visibility
  const [isEssayVisible, setIsEssayVisible] = useState(true);
  /**
   * 左右兩欄的比例（左欄佔幾 %）。拖過一次就記在這台裝置上，
   * 下次打開批改頁就是老師自己調好的比例（見 lib/useSplitPane.ts）。
   */
  const [splitPct, setSplitPct, resetSplit] = useSplitPane(SPLIT_KEY, DEFAULT_SPLIT);
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  /** 量測拖曳位置用的容器（左欄＋分隔線＋右欄） */
  const workspaceRef = useRef<HTMLDivElement>(null);
  /**
   * 手機／平板走分頁切換，不套比例。
   * 用 matchMedia 而不是只看一次視窗寬度 —— 轉向或拉動視窗時要跟著變。
   */
  const [isMobileLayout, setIsMobileLayout] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < DESKTOP_MIN_WIDTH,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`);
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsMobileLayout(e.matches);
    onChange(mq);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** 拖曳分隔線：算出滑鼠在容器裡的百分比位置 */
  const onSplitPointerMove = (clientX: number) => {
    const box = workspaceRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setSplitPct(((clientX - box.left) / box.width) * 100);
  };

  const isGraded = submission.status === 'Graded';
  const isPublished = submission.status === 'Published';
  const isPending = submission.status === 'Pending';
  /** 有沒有還沒存的改動 */
  const isDirty = snapshot(result) !== savedSnapshot;

  /**
   * 有沒有手寫原稿。
   *
   * ⚠️ 這裡以前是 `submission.id.charCodeAt(...) % 2 === 0` —— **用 id 末字元的
   *    奇偶數在假裝**，註解還寫著「實際串接時請改成…」。所以有原稿的看不到、
   *    沒原稿的按鈕卻是亮的（而且點開來是 Unsplash 的一張示範照片）。
   */
  const draftImages = submission.picFiles ?? [];
  const hasDraft = draftImages.length > 0;
  /**
   * 原稿一次看一頁。以前是全部往下堆，一張 A3 稿紙就佔滿整個畫面，
   * 第二頁要捲很久才看得到，也不知道總共幾頁。
   * 夾在範圍內：換到頁數比較少的另一份繳交時，不會停在不存在的頁碼。
   */
  const [draftIndex, setDraftIndex] = useState(0);
  const draftPage = Math.min(draftIndex, Math.max(0, draftImages.length - 1));



  /**
   * 存檔。
   *
   * 這裡不發還 —— 發還是整批的動作，在批改清單的工具列做。
   * 老師在這一頁只負責把這一份改好、存起來，
   * 存完可以直接按「下一位」繼續，不會被踢回清單。
   *
   * isPublished 沿用原值：已發還的作文改完評語再存，它還是已發還，
   * 不會因為存檔而被收回去。
   */
  const handleSave = () => {
    if (!result) return;
    onSave(submission.id, result, false);
    setSavedSnapshot(snapshot(result));
  };

  /**
   * AI 批改。
   *
   * 以前這裡直接在瀏覽器呼叫 Gemini，拿回結果塞進本地 state，等老師按儲存 ——
   * 金鑰因此必須送進前端。現在交給 onAutoGrade：後端批改完就存成一筆
   * `is_ai = true` 的版本（與批次批改同一支端點，token 用量也記得到），
   * 完成後這個元件會被重掛，新的結果從 props 進來。
   *
   * 所以**按完就已經存好了**，不必也不該再 setResult。
   */
  const handleAutoGrade = async () => {
    if (!onAutoGrade) return;
    setIsGrading(true);
    try {
      await onAutoGrade(submission.id);
    } catch (err) {
      console.error("AI Grading Error:", err);
      alert("AI 批改失敗，請稍後再試。");
      setIsGrading(false);
    }
    // 成功時不解除 isGrading —— 元件緊接著就被重掛，解除只會閃一下
  };

  return (
    /*
      ⚠️ 這裡**不要給 z-index**。

      原本是 `relative z-50`，而教師端的導覽列是 `sticky top-0 z-40` ——
      整個批改頁因此蓋在導覽列上面，帳號選單一拉開就被切掉，
      只露出最上面那一條「帳號類型」（實測 1440×900）。
      選單自己的 z-50 救不了：它在導覽列的堆疊脈絡裡面，對外仍然只有 40。

      拿掉之後還有一個好處：`relative` 不帶 z-index 就不會建立堆疊脈絡，
      底下那個手寫原稿視窗（z-[60]）才能真的蓋過導覽列。
    */
    <div className="h-screen flex flex-col bg-surface relative overflow-hidden w-full">
      {/* Top Navigation Bar - Glass */}
      <div className="h-16 md:h-20 bg-card/70 backdrop-blur-xl border-b border-border px-2 md:px-8 flex items-center justify-between shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-1.5 md:gap-4 overflow-hidden mr-2">
          <button 
            id="gradingeditor-btn-back"
            onClick={onBack}
            className="tap-target w-8 h-8 md:w-10 md:h-10 flex shrink-0 items-center justify-center rounded-full bg-card/50 border border-card/60 text-text-secondary hover:bg-card hover:text-text-primary transition-all hover:scale-105 shadow-sm"
            title="返回列表"
          >
            <ArrowLeft size={16} className="md:w-[18px] md:h-[18px]" />
          </button>

          {/* Desktop Toggle Button */}
          <button 
            id="gradingeditor-btn-toggleessay"
            onClick={() => setIsEssayVisible(!isEssayVisible)}
            className="tap-target hidden lg:flex w-10 h-10 shrink-0 items-center justify-center rounded-full bg-card/50 border border-card/60 text-text-secondary hover:bg-card hover:text-primary transition-all hover:scale-105 shadow-sm"
            title={isEssayVisible ? "收起原文 (專注模式)" : "展開原文"}
          >
            {isEssayVisible ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>

          {/*
            身分區。第二行原本只有「繳交於…」，右邊一大片空白 ——
            批改狀態與級分收進來，右邊那排就不必再擠。
            這裡是整條橫列**唯一**會被壓縮的區塊（flex-1 min-w-0）：
            姓名太長就截斷，不要讓右邊的按鈕變形。
          */}
          <div className="min-w-0 flex-1 flex flex-col">
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
                <h2
                  className="font-bold text-text-primary truncate text-title"
                  title={submission.studentName}
                >
                  {submission.studentName}
                </h2>
                <span className="hidden lg:inline shrink-0 max-w-[14rem] truncate text-caption px-2 md:px-2.5 py-0.5 md:py-1 rounded-full bg-surface-soft text-text-secondary border border-border">
                    {assignmentTitle || '作文作業'}
                </span>
            </div>
            <div className="mt-0.5 hidden sm:flex items-center gap-2 min-w-0 text-caption text-text-secondary">
                {/* 這一頁原本從頭到尾沒說過這一份是什麼狀態，只能從按鈕反推 */}
                <StatusBadge status={submission.status} plain className="shrink-0" />
                {result && (
                  <>
                    <span className="text-text-muted shrink-0">·</span>
                    <span className="shrink-0 tabular-nums whitespace-nowrap">級分 {result.totalScore}</span>
                  </>
                )}
                <span className="text-text-muted shrink-0">·</span>
                <span className="truncate font-normal">
                  繳交於 {new Date(submission.submittedAt).toLocaleDateString()}
                </span>
            </div>
          </div>
        </div>
        
        {/*
          控制項永遠不縮、不折（shrink-0 + whitespace-nowrap）。
          空間不夠時被截斷的是左邊的姓名，不是這裡的按鈕 ——
          原本沒有這兩條，1200px 以下整排就折成三四行，把 80px 的橫列撐破。
          「目前總分」的大卡片移到左邊第二行了，右邊面板本來就有大字級分。
        */}
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            
            <button 
                id="gradingeditor-btn-viewdraft"
                onClick={() => {
                    if (!hasDraft) return;
                    setDraftIndex(0);   // 每次打開都從第 1 頁看起
                    setShowHandwritten(true);
                }}
                disabled={!hasDraft}
                className={`shrink-0 whitespace-nowrap flex items-center gap-1 md:gap-2 px-2 md:px-3 py-2 md:py-2.5 rounded-xl text-body font-bold transition-all border group ${
                    hasDraft
                    ? 'bg-card/50 border-card/60 text-text-secondary hover:text-primary hover:bg-card hover:border-primary/20 hover:shadow-sm cursor-pointer hover:md:px-4'
                    : 'bg-surface-soft border-transparent text-text-secondary cursor-not-allowed opacity-70'
                }`}
                title={hasDraft ? "查看學生手寫原稿" : "學生未上傳手寫原稿"}
            >
                <div className={`w-1.5 md:w-2.5 h-1.5 md:h-2.5 rounded-full shadow-sm transition-colors ${
                    hasDraft 
                    ? 'bg-accent shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                    : 'bg-danger-500'
                }`}></div>
                <ImageIcon size={14} className="md:w-[18px] md:h-[18px]" />
                <span className="max-w-0 overflow-hidden group-hover:max-w-[50px] transition-all duration-300 whitespace-nowrap">原稿</span>
            </button>

 
            {/*
              兩組按鈕：左邊是會改變狀態的動作，右邊是換人。
              分開是因為它們的後果差很多 —— 換人不會動到任何資料，
              重置批改會把分數與評語清掉。放在一起容易誤按。
            */}
            {!isGraded && !isPublished && (
              <button
                  id="gradingeditor-btn-aigrade"
                  onClick={handleAutoGrade}
                  disabled={isGrading || !isPending}
                  className={`shrink-0 whitespace-nowrap flex items-center gap-1 md:gap-2 px-2 md:px-5 py-2 md:py-2.5 rounded-xl text-body font-bold transition-all shadow-lg ${
                    (isGrading || !isPending)
                    ? 'bg-surface-soft text-text-secondary cursor-not-allowed opacity-70'
                    : 'bg-primary text-on-accent hover:bg-primary/90 hover:shadow-primary/20 hover:scale-[1.02]'
                  }`}
                  title={!isPending ? "僅限「待批改」狀態可使用 AI 批改" : "使用 AI 進行自動批改"}
              >
                  {isGrading ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-text-secondary border-t-transparent" /> : <Sparkles size={14} className="md:w-[18px] md:h-[18px]" />}
                  <span className="hidden sm:inline">{isGrading ? '批改中...' : '批改'}</span>
                  <span className="sm:hidden">{isGrading ? '中...' : '批改'}</span>
              </button>
            )}

            {/* 已批改或已發還都能重置 —— 發還出去才發現評語寫錯是常有的事 */}
            {(isGraded || isPublished) && (
              <button
                  id="gradingeditor-btn-reset"
                  onClick={() => onResetGrading?.(submission.id)}
                  className="shrink-0 whitespace-nowrap flex items-center gap-1 md:gap-2 px-2 md:px-4 py-2 md:py-2.5 rounded-xl text-body font-bold bg-danger-600 text-on-accent hover:opacity-90 shadow-lg shadow-danger-600/20 transition-all active:scale-95"
                  /* danger-600 是量出來的：500 在碑拓模式只有 3.88，過不了 4.5 */
                  title="清除分數與評語，退回「待批改」"
              >
                  <RotateCcw size={14} className="md:w-[18px] md:h-[18px]" />
                  {/* 只寫「重置」，完整說明交給滑鼠停留的 title */}
                  <span>重置</span>
              </button>
            )}

            {/*
              發還：只有「已批改、還沒發還」的時候才有意義。
              已發還的不再顯示（右邊會改成一個狀態標籤），避免重複發還。

              未存的改動要先存 —— 發還的是資料庫裡那一版，
              直接發還會把老師剛改的評語留在畫面上、卻發出舊的那份。
            */}
            {isGraded && onPublish && (
              <button
                  id="gradingeditor-btn-publish"
                  onClick={() => onPublish(submission.id)}
                  disabled={isDirty}
                  className={`shrink-0 whitespace-nowrap flex items-center gap-1 md:gap-2 px-2 md:px-4 py-2 md:py-2.5 rounded-xl text-body font-bold transition-all active:scale-95 ${
                    isDirty
                      ? 'bg-primary/10 text-primary/60 border border-primary/20 cursor-not-allowed'
                      : 'bg-primary text-on-accent hover:bg-primary/90 shadow-lg shadow-primary/25'
                  }`}
                  title={isDirty ? '有未存檔的修改，請先存檔再發還' : '把這一份發還給學生，學生就看得到分數與評語'}
              >
                  <Send size={14} className="md:w-[18px] md:h-[18px]" />
                  <span>發還</span>
              </button>
            )}

            {isPublished && (
              <span
                id="gradingeditor-published-tag"
                title="學生已經看得到這份成績與評語"
                className="shrink-0 whitespace-nowrap flex items-center gap-1 md:gap-2 px-2 md:px-4 py-2 md:py-2.5 rounded-xl text-body font-bold bg-success-50 text-success-700 border border-success-200"
              >
                  <CheckCircle2 size={14} className="md:w-[18px] md:h-[18px]" />
                  <span>已發還</span>
              </span>
            )}

            {/*
              已發還的也要能存 —— 右邊的欄位本來就編輯得動，
              少了這顆按鈕，老師改完評語會找不到地方存，改的東西直接消失。
            */}
            <button
                id="gradingeditor-btn-save"
                onClick={handleSave}
                disabled={!result || !isDirty}
                className={`shrink-0 whitespace-nowrap flex items-center gap-1 md:gap-2 px-2 md:px-5 py-2 md:py-2.5 rounded-xl text-body font-bold transition-all transform active:scale-95 ${
                    !result || !isDirty
                    ? 'bg-accent/10 text-accent border border-accent/20 shadow-none cursor-default'
                    : 'bg-accent hover:bg-accent/90 text-on-accent shadow-lg shadow-accent/30'
                }`}
                title={
                  !result ? '還沒有批改結果可以存'
                  : isDirty ? '儲存這一份的分數與評語'
                  : '目前的內容已經存檔'
                }
            >
                {result && !isDirty
                  ? <CheckCircle2 size={14} className="md:w-[18px] md:h-[18px]" />
                  : <Save size={14} className="md:w-[18px] md:h-[18px]" />}
                <span>{result && !isDirty ? '已存檔' : '存檔'}</span>
            </button>

            {/*
              換人。原本是兩顆帶文字的按鈕加一段位置文字，整組 308px ——
              單一最胖的一組，也是折行的主因。改成箭頭夾住位置：
              箭頭方向自明，位置這個重要資訊留著，寬度降到約 150px。
              ink 色階在碑拓模式會整組翻轉，兩個顏色一起翻，對比不會掉。
            */}
            {(onPrevStudent || onNextStudent) && (
              <div className="flex items-center gap-1 md:gap-1.5 shrink-0 md:ml-1 md:pl-2 md:border-l border-border">
                <button
                    id="gradingeditor-btn-prev-student"
                    onClick={onPrevStudent}
                    disabled={!onPrevStudent}
                    aria-label="上一位學生"
                    title="上一位學生"
                    className="tap-target w-9 h-9 md:w-10 md:h-10 shrink-0 flex items-center justify-center rounded-full bg-ink-200 text-ink-700 hover:bg-ink-300 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ink-200"
                >
                    <ChevronLeft size={18} />
                </button>
                {queuePosition && (
                  <span className="hidden lg:inline shrink-0 whitespace-nowrap tabular-nums text-caption text-text-secondary px-1">
                    {queuePosition.index} / {queuePosition.total}
                  </span>
                )}
                <button
                    id="gradingeditor-btn-next-student"
                    onClick={onNextStudent}
                    disabled={!onNextStudent}
                    aria-label="下一位學生"
                    title="下一位學生"
                    className="tap-target w-9 h-9 md:w-10 md:h-10 shrink-0 flex items-center justify-center rounded-full bg-ink-800 text-ink-50 hover:bg-ink-900 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ink-800"
                >
                    <ChevronRight size={18} />
                </button>
              </div>
            )}

        </div>
      </div>

      {/* Mobile Tab Switcher */}
      <div className="md:hidden flex border-b border-card/50 bg-card/60 backdrop-blur-md shrink-0">
        <button 
          id="gradingeditor-tab-essay"
          onClick={() => setMobileTab('essay')}
          className={`flex-1 py-3 text-caption font-bold flex items-center justify-center gap-2 ${mobileTab === 'essay' ? 'text-primary border-b-2 border-primary' : 'text-text-secondary'}`}
        >
          <FileText size={14} /> 閱讀文章
        </button>
        <button 
          id="gradingeditor-tab-grading"
          onClick={() => setMobileTab('grading')}
          className={`flex-1 py-3 text-caption font-bold flex items-center justify-center gap-2 ${mobileTab === 'grading' ? 'text-primary border-b-2 border-primary' : 'text-text-secondary'}`}
        >
          <Layout size={14} /> 評分面板
        </button>
      </div>

      {/* Main Workspace */}
      <div ref={workspaceRef} className="flex-1 flex overflow-hidden relative">
        
        {/* Left: Essay Paper View - Collapsible on Desktop */}
        {/*
          桌機的寬度走 flexBasis（老師拖出來的比例），不是寫死的 flex-[3]。
          拖曳中關掉 transition —— 否則每次 setState 都補一段 500ms 動畫，
          拖起來像在拉橡皮筋。
        */}
        <div
          style={isEssayVisible && !isMobileLayout ? { flexBasis: `${splitPct}%` } : undefined}
          className={`
            bg-surface overflow-hidden flex flex-col ${isDragging ? '' : 'transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]'}
            ${mobileTab === 'essay' ? 'flex-1' : 'hidden'} 
            ${isEssayVisible 
                ? 'lg:flex lg:flex-grow-0 lg:flex-shrink-0 lg:opacity-100 lg:translate-x-0' 
                : 'lg:flex-none lg:w-0 lg:opacity-0 lg:-translate-x-10'}
        `}>
            <div className="flex-1 overflow-y-auto p-3 md:p-4 flex flex-col items-center">
                
                {/* Assignment Prompt Card */}
                {(assignmentContent || referenceImageUrl) && (
                    <div className={`w-full mb-6 bg-primary/5 border border-primary/10 rounded-2xl p-6 shadow-sm transition-all duration-500`}>
                        <div className="flex items-center gap-2 mb-3">
                            <span className="bg-primary/10 text-primary p-1.5 rounded-lg">
                                <BookOpen size={16}/> 
                            </span>
                            <span className="text-caption text-primary uppercase tracking-wider">題目說明與引導</span>
                        </div>
                        
                        {assignmentTitle && (
                            <h2 className="text-title font-bold text-text-primary mb-3">{assignmentTitle}</h2>
                        )}
                        
                        {assignmentContent && (
                            <div className="text-text-primary/80 text-body leading-relaxed whitespace-pre-wrap font-normal font-essay">
                                {assignmentContent}
                            </div>
                        )}

                        {referenceImageUrl && (
                            <div className="mt-5 pt-5 border-t border-primary/10">
                                <div className="flex items-center gap-2 mb-3 text-caption text-text-secondary">
                                    <ImageIcon size={14} /> 參考圖片 (看圖寫作)
                                </div>
                                <div className="rounded-xl overflow-hidden border border-card shadow-sm inline-block max-w-full bg-card group cursor-zoom-in">
                                    <img 
                                        src={referenceImageUrl} 
                                        alt="Reference" 
                                        referrerPolicy="no-referrer"
                                        className="max-h-64 object-contain w-auto transition-transform hover:scale-105" 
                                        onClick={() => window.open(referenceImageUrl, '_blank')}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* The Paper - Realistic Shadow and Texture */}
                <div className="w-full bg-card min-h-[calc(100%-2rem)] shrink-0 shadow-card border border-border rounded-sm px-4 py-6 md:px-8 md:py-10 mb-8 relative">
                    <h1 className="text-heading font-bold mb-6 md:mb-10 text-text-primary text-center text-balance">
                        {assignmentTitle || "學生作品"}
                    </h1>

                    {/*
                      作文是這個系統真正的主角，排版比照書本內文：
                        text-essay    17px／行高 2.0／字距 0.03em（定義在 index.css）
                        indent-[2em]  中文慣例的「空兩格」，不是固定像素
                        max-w-[34em]  一行約 34 個字；840px 寬配 17px 會排到 49 字，太長

                      原本掛的 prose / prose-slate 是 @tailwindcss/typography 的類別，
                      但專案沒裝那個外掛，等於完全沒有作用，已移除。
                      leading-7 md:leading-9 也拿掉 —— 會和 text-essay 自帶的行高打架。
                    */}
                    <div className="mx-auto max-w-[38em] text-essay font-essay text-text-primary selection:bg-primary/10 selection:text-text-primary">
                        {submission.content
                            .split('\n')
                            // 段落間的空行不要變成空的 <p>，否則會多出一段間距
                            .filter((paragraph) => paragraph.trim() !== '')
                            .map((paragraph, idx) => (
                                <p key={idx} className="mb-5 last:mb-0 indent-[2em] text-justify">
                                    {paragraph}
                                </p>
                            ))}
                    </div>
                </div>
            </div>
        </div>

        {/*
          可拖曳的分隔線。只有桌機、而且左欄沒收起來時才有意義。
          用 pointer events：滑鼠、觸控筆、觸控螢幕同一套。
        */}
        {!isMobileLayout && isEssayVisible && (
          <div
            id="gradingeditor-split-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="調整作文與批改面板的寬度"
            aria-valuenow={splitPct}
            aria-valuemin={MIN_PCT}
            aria-valuemax={MAX_PCT}
            tabIndex={0}
            title="拖曳調整寬度（雙擊還原）"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = true;
              setIsDragging(true);
              document.body.style.userSelect = 'none';
            }}
            onPointerMove={(e) => { if (dragging.current) onSplitPointerMove(e.clientX); }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              dragging.current = false;
              setIsDragging(false);
              document.body.style.userSelect = '';
            }}
            onDoubleClick={resetSplit}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); setSplitPct(splitPct - 2); }
              if (e.key === 'ArrowRight') { e.preventDefault(); setSplitPct(splitPct + 2); }
              if (e.key === 'Home') { e.preventDefault(); resetSplit(); }
            }}
            className="hidden lg:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-border/60 hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none transition-colors group"
          >
            {/* 中間那三點讓它看起來就是可以拉的 */}
            <span className="h-8 w-0.5 rounded-full bg-text-muted/50 group-hover:bg-on-accent/70" aria-hidden="true" />
          </div>
        )}

        {/* Right: Grading Tool Panel - Glass Sidebar - Expandable */}
        <div className={`
            bg-card/60 backdrop-blur-2xl flex flex-col shadow-[-10px_0_40px_rgba(0,0,0,0.03)] z-10 shrink-0 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
            ${mobileTab === 'grading' ? 'absolute inset-0 flex lg:relative lg:inset-auto' : 'hidden'}
            ${isEssayVisible 
                ? 'lg:flex lg:flex-1 lg:min-w-0'
                : 'lg:flex lg:flex-1 lg:w-full'}
        `}>
            {/* Tool Header */}
            <div className="p-6 border-b border-card/40 flex items-center justify-between sticky top-0 z-10 bg-card/40 backdrop-blur-xl">
                <h3 className="font-bold text-text-primary flex items-center gap-2 text-title">
                    <PenTool size={20} className="text-primary" />
                    批改面板
                </h3>
                {/*
                  批改模型原本是最上面那條黑色橫幅，而且只在「未批改」時才出現 ——
                  按「下一位」遇到已批改的學生它就消失，整排操作鍵跟著上下跳。
                  移到這裡：模型本來就是批改的輸入，放在批改面板才對；
                  而且無論批改與否都固定顯示，上面那排操作鍵不會再移動。
                */}
                {SHOW_AI_MODEL_PICKER && availableModels.length > 0 && (
                  <div className="relative group shrink-0">
                    <Bot
                      size={14}
                      className="text-accent absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    />
                    <select
                      id="gradingeditor-select-ai-model"
                      value={selectedAiModel || ""}
                      onChange={(e) => onSelectAiModel?.(e.target.value)}
                      title="AI 批改模型"
                      className="appearance-none bg-surface-soft border border-border rounded-xl pl-9 pr-8 py-1.5 text-caption text-text-primary outline-none cursor-pointer hover:border-primary/40 focus:ring-2 focus:ring-primary/30 transition-colors max-w-[190px] truncate"
                    >
                      {[...availableModels].sort((a, b) => {
                        if (a === preferredAiModel) return -1;
                        if (b === preferredAiModel) return 1;
                        return 0;
                      }).map((model) => (
                        <option key={model} value={model}>
                          {model}{model === preferredAiModel ? '（預選）' : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="text-text-secondary absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    />
                  </div>
                )}
            </div>

            {/* Tool Content - Centered when expanded */}
            <div className="flex-1 overflow-y-auto relative">
                <div className={`p-8 space-y-8 pb-32 md:pb-8 transition-all duration-500 ${!isEssayVisible ? 'max-w-4xl mx-auto' : ''}`}>
                    {/*
                      兩顆章放在面板最上方，而且在「準備開始批改」的空狀態之前 ——
                      老師可能讀完就覺得這篇好，還沒打分數就想先蓋起來。

                      蓋章**立即生效**，不必按「存檔」。標記不是 GradingResult
                      的一部分，混進存檔的未存判斷只會讓人搞不清那顆按鈕在管什麼。

                      能不能蓋一律問 canMark() —— 這一頁在「待批改」狀態下也打得開，
                      不要在這裡自己比對 status（清單那邊也是問同一支）。
                    */}
                    {onToggleMark && (
                      <div className="rounded-brand border border-border bg-card/40 px-4 py-3 sm:px-5 sm:py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <span className="text-caption text-text-secondary">作品標記</span>
                        <SubmissionStampRow
                          submissionId={submission.id}
                          idPrefix="gradingeditor-stamp"
                          canMark={canMark(submission.status)}
                          isOn={(kind) => hasMark(marks, submission.id, kind)}
                          onToggle={(kind) => onToggleMark(submission.id, kind)}
                        />
                        {!canMark(submission.status) && (
                          <span className="text-caption text-text-muted">
                            批改完成後才能標記
                          </span>
                        )}
                      </div>
                    )}

                    {!result && (
                        <div className="text-center py-24 px-10">
                            <div className="w-24 h-24 bg-card/50 rounded-full flex items-center justify-center mx-auto mb-6 text-text-muted shadow-inner">
                                <FileText size={40} />
                            </div>
                            <h4 className="text-text-primary font-bold mb-2 text-title">準備開始批改</h4>
                            <p className="text-text-secondary text-body">直接手動輸入分數與評語。</p>
                        </div>
                    )}

                    {result && (
                        <>
                            {/* Total Score Override */}
                            <div className="bg-gradient-to-br from-primary/5 to-secondary/5 rounded-brand p-5 md:p-8 border border-primary/10 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
                                <div className="flex items-center justify-between relative z-10">
                                    <span className="font-bold text-text-primary text-title">整體級分</span>
                                    <div className="flex items-baseline gap-2">
                                        <input 
                                            id="gradingeditor-input-totalscore"
                                            type="number"
                                            min={MIN_LEVEL}
                                            max={MAX_LEVEL}
                                            step={1}
                                            value={result.totalScore}
                                            onChange={(e) =>
                                              setResult({ ...result, totalScore: toLevel(Number(e.target.value)) })
                                            }
                                            className="w-16 md:w-20 bg-card border border-border rounded-lg md:rounded-xl text-center text-display font-bold text-primary focus:outline-none focus:ring-4 focus:ring-primary/10 py-1 md:py-2 shadow-sm"
                                        />
                                        <span className="text-text-secondary font-bold text-title">級分</span>
                                    </div>
                                </div>
                            </div>

                            {/*
                              評語只有**一個**欄位。
                              先前這裡是「AI 評語建議」與「教師補充評語」兩個 textarea，
                              但資料庫的模型是版本不是欄位：一份繳交任何時刻只有一筆
                              is_valid = true，老師修改等於寫一筆 is_ai = false 的新版本
                              讓舊的失效。兩個輸入框對不上一個資料來源。

                              老師直接在這裡改，存檔就是新版本；上方的標籤顯示目前
                              這一版是誰寫的。
                            */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between gap-2 pl-1">
                                    <div className="flex items-center gap-2 text-body text-text-primary">
                                        <Highlighter size={16} className="text-secondary" />
                                        <span>評語</span>
                                    </div>
                                    <span className="text-caption text-text-muted">
                                        {result.isAi ? 'AI 批改' : '教師修改'}
                                    </span>
                                </div>

                                {/*
                                  所見即所得（見 components/FeedbackEditor.tsx）。
                                  存回去的仍然是 markdown —— 學生端與預覽都吃這個格式。
                                */}
                                <React.Suspense
                                  fallback={
                                    <div className="rounded-2xl border border-border bg-card shadow-sm min-h-[240px] flex items-center justify-center text-body text-text-muted">
                                      編輯器載入中…
                                    </div>
                                  }
                                >
                                  <FeedbackEditor
                                    id="gradingeditor-feedback"
                                    value={result.feedback}
                                    onChange={(markdown) =>
                                      setResult({ ...result, feedback: markdown, isAi: false })
                                    }
                                  />
                                </React.Suspense>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
      </div>

      {/* 👇👇👇 手寫原稿彈出視窗 (Modal) 👇👇👇 */}
      {showHandwritten && (
        <div id="gradingeditor-modal-handwritten" className="fixed inset-0 z-[60] flex items-center justify-center bg-text-primary/80 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setShowHandwritten(false)}>
            <div className="relative max-w-4xl w-full h-full flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <button 
                    id="gradingeditor-modal-btn-closehandwritten"
                    onClick={() => setShowHandwritten(false)} 
                    className="absolute top-4 right-4 text-white hover:text-text-secondary p-2 rounded-full bg-card/10 hover:bg-card/20 transition-colors"
                >
                    <X size={24} />
                </button>
                {/*
                  ⚠️ 這裡以前寫死一張 Unsplash 的示範照片，跟學生完全無關。
                     現在顯示 submission.pic_files 裡真正的原稿（可能多頁）。
                */}
                <div className="overflow-auto max-h-full rounded-lg shadow-2xl">
                    <img
                        key={draftImages[draftPage]}
                        src={imageUrlOf(draftImages[draftPage])}
                        alt={`手寫原稿第 ${draftPage + 1} 頁`}
                        className="max-h-[85vh] max-w-full object-contain"
                    />
                </div>
                <div className="mt-4 flex items-center gap-3 bg-black/50 px-4 py-2 rounded-full backdrop-blur-md">
                    {draftImages.length > 1 && (
                        <button
                            id="gradingeditor-modal-btn-prevdraft"
                            onClick={() => setDraftIndex(Math.max(0, draftPage - 1))}
                            disabled={draftPage === 0}
                            aria-label="上一頁原稿"
                            className="tap-target p-1 text-on-solid disabled:opacity-30"
                        >
                            <ChevronLeft size={18} />
                        </button>
                    )}
                    <span className="text-on-solid font-normal tabular-nums whitespace-nowrap">
                        學生手寫原稿 {draftPage + 1} / {draftImages.length}
                    </span>
                    {draftImages.length > 1 && (
                        <button
                            id="gradingeditor-modal-btn-nextdraft"
                            onClick={() => setDraftIndex(Math.min(draftImages.length - 1, draftPage + 1))}
                            disabled={draftPage >= draftImages.length - 1}
                            aria-label="下一頁原稿"
                            className="tap-target p-1 text-on-solid disabled:opacity-30"
                        >
                            <ChevronRight size={18} />
                        </button>
                    )}
                </div>
            </div>
        </div>
      )}
      {/* 👆👆👆 End of Modal */}
    </div>
  );
};
