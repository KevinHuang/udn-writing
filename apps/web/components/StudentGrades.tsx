import { Markdown } from './Markdown';
import { useNavigate } from 'react-router-dom';
import { routes } from '../lib/routes';
import React, { useState, useRef } from 'react';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } from 'docx';
import { 
  Award,
  ChevronRight,
  FileText,
  Calendar,
  MessageSquare,
  ArrowLeft,
  Download,
} from 'lucide-react';
import { Submission, Assignment, Course, Question, CATEGORY_LABELS } from '../types';
import { levelStyle, MAX_LEVEL } from '../lib/scoring';
import { semesterLabel } from '../lib/semester';
import { SemesterSelect } from './SemesterSelect';
import { SHOW_CATEGORY_SCORES } from '../lib/features';
import { stripFeedbackMarks } from '../lib/feedbackMarks';
import { 
  Radar, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  ResponsiveContainer
, PolarRadiusAxis} from 'recharts';

interface StudentGradesProps {
  submissions: Submission[];
  assignments: Assignment[];
  courses: Course[];
  questions: Question[];
  onBack?: () => void;
  canGoBack?: boolean;
  selectedSubmissionId?: string;
  /** 網址指定的學期（例如 115-1）。沒帶就依 selectedSubmissionId 或目前學期決定 */
  semester?: string;
  /** 目前學期。學期下拉預設就停在這一個 */
  currentSemester?: string;
  /** 學期下拉的選項（後端 semesters 表） */
  semesterOptions: { value: string; label: string }[];
}

/**
 * Recharts 只接受實際色碼，不吃 Tailwind class，
 * 所以從 CSS 變數把當前主題的顏色讀出來。
 */
function readChartInk() {
  if (typeof window === 'undefined') {
    return { muted: '#8A8271', border: '#DED7C4', accent: '#3E5A78' };
  }
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return {
    muted: get('--color-ink-500', '#8A8271'),
    border: get('--color-border', '#DED7C4'),
    accent: get('--color-primary', '#3E5A78'),
  };
}

export const StudentGrades: React.FC<StudentGradesProps> = ({
  submissions,
  assignments,
  courses,
  questions,
  onBack,
  canGoBack,
  selectedSubmissionId,
  semester,
  currentSemester,
  semesterOptions,
}) => {
  const navigate = useNavigate();
  const chartInk = readChartInk();

  const [viewMode, setViewMode] = useState<'OVERVIEW' | 'DETAIL'>(selectedSubmissionId ? 'DETAIL' : 'OVERVIEW');
  const [currentSubmissionId, setCurrentSubmissionId] = useState(selectedSubmissionId);
  const detailTopRef = useRef<HTMLDivElement>(null);

  // 從外面帶著 selectedSubmissionId 導覽進來時要切到明細頁；沒有帶就回總覽。
  // 原本用 effect 同步，等於 render 完才改 state，使用者會先看到舊的那一頁。
  // 改用 React 官方的「render 階段依 prop 變化調整 state」寫法。
  const [lastSelectedSubmissionId, setLastSelectedSubmissionId] = useState(selectedSubmissionId);
  if (selectedSubmissionId !== lastSelectedSubmissionId) {
    setLastSelectedSubmissionId(selectedSubmissionId);
    if (selectedSubmissionId) {
      setCurrentSubmissionId(selectedSubmissionId);
        setViewMode('DETAIL');
    } else {
      setViewMode('OVERVIEW');
    }
  }

  /** 某份繳交屬於哪個學期。查不到課程就是 undefined */
  const semesterOf = (s: Submission): string | undefined => {
    const assignment = assignments.find(a => a.id === s.assignmentId);
    return courses.find(c => c.id === assignment?.courseId)?.semester;
  };

  /**
   * 學期。改成下拉選單（與教師端一致），預設停在目前學期。
   *
   * 原本是「全部／本學期／過往學期」三顆鈕 —— 學生講不出「過往」指的是哪一個學期。
   *
   * 學期放在網址（?semester=115-1），不另存 state：重新整理不會跳走，
   * 也能把網址貼給別人。從作業清單點某一份成績進來（只帶 focus）時，
   * 落在**那一份所屬的學期** —— 否則過去學期的成績點進來會是一片空白。
   */
  const focusedSubmission = selectedSubmissionId
    ? submissions.find(s => s.id === selectedSubmissionId)
    : undefined;
  const pickedSemester =
    semester
    ?? (focusedSubmission && semesterOf(focusedSubmission))
    ?? currentSemester
    ?? '';

  const gradedSubmissions = submissions
    .filter(s => {
      if (s.status !== 'Published' || !s.result) return false;
      // 只留選定學期的成績。查不到課程的那幾筆不顯示 —— 寧可少一筆，也不要掛錯學期
      return semesterOf(s) === pickedSemester;
    })
    .sort((a, b) => {
      const dateA = new Date(a.publishedAt || a.submittedAt).getTime();
      const dateB = new Date(b.publishedAt || b.submittedAt).getTime();
      return dateB - dateA;
    });


  const currentSubmission = gradedSubmissions.find(s => s.id === currentSubmissionId) || gradedSubmissions[0];
  const currentAssignment = assignments.find(a => a.id === currentSubmission?.assignmentId);
  const currentQuestion = questions.find(q => q.id === currentAssignment?.questionId);

  const displayData = {
    content: currentSubmission?.content,
    result: currentSubmission?.result,
    submittedAt: currentSubmission?.submittedAt,
    publishedAt: currentSubmission?.publishedAt,
  };

  const handleShowDetail = (id: string) => {
    setCurrentSubmissionId(id);
    setViewMode('DETAIL');
  };


  /**
   * docx v9 的 ImageRun 需要明確指定圖片格式，光給 ArrayBuffer 不夠，
   * 所以這裡連同格式一起帶出來。SVG 需要額外的點陣 fallback，
   * 原型用不到，直接視為不支援。
   */
  type DocxImage = { data: ArrayBuffer; type: 'png' | 'jpg' | 'gif' | 'bmp' };

  const mimeToDocxType = (mime: string): DocxImage['type'] | null => {
    switch (mime.toLowerCase()) {
      case 'image/png':
        return 'png';
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg';
      case 'image/gif':
        return 'gif';
      case 'image/bmp':
        return 'bmp';
      default:
        return null;
    }
  };

  const fetchImageAsBuffer = async (urlOrBase64: string): Promise<DocxImage | null> => {
    try {
      if (urlOrBase64.startsWith('data:')) {
        // data:image/png;base64,xxxx → 取出 mime 與內容
        const [header, base64Data] = urlOrBase64.split(',');
        const mime = header.slice(5).split(';')[0];
        const type = mimeToDocxType(mime);
        if (!type || !base64Data) return null;

        const binaryString = window.atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return { data: bytes.buffer, type };
      }

      const response = await fetch(urlOrBase64);
      if (!response.ok) return null;
      const blob = await response.blob();
      const type = mimeToDocxType(blob.type);
      if (!type) return null;
      return { data: await blob.arrayBuffer(), type };
    } catch (error) {
      console.error('Failed to fetch image for docx', error);
      return null;
    }
  };

  const handleDownloadReport = async () => {
    if (!currentSubmission || !currentAssignment || !currentQuestion) return;

    const children: Paragraph[] = [];

    const createParagraphs = (text: string) => {
      // 老師標的螢光筆與文字色是行內 HTML，Word 這邊是逐行塞純文字 ——
      // 不剝掉的話文件裡會出現 <mark class="hl-yellow"> 這種標籤
      return stripFeedbackMarks(text).split('\n').map(line => new Paragraph({
        children: [new TextRun({ text: line })],
        spacing: { after: 120 }
      }));
    };

    // 1. 原作文題目文字說明
    children.push(
      new Paragraph({
        text: "作業題目",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 }
      }),
      ...createParagraphs(currentQuestion.content)
    );

    // 2. 相關附圖
    if (currentQuestion.imageUrl) {
      const image = await fetchImageAsBuffer(currentQuestion.imageUrl);
      if (image) {
        children.push(
          new Paragraph({
            text: "相關附圖",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 }
          }),
          new Paragraph({
            children: [
              new ImageRun({
                type: image.type,
                data: image.data,
                transformation: {
                  width: 400,
                  height: 300,
                },
              }),
            ],
            spacing: { after: 120 }
          })
        );
      }
    }

    // 3. 學生作文
    children.push(
      new Paragraph({
        text: "學生作文",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 }
      }),
      ...createParagraphs(displayData.content || '')
    );

    // 4. 批改結果
    children.push(
      new Paragraph({
        text: "批改結果",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `總分: ${displayData.result?.totalScore || '--'}`, bold: true, size: 28 }),
        ],
        spacing: { after: 120 }
      })
    );

    if (displayData.result?.feedback) {
      children.push(
        new Paragraph({
          // 評語只有一版，標題跟著作者走
          text: displayData.result.isAi ? "AI 批改建議" : "教師評語",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 }
        }),
        // ⚠️ 內容是 markdown。標色的標籤會被剝掉（見 createParagraphs），
        //    但 ### 與 - 仍會照原樣輸出。要漂亮的話得把 markdown 轉成
        //    docx 的段落與清單，那是另一件事（見 artifacts/findings.md）。
        ...createParagraphs(displayData.result.feedback)
      );
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: children,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentAssignment.title}_批改報告.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 雷達圖：四項要素用會考的官方名稱，滿分是級分上限而非舊的 25 分制。
  // 名稱走 CATEGORY_LABELS，這樣改一個地方全站都跟著改。
  const radarData = displayData.result
    ? (['content', 'structure', 'vocabulary', 'grammar'] as const).map((key) => ({
        key,
        subject: CATEGORY_LABELS[key],
        A: displayData.result!.categoryScores[key],
        fullMark: MAX_LEVEL,
      }))
    : [];

  if (viewMode === 'DETAIL' && currentSubmission) {
    return (
      <div className="space-y-4 sm:space-y-6 animate-fade-in" ref={detailTopRef}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button 
            id="studentgrades-btn-back-overview"
            onClick={() => setViewMode('OVERVIEW')}
            className="flex items-center gap-2 text-text-primary hover:text-primary font-bold transition-colors w-fit"
          >
            <ArrowLeft size={20} /> 返回成績概覽
          </button>
          <button 
            id="studentgrades-btn-download-report" 
            onClick={handleDownloadReport}
            className="flex items-center justify-center gap-2 bg-card border border-border/50 px-4 py-2 sm:py-2.5 rounded-xl text-body text-text-primary hover:bg-surface transition-colors shadow-sm w-full sm:w-auto"
          >
            <Download size={18} /> 下載報告
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
          {/* Left Column: Summary & Scores */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <div className="bg-card p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-border-card">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 mb-6 sm:mb-8">
                <div>
                  <h1 className="text-display font-bold text-text-primary mb-3 sm:mb-2 tracking-tight">{currentAssignment?.title}</h1>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-body text-text-secondary font-normal">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={16} />
                      <span>發還於：{displayData.publishedAt || displayData.submittedAt ? new Date(displayData.publishedAt || displayData.submittedAt!).toLocaleDateString() : '未知'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Award size={16} />
                      <span>評分狀態：已發佈</span>
                    </div>
                  </div>
                </div>
                <div className="text-left sm:text-center bg-gradient-to-br from-sun-300 to-sun-500 px-6 py-4 rounded-2xl shadow-sm shrink-0">
                  <div className="text-display font-bold text-text-primary mb-1">
                    {displayData.result?.totalScore || '--'}
                  </div>
                  <div className="text-caption text-text-secondary uppercase tracking-widest">總分</div>
                </div>
              </div>

              {/* 四項評分要素：依需求先隱藏，資料與 AI 回傳都保留（見 lib/features.ts） */}
              {SHOW_CATEGORY_SCORES && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                <div className="h-48 sm:h-64 bg-card/30 rounded-2xl p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                      <PolarGrid stroke={chartInk.border} />
                      <PolarAngleAxis
                        dataKey="subject"
                        tick={{ fill: chartInk.muted, fontSize: 12, fontWeight: 600 }}
                      />
                      <PolarRadiusAxis domain={[0, MAX_LEVEL]} tick={false} axisLine={false} />
                      <Radar
                        name="級分"
                        dataKey="A"
                        stroke={chartInk.accent}
                        fill={chartInk.accent}
                        fillOpacity={0.2}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-4 flex flex-col justify-center bg-card/30 p-4 sm:p-6 rounded-2xl">
                  {radarData.map((item) => (
                    <div key={item.key} className="space-y-1.5">
                      <div className="flex justify-between text-body text-text-primary">
                        <span>{item.subject}</span>
                        <span>{item.A} / {item.fullMark}</span>
                      </div>
                      <div className="h-2 bg-card/50 rounded-full overflow-hidden border border-border-card">
                        <div 
                          className="h-full bg-primary rounded-full transition-all duration-1000" 
                          style={{ width: `${(item.A / item.fullMark) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              )}
            </div>

            {/* AI Feedback */}
            <div className="bg-card p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-border-card">
              {/*
                評語只有**一個**區塊。先前這裡分成「AI 批改建議」「教師回饋」
                「具體優化建議」三段，但資料庫裡一份繳交任何時刻只有一筆有效的
                批改 —— 老師修改是寫新版本讓舊的失效，不是另外加一段。
                建議本來就寫在那份 markdown 報告裡。
              */}
              <div className="flex items-center justify-between gap-2 mb-4 sm:mb-6">
                <div className="flex items-center gap-2 text-secondary font-bold">
                  <MessageSquare size={20} className="sm:size-6" />
                  <h2 className="text-title tracking-tight">批改評語</h2>
                </div>
                {displayData.result?.feedback && (
                  <span className="text-caption text-text-muted">
                    {displayData.result.isAi ? 'AI 批改' : '教師評語'}
                  </span>
                )}
              </div>
              {displayData.result?.feedback
                ? <Markdown>{displayData.result.feedback}</Markdown>
                : <p className="text-ui text-text-muted font-normal">尚無評語</p>}
            </div>

          </div>

          {/* Right Column: Original Text & Prompt */}
          <div className="space-y-4 sm:space-y-6">
            {currentQuestion && (
              <div className="bg-card p-5 sm:p-6 rounded-2xl sm:rounded-3xl shadow-sm border border-border-card">
                <div className="flex items-center gap-2 text-text-secondary font-bold mb-3 sm:mb-4">
                  <FileText size={18} className="sm:size-5" />
                  <h3 id="studentgrades-prompt-title" className="text-ui">作業題目</h3>
                </div>
                <div className="bg-surface/50 p-4 sm:p-5 rounded-xl sm:rounded-2xl text-body text-text-primary font-essay leading-relaxed border border-border whitespace-pre-wrap shadow-sm">
                  {currentQuestion.content}
                </div>
              </div>
            )}

            <div className="bg-card p-5 sm:p-6 rounded-2xl sm:rounded-3xl shadow-sm border border-border-card sticky top-4 sm:top-6">
              <div className="flex items-center gap-2 text-text-secondary font-bold mb-3 sm:mb-4">
                <FileText size={18} className="sm:size-5" />
                <h3 id="studentgrades-content-title" className="text-ui">原文內容</h3>
              </div>
              <div className="bg-surface/50 p-4 sm:p-5 rounded-xl sm:rounded-2xl text-body text-text-primary leading-loose font-essay h-[300px] sm:h-[500px] overflow-y-auto no-scrollbar border border-border whitespace-pre-wrap shadow-sm">
                {displayData.content}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in">
      <div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-2 sm:gap-3">
            {canGoBack && onBack && (
              <button 
                id="studentgrades-btn-back-main"
                onClick={onBack}
                className="tap-target p-1.5 sm:p-2 -ml-1 sm:-ml-2 rounded-full hover:bg-card/50 text-text-primary transition-colors active:scale-90"
              >
                <ArrowLeft size={20} className="sm:size-6" />
              </button>
            )}
            <h1 className="text-display font-bold text-text-primary tracking-tight">成績紀錄</h1>
          </div>
          
          {/* 學期：與教師端一樣用下拉，預設目前學期。換學期就換網址（replace，不塞歷史） */}
          <SemesterSelect
            id="studentgrades-select-semester"
            value={pickedSemester}
            options={semesterOptions}
            current={currentSemester}
            onChange={(s) => navigate(routes.studentGrades({ semester: s }), { replace: true })}
            className="self-stretch md:self-center"
          />
        </div>
        <p className="tap-target text-body text-text-secondary font-normal">追蹤你的寫作進度與成長曲線</p>
      </div>

      {/*
        單欄。右側原本的「學習成就」卡（平均、最高分、完成率）拿掉了 ——
        學期改成單選之後它只是把這張表再算一次，完成率還是跨學期算的，兩邊對不起來。
      */}
      <div>
        <div>
          <div className="bg-card p-4 sm:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-border-card hover:shadow-md transition-all duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 sm:mb-8">
              <div className="flex items-center gap-2 text-secondary font-bold">
                <Award size={20} className="sm:size-6" />
                <h2 className="text-title tracking-tight">所有成績紀錄 (總表)</h2>
              </div>
              <div className="text-body text-text-secondary uppercase tracking-widest bg-surface/60 px-2.5 py-1 rounded-full border border-border w-fit">
                共 {gradedSubmissions.length} 筆紀錄
              </div>
            </div>
            
            {/* Mobile View (Cards) */}
            <div className="block sm:hidden space-y-3">
              {gradedSubmissions.length > 0 ? (
                gradedSubmissions.map(submission => {
                  const assignment = assignments.find(a => a.id === submission.assignmentId);
                  const course = courses.find(c => c.id === assignment?.courseId);
                  const score = submission.result?.totalScore || 0;
                  
                  return (
                    <div 
                      key={submission.id}
                      id={`studentgrades-mobile-card-${submission.id}`}
                      onClick={() => handleShowDetail(submission.id)}
                      className="bg-surface/50 p-4 rounded-2xl border border-border flex flex-col gap-3 active:scale-[0.98] transition-transform"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-caption text-primary bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20 uppercase tracking-wider">
                            {course ? semesterLabel(course.semester) : '未知'}
                          </span>
                          <div className="text-caption text-text-secondary mt-1.5 font-normal">
                            發還：{new Date(submission.publishedAt || submission.submittedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-heading font-bold ${
                            levelStyle(score).text
                          }`}>
                            {score}
                          </span>
                        </div>
                      </div>
                      
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-text-primary text-body">
                            {assignment?.title}
                          </div>
                        </div>
                        <div className="text-caption text-text-secondary mt-1 uppercase tracking-widest">
                          {course?.name}
                        </div>
                      </div>
                      
                      <div className="flex justify-end border-t border-border/30 pt-2 mt-1">
                        <button className="tap-target text-primary text-caption flex items-center gap-1 whitespace-nowrap">
                          查看詳情 <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="bg-card/50 border-2 border-dashed border-border/50 rounded-2xl p-8 text-center">
                  <p className="text-text-secondary text-body font-normal">這個學期還沒有已發還的成績</p>
                </div>
              )}
            </div>

            {/* Desktop View (Table) */}
            <div className="hidden sm:block overflow-x-auto -mx-4 sm:-mx-8">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="bg-surface-soft/60 border-y border-border">
                    <th className="px-4 sm:px-6 py-3 sm:py-4 text-body text-text-secondary uppercase tracking-widest whitespace-nowrap">學期</th>
                    <th className="px-4 sm:px-6 py-3 sm:py-4 text-body text-text-secondary uppercase tracking-widest">作業名稱</th>
                    <th className="px-4 sm:px-6 py-3 sm:py-4 text-body text-text-secondary uppercase tracking-widest text-center">總分</th>
                    <th className="px-4 sm:px-6 py-3 sm:py-4 text-body text-text-secondary uppercase tracking-widest text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashed divide-border dark:divide-border-strong/60">
                  {gradedSubmissions.length > 0 ? (
                    gradedSubmissions.map(submission => {
                      const assignment = assignments.find(a => a.id === submission.assignmentId);
                      const course = courses.find(c => c.id === assignment?.courseId);
                      const score = submission.result?.totalScore || 0;
                      
                      return (
                        <tr 
                          key={submission.id} 
                          id={`studentgrades-table-row-${submission.id}`}
                          className="hover:bg-surface/70 transition-all duration-200 group cursor-pointer active:bg-surface-soft"
                          onClick={() => handleShowDetail(submission.id)}
                        >
                          <td className="px-4 sm:px-8 py-4 sm:py-5">
                            <span className="text-body text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20 uppercase tracking-wider">
                              {course ? semesterLabel(course.semester) : '未知'}
                            </span>
                            <div className="text-body text-text-secondary mt-1.5 font-normal">
                              發還：{new Date(submission.publishedAt || submission.submittedAt).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="px-4 sm:px-8 py-4 sm:py-5">
                            <div className="flex items-center gap-2">
                              <div className="font-bold text-text-primary group-hover:text-primary transition-colors text-title">
                                {assignment?.title}
                              </div>
                            </div>
                            <div className="text-body text-text-secondary mt-1 uppercase tracking-widest">
                              {course?.name}
                            </div>
                          </td>
                          <td className="px-4 sm:px-8 py-4 sm:py-5 text-center">
                            <span className={`text-heading font-bold ${
                              levelStyle(score).text
                            }`}>
                              {score}
                            </span>
                          </td>
                          <td className="px-4 sm:px-6 py-4 sm:py-5 text-right">
                            <button id={`studentgrades-btn-viewdetail-${submission.id}`} className="tap-target text-primary font-bold text-ui flex items-center gap-1 ml-auto whitespace-nowrap hover:underline active:scale-95 transition-transform">
                              查看詳情 <ChevronRight size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-4 sm:px-8 py-8 sm:py-12 text-center text-text-secondary text-body font-normal">
                        這個學期還沒有已發還的成績
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
