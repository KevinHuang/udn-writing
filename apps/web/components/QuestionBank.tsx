
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Folder as FolderIcon, FolderPlus, ArchiveRestore, Plus, Copy, MoreVertical, Search, FileText, Layers, Home, ArrowLeft, Archive, Trash2, FolderInput, X, Check, RotateCcw, Save, AlignLeft, Image as ImageIcon, Upload, Sparkles, Loader2, ListChecks, Users, User, Bot, GraduationCap, BookOpen, Wand2, Info, PenLine, Eye } from 'lucide-react';
import { Question, QuestionType, Folder, TargetGrade, QuestionSource } from '../types';
import {
  TARGET_GRADES,
  QUESTION_SOURCES,
  TARGET_GRADE_LABEL,
  QUESTION_SOURCE_LABEL,
  QUESTION_LIMITS,
  validateQuestion,
  isQuestionValid,
  checkImageFile,
} from '../lib/questionMeta';
import { StudentQuestionPreview } from './StudentQuestionPreview';
import { QuestionPreviewModal } from './QuestionPreviewModal';
import { analyzeImageContent, generateGradingRubric } from '../api/ai';
import { isAdmin, type CurrentUser } from '../lib/access';
import { ApiError } from '../api/client';
import { ConfirmDialog } from './ConfirmDialog';
import { PageHeader, PAGE_CONTAINER } from './PageHeader';
import { AVAILABLE_AI_MODELS } from '../mockData';
import { questionCountsByFolder } from '../lib/folders';
import { MAX_LEVEL } from '../lib/scoring';
import { SHOW_AI_MODEL_PICKER } from '../lib/features';


interface MoveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (targetFolderId: string | null) => void;
  folders: Folder[];
  currentFolderId: string | null;
}

const MoveModal: React.FC<MoveModalProps> = ({ isOpen, onClose, onConfirm, folders, currentFolderId }) => {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(currentFolderId);

  if (!isOpen) return null;

  return (
    <div id="questionbank-movemodal" className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/20 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-surface/80 backdrop-blur-2xl rounded-brand shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh] border border-surface/50 ring-1 ring-surface/60">
        <div className="p-5 border-b border-surface/30 flex justify-between items-center bg-surface/40">
          <h3 className="font-bold text-text-primary flex items-center gap-2">
            <FolderInput size={20} className="text-primary" />
            移動題目至...
          </h3>
          <button id="questionbank-movemodal-btn-close" onClick={onClose} className="text-text-secondary hover:text-text-primary p-2 hover:bg-black/5 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            <button
              id="questionbank-movemodal-btn-root"
              onClick={() => setSelectedFolderId(null)}
              className={`w-full text-left px-4 py-3.5 rounded-brand flex items-center gap-3 transition-all ${
                selectedFolderId === null 
                  ? 'bg-primary/5 text-primary font-bold border border-primary/10 shadow-sm' 
                  : 'hover:bg-surface/50 text-text-secondary border border-transparent'
              }`}
            >
              <Home size={18} />
              (根目錄)
            </button>
            
            {folders.map(folder => (
              <button
                key={folder.id}
                id={`questionbank-movemodal-btn-folder-${folder.id}`}
                onClick={() => setSelectedFolderId(folder.id)}
                className={`w-full text-left px-4 py-3.5 rounded-brand flex items-center gap-3 transition-all ${
                  selectedFolderId === folder.id 
                    ? 'bg-primary/5 text-primary font-bold border border-primary/10 shadow-sm' 
                    : 'hover:bg-surface/50 text-text-secondary border border-transparent'
                }`}
              >
                <div className="w-6 flex justify-center">
                    {folder.parentId ? <div className="w-1.5 h-1.5 rounded-full bg-secondary/30" /> : <FolderIcon size={18} />}
                </div>
                <div className="flex flex-col">
                    <span>{folder.name}</span>
                    {folder.parentId && <span className="text-caption text-text-muted">子資料夾</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 border-t border-surface/30 bg-surface/40 flex justify-end gap-3">
          <button 
            id="questionbank-movemodal-btn-cancel"
            onClick={onClose}
            className="px-5 py-2.5 text-body text-text-secondary hover:bg-surface/50 rounded-xl transition-colors"
          >
            取消
          </button>
          <button 
            id="questionbank-movemodal-btn-confirm"
            onClick={() => onConfirm(selectedFolderId)}
            className="px-6 py-2.5 text-body text-surface bg-primary hover:bg-primary/90 rounded-xl shadow-lg shadow-primary/30 transition-all hover:scale-[1.02]"
          >
            確定移動
          </button>
        </div>
      </div>
    </div>
  );
};

// --- NEW: NewFolderModal ---
interface NewFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

const NewFolderModal: React.FC<NewFolderModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const [name, setName] = useState('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (name.trim()) {
      onConfirm(name.trim());
      setName('');
      onClose();
    }
  };

  return (
    <div id="questionbank-newfoldermodal" className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-surface/90 backdrop-blur-2xl rounded-brand shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-surface/50 ring-1 ring-surface/60">
        <div className="p-6 border-b border-surface/30 bg-surface/40 flex justify-between items-center">
          <h3 className="text-title font-bold text-text-primary flex items-center gap-2">
            <FolderIcon size={22} className="text-primary" />
            新增資料夾
          </h3>
          <button id="questionbank-newfoldermodal-btn-close" onClick={onClose} className="text-text-secondary hover:text-text-primary p-2 hover:bg-black/5 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-body text-text-secondary mb-2">資料夾名稱</label>
            <input id="questionbank-newfoldermodal-input-title" 
              autoFocus
              type="text" 
              placeholder="請輸入資料夾名稱..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              className="w-full px-4 py-3 bg-surface border border-border rounded-brand text-body focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all"
            />
          </div>
        </div>

        <div className="p-5 border-t border-surface/30 bg-surface/40 flex justify-end gap-3">
          <button id="questionbank-newfoldermodal-btn-cancel" 
            onClick={onClose}
            className="px-5 py-2.5 text-body text-text-secondary hover:bg-surface/60 rounded-xl transition-colors"
          >
            取消
          </button>
          <button id="questionbank-newfoldermodal-btn-confirm" 
            onClick={handleConfirm}
            disabled={!name.trim()}
            className="px-8 py-2.5 text-body text-surface bg-primary hover:bg-primary/90 rounded-xl shadow-lg shadow-primary/30 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed"
          >
            建立
          </button>
        </div>
      </div>
    </div>
  );
};

interface QuestionBankProps {
  onBack?: () => void;
  questions: Question[];
  /**
   * 題目的異動。先前是直接給 setQuestions 讓這個元件自己改陣列 ——
   * 接上後端之後那行不通：改陣列不會寫進資料庫，重新整理就回去了。
   * 改成明確的四個動作，每一個都是「呼叫 API → 重新載入」。
   */
  questionOps: {
    create: (q: Partial<Question>) => Promise<void>;
    update: (id: string, q: Partial<Question>) => Promise<void>;
    remove: (id: string) => Promise<void>;
    setArchived: (id: string, archived: boolean) => Promise<void>;
  };
  /** 題庫資料夾。收在 App 並持久化，離開這一頁不會復原 */
  folders: Folder[];
  folderOps: {
    create: (name: string, parentId: string | null, type: QuestionType) => Promise<void>;
    rename: (id: string, name: string, parentId: string | null) => Promise<void>;
    remove: (id: string) => Promise<void>;
  };
  /**
   * 目前身分。共同題庫是全站老師共用的，只有聯合報管理人員能改；
   * 個人題庫則是誰的就誰改。判斷收在 canEditCurrentBank 一處。
   */
  user: CurrentUser;
}

/**
 * 建題表單的欄位。
 *
 * targetGrades / sources / teacherNotes / imagePosition
 * 是從任務建置模組移植進來的；其餘維持原本的欄位不動。
 */
interface QuestionFormState {
  title: string;
  /** 題說 */
  content: string;
  /** 教師的話 */
  teacherNotes: string;
  gradeLevel: string;
  folderId: string;
  gradingCriteria: string;
  maxScore: number;
  preferredAiModel?: string;
  targetGrades: TargetGrade[];
  sources: QuestionSource[];
  imagePosition: 'before' | 'after';
}

/** 預設值。適用階段預填國中 —— 這套系統的主場就是國中會考寫作 */
const emptyForm = (folderId = ''): QuestionFormState => ({
  title: '',
  content: '',
  teacherNotes: '',
  gradeLevel: '一般',
  folderId,
  gradingCriteria: '',
  maxScore: MAX_LEVEL,
  preferredAiModel: undefined,
  targetGrades: ['junior'],
  sources: [],
  imagePosition: 'after',
});

/** 可複選的選項鈕。aria-pressed 讓螢幕閱讀器讀得出多選語意 */
const ToggleChip: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
  id: string;
}> = ({ active, onClick, icon: Icon, children, id }) => (
  <button
    id={id}
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-body whitespace-nowrap transition-colors ${
      active
        ? 'border-primary bg-primary text-on-accent'
        : 'border-border bg-surface text-text-secondary hover:border-primary hover:text-primary'
    }`}
  >
    <Icon size={13} className="shrink-0" />
    {children}
    {active && <Check size={13} className="shrink-0" />}
  </button>
);

/** 表單欄位外框：標籤、說明、字數計數、錯誤訊息 */
const Field: React.FC<{
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  required?: boolean;
  hint?: string;
  error?: string;
  counter?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, icon: Icon, required, hint, error, counter, action, children }) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-body text-text-secondary flex items-center gap-2">
        {Icon && <Icon size={15} className="text-primary shrink-0" />}
        {label}
        {required && <span className="text-danger-600">*</span>}
      </span>
      {counter && (
        <span className="ml-auto text-caption text-text-muted tabular-nums whitespace-nowrap">
          {counter}
        </span>
      )}
      {action && <span className={counter ? '' : 'ml-auto'}>{action}</span>}
    </div>
    {hint && <p className="text-caption text-text-muted -mt-1">{hint}</p>}
    {children}
    {error && (
      <p className="flex items-center gap-1.5 text-caption text-danger-600">
        <Info size={13} className="shrink-0" />
        {error}
      </p>
    )}
  </div>
);

/** 表單控制項的共用外觀 */
const inputBase =
  'w-full px-3.5 py-3 border border-border rounded-brand bg-surface/60 text-text-primary ' +
  'placeholder:text-text-muted focus:bg-surface focus:ring-4 focus:ring-primary/10 ' +
  'focus:border-primary outline-none transition-all shadow-sm';

export const QuestionBank: React.FC<QuestionBankProps> = ({ onBack, questions, questionOps, folders, folderOps, user }) => {
  const [view, setView] = useState<'LIST' | 'CREATE'>('LIST');
  // 老師的起點是自己的題目，共用題庫是拿來取材的，所以預設落在個人題庫
  const [activeTab, setActiveTab] = useState<QuestionType>(QuestionType.PERSONAL);
  const [currentPath, setCurrentPath] = useState<Folder[]>([]);
  /**
   * 目前這個題庫能不能改。
   *
   * 個人題庫是自己的，隨時能改；共同題庫是全站老師共用的，
   * 只有聯合報管理人員能動 —— 一般老師在那裡封存或刪一題，
   * 是把所有人的題目一起弄掉。
   *
   * 所有會改動資料的動作（新增／編輯／移動／封存／刪除／新增資料夾）
   * 都吃這一個值，不要各自寫 activeTab === PERSONAL。
   */
  const canEditCurrentBank =
    activeTab === QuestionType.PERSONAL || isAdmin(user);

  /**
   * 待二次確認的刪除動作。
   *
   * 刪題目與刪資料夾共用同一個視窗，差別只在訊息與按鈕字樣 ——
   * 兩者都不可復原，都必須先講清楚會影響什麼。
   */
  const [pendingDelete, setPendingDelete] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => void;
  } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal States
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [questionToMove, setQuestionToMove] = useState<Question | null>(null);
  /** 正在檢視的題目。null 時不顯示預覽視窗 */
  const [viewingQuestion, setViewingQuestion] = useState<Question | null>(null);

  // Edit/Create State
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 正在編輯的題目屬於哪個題庫。存檔要原樣帶回去，不然共同題目會掉到個人題庫 */
  const [editingType, setEditingType] = useState<QuestionType | null>(null);
  /** 存檔中：按鈕停用，避免連點建立兩題 */
  const [isSaving, setIsSaving] = useState(false);
  /** 存檔失敗的原因。有值就留在表單顯示，不要靜默跳回清單 */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formData, setFormData] = useState<QuestionFormState>(emptyForm());
  
  // Image Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [aiImageAnalysis, setAiImageAnalysis] = useState<string | null>(null);
  const [isGeneratingRubric, setIsGeneratingRubric] = useState(false);
  const [showRubric, setShowRubric] = useState(false);

  const currentFolderId = currentPath.length > 0 ? currentPath[currentPath.length - 1].id : null;

  const handleCreateFolder = (name: string) => {
    const newFolder: Folder = {
      id: `f-${Date.now()}`,
      name,
      parentId: currentFolderId,
      type: activeTab,
    };
    
    void folderOps.create(newFolder.name, newFolder.parentId, newFolder.type);
  };

  // Initialize form when entering create view
  const initCreateForm = () => {
      setEditingId(null);
      setEditingType(null);
      setSaveError(null);
      setFormData(emptyForm(currentFolderId || ''));
      setImagePreview(null);
      setAiImageAnalysis(null);
      setShowRubric(false);
      setView('CREATE');
  };

  const initEditForm = (q: Question) => {
      setEditingId(q.id);
      setEditingType(q.type);
      setSaveError(null);
      setFormData({
          ...emptyForm(q.folderId || ''),
          title: q.title,
          content: q.content,
          teacherNotes: q.teacherNotes || '',
          gradeLevel: q.gradeLevel,
          gradingCriteria: q.gradingCriteria || '',
          maxScore: q.maxScore || MAX_LEVEL,
          preferredAiModel: q.preferredAiModel,
          targetGrades: q.targetGrades ?? ['junior'],
          sources: q.sources ?? [],
          imagePosition: q.imagePosition ?? 'after',
      });
      setImagePreview(q.imageUrl || null);
      setAiImageAnalysis(q.aiImageDescription || null);
      setShowRubric(!!q.gradingCriteria);
      setView('CREATE');
  };
  
  /**
   * 收下一個圖片檔。點選與拖放共用同一條路徑，驗證才不會只擋住其中一種。
   * 存成 base64 是原型的做法 —— 接後端時這裡換成上傳並保留回傳的 URL。
   */
  const acceptImageFile = (file: File) => {
      const problem = checkImageFile(file);
      if (problem) {
          setImageError(problem);
          return;
      }
      setImageError(null);
      const reader = new FileReader();
      reader.onloadend = () => {
          setImagePreview(reader.result as string);
          setAiImageAnalysis(null);
      };
      reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) acceptImageFile(file);
      e.target.value = ''; // 允許重選同一個檔案
  };

  const handleRemoveImage = () => {
      setImagePreview(null);
      setAiImageAnalysis(null);
      setImageError(null);
      if (fileInputRef.current) {
          fileInputRef.current.value = '';
      }
  };

  const handleAnalyzeImage = async () => {
      if (!imagePreview) return;
      setIsAnalyzingImage(true);
      try {
          const matches = imagePreview.match(/^data:(.+);base64,(.+)$/);
          if (matches && matches.length === 3) {
              const mimeType = matches[1];
              const base64Data = matches[2];
              const analysis = await analyzeImageContent(base64Data, mimeType);
              setAiImageAnalysis(analysis);
          }
      } catch {
          setAiImageAnalysis("分析失敗，請稍後再試。");
      } finally {
          setIsAnalyzingImage(false);
      }
  };

  const handleGenerateRubric = async () => {
      if (!formData.title || !formData.content) {
          alert("請先填寫題目名稱與說明，以便 AI 產生評分規準。");
          return;
      }
      setIsGeneratingRubric(true);
      try {
          const rubric = await generateGradingRubric(formData.title, formData.content);
          setFormData(prev => ({ ...prev, gradingCriteria: rubric }));
      } catch {
          alert("產生評分規準失敗，請稍後再試。");
      } finally {
          setIsGeneratingRubric(false);
      }
  };

  /** 離開建題表單。所有 state 一次清乾淨，下次開啟不會殘留上一次的內容 */
  const handleLeaveForm = () => {
      setFormData(emptyForm());
      setImagePreview(null);
      setAiImageAnalysis(null);
      setImageError(null);
      setShowRubric(false);
      setEditingId(null);
      setEditingType(null);
      setSaveError(null);
      setView('LIST');
  };

  /**
   * 存檔。
   *
   * ⚠️ 這裡原本是 `void questionOps.create(...)` 之後**無條件**離開表單。
   *    api/client.ts 失敗時是 throw，所以 403／500 只會進 console ——
   *    畫面照樣回清單，題目卻不在那裡，使用者看到的就是「存不了檔」。
   *    現在等結果：成功才離開，失敗留在表單並把原因寫出來。
   */
  const handleSaveQuestion = async () => {
      if (!isQuestionValid(formData) || isSaving) return;
      setSaveError(null);
      setIsSaving(true);

      // 移植進來的欄位，新增與編輯共用同一份
      const portedFields = {
          teacherNotes: formData.teacherNotes || undefined,
          targetGrades: formData.targetGrades,
          sources: formData.sources,
          imagePosition: formData.imagePosition,
      };

      try {
          if (editingId) {
              await questionOps.update(editingId, {
                  title: formData.title,
                  content: formData.content,
                  folderId: formData.folderId || null,
                  /*
                    type 一定要帶。payload 的 shared 是從它算出來的，
                    漏了就變成 false —— 管理人員編輯共同題目，存檔後會掉到個人題庫。
                  */
                  type: editingType ?? activeTab,
                  gradeLevel: formData.gradeLevel,
                  gradingCriteria: formData.gradingCriteria,
                  maxScore: formData.maxScore,
                  imageUrl: imagePreview || undefined,
                  aiImageDescription: aiImageAnalysis || undefined,
                  preferredAiModel: formData.preferredAiModel,
                  ...portedFields,
              });
          } else {
              const newQuestion: Question = {
                  id: `q-new-${Date.now()}`,
                  title: formData.title,
                  content: formData.content,
                  type: activeTab,
                  folderId: formData.folderId || null,
                  gradeLevel: '一般',
                  maxScore: formData.maxScore,
                  gradingCriteria: formData.gradingCriteria,
                  isArchived: false,
                  imageUrl: imagePreview || undefined,
                  aiImageDescription: aiImageAnalysis || undefined,
                  preferredAiModel: formData.preferredAiModel,
                  ...portedFields,
              };
              await questionOps.create(newQuestion);
          }
          handleLeaveForm();
      } catch (e) {
          // 403 的原因很具體（共同題庫只有管理人員能動），值得講清楚
          const status = e instanceof ApiError ? e.status : 0;
          setSaveError(
              status === 403
                  ? '沒有權限編輯共同題庫。共同題目只有聯合報管理人員能新增或修改。'
                  : `儲存失敗：${e instanceof Error ? e.message : '請稍後再試'}`,
          );
      } finally {
          setIsSaving(false);
      }
  };

  useEffect(() => {
    const handleClickOutside = () => setActiveMenuId(null);
    if (activeMenuId) {
        window.addEventListener('click', handleClickOutside);
    }
    return () => window.removeEventListener('click', handleClickOutside);
  }, [activeMenuId]);

  // 資料夾卡片上的題目數。算出來的，不是存在 Folder 上的欄位 ——
  // 新增／刪除／搬移／匯入／封存任何一條路徑都不必再自己記帳。
  /**
   * 實際要不要列出已封存的題目。封存是「管理題目」的一環 —— 授課教師在共同題庫
   * 沒有編輯權限，也就沒有「查看已封存」：按鈕不顯示，而且就算在個人題庫打開了
   * 再切過來，共同題庫的封存題也不會出現。
   */
  const includeArchived = showArchived && canEditCurrentBank;
  const folderCounts = useMemo(
    () => questionCountsByFolder(folders, questions, { includeArchived: includeArchived }),
    [folders, questions, includeArchived],
  );

  /**
   * 題目所在資料夾的名字。
   *
   * ⚠️ 不要用 `q.folderName` —— 後端回來的題目沒有這個欄位（見 api/questions.ts
   *    的 toQuestion），所以重新整理之後標籤永遠不見。資料夾名字是查出來的。
   */
  const folderNameOf = (q: Question): string | null =>
    q.folderId ? folders.find(f => f.id === q.folderId)?.name ?? null : null;

  // Handle Search Logic
  const visibleFolders = !searchTerm.trim() 
    ? folders.filter(f => {
        const matchesTab = f.type === activeTab;
        const matchesParent = f.parentId === currentFolderId;
        return matchesTab && matchesParent;
      }) 
    : [];

  const visibleQuestions = questions.filter(q => {
    const matchesTab = q.type === activeTab;
    const matchesArchive = includeArchived ? true : !q.isArchived;
    
    if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        return matchesTab && matchesArchive && (
            q.title.toLowerCase().includes(term) ||
            q.content.toLowerCase().includes(term) ||
            (folderNameOf(q)?.toLowerCase().includes(term) ?? false) ||
            (q.gradeLevel && q.gradeLevel.toLowerCase().includes(term))
        );
    }
    
    return matchesTab && matchesArchive && q.folderId === currentFolderId;
  });

  const availableFoldersForMove = folders.filter(f => f.type === activeTab);

  const handleCopyToPersonal = (q: Question) => {
    const newQuestion: Question = {
      ...q,
      id: Math.random().toString(36).substr(2, 9),
      type: QuestionType.PERSONAL,
      folderId: null,
      title: `${q.title} (複製)`,
      isArchived: false
    };
    void questionOps.create(newQuestion).then(() => {
      alert("已複製到個人題庫（根目錄）！");
    });
    setActiveTab(QuestionType.PERSONAL);
    setCurrentPath([]);
  };

  const handleArchive = (id: string) => {
    const q = questions.find((x) => x.id === id);
    if (!q) return;
    void questionOps.setArchived(id, !q.isArchived);
  };

  /**
   * 刪除題目。
   *
   * 原本用 window.confirm —— 瀏覽器原生視窗長相不受控，在碑拓模式下
   * 完全不像這個系統的一部分，也沒辦法把「共同題庫影響全站」講清楚。
   */
  const handleDelete = (id: string) => {
    const q = questions.find((x) => x.id === id);
    if (!q) return;
    setPendingDelete({
      title: '刪除題目',
      message:
        `確定要刪除「${q.title}」嗎？` +
        (q.type === QuestionType.SHARED
          ? '\n\n這是共同題庫的題目，刪除後所有老師都會看不到。'
          : '') +
        '\n\n此操作無法復原。已經派發出去的作業不受影響。',
      confirmLabel: '刪除題目',
      run: () => void questionOps.remove(id),
    });
  };

  /**
   * 刪除資料夾。
   *
   * 裡面的題目與子資料夾**往上移到母層**，不會跟著消失 ——
   * 刪一個分類就把裡面的題目一起毀掉，代價太高而且救不回來。
   * 視窗會把搬動的數量講出來，不要讓人事後才發現東西跑了。
   */
  const handleDeleteFolder = (folder: Folder) => {
    const childFolders = folders.filter((f) => f.parentId === folder.id);
    const inside = questions.filter((q) => q.folderId === folder.id);
    const moved: string[] = [];
    if (inside.length) moved.push(`${inside.length} 個題目`);
    if (childFolders.length) moved.push(`${childFolders.length} 個子資料夾`);

    setPendingDelete({
      title: '刪除資料夾',
      message:
        `確定要刪除資料夾「${folder.name}」嗎？` +
        (moved.length
          ? `\n\n裡面的 ${moved.join('與')}會移到上一層，不會被刪除。`
          : '\n\n這個資料夾是空的。') +
        '\n\n此操作無法復原。',
      confirmLabel: '刪除資料夾',
      run: () => {
        // 子資料夾接到母層、題目退到上一層 —— 兩件事都在後端的同一個交易裡做
        // （見 FolderHelper.deleteById）。前端只要重新載入。
        void folderOps.remove(folder.id);
      },
    });
  };

  const openMoveModal = (q: Question) => {
    setQuestionToMove(q);
    setIsMoveModalOpen(true);
  };

  const handleMoveConfirm = (targetFolderId: string | null) => {
    if (questionToMove) {
      void questionOps.update(questionToMove.id, { ...questionToMove, folderId: targetFolderId });


      setIsMoveModalOpen(false);
      setQuestionToMove(null);
    }
  };

  const navigateToFolder = (folder: Folder) => {
    setCurrentPath([...currentPath, folder]);
  };

  const navigateUp = () => {
    setCurrentPath(currentPath.slice(0, -1));
  };



  const handleTabChange = (tab: QuestionType) => {
    setActiveTab(tab);
    setCurrentPath([]);
    setSearchTerm(''); // Clear search when switching tabs
  };

  if (view === 'CREATE') {
      const errors = validateQuestion(formData);
      const canSave = isQuestionValid(formData);

      const toggleGrade = (g: TargetGrade) => setFormData(prev => ({
          ...prev,
          targetGrades: prev.targetGrades.includes(g)
              ? prev.targetGrades.filter(x => x !== g)
              : [...prev.targetGrades, g],
      }));

      const toggleSource = (src: QuestionSource) => setFormData(prev => ({
          ...prev,
          sources: prev.sources.includes(src)
              ? prev.sources.filter(x => x !== src)
              : [...prev.sources, src],
      }));

      return (
        <div className="max-w-6xl mx-auto pb-8">
            {/* 頁首 */}
            <div className="flex items-center gap-3 sm:gap-4 mb-5 sm:mb-6">
                <button
                  id="questionbank-create-btn-back"
                  onClick={handleLeaveForm}
                  className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 flex items-center justify-center rounded-full bg-surface/50 border border-border text-text-secondary hover:bg-surface hover:text-text-primary transition-all hover:scale-105 shadow-sm"
                  title="返回題庫"
                >
                    <ArrowLeft size={16} className="sm:size-5" />
                </button>
                <div className="min-w-0">
                    <h2 className="text-heading font-bold text-text-primary">
                      {editingId ? '編輯作文題目' : '新增作文題目'}
                    </h2>
                    <p className="text-ui text-text-secondary font-normal">
                      左邊填寫，右邊同步顯示學生會看到的樣子
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-5 lg:gap-6">

                {/* ── 左欄：核心設定與配圖 ───────────────────────── */}
                <div className="bg-card border border-border rounded-brand shadow-sm p-5 sm:p-6 flex flex-col gap-6">

                    <Field
                      label="適用階段"
                      icon={GraduationCap}
                      required
                      error={errors.targetGrades}
                      hint="可複選。影響 AI 評分的用詞標準與字數期待。"
                    >
                        <div role="group" aria-label="適用階段" className="flex flex-wrap gap-2">
                            {TARGET_GRADES.map(g => (
                                <ToggleChip
                                  key={g}
                                  id={`questionbank-create-chip-grade-${g}`}
                                  icon={GraduationCap}
                                  active={formData.targetGrades.includes(g)}
                                  onClick={() => toggleGrade(g)}
                                >
                                    {TARGET_GRADE_LABEL[g]}
                                </ToggleChip>
                            ))}
                        </div>
                    </Field>

                    <Field label="題目來源" icon={BookOpen} hint="可複選。用於題庫檢索與命題比例統計。">
                        <div role="group" aria-label="題目來源" className="flex flex-wrap gap-2">
                            {QUESTION_SOURCES.map(src => (
                                <ToggleChip
                                  key={src}
                                  id={`questionbank-create-chip-source-${src}`}
                                  icon={BookOpen}
                                  active={formData.sources.includes(src)}
                                  onClick={() => toggleSource(src)}
                                >
                                    {QUESTION_SOURCE_LABEL[src]}
                                </ToggleChip>
                            ))}
                        </div>
                    </Field>

                    <Field
                      label="題目名稱"
                      icon={FileText}
                      required
                      error={errors.title}
                      counter={`${formData.title.length} / ${QUESTION_LIMITS.title.max}`}
                    >
                        <input
                            id="questionbank-create-input-title"
                            type="text"
                            value={formData.title}
                            maxLength={QUESTION_LIMITS.title.max}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            placeholder="例：那一次，我沒有放棄"
                            className={`${inputBase} font-bold`}
                        />
                    </Field>

                    <Field
                      label="題說"
                      icon={AlignLeft}
                      required
                      error={errors.content}
                      hint="給學生看的簡短說明，兩三句就好。"
                      counter={`${formData.content.length} / ${QUESTION_LIMITS.content.max}`}
                    >
                        <textarea
                            id="questionbank-create-textarea-content"
                            value={formData.content}
                            maxLength={QUESTION_LIMITS.content.max}
                            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                            placeholder="請回想一件你原本想放棄、最後卻堅持下來的事。寫出當時遇到的困難、你如何撐過去，以及事後的體會。不可用詩歌體。"
                            className={`${inputBase} min-h-[130px] resize-y leading-[1.9]`}
                        />
                    </Field>

                    {/* 配圖 */}
                    <Field label="題目配圖" icon={ImageIcon} hint="選填。有畫面的題目，學生比較容易起筆。">
                        {!imagePreview ? (
                            <>
                                <div
                                    id="questionbank-create-div-upload"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => fileInputRef.current?.click()}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            fileInputRef.current?.click();
                                        }
                                    }}
                                    onDragOver={(e) => { e.preventDefault(); setIsDraggingImage(true); }}
                                    onDragLeave={() => setIsDraggingImage(false)}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        setIsDraggingImage(false);
                                        const file = e.dataTransfer.files?.[0];
                                        if (file) acceptImageFile(file);
                                    }}
                                    className={`w-full py-9 border-2 border-dashed rounded-brand flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${
                                        isDraggingImage
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border bg-surface/30 hover:border-primary/50 hover:bg-primary/5'
                                    }`}
                                >
                                    <Upload size={22} className="text-text-muted" />
                                    <p className="text-body text-text-secondary">拖曳圖片到這裡，或點擊選擇</p>
                                    <p className="text-caption text-text-muted">JPG／PNG／WebP，5 MB 以內</p>
                                </div>
                                <input
                                    id="questionbank-create-input-upload"
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept={QUESTION_LIMITS.image.accept.join(',')}
                                    onChange={handleImageUpload}
                                />
                            </>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <div className="relative rounded-brand overflow-hidden border border-border bg-surface-soft">
                                    <img
                                        src={imagePreview}
                                        alt={aiImageAnalysis || '題目配圖預覽'}
                                        referrerPolicy="no-referrer"
                                        className="w-full max-h-56 object-contain"
                                    />
                                    <button
                                        id="questionbank-create-btn-removeimage"
                                        onClick={handleRemoveImage}
                                        title="移除配圖"
                                        className="absolute right-2 top-2 bg-ink-900/60 text-on-solid p-2 rounded-full hover:bg-danger-600 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>

                                {/* 配圖位置：學生端要先看到圖，還是先讀題說 */}
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-caption text-text-secondary">圖片位置</span>
                                    {([
                                        { key: 'before' as const, label: '題說前' },
                                        { key: 'after' as const, label: '題說後' },
                                    ]).map(({ key, label }) => (
                                        <button
                                            key={key}
                                            id={`questionbank-create-btn-imagepos-${key}`}
                                            type="button"
                                            aria-pressed={formData.imagePosition === key}
                                            onClick={() => setFormData({ ...formData, imagePosition: key })}
                                            className={`px-3 py-1.5 rounded-lg text-caption whitespace-nowrap border transition-colors ${
                                                formData.imagePosition === key
                                                    ? 'bg-primary text-on-accent border-primary'
                                                    : 'bg-surface text-text-secondary border-border hover:border-primary hover:text-primary'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>

                                {/* 替代文字：學生裡有人看不見這張圖 */}
                                <Field
                                  label="配圖說明（替代文字）"
                                  hint="描述圖片內容。使用螢幕閱讀器的學生靠這段文字理解題目，AI 批改時也會參考。"
                                  action={
                                    <button
                                        id="questionbank-create-btn-genalt"
                                        type="button"
                                        onClick={handleAnalyzeImage}
                                        disabled={isAnalyzingImage}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-primary px-3.5 py-1.5 text-caption text-primary whitespace-nowrap hover:bg-primary/5 transition-colors disabled:opacity-50"
                                    >
                                        {isAnalyzingImage
                                            ? <Loader2 size={13} className="animate-spin shrink-0" />
                                            : <Wand2 size={13} className="shrink-0" />}
                                        {isAnalyzingImage ? '讀圖中…' : 'AI 產生說明'}
                                    </button>
                                  }
                                >
                                    <textarea
                                        id="questionbank-create-textarea-analysis"
                                        value={aiImageAnalysis ?? ''}
                                        onChange={(e) => setAiImageAnalysis(e.target.value)}
                                        placeholder="例：鄉間溪流上的舊木橋，橋面木板被踩得發亮，欄杆的漆剝落。"
                                        className={`${inputBase} min-h-[92px] resize-y leading-[1.9]`}
                                    />
                                </Field>
                            </div>
                        )}
                        {imageError && (
                            <p className="flex items-center gap-1.5 text-caption text-danger-600">
                                <Info size={13} className="shrink-0" />
                                {imageError}
                            </p>
                        )}
                    </Field>

                    {/* 收納與批改設定 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-border">
                        <Field label="儲存位置" icon={FolderIcon}>
                            <select
                                id="questionbank-create-select-folder"
                                value={formData.folderId}
                                onChange={(e) => setFormData({ ...formData, folderId: e.target.value })}
                                className={`${inputBase} appearance-none cursor-pointer text-text-secondary`}
                            >
                                <option value="">(根目錄)</option>
                                {folders.filter(f => f.type === activeTab).map(f => (
                                    <option key={f.id} value={f.id}>
                                        {f.name} {f.parentId ? '(子資料夾)' : ''}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        {/* 依需求隱藏，欄位與自動預選的邏輯都保留 —— 見 lib/features.ts */}
                        {SHOW_AI_MODEL_PICKER && (
                        <Field label="預設批改模型" icon={Bot} hint="指定後，批改這題的作業時會自動預選。">
                            <select
                                id="questionbank-create-select-aimodel"
                                value={formData.preferredAiModel || ''}
                                onChange={(e) => setFormData({ ...formData, preferredAiModel: e.target.value || undefined })}
                                className={`${inputBase} appearance-none cursor-pointer text-text-secondary`}
                            >
                                <option value="">-- 不指定（使用課程預設）--</option>
                                {AVAILABLE_AI_MODELS.map(model => (
                                    <option key={model} value={model}>{model}</option>
                                ))}
                            </select>
                        </Field>
                        )}
                    </div>

                    {/* 評分規準：只給 AI 看，不進學生端預覽 */}
                    <div className="flex flex-col gap-3 pt-1 border-t border-border">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <span className="text-body text-text-secondary flex items-center gap-2">
                                <ListChecks size={15} className="text-primary shrink-0" /> 評分規準（給 AI 批改用）
                            </span>
                            <button
                                id="questionbank-create-btn-togglerubric"
                                type="button"
                                onClick={() => setShowRubric(!showRubric)}
                                className="flex items-center gap-2 shrink-0"
                            >
                                <span className={`w-10 h-6 rounded-full p-1 transition-colors ${showRubric ? 'bg-primary' : 'bg-ink-200'}`}>
                                    <span className={`block w-4 h-4 rounded-full bg-surface shadow-sm transition-transform ${showRubric ? 'translate-x-4' : 'translate-x-0'}`} />
                                </span>
                                <span className="text-body text-text-secondary">{showRubric ? '開啟' : '關閉'}</span>
                            </button>
                        </div>

                        {showRubric && (
                            <div className="flex flex-col gap-2.5 animate-fade-in">
                                <div className="flex justify-between items-center gap-3 flex-wrap">
                                    <p className="text-caption text-text-muted">
                                        學生看不到這一段。可以手動輸入，或讓 AI 根據題目產生。
                                    </p>
                                    <button
                                        id="questionbank-create-btn-genrubric"
                                        type="button"
                                        onClick={handleGenerateRubric}
                                        disabled={isGeneratingRubric}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-primary px-3.5 py-1.5 text-caption text-primary whitespace-nowrap hover:bg-primary/5 transition-colors disabled:opacity-50"
                                    >
                                        {isGeneratingRubric
                                            ? <Loader2 size={13} className="animate-spin shrink-0" />
                                            : <Sparkles size={13} className="shrink-0" />}
                                        AI 自動產生
                                    </button>
                                </div>
                                <textarea
                                    id="questionbank-create-textarea-criteria"
                                    value={formData.gradingCriteria}
                                    onChange={(e) => setFormData({ ...formData, gradingCriteria: e.target.value })}
                                    placeholder="請輸入詳細的評分規準..."
                                    className={`${inputBase} min-h-[180px] resize-y leading-[1.9]`}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* ── 右欄：教師引導與即時預覽 ───────────────────── */}
                <div className="flex flex-col gap-5 lg:gap-6">
                    <div className="bg-card border border-border rounded-brand shadow-sm p-5 sm:p-6">
                        <Field
                          label="教師的話"
                          icon={PenLine}
                          error={errors.teacherNotes}
                          hint="詳細的寫作引導。可以分行寫成幾個提示，學生會逐條看到。"
                          counter={`${formData.teacherNotes.length} / ${QUESTION_LIMITS.teacherNotes.max}`}
                        >
                            <textarea
                                id="questionbank-create-textarea-teachernotes"
                                value={formData.teacherNotes}
                                maxLength={QUESTION_LIMITS.teacherNotes.max}
                                onChange={(e) => setFormData({ ...formData, teacherNotes: e.target.value })}
                                placeholder={'先想再寫。困難不一定是大事——什麼時候你差一點就停下來了？\n第一段給一個具體畫面，不要直接抄題目。\n最後一段要回到主題，不要突然停下來。'}
                                className={`${inputBase} min-h-[220px] resize-y leading-[2.0]`}
                            />
                        </Field>
                    </div>

                    <div className="lg:sticky lg:top-6 space-y-4">
                    <StudentQuestionPreview
                      data={{
                        title: formData.title,
                        content: formData.content,
                        teacherNotes: formData.teacherNotes,
                        targetGrades: formData.targetGrades,
                        sources: formData.sources,
                        imageUrl: imagePreview,
                        imageAlt: aiImageAnalysis,
                        imagePosition: formData.imagePosition,
                      }}
                    />
                        {/* ── 操作列 ────────────────────────────────────── */}
                        {/*
                          儲存放在學生端預覽的正下方，跟著預覽一起釘在畫面上：
                          老師確認完學生看到的樣子，手就在按鈕旁邊。

                          ⚠️ 先前是放在格線最後一列、用 sticky bottom-0 —— 沒有用。
                             sticky 的可移動範圍是它自己的格線區域，而那一列的高度
                             就等於按鈕本身，等於完全沒有空間可以固定（使用者回報
                             捲到底也看不到儲存鈕）。
                             窄畫面沒有分欄，才用 sticky 釘在視窗底部。
                        */}
                    <div className="sticky bottom-0 z-20 lg:static flex flex-wrap items-center justify-end gap-3 bg-card border border-border rounded-brand shadow-lift px-5 py-4">
                        {saveError && (
                            <span className="mr-auto text-caption text-danger-600 flex items-center gap-1.5">
                                <Info size={13} className="shrink-0" />
                                {saveError}
                            </span>
                        )}
                        {!canSave && !saveError && (
                            <span className="mr-auto text-caption text-text-muted flex items-center gap-1.5">
                                <Info size={13} className="shrink-0" />
                                題目名稱、題說與適用階段填齊後才能儲存
                            </span>
                        )}
                        <button
                          id="questionbank-create-btn-cancel"
                          onClick={handleLeaveForm}
                          className="px-6 py-2.5 rounded-brand text-ui text-text-secondary hover:bg-surface-soft hover:text-text-primary transition-colors whitespace-nowrap"
                        >
                            取消
                        </button>
                        <button
                          id="questionbank-create-btn-save"
                          onClick={handleSaveQuestion}
                          disabled={!canSave || isSaving}
                          className="px-7 py-2.5 rounded-brand text-ui text-on-accent bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                        >
                            {isSaving
                              ? <><Loader2 size={17} className="shrink-0 animate-spin" /> 儲存中…</>
                              : <><Save size={17} className="shrink-0" /> {editingId ? '儲存修改' : '儲存題目'}</>}
                        </button>
                    </div>
                    </div>
                </div>
            </div>
        </div>
      );
  }

  // --- RENDER LIST VIEW ---
  return (
    <div className={`bg-transparent h-full flex flex-col ${PAGE_CONTAINER} pb-10`}>
      {/* Modals */}
      <NewFolderModal 
        isOpen={isNewFolderModalOpen}
        onClose={() => setIsNewFolderModalOpen(false)}
        onConfirm={handleCreateFolder}
      />
      <MoveModal 
        isOpen={isMoveModalOpen}
        onClose={() => setIsMoveModalOpen(false)}
        onConfirm={handleMoveConfirm}
        folders={availableFoldersForMove}
        currentFolderId={questionToMove?.folderId || null}
      />

      {/*
        查看完整題目。與派發流程的「查看完整題目」是同一個元件，
        老師在建題與選題兩個場合看到的東西才會一致。
      */}
      <QuestionPreviewModal
        question={viewingQuestion}
        onClose={() => setViewingQuestion(null)}
      />

      <PageHeader
        title="題庫中心"
        subtitle="建立、管理與分享您的作文題目"
        onBack={onBack}
        backId="questionbank-list-btn-back"
        wideActions
        className="mb-6 sm:mb-10"
        actions={
        <div className="flex flex-col md:flex-row gap-3 w-full lg:w-auto items-stretch md:items-center">
           {/* Tab Switcher */}
           {/*
             凹槽原本被 /50 與 /40 稀釋到幾乎看不見，未選的「共用題庫」
             對底色只有 1.00 —— 完全看不出那裡有一顆可以按的東西。
             拿掉稀釋、邊界改用 border-strong，選中的那一格才浮得起來。
           */}
           <div className="bg-surface-soft p-1 rounded-2xl border border-border-strong flex shrink-0 w-full md:w-auto shadow-sm">
              <button
                  id="questionbank-list-tab-shared"
                  onClick={() => handleTabChange(QuestionType.SHARED)}
                  className={`flex-1 md:flex-none px-4 sm:px-6 py-2 sm:py-3 text-body font-bold rounded-xl transition-all flex items-center justify-center gap-2 sm:gap-3 ${
                  activeTab === QuestionType.SHARED 
                      ? 'bg-primary text-surface shadow-lg shadow-primary/20 scale-[1.02]' 
                      : 'text-text-secondary hover:bg-surface/60 hover:text-text-primary hover:shadow-sm'
                  }`}
              >
                  <Users size={18} className={activeTab === QuestionType.SHARED ? 'text-surface' : 'text-text-muted'} />
                  共用題庫
              </button>
              <button
                  id="questionbank-list-tab-personal"
                  onClick={() => handleTabChange(QuestionType.PERSONAL)}
                  className={`flex-1 md:flex-none px-4 sm:px-6 py-2 sm:py-3 text-body font-bold rounded-xl transition-all flex items-center justify-center gap-2 sm:gap-3 ${
                  activeTab === QuestionType.PERSONAL 
                      ? 'bg-primary text-surface shadow-lg shadow-primary/20 scale-[1.02]' 
                      : 'text-text-secondary hover:bg-surface/60 hover:text-text-primary hover:shadow-sm'
                  }`}
              >
                  <User size={18} className={activeTab === QuestionType.PERSONAL ? 'text-surface' : 'text-text-muted'} />
                  個人題庫
              </button>
           </div>

           {/* Search Bar */}
           <div className="relative group w-full md:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors" size={18} />
              <input 
                  id="questionbank-list-input-search"
                  type="text" 
                  placeholder="搜尋題目..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-12 pr-10 py-2.5 sm:py-3 border border-border-strong bg-card rounded-2xl text-body w-full focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary focus:bg-surface transition-all shadow-sm"
              />
              {searchTerm && (
                  <button 
                      id="questionbank-list-btn-clearsearch"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                  >
                      <X size={14} />
                  </button>
              )}
           </div>

           {/*
             功能鍵區在桌機上**固定寬度**、靠右。以前是 w-auto：共用題庫（老師沒有按鈕）
             與個人題庫（三顆）寬度不同，整組靠右排的控制列跟著伸縮，
             「共用／個人」切換鈕就在兩個分頁之間左右跑。寬度取三顆都在時的大小。
           */}
           <div className="flex gap-2.5 shrink-0 w-full md:w-[17rem] md:justify-end">
              {canEditCurrentBank && (
              <button id="questionbank-list-btn-edit" 
                  onClick={() => setShowArchived(!showArchived)}
                  className={`flex-1 md:flex-none p-3 rounded-2xl border transition-all flex items-center justify-center ${
                      showArchived 
                          ? 'bg-text-primary text-surface border-text-primary shadow-md' 
                          : 'bg-card text-text-secondary border-border-strong hover:bg-surface-soft hover:shadow-sm'
                  }`}
                  title={showArchived ? '隱藏已封存的題目' : '顯示已封存的題目'}
                  aria-pressed={showArchived}
              >
                  {/* 漏斗是「篩選」的通用圖示，看不出跟封存有關；箱子才是封存 */}
                  {showArchived ? <ArchiveRestore size={20} /> : <Archive size={20} />}
              </button>
              )}

              {/* 資料夾也是共用的，老師不該在共同題庫裡建 */}
              {canEditCurrentBank && (
              <button 
                  id="questionbank-list-btn-newfolder"
                  onClick={() => setIsNewFolderModalOpen(true)}
                  className="flex-1 md:flex-none p-3 bg-card hover:bg-surface-soft border border-border-strong text-text-secondary hover:text-primary rounded-2xl transition-all shadow-sm hover:shadow-md flex items-center justify-center" 
                  title="新增資料夾"
              >
                  <FolderPlus size={20} />
              </button>
              )}

              {/*
                管理人員在共同題庫可以直接新增題目，流程與個人題庫完全相同
                （type 取自目前分頁）。
              */}
              {canEditCurrentBank && (
                  <button 
                      id="questionbank-list-btn-newquestion"
                      onClick={initCreateForm}
                      className="flex-[2] md:flex-none bg-primary hover:bg-primary/90 text-surface px-5 py-3 rounded-2xl text-body transition-all shadow-lg shadow-primary/30 flex items-center justify-center gap-2 lg:min-w-[9rem]"
                  >
                      <Plus size={20} /> <span>新增題目</span>
                  </button>
              )}

              {/*
                這裡以前有一顆「匯入」，讓授課教師把個人題目送進共同題庫。
                已拿掉：**授課教師對共同題庫沒有任何編輯權限，也不能匯入**。
                共同題庫只有聯合報管理人員能動（後端也擋，見 routes/instructor.ts 的
                denySharedBank）。管理人員要放題目，直接在共同題庫按「新增題目」。
              */}
           </div>
        </div>
        }
      />

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.title}
          message={pendingDelete.message}
          confirmLabel={pendingDelete.confirmLabel}
          danger
          onConfirm={() => {
            pendingDelete.run();
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <div className="bg-surface/60 backdrop-blur-2xl rounded-brand border border-border shadow-[0_20px_40px_-12px_rgba(0,0,0,0.05)] ring-1 ring-surface/60 flex flex-col flex-1 overflow-hidden">
        
        {/* Content Area */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
            {searchTerm && (
                <div className="mb-4 sm:mb-6 flex items-center gap-2 text-body text-primary bg-primary/5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl w-fit border border-primary/10">
                    <Search size={14} className="sm:size-4" />
                    <span>搜尋結果：共 {visibleQuestions.length} 筆符合「{searchTerm}」</span>
                </div>
            )}

            {currentPath.length > 0 && !searchTerm && (
                <button id="questionbank-list-btn-delete" 
                    onClick={navigateUp}
                    className="mb-4 sm:mb-6 flex items-center text-body text-text-secondary hover:text-text-primary transition-colors bg-surface/40 w-fit px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl hover:bg-surface/70"
                >
                    <ArrowLeft size={14} className="sm:size-4 mr-1" /> 返回上一層
                </button>
            )}

            {visibleFolders.length === 0 && visibleQuestions.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-text-muted">
                    <Layers size={56} className="mb-4 text-text-muted" />
                    <p className="text-title font-normal">{searchTerm ? '找不到符合的題目' : '此資料夾為空'}</p>
                    <p className="text-body mt-2 opacity-70">{!searchTerm && '新增題目或建立子資料夾'}</p>
                </div>
            ) : (
                <>
                    {/* Folders Section - Hidden when searching */}
                    {visibleFolders.length > 0 && (
                        <div className="mb-6">
                            <h3 className="text-caption text-text-muted uppercase tracking-widest mb-3 sm:mb-4 pl-1">資料夾</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
                                {visibleFolders.map(folder => (
                                    <div 
                                        key={folder.id}
                                        id={`questionbank-list-folder-${folder.id}`}
                                        onClick={() => navigateToFolder(folder)}
                                        className="relative bg-card p-2.5 sm:p-5 rounded-2xl border border-border-card shadow-paper hover:bg-surface-soft hover:border-border-strong hover:shadow-lift cursor-pointer transition-all duration-300 group flex flex-col items-center text-center py-3 sm:py-8"
                                    >
                                        {/*
                                          刪除資料夾。放在卡片右上角、滑過去才顯現 ——
                                          常按的是「進入資料夾」，刪除不該一直搶位置。
                                          共同題庫的資料夾同樣只有管理人員能刪。
                                        */}
                                        {canEditCurrentBank && (
                                          <button
                                            id={`questionbank-list-folder-btn-delete-${folder.id}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteFolder(folder);
                                            }}
                                            title="刪除資料夾"
                                            className="tap-target absolute top-1.5 right-1.5 p-1.5 rounded-full text-text-muted hover:text-danger-600 hover:bg-danger-50 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        )}
                                        <div className="w-8 h-8 sm:w-14 sm:h-14 bg-gradient-to-br from-primary/5 to-primary/10 text-primary rounded-lg sm:rounded-2xl flex items-center justify-center mb-1.5 sm:mb-4 group-hover:scale-110 transition-transform shadow-sm">
                                            <FolderIcon size={16} className="sm:size-7" fill="currentColor" fillOpacity={0.2} />
                                        </div>
                                        <h4 className="text-text-primary text-body mb-0.5 group-hover:text-primary transition-colors line-clamp-1">{folder.name}</h4>
                                        <span className="text-caption text-text-muted font-normal">{folderCounts[folder.id] ?? 0} 個項目</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Questions Section */}
                    {visibleQuestions.length > 0 && (
                        <div>
                             <h3 className="text-caption text-text-muted uppercase tracking-widest mb-3 sm:mb-4 pl-1">題目列表</h3>
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4 sm:gap-6">
                                {visibleQuestions.map((q) => (
                                    <div key={q.id} id={`questionbank-list-question-${q.id}`} className={`bg-card border border-border-card shadow-paper hover:border-border-strong rounded-2xl p-3.5 sm:p-7 hover:shadow-lift hover:-translate-y-1 transition-all duration-300 group flex flex-col h-auto min-h-[10rem] sm:min-h-[16rem] relative ${q.isArchived ? 'opacity-70 bg-secondary/5' : ''}`}>
                                        
                                        <div className="flex justify-between items-start mb-2 sm:mb-4 relative">
                                            {/*
                                              標籤列可以折行：學段、來源、看圖加起來常常超過卡片寬度，
                                              不折行的話會把「看圖」擠成一字一行（實測）。每個標籤本身不斷字。
                                            */}
                                            <div className="flex flex-wrap items-center gap-1 sm:gap-2 min-w-0">
                                                <span className={`inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-3 py-0.5 sm:py-1 rounded-lg text-caption font-bold uppercase tracking-wider transition-colors ${q.isArchived ? 'bg-secondary/10 text-text-muted' : 'bg-secondary/5 text-text-muted group-hover:bg-primary/5 group-hover:text-primary'}`}>
                                                    <FileText size={9} className="sm:size-3" />
                                                    {q.gradeLevel}
                                                </span>
                                                {q.isArchived && (
                                                    <span className="inline-flex items-center px-1 sm:px-2 py-0.5 sm:py-1 rounded-md bg-secondary/20 text-text-secondary text-caption">已封存</span>
                                                )}
                                                {q.imageUrl && (
                                                    // 只是告訴老師「這題有圖」—— 旁邊就看得到縮圖，不必再寫字
                                                    <span
                                                        title="這題有配圖"
                                                        aria-label="有配圖"
                                                        className="shrink-0 inline-flex items-center p-1 sm:p-1.5 rounded-md bg-accent/10 text-accent"
                                                    >
                                                        <ImageIcon size={10} className="sm:size-3.5" aria-hidden="true" />
                                                    </span>
                                                )}
                                                {/* 適用階段與來源。這一輪還沒有篩選列，但標籤要先看得見 */}
                                                {q.targetGrades?.map((g) => (
                                                    <span key={g} className="inline-flex items-center px-1 sm:px-2 py-0.5 sm:py-1 rounded-md bg-primary/10 text-primary text-caption whitespace-nowrap">
                                                        {TARGET_GRADE_LABEL[g]}
                                                    </span>
                                                ))}
                                                {q.sources?.slice(0, 2).map((src) => (
                                                    <span key={src} className="inline-flex items-center px-1 sm:px-2 py-0.5 sm:py-1 rounded-md bg-surface-soft text-text-secondary border border-border text-caption whitespace-nowrap">
                                                        {QUESTION_SOURCE_LABEL[src]}
                                                    </span>
                                                ))}
                                            </div>
                                            
                                            {/* 選單裡全是會改動資料的動作，不能改就整顆藏起來 */}
                                            {canEditCurrentBank && (
                                            <div className="relative">
                                                <button 
                                                    id={`questionbank-list-question-btn-more-${q.id}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setActiveMenuId(activeMenuId === q.id ? null : q.id);
                                                    }}
                                                    className="tap-target text-text-muted hover:text-text-secondary transition-colors p-1 sm:p-1.5 rounded-full hover:bg-surface"
                                                >
                                                    <MoreVertical size={14} className="sm:size-5" />
                                                </button>
                                                
                                                {activeMenuId === q.id && (
                                                    <div className="absolute right-0 top-7 sm:top-8 w-36 sm:w-48 bg-surface/90 backdrop-blur-xl rounded-2xl shadow-xl border border-surface/50 ring-1 ring-black/5 z-10 py-1 animation-scale-in origin-top-right">
                                                        <button 
                                                            id={`questionbank-list-question-btn-move-${q.id}`}
                                                            onClick={(e) => { e.stopPropagation(); openMoveModal(q); setActiveMenuId(null); }}
                                                            className="w-full text-left px-3 sm:px-4 py-1.5 sm:py-2 text-body font-normal text-text-primary hover:bg-primary/5 hover:text-primary flex items-center gap-2"
                                                        >
                                                            <FolderInput size={12} className="sm:size-4" /> 移動至...
                                                        </button>
                                                        <button 
                                                            id={`questionbank-list-question-btn-archive-${q.id}`}
                                                            onClick={(e) => { e.stopPropagation(); handleArchive(q.id); setActiveMenuId(null); }}
                                                            className="w-full text-left px-3 sm:px-4 py-1.5 sm:py-2 text-body font-normal text-text-primary hover:bg-primary/5 hover:text-primary flex items-center gap-2"
                                                        >
                                                            {q.isArchived ? <RotateCcw size={12} className="sm:size-4" /> : <Archive size={12} className="sm:size-4" />}
                                                            {q.isArchived ? '復原題目' : '封存題目'}
                                                        </button>
                                                        <div className="h-px bg-secondary/5 my-1 mx-2"></div>
                                                        <button 
                                                            id={`questionbank-list-question-btn-delete-${q.id}`}
                                                            onClick={(e) => { e.stopPropagation(); handleDelete(q.id); setActiveMenuId(null); }}
                                                            className="w-full text-left px-3 sm:px-4 py-1.5 sm:py-2 text-body font-normal text-danger-600 hover:bg-danger-50 flex items-center gap-2"
                                                        >
                                                            <Trash2 size={12} className="sm:size-4" /> 刪除
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            )}
                                        </div>
                                        
                                        <div className="flex gap-2 sm:gap-4 mb-2 sm:mb-4 flex-1">
                                            <div className="flex-1 min-w-0 flex flex-col">
                                                <h3 className="text-title font-bold text-text-primary mb-1 sm:mb-2 group-hover:text-primary transition-colors line-clamp-2 leading-tight">
                                                    {q.title}
                                                </h3>
                                                <p className="text-text-secondary text-body leading-relaxed line-clamp-3 flex-1">
                                                    {q.content}
                                                </p>
                                            </div>
                                            {q.imageUrl && (
                                                <div className="w-14 h-14 sm:w-24 sm:h-24 rounded-lg sm:rounded-xl overflow-hidden shrink-0 border border-surface/50 bg-secondary/5 shadow-sm self-start mt-0.5">
                                                    <img 
                                                        src={q.imageUrl} 
                                                        alt="參考圖片" 
                                                        referrerPolicy="no-referrer"
                                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" 
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        
                                        <div className="flex items-center justify-between pt-2.5 sm:pt-4 border-t border-secondary/5 mt-auto">
                                            <div className="flex items-center gap-1 sm:gap-2 text-caption font-normal text-text-muted">
                                                {folderNameOf(q) && (
                                                    <span className="flex items-center gap-1 sm:gap-1.5 bg-surface/40 px-1 sm:px-2 py-0.5 sm:py-1 rounded-md">
                                                        <FolderIcon size={9} className="sm:size-3" /> {folderNameOf(q)}
                                                    </span>
                                                )}
                                            </div>
                                            
                                            <div className="flex items-center gap-2 ml-auto">
                                            <button
                                                id={`questionbank-list-question-btn-view-${q.id}`}
                                                onClick={(e) => { e.stopPropagation(); setViewingQuestion(q); }}
                                                className="tap-target flex items-center gap-1 text-text-secondary hover:text-primary bg-surface/40 hover:bg-primary/5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-caption whitespace-nowrap transition-colors"
                                            >
                                                <Eye size={10} className="sm:size-3.5 shrink-0" /> 查看
                                            </button>
                                            {activeTab === QuestionType.SHARED && !q.isArchived && (
                                            <button 
                                                id={`questionbank-list-question-btn-copy-${q.id}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCopyToPersonal(q);
                                                }}
                                                className="flex items-center gap-1 text-primary bg-primary/5 hover:bg-primary/10 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-caption opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all translate-y-0 md:translate-y-2 md:group-hover:translate-y-0"
                                            >
                                                <Copy size={10} className="sm:size-3.5" /> 複製
                                            </button>
                                            )}
                                            {canEditCurrentBank && !q.isArchived && (
                                            <button 
                                                id={`questionbank-list-question-btn-edit-${q.id}`}
                                                onClick={(e) => { e.stopPropagation(); initEditForm(q); }}
                                                className="tap-target text-text-muted hover:text-primary text-caption opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all"
                                            >
                                                編輯
                                            </button>
                                            )}
                                            </div>
                                            
                                            {q.isArchived && (
                                                <button 
                                                    id={`questionbank-list-question-btn-restore-${q.id}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleArchive(q.id);
                                                    }}
                                                    className="flex items-center gap-1 text-text-secondary bg-secondary/20 hover:bg-secondary/30 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-caption transition-all"
                                                >
                                                    <RotateCcw size={10} className="sm:size-3.5" /> 復原
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                             </div>
                        </div>
                    )}
                </>
            )}
        </div>
      </div>
    </div>
  );
};
