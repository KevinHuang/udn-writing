import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Clock,
  EyeOff,
  Eye,
  Lock,
  Plus,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Repeat,
  Trash2,
} from 'lucide-react';
import { Assignment, Question, Submission } from '../types';
import { QuestionPreviewModal } from './QuestionPreviewModal';
import { ConfirmDialog } from './ConfirmDialog';
import { DeadlineEditor } from './DeadlineEditor';
import {
  assignmentPhase,
  allowsLate,
  submissionStats,
  toggleVisibility,
  canSwapQuestion,
  swapBlockedReason,
  hasDeadline,
  NO_DEADLINE_LABEL,
  PHASE_LABEL,
  type AssignmentPhase,
} from '../lib/assignments';
import {
  orderedAssignments,
  orderNumbers,
  moveAssignment,
  renumberAssignments,
} from '../lib/assignmentOrder';

interface CourseAssignmentListProps {
  courseId: string;
  assignments: Assignment[];
  submissions: Submission[];
  /** 題庫。點作業標題時要拿出完整題目給老師看 */
  questions: Question[];
  /** 套用作業變更。沿用全站既有的契約 */
  onAssignmentOperation: (
    creates: Assignment[],
    updates: Assignment[],
    deleteIds: string[],
  ) => void;
  /** 點作業標題 → 進批改 */
  onSelectAssignment: (assignmentId: string) => void;
  /** 派發新作業（帶著這個班級進入派發流程） */
  onPublishNew: () => void;
  /** 要求更換題目（由上層開題庫選擇器） */
  onRequestSwapQuestion: (assignment: Assignment) => void;
}

type Filter = 'all' | AssignmentPhase;

// 篩選的名字就是徽章的名字 —— 以前「已關閉」篩選裡混著「已逾期」徽章，老師對不起來
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: PHASE_LABEL.draft },
  { key: 'open', label: PHASE_LABEL.open },
  { key: 'ended', label: PHASE_LABEL.ended },
];

type SortDir = 'asc' | 'desc';

/**
 * 檢視方向的偏好。故意不放在 `udn-writing:` 前綴底下 ——
 * 那是示範資料，「重置為初始資料」會清掉，也會讓重置鍵以為有資料要清。
 */
const SORT_KEY = 'udn-writing-pref:assignment-sort';

function readSortDir(): SortDir {
  try {
    return localStorage.getItem(SORT_KEY) === 'desc' ? 'desc' : 'asc';
  } catch {
    return 'asc';
  }
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d
    .getHours()
    .toString()
    .padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

/** 三個階段的徽章外觀。各有自己的顏料色，一眼可辨 */
const PHASE_CHIP: Record<AssignmentPhase, { cls: string; Icon: typeof Eye }> = {
  draft: { cls: 'bg-ink-100 text-ink-600 border-ink-200 hover:bg-ink-200', Icon: EyeOff },
  open: { cls: 'bg-success-100 text-success-700 border-success-200 hover:bg-success-200', Icon: Eye },
  ended: { cls: 'bg-mauve-100 text-mauve-700 border-mauve-200 hover:bg-mauve-200', Icon: Lock },
};

/**
 * 狀態徽章，同時也是開放開關。
 *
 * 以前右上角另有一顆「學生看得到／看不到」，和這個徽章講的是同一件事，
 * 而且那顆寫的是「現在的狀態」不是「按下去會怎樣」，老師看不懂。
 * 現在徽章本身可以點，選單裡的字寫的是動作。
 */
function StatusMenu({
  assignment,
  open,
  onOpenChange,
  onPublish,
  onUnpublish,
}: {
  assignment: Assignment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublish: () => void;
  onUnpublish: () => void;
}) {
  const phase = assignmentPhase(assignment);
  const { cls, Icon } = PHASE_CHIP[phase];

  // Esc 關閉。選單開著才掛監聽
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <>
      <span className="relative">
        <button
          id={`course-assignment-status-${assignment.id}`}
          onClick={() => onOpenChange(!open)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={phase === 'draft' ? '點一下可以開放給學生' : '點一下可以改回未開放'}
          className={`inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded text-caption whitespace-nowrap border transition-colors ${cls}`}
        >
          <Icon size={11} className="shrink-0" />
          {PHASE_LABEL[phase]}
          <ChevronDown size={12} aria-hidden="true" className={`shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <>
            {/* 點選單外面就關掉 */}
            <span className="fixed inset-0 z-30" onClick={() => onOpenChange(false)} />
            <span
              role="menu"
              className="absolute left-0 top-full mt-1 z-40 block w-64 bg-surface border border-border rounded-xl shadow-lift p-1.5"
            >
              {phase === 'draft' ? (
                <button
                  id={`course-assignment-publish-${assignment.id}`}
                  role="menuitem"
                  onClick={() => {
                    onOpenChange(false);
                    onPublish();
                  }}
                  className="w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg text-body text-text-primary hover:bg-surface-soft"
                >
                  <Eye size={14} className="shrink-0 mt-1 text-success-700" />
                  <span className="min-w-0">
                    開放給學生
                    <span className="block text-caption text-text-muted leading-snug">
                      學生會在作業列表看到這份作業，並可以繳交。
                    </span>
                  </span>
                </button>
              ) : (
                <button
                  id={`course-assignment-unpublish-${assignment.id}`}
                  role="menuitem"
                  onClick={() => {
                    onOpenChange(false);
                    onUnpublish();
                  }}
                  className="w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg text-body text-text-primary hover:bg-surface-soft"
                >
                  <EyeOff size={14} className="shrink-0 mt-1 text-ink-600" />
                  <span className="min-w-0">
                    改回未開放
                    <span className="block text-caption text-text-muted leading-snug">
                      學生的作業列表與待辦不再出現這份作業。
                    </span>
                  </span>
                </button>
              )}
            </span>
          </>
        )}
      </span>
      {phase === 'ended' && allowsLate(assignment) && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-caption whitespace-nowrap bg-warning-100 text-warning-700 border border-warning-200">
          可遲交
        </span>
      )}
    </>
  );
}

/**
 * 班級的作業清單。
 *
 * 預設顯示**全部**作業，不管有沒有對學生開放 —— 老師需要一眼看完這個班
 * 的所有派發狀況，包括還沒放行的草稿。上方的篩選晶片只是輔助，
 * 不是必須切換才看得到內容的分頁。
 */
export const CourseAssignmentList: React.FC<CourseAssignmentListProps> = ({
  courseId,
  assignments,
  submissions,
  questions,
  onAssignmentOperation,
  onSelectAssignment,
  onPublishNew,
  onRequestSwapQuestion,
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  /** 檢視方向。只是個人的看法偏好，記在這台瀏覽器 */
  const [sortDir, setSortDirState] = useState<SortDir>(readSortDir);
  const setSortDir = (d: SortDir) => {
    setSortDirState(d);
    try {
      localStorage.setItem(SORT_KEY, d);
    } catch {
      // 存不進去就算了，這次開著的頁面照樣有效
    }
  };
  /** 正在被拖曳的作業 id */
  const [dragId, setDragId] = useState<string | null>(null);
  /** 游標正懸在哪一列上。只用來畫落點提示 */
  const [overId, setOverId] = useState<string | null>(null);
  /*
    只能從號碼那顆把手拖。

    HTML5 的 draggable 只能掛在整列上，沒有「只有這一小塊能拖」的設定。
    做法是：整列固定可拖，但在 dragstart 時檢查這一次的手指／滑鼠是不是
    按在把手上，不是就 preventDefault 取消掉。

    用 ref 不用 state —— 換成 state 的話，draggable 要等 React 重繪才會變成
    true，而瀏覽器是在按下去之後緊接著的移動就判定能不能拖，重繪慢一步
    就整個拖不動，而且不會有任何錯誤訊息。ref 是同步的，沒有這個時序問題。
  */
  const fromHandleRef = useRef(false);
  /** 正在檢視的題目。null 時不顯示 */
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);
  /** 待二次確認刪除的作業 */
  const [deletingAssignment, setDeletingAssignment] = useState<Assignment | null>(null);
  /** 正在改截止設定的作業 */
  const [editingDeadline, setEditingDeadline] = useState<Assignment | null>(null);
  /** 待確認「改回未開放」的作業（已經有人交了才會問） */
  const [hidingAssignment, setHidingAssignment] = useState<Assignment | null>(null);
  /** 哪一個選單開著：`status:{id}`（狀態徽章）或 `more:{id}`（⋯）。同一時間只開一個 */
  const [menuFor, setMenuFor] = useState<string | null>(null);

  /**
   * 刪除作業的警語。
   *
   * 已經有學生繳交時要把**會失去什麼**講出來（幾份繳交、其中幾份已批改／已發還），
   * 而不是只寫「確定刪除嗎」—— 老師才有辦法判斷這一下的代價。
   * 另外提示「結束收件」這條退路，就像刪課程時建議改用封存一樣。
   */
  const deleteMessage = (a: Assignment): string => {
    const st = submissionStats(a, submissions);
    if (st.submitted === 0) {
      return `確定要刪除「${a.title}」嗎？\n\n`
        + `這份作業還沒有任何學生繳交。\n\n此操作無法復原。`;
    }
    const done: string[] = [];
    if (st.pending) done.push(`${st.pending} 份待批改`);
    if (st.graded) done.push(`${st.graded} 份已批改`);
    if (st.published) done.push(`${st.published} 份已發還`);
    return `確定要刪除「${a.title}」嗎？\n\n`
      + `這份作業已經有 ${st.submitted} 份繳交（${done.join('、')}）。`
      + `刪除後這些作文與批改結果會一併消失，學生端也看不到了，而且無法復原。\n\n`
      + `如果只是要停止收件，請改用截止設定裡的「立即截止」——`
      + `學生仍然看得到自己的成績，只是不能再繳交。`;
  };

  /** 關掉開關前的警語。學生會連自己的成績都看不到 */
  const hideMessage = (a: Assignment): string => {
    const st = submissionStats(a, submissions);
    return `「${a.title}」已經有 ${st.submitted} 份繳交。\n\n`
      + `改回未開放之後，學生的作業列表與首頁待辦都不會再出現這份作業，也不能再繳交。`
      + `已發還的成績仍留在學生的成績紀錄裡。作文與批改結果不會被刪除，之後再打開就回來了。\n\n`
      + `如果只是要停止收件，請改用截止設定裡的「立即截止」。`;
  };

  /** 按開關。從看得到切成看不到、而且已經有人交時，先確認 */
  const onToggle = (a: Assignment) => {
    if (a.status !== 'Draft' && submissionStats(a, submissions).submitted > 0) {
      setHidingAssignment(a);
      return;
    }
    applyUpdate(toggleVisibility(a));
  };

  /*
    這個班的作業，只有一種順序 —— 老師自己排的那一種。

    這裡曾經有一個「排序」下拉（截止日、待批改最多…），結果是同一份清單
    同時存在兩套順序，拖拉只好在其他排序底下被停用。真正有用的那一種
    「待批改優先」在批改作業頁本來就有，所以整個下拉拿掉，畫面上不再有模式。

    卡片上的 1、2、3 是這份作業在**課程裡**的編號，不是它在目前畫面的第幾列，
    所以切換篩選時號碼不會跟著跳（會跳號，那是對的）。
  */
  const fullOrder = useMemo(
    () => orderedAssignments(assignments, courseId),
    [assignments, courseId],
  );
  const numbers = useMemo(() => orderNumbers(fullOrder), [fullOrder]);

  /** 只有一份作業就沒得排 */
  const canReorder = fullOrder.length > 1;

  const counts = useMemo(() => {
    const c = { all: fullOrder.length, draft: 0, open: 0, ended: 0 };
    fullOrder.forEach((a) => {
      c[assignmentPhase(a)] += 1;
    });
    return c;
  }, [fullOrder]);

  const filtered =
    filter === 'all' ? fullOrder : fullOrder.filter((a) => assignmentPhase(a) === filter);
  /*
    升冪／降冪只改「由上往下怎麼排」，不改順序本身 —— 號碼永遠是課程裡的編號，
    成績管理與批改頁也一律照 1、2、3。
    上下鍵與拖曳都以畫面上看到的位置為準（見 nudge），所以兩種方向下都照常可用。
  */
  const rows = sortDir === 'desc' ? [...filtered].reverse() : filtered;

  const applyUpdate = (next: Assignment) =>
    onAssignmentOperation([], [next], []);

  /**
   * 套用新的順序。renumberAssignments 只回傳真正有變動的那幾份，
   * 挪一格不會送出整個班級的更新。
   */
  const applyOrder = (next: Assignment[]) => {
    if (next === fullOrder) return;          // 沒動就不要送出空的更新
    const updates = renumberAssignments(next);
    if (updates.length) onAssignmentOperation([], updates, []);
  };

  /**
   * 和**目前看得到的**上／下一列交換。
   *
   * 鄰居要從 rows（篩選後）挑，不是從 fullOrder ——
   * 篩選時完整順序裡的鄰居可能沒顯示在畫面上，跟它交換會看起來沒動。
   * moveAssignment 是「放到那一列的位置」：往下移落在目標後面、
   * 往上移落在目標前面，正好就是交換要的行為。
   */
  const nudge = (a: Assignment, delta: -1 | 1) => {
    const at = rows.findIndex((x) => x.id === a.id);
    const neighbour = rows[at + delta];
    if (!neighbour) return;
    applyOrder(moveAssignment(fullOrder, a.id, neighbour.id));
  };

  /** 這個方向還有沒有看得到的鄰居。沒有就把按鈕停用 */
  const hasNeighbour = (a: Assignment, delta: -1 | 1): boolean => {
    const at = rows.findIndex((x) => x.id === a.id);
    return at >= 0 && rows[at + delta] != null;
  };

  const endDrag = () => {
    setDragId(null);
    setOverId(null);
    fromHandleRef.current = false;
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-title font-bold text-text-primary">
            作業清單
            <span className="ml-2 text-body font-normal text-text-secondary">
              共 {counts.all} 份
            </span>
          </h2>
          {canReorder && (
            <p className="mt-1 text-caption text-text-muted">
              編號就是這個班的作業順序。按住號碼拖曳，或用上下鍵調整。
            </p>
          )}
        </div>
        <button
          id="course-assignments-btn-publish"
          onClick={onPublishNew}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-on-accent text-ui whitespace-nowrap hover:opacity-90 active:scale-95 transition-all"
        >
          <Plus size={16} className="shrink-0" />
          新增作業
        </button>
      </div>

      {/* 晶片只收窄看到的範圍，不改順序 —— 順序只有老師排的那一種 */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {/*
          升冪／降冪：一顆鈕，按一下換方向（和購物網站的價格排序一樣）。
          新作業排在最後，作業多了之後要看最新的，切成降冪就在最上面。
          按鈕上寫的是「現在」的排法。
        */}
        <button
          id="course-assignments-sort-toggle"
          onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
          aria-label={
            sortDir === 'asc'
              ? '編號由小到大排列，按一下改成由大到小'
              : '編號由大到小排列，按一下改成由小到大'
          }
          title={sortDir === 'asc' ? '按一下改成由大到小（最新的在上面）' : '按一下改成由小到大（第 1 份在上面）'}
          className="order-last ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption text-text-secondary border border-border whitespace-nowrap hover:bg-surface-soft hover:text-text-primary transition-colors"
        >
          {sortDir === 'asc' ? (
            <ArrowUpNarrowWide size={14} className="shrink-0" aria-hidden="true" />
          ) : (
            <ArrowDownWideNarrow size={14} className="shrink-0" aria-hidden="true" />
          )}
          編號 {sortDir === 'asc' ? '小→大' : '大→小'}
        </button>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            id={`course-assignments-filter-${f.key}`}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-caption whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-primary text-on-accent'
                : 'text-text-secondary hover:bg-surface-soft border border-border'
            }`}
          >
            {f.label}
            <span className="ml-1.5 opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-body text-text-muted py-12 text-center bg-surface-soft/30 rounded-xl border border-dashed border-border">
          {counts.all === 0
            ? '這個班級還沒有任何作業。按右上角「新增作業」開始派發。'
            : '這個篩選條件下沒有作業。'}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((a) => {
            const stats = submissionStats(a, submissions);
            const isDragging = dragId === a.id;
            const isDropTarget = canReorder && overId === a.id && dragId !== a.id;
            return (
              <li
                key={a.id}
                draggable={canReorder}
                /*
                  pointerdown 會從把手冒泡上來，這裡才看得到真正被按住的是誰
                  —— dragstart 的 target 是可拖曳的那一列本身，看不出起點。
                */
                onPointerDown={(e) => {
                  fromHandleRef.current =
                    (e.target as HTMLElement).closest('[data-drag-handle]') !== null;
                }}
                onDragStart={(e) => {
                  // 不是從把手開始的（點標題、點按鈕）就不要變成拖曳
                  if (!canReorder || !fromHandleRef.current) {
                    e.preventDefault();
                    return;
                  }
                  setDragId(a.id);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox 沒有 setData 就不會開始拖曳
                  e.dataTransfer.setData('text/plain', a.id);
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  if (!canReorder || !dragId) return;
                  e.preventDefault();          // 不擋掉預設就不會觸發 drop
                  e.dataTransfer.dropEffect = 'move';
                  if (overId !== a.id) setOverId(a.id);
                }}
                onDragLeave={() => {
                  if (overId === a.id) setOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (canReorder && dragId) {
                    applyOrder(moveAssignment(fullOrder, dragId, a.id));
                  }
                  endDrag();
                }}
                className={`bg-card border rounded-xl px-3 sm:px-4 py-3.5 transition-all ${
                  isDropTarget
                    ? 'border-primary ring-2 ring-primary/25'
                    : 'border-border hover:border-primary/40'
                } ${isDragging ? 'opacity-45' : ''}`}
              >
                <div className="flex items-start justify-between gap-3 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    {/*
                      序號與狀態同一行。序號不另外開一欄 —— 手機上那一欄會吃掉
                      約 48px，標題就只剩一半寬度，「那一次，我沒有放棄」會被截成
                      「那一次，我…」。放在這裡，各張卡片的號碼依然對齊在同一個
                      起點，標題也拿回整行。
                    */}
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span
                        id={`course-assignment-seat-${a.id}`}
                        data-drag-handle={canReorder ? '' : undefined}
                        title={canReorder ? '按住拖曳可調整順序' : `第 ${numbers[a.id]} 份作業`}
                        className={`inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 rounded-lg text-caption tabular-nums border select-none ${
                          canReorder
                            ? 'cursor-grab active:cursor-grabbing bg-surface-soft text-text-primary border-border-strong hover:border-primary hover:text-primary'
                            : 'bg-surface-soft text-text-secondary border-border'
                        }`}
                      >
                        {canReorder && (
                          <GripVertical
                            size={11}
                            aria-hidden="true"
                            className="-ml-0.5 mr-0.5 shrink-0 opacity-60"
                          />
                        )}
                        {numbers[a.id]}
                      </span>

                      {/*
                        上下鍵給觸控與鍵盤用 —— 平板上 HTML5 拖曳按不動。
                        兩顆是上下相疊的，沒辦法各給 44px 的高度（會互相蓋住），
                        所以改用加寬的方式把目標做大：疊起來約 42px 高、26px 寬，
                        和原生數字輸入框的上下鈕是同一種取捨。
                      */}
                      {canReorder && (
                        <span className="flex flex-col -ml-1">
                          <button
                            id={`course-assignment-up-${a.id}`}
                            onClick={() => nudge(a, -1)}
                            disabled={!hasNeighbour(a, -1)}
                            title="往上移一格"
                            aria-label={`把「${a.title}」往上移一格`}
                            className="px-1.5 py-1 rounded text-text-muted hover:text-primary hover:bg-surface-soft disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            id={`course-assignment-down-${a.id}`}
                            onClick={() => nudge(a, 1)}
                            disabled={!hasNeighbour(a, 1)}
                            title="往下移一格"
                            aria-label={`把「${a.title}」往下移一格`}
                            className="px-1.5 py-1 rounded text-text-muted hover:text-primary hover:bg-surface-soft disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronDown size={13} />
                          </button>
                        </span>
                      )}

                      <StatusMenu
                        assignment={a}
                        open={menuFor === `status:${a.id}`}
                        onOpenChange={(o) => setMenuFor(o ? `status:${a.id}` : null)}
                        onPublish={() => applyUpdate(toggleVisibility(a))}
                        onUnpublish={() => onToggle(a)}
                      />
                    </div>
                    {/*
                      標題原本也是連到批改，和右下角的「前往批改」重複。
                      改成展示題目全貌 —— 老師常常是想確認「這份到底考什麼」，
                      而不是要進去批改。
                    */}
                    <button
                      id={`course-assignment-open-${a.id}`}
                      onClick={() => {
                        // 題目可能已經被刪掉。找不到就退回原本的行為，
                        // 不要讓這一下點擊什麼都沒發生。
                        const q = questions.find((x) => x.id === a.questionId);
                        if (q) setPreviewQuestion(q);
                        else onSelectAssignment(a.id);
                      }}
                      title="查看完整題目"
                      className="text-left group flex w-full items-center gap-1.5"
                    >
                      <span className="text-ui text-text-primary group-hover:text-primary transition-colors line-clamp-1 min-w-0">
                        {a.title}
                      </span>
                      {/*
                        小眼睛。滑過去才變色是看不出來的 —— 老師不會先把
                        滑鼠移上去試探，圖示要一開始就在那裡告訴他可以點。
                      */}
                      <Eye
                        size={13}
                        aria-hidden="true"
                        className="shrink-0 text-text-muted group-hover:text-primary transition-colors"
                      />
                    </button>
                    {/*
                      截止設定的入口。收不收件只看這個時間，
                      以前的「結束收件」「重新開放」都在這裡做。
                    */}
                    <button
                      id={`course-assignment-deadline-${a.id}`}
                      onClick={() => setEditingDeadline(a)}
                      title="修改截止設定"
                      className="group mt-1 inline-flex items-center gap-1.5 text-caption text-text-secondary hover:text-primary whitespace-nowrap transition-colors"
                    >
                      <Clock size={11} className="shrink-0" />
                      {hasDeadline(a) ? `截止 ${fmt(a.config.deadline as string)}` : NO_DEADLINE_LABEL}
                      <Pencil size={11} aria-hidden="true" className="shrink-0 text-text-muted group-hover:text-primary" />
                    </button>
                  </div>
                  {/* 開放開關已經併進狀態徽章（見 StatusMenu），這裡不再另放一顆 */}
                </div>

                {/* 繳交進度 */}
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 min-w-0 bg-ink-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{
                        width: `${stats.total ? (stats.submitted / stats.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-caption text-text-secondary whitespace-nowrap">
                    已繳 {stats.submitted}/{stats.total}
                  </span>
                  {stats.pending > 0 && (
                    <span className="text-caption text-warning-700 bg-warning-100 border border-warning-200 px-2 py-0.5 rounded whitespace-nowrap">
                      待批改 {stats.pending}
                    </span>
                  )}
                </div>

                {/*
                  動作列只留最常用的「前往批改」。
                  更換題目與刪除都不常用、按錯代價又最大，收進「⋯」。
                */}
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-3">
                  <div className="relative">
                    <button
                      id={`course-assignment-more-${a.id}`}
                      onClick={() => setMenuFor(menuFor === `more:${a.id}` ? null : `more:${a.id}`)}
                      title="更多動作"
                      aria-haspopup="menu"
                      aria-expanded={menuFor === `more:${a.id}`}
                      className="tap-target inline-flex items-center justify-center p-1 rounded-lg text-text-secondary hover:bg-surface-soft hover:text-text-primary transition-colors"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {menuFor === `more:${a.id}` && (
                      <>
                        {/* 點選單外面就關掉 */}
                        <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} />
                        <div
                          role="menu"
                          className="absolute left-0 bottom-full mb-1 z-40 w-64 bg-surface border border-border rounded-xl shadow-lift p-1.5"
                        >
                          {/* 換題的條件收在 lib/assignments.ts，這裡不要自己判斷狀態 */}
                          <button
                            id={`course-assignment-swap-${a.id}`}
                            role="menuitem"
                            disabled={!canSwapQuestion(a)}
                            onClick={() => {
                              setMenuFor(null);
                              onRequestSwapQuestion(a);
                            }}
                            className="w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg text-body text-text-primary hover:bg-surface-soft disabled:hover:bg-transparent disabled:cursor-not-allowed"
                          >
                            <Repeat size={14} className="shrink-0 mt-1 text-danger-700" />
                            <span className="min-w-0">
                              <span className={canSwapQuestion(a) ? 'text-danger-700' : 'text-text-muted'}>
                                更換題目
                              </span>
                              <span className="block text-caption text-text-muted leading-snug">
                                {canSwapQuestion(a)
                                  ? a.status === 'Draft'
                                    ? '學生還看不到，可以直接換。'
                                    : '會刪除這份作業所有的繳交紀錄。'
                                  : swapBlockedReason(a)}
                              </span>
                            </span>
                          </button>
                          {/*
                            刪除。已經有繳交時，警語會把「會失去幾份、其中幾份批改過」
                            講出來，並提示可以改用「立即截止」—— 老師才知道代價。
                          */}
                          <button
                            id={`course-assignment-delete-${a.id}`}
                            role="menuitem"
                            onClick={() => {
                              setMenuFor(null);
                              setDeletingAssignment(a);
                            }}
                            className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-body text-danger-700 hover:bg-surface-soft"
                          >
                            <Trash2 size={14} className="shrink-0" />
                            刪除作業
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    id={`course-assignment-grade-${a.id}`}
                    onClick={() => onSelectAssignment(a.id)}
                    className="ml-auto inline-flex items-center gap-1 text-caption text-primary hover:underline whitespace-nowrap"
                  >
                    前往批改
                    <ChevronRight size={12} className="shrink-0" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        與派發流程的「查看完整題目」用同一個元件，
        老師在選題與看清單兩個場合看到的是同一種東西。
      */}
      <QuestionPreviewModal
        question={previewQuestion}
        onClose={() => setPreviewQuestion(null)}
      />

      {deletingAssignment && (
        <ConfirmDialog
          title="刪除作業"
          message={deleteMessage(deletingAssignment)}
          confirmLabel="刪除作業"
          danger
          onConfirm={() => {
            // 繳交紀錄由 App 的 handleAssignmentOperation 一併清掉，
            // 這裡只負責送出要刪的 id
            onAssignmentOperation([], [], [deletingAssignment.id]);
            setDeletingAssignment(null);
          }}
          onCancel={() => setDeletingAssignment(null)}
        />
      )}

      {editingDeadline && (
        <DeadlineEditor
          assignment={editingDeadline}
          onSave={(next) => {
            applyUpdate(next);
            setEditingDeadline(null);
          }}
          onCancel={() => setEditingDeadline(null)}
        />
      )}

      {hidingAssignment && (
        <ConfirmDialog
          title="改回未開放"
          message={hideMessage(hidingAssignment)}
          confirmLabel="改回未開放"
          onConfirm={() => {
            applyUpdate(toggleVisibility(hidingAssignment));
            setHidingAssignment(null);
          }}
          onCancel={() => setHidingAssignment(null)}
        />
      )}
    </section>
  );
};
