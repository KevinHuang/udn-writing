
import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Search,
  CheckCircle,
  ChevronRight,
  ArrowLeft,
  Folder as FolderIcon,
  Home,
  FolderOpen,
  Check,
  X,
  Eye,
} from 'lucide-react';
import { Assignment, Course, Question, AssignmentConfig, Folder } from '../types';
import { questionCountsByFolder } from '../lib/folders';
import { QuestionPreviewModal } from './QuestionPreviewModal';

interface PublishAssignmentWizardProps {
  courses: Course[];
  questions: Question[];
  folders: Folder[];
  onAssignmentOperation: (creates: Assignment[], updates: Assignment[], deleteIds: string[]) => void;
  /** 離開精靈（返回進來的那一頁） */
  onBack?: () => void;
  /** 要派發到的班級。老師從班級工作台的「新增作業」進來，一次只派這一班 */
  initialCourseId?: string | null;
  /** 派發成功後呼叫。從班級頁進來的要導回該班級頁 */
  onPublished?: () => void;
}

/**
 * 派發作業：選題目、設截止日，在同一頁完成。
 *
 * 班級不在精靈裡選 —— 老師是從某一個班級的工作台按「新增作業」進來的，
 * 那個班就是派發對象。原本第一步可以勾選多個班一次派發，
 * 但「我現在在七年忠班」和「順便也派給其他班」是兩件事混在一起，
 * 老師很容易在沒注意的情況下多派給別班，所以拿掉了。
 * 要派給另一個班，就到那個班的工作台再派一次。
 */
export const PublishAssignmentWizard: React.FC<PublishAssignmentWizardProps> = ({
  courses,
  questions,
  folders,
  onAssignmentOperation,
  onBack,
  initialCourseId,
  onPublished,
}) => {
  /** 派發對象。由進來的那一頁決定，精靈裡不能改 */
  const targetCourse = courses.find(c => c.id === initialCourseId) ?? null;

  // --- Form State ---
  const [activeTab, setActiveTab] = useState<'SHARED' | 'PERSONAL'>('SHARED');
  const [currentPath, setCurrentPath] = useState<Folder[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  /** 正在預覽的題目。null 時不顯示預覽視窗 */
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);

  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  
  /**
   * 老師開了截止日之後，預設帶一週後的 23:59。
   * 這只是「開啟時的起始值」，不是派作業的預設 —— 預設是沒有截止日。
   */
  const getDefaultDeadline = () => {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      const pad = (n: number) => n < 10 ? '0' + n : n;
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T23:59`;
  };

  /**
   * 要不要設截止日。**預設關閉** —— 老師實際的操作習慣是先派出去，
   * 需要限期再手動開。
   */
  const [hasDeadline, setHasDeadline] = useState(false);

  const [config, setConfig] = useState<AssignmentConfig>({
    deadline: '',
    allowLateSubmission: true
  });
  
  const resetForm = () => {
    setSelectedQuestionIds([]);
    setHasDeadline(false);
    setConfig({
      deadline: '',
      allowLateSubmission: true
    });
    setCurrentPath([]);
    setActiveTab('SHARED');
    setSearchQuery('');
  };

  const handlePublish = () => {
    if (!targetCourse || selectedQuestionIds.length === 0) return;

    const creates: Assignment[] = selectedQuestionIds.flatMap(qId => {
        const question = questions.find(q => q.id === qId);
        if (!question) return [];
        return [{
            id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: question.title,
            courseId: targetCourse.id,
            questionId: question.id,
            config: { ...config },
            // 預設未開放：老師先把題目排好，再自己決定什麼時候讓學生看到。
            // 清單每一列的開關（toggleVisibility）就是放行的地方。
            status: 'Draft' as const,
            totalStudents: targetCourse.studentCount,
            createdAt: new Date().toISOString(),
        }];
    });

    onAssignmentOperation(creates, [], []);
    alert(
      `已建立 ${creates.length} 份作業給${targetCourse.name}。

` +
        `目前是「未開放」，學生還看不到。在作業清單按下開關才會放行。`,
    );
    resetForm();
    onPublished?.();
  };

  const toggleQuestionSelection = (questionId: string) => {
      setSelectedQuestionIds(prev => 
          prev.includes(questionId) 
              ? prev.filter(id => id !== questionId) 
              : [...prev, questionId]
      );
  };


  const folderCounts = useMemo(
    () => questionCountsByFolder(folders, questions),
    [folders, questions],
  );

  const currentFolderId = currentPath.length > 0 ? currentPath[currentPath.length - 1].id : null;
  const visibleFolders = !searchQuery.trim() 
    ? folders.filter(f => f.type === activeTab && f.parentId === currentFolderId) 
    : [];
  
  const visibleQuestions = questions.filter(q => {
    const matchesTab = q.type === activeTab;
    const matchesArchive = !q.isArchived;
    const term = searchQuery.toLowerCase();
    
    if (term) {
         return matchesTab && matchesArchive && (
            q.title.toLowerCase().includes(term) ||
            q.content.toLowerCase().includes(term) ||
            q.gradeLevel.toLowerCase().includes(term)
         );
    }
    
    return matchesTab && matchesArchive && q.folderId === currentFolderId;
  });

  const navigateToFolder = (folder: Folder) => setCurrentPath([...currentPath, folder]);
  const navigateToBreadcrumb = (index: number) => setCurrentPath(index === -1 ? [] : currentPath.slice(0, index + 1));

  const renderQuestionPicker = () => (
    <div className="flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 shrink-0 gap-4">
        <div className="flex gap-2 p-1.5 bg-secondary/5 rounded-brand w-full md:w-auto overflow-x-auto scrollbar-hide">
            <button
                id="assignmentmanager-create-tab-shared"
                onClick={() => { setActiveTab('SHARED'); setCurrentPath([]); setSearchQuery(''); }}
                className={`flex-1 md:flex-none px-4 md:px-5 py-2 text-body font-bold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'SHARED' 
                    ? 'bg-surface text-primary shadow-sm' 
                    : 'text-text-primary opacity-70 hover:opacity-100'
                }`}
            >
                共用題庫
            </button>
            <button
                id="assignmentmanager-create-tab-personal"
                onClick={() => { setActiveTab('PERSONAL'); setCurrentPath([]); setSearchQuery(''); }}
                className={`flex-1 md:flex-none px-4 md:px-5 py-2 text-body font-bold rounded-lg transition-all whitespace-nowrap ${
                activeTab === 'PERSONAL' 
                    ? 'bg-surface text-primary shadow-sm' 
                    : 'text-text-primary opacity-70 hover:opacity-100'
                }`}
            >
                個人題庫
            </button>
        </div>
        
        {selectedQuestionIds.length > 0 && (
            <div className="flex items-center gap-2 md:hidden">
                <span className="text-caption text-primary bg-primary/5 px-4 py-1.5 rounded-full border border-primary/10 w-full text-center">
                    已選擇 {selectedQuestionIds.length} 個題目
                </span>
            </div>
        )}

        {selectedQuestionIds.length > 0 && (
            <div className="hidden md:flex items-center gap-2">
                <span className="text-body text-primary bg-primary/5 px-4 py-1.5 rounded-full border border-primary/10">
                    已選擇 {selectedQuestionIds.length} 個題目
                </span>
            </div>
        )}

        <div className="relative w-full md:w-64">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-primary opacity-60" size={16} />
             <input 
                id="assignmentmanager-create-input-search"
                type="text" 
                placeholder="搜尋題目..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 py-2.5 md:py-2 w-full border border-border rounded-brand text-body bg-surface/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all shadow-sm" 
             />
             {searchQuery && (
                <button 
                    id="assignmentmanager-create-btn-clearsearch"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-primary opacity-60 hover:opacity-100"
                >
                    <X size={14} />
                </button>
             )}
        </div>
      </div>

      {!searchQuery && (
        <div className="flex items-center gap-2 text-body text-text-primary opacity-70 bg-surface/40 border border-border p-2 rounded-brand mb-4 overflow-x-auto shrink-0">
            <button 
                id="assignmentmanager-create-breadcrumb-home"
                onClick={() => navigateToBreadcrumb(-1)}
                className={`flex items-center hover:text-primary px-3 py-1 rounded-lg transition-colors whitespace-nowrap ${currentPath.length === 0 ? 'font-bold text-text-primary bg-surface/60 shadow-sm' : ''}`}
            >
                <Home size={14} className="mr-1.5" />
                {activeTab === 'SHARED' ? '共用題庫' : '個人題庫'}
            </button>
            {currentPath.map((folder, index) => (
                <React.Fragment key={folder.id}>
                    <ChevronRight size={14} className="text-text-primary opacity-40 min-w-[14px]" />
                    <button 
                        id={`assignmentmanager-create-breadcrumb-${folder.id}`}
                        onClick={() => navigateToBreadcrumb(index)}
                        className={`flex items-center hover:text-primary px-3 py-1 rounded-lg transition-colors whitespace-nowrap ${index === currentPath.length - 1 ? 'font-bold text-text-primary bg-surface/60 shadow-sm' : ''}`}
                    >
                        <FolderOpen size={14} className="mr-1.5 text-text-primary opacity-50" />
                        {folder.name}
                    </button>
                </React.Fragment>
            ))}
        </div>
      )}

      <div className="space-y-4">
        {/* Folders - smaller and more compact */}
        {visibleFolders.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {visibleFolders.map(folder => (
                    <div 
                        key={folder.id}
                        id={`assignmentmanager-create-folder-${folder.id}`}
                        onClick={() => navigateToFolder(folder)}
                        className="bg-surface/40 p-3 rounded-brand border border-border hover:bg-surface/80 cursor-pointer transition-all flex items-center gap-3 group hover:shadow-sm"
                    >
                        <div className="w-8 h-8 bg-info-50 text-info-700 rounded-lg flex items-center justify-center shrink-0 shadow-sm group-hover:bg-info-100 transition-colors">
                            <FolderIcon size={16} fill="currentColor" fillOpacity={0.2} />
                        </div>
                        <div className="min-w-0">
                            <h4 className="text-text-primary text-caption truncate group-hover:text-primary">{folder.name}</h4>
                            <span className="text-caption text-text-primary opacity-70 font-normal">{folderCounts[folder.id] ?? 0} 項目</span>
                        </div>
                    </div>
                ))}
            </div>
        )}

        {visibleFolders.length > 0 && visibleQuestions.length > 0 && (
            <div className="h-px bg-border/50 my-2 mx-2"></div>
        )}

        {/* Questions - Grid Layout, Smaller Cards */}
        {visibleQuestions.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleQuestions.map(q => {
                    const isSelected = selectedQuestionIds.includes(q.id);
                    return (
                        <div 
                            key={q.id}
                            id={`assignmentmanager-create-btn-togglequestion-${q.id}`}
                            onClick={() => toggleQuestionSelection(q.id)}
                            className={`p-4 rounded-brand cursor-pointer transition-all flex flex-col gap-2 border h-full relative group ${
                                isSelected 
                                ? 'border-primary/50 bg-primary/5 shadow-md ring-1 ring-primary/20' 
                                : 'border-border bg-surface/40 hover:bg-surface/80 hover:shadow-sm'
                            }`}
                        >
                            <div className="flex justify-between items-start">
                                <span className={`text-caption font-bold px-2 py-0.5 rounded border ${isSelected ? 'bg-primary/10 text-primary border-primary/20' : 'bg-surface/60 text-text-primary opacity-70 border-border/60'}`}>
                                    {q.gradeLevel}
                                </span>
                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${isSelected ? 'bg-primary border-primary' : 'bg-surface border-text-primary/40'}`}>
                                    {isSelected && <Check size={12} className="text-surface" />}
                                </div>
                            </div>
                            
                            {/*
                              標題自己就是「看這一題」的入口 —— 老師的直覺是
                              點題目名稱看內容，不是點了就把它選走。
                              選取仍然靠卡片其他位置與右上角的圈圈。
                            */}
                            <h4 className={`font-bold text-body leading-tight ${isSelected ? 'text-primary' : 'text-text-primary'}`}>
                                <button
                                    id={`assignmentmanager-create-btn-previewtitle-${q.id}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setPreviewQuestion(q);
                                    }}
                                    title="查看完整題目"
                                    className="group flex w-full items-center gap-1.5 text-left"
                                >
                                    <span className="truncate min-w-0 group-hover:underline">{q.title}</span>
                                    {/* 與作業清單同一個記號：有眼睛就是點得開 */}
                                    <Eye
                                        size={13}
                                        aria-hidden="true"
                                        className={`shrink-0 transition-colors ${isSelected ? 'text-primary/70' : 'text-text-muted'}`}
                                    />
                                </button>
                            </h4>
                            
                            <p className="text-caption text-text-primary opacity-70 line-clamp-2 leading-relaxed">
                                {q.content}
                            </p>

                            {/*
                              「查看」：卡片只顯示標題與內容前兩行，
                              看圖寫作的圖片更是完全看不到。老師需要能確認
                              這是不是他要的那一題再決定選用。
                              stopPropagation 避免點到查看就順手選取了。
                            */}
                            <button
                                id={`assignmentmanager-create-btn-preview-${q.id}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewQuestion(q);
                                }}
                                className="mt-auto self-start inline-flex items-center gap-1 text-caption text-primary hover:underline whitespace-nowrap"
                            >
                                <Eye size={12} className="shrink-0" />
                                查看完整題目
                            </button>
                        </div>
                    );
                })}
            </div>
        ) : (
            visibleFolders.length === 0 && (
                <div className="py-20 text-center text-text-primary opacity-60">
                    <p>{searchQuery ? '找不到符合的題目' : '此資料夾為空'}</p>
                </div>
            )
        )}
      </div>
    </div>
  );

  // --- MAIN RENDER ---

  // 精靈只能從班級工作台進來。直接打到這個路由時給出去路，不要停在半殘的表單
  if (!targetCourse) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <p className="text-body text-text-secondary mb-5">
          派發作業要從班級開始。請先到課程管理選一個班級，再按「新增作業」。
        </p>
        <button
          id="assignmentmanager-btn-nocourse-back"
          onClick={() => onBack?.()}
          className="px-6 py-2.5 rounded-brand bg-primary text-on-accent text-ui hover:opacity-90 transition-opacity"
        >
          回到課程管理
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-5xl mx-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
          <button id="assignmentmanager-create-btn-back" onClick={() => { resetForm(); onBack?.(); }} className="p-2 md:p-3 hover:bg-surface/50 rounded-full text-text-primary opacity-70 hover:text-primary transition-colors">
            <ArrowLeft size={20} className="md:size-[24px]" />
          </button>
          <div>
            <h2 className="text-heading font-bold text-text-primary">
              發布新作業：{targetCourse.name}
            </h2>
            <div className="flex items-center gap-2 text-body text-text-primary opacity-70 mt-1 font-normal">
              從題庫挑題目，設定截止日期，就可以發布。
            </div>
          </div>
        </div>

        {/* 選題 */}
        <div className="px-1 py-2 md:py-4">
           {renderQuestionPicker()}
        </div>

        {/*
          截止日與發布放在同一條列上。
          原本這是精靈的第二步，但拿掉跨班派發與自動提醒之後，
          「設定規則」只剩一個日期欄位 —— 為了一個欄位多翻一頁不划算。
        */}
        <div className="sticky bottom-0 z-20 mt-4 border-t border-border bg-surface/95 backdrop-blur-xl px-1 py-4 flex flex-col lg:flex-row lg:items-end gap-4">
           {/*
             截止日預設不開。老師的習慣是先把作業派出去，
             需要限期再手動設 —— 所以這裡是一個開關，不是必填欄位。
           */}
           <div className="lg:w-80 shrink-0">
              <label className="mb-2 flex items-center gap-2 text-body text-text-secondary cursor-pointer">
                <input
                  id="assignmentmanager-create-toggle-deadline"
                  type="checkbox"
                  checked={hasDeadline}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setHasDeadline(on);
                    // 開啟時給一個合理的起始值，關閉時清空 —— 關掉卻留著日期，
                    // 送出去的 config 會帶著一個沒人看得到的截止日
                    setConfig({ ...config, deadline: on ? getDefaultDeadline() : '' });
                  }}
                  className="w-4 h-4 shrink-0 accent-primary cursor-pointer"
                />
                <Calendar size={15} className="text-primary shrink-0" />
                設定截止日期
              </label>
              {hasDeadline ? (
                <input
                  id="assignmentmanager-create-input-samedeadline"
                  type="datetime-local"
                  value={config.deadline}
                  onChange={(e) => setConfig({...config, deadline: e.target.value})}
                  className="w-full px-3.5 py-2.5 border border-border rounded-brand bg-surface/80 text-text-primary text-ui focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none shadow-sm transition-all"
                  style={{ colorScheme: 'light' }}
                />
              ) : (
                <p className="px-3.5 py-2.5 text-caption text-text-muted border border-dashed border-border rounded-brand">
                  不限期繳交，之後仍可在作業清單設定
                </p>
              )}
           </div>

           <div className="flex flex-1 items-center justify-end gap-3">
              <span className="text-caption text-text-secondary whitespace-nowrap">
                {selectedQuestionIds.length > 0
                  ? `已選 ${selectedQuestionIds.length} 題，發布給${targetCourse.name}`
                  : '請先從上方選一道題目'}
              </span>
              <button
                id="assignmentmanager-create-btn-publish"
                onClick={handlePublish}
                disabled={selectedQuestionIds.length === 0}
                className="px-7 py-2.5 rounded-brand text-ui text-on-accent bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-[1.02] disabled:hover:scale-100 flex items-center gap-2 whitespace-nowrap"
              >
                <CheckCircle size={17} className="shrink-0" /> 確認發布
              </button>
           </div>
        </div>
      </div>

      {/* 題目預覽：選題時確認「這是不是我要的那一題」 */}
      <QuestionPreviewModal
        question={previewQuestion}
        isSelected={
          previewQuestion ? selectedQuestionIds.includes(previewQuestion.id) : false
        }
        onClose={() => setPreviewQuestion(null)}
        onSelect={(q) => {
          toggleQuestionSelection(q.id);
          setPreviewQuestion(null);
        }}
      />
    </>
  );
};
