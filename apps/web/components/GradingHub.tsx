import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  School,
  Search,
  X,
} from 'lucide-react';
import { Assignment, Course, Submission } from '../types';
import { filterCoursesByQuery } from '../lib/courseSearch';
import {
  cityChipsOf,
  cityCountsOf,
  groupCoursesBySchool,
  schoolLabel,
  showCitySeparately,
  UNASSIGNED_GROUP,
} from '../lib/courseGroups';
import {
  assignmentPhase,
  deadlineLabel,
  hasDeadline,
  PHASE_LABEL,
  submissionStats,
  type AssignmentPhase,
} from '../lib/assignments';
import { orderedAssignments, orderNumbers } from '../lib/assignmentOrder';

interface GradingHubProps {
  /** 這位使用者看得到的班級（已依身分過濾，見 lib/access.ts） */
  courses: Course[];
  assignments: Assignment[];
  submissions: Submission[];
  currentSemester: string;
  onSemesterChange: (semester: string) => void;
  /** 學期下拉的選項（後端 semesters 表，不是 mockData 的寫死清單） */
  semesterOptions: { value: string; label: string }[];
  /** 進入某份作業的批改清單 */
  onOpenAssignment: (assignmentId: string) => void;
  onBack: () => void;
}

type PhaseFilter = 'all' | Exclude<AssignmentPhase, 'draft'>;

const PHASE_FILTERS: { key: PhaseFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'open', label: PHASE_LABEL.open },
  { key: 'ended', label: PHASE_LABEL.ended },
];

/** 待批改清單一開始列幾筆。其餘收在「顯示全部」 */
const PENDING_PREVIEW = 8;

/**
 * 「新北市・淡江中學」。認不出縣市就只寫校名（真實資料大多如此），
 * 連校名都沒有才寫「待確認歸屬」—— 不要猜。規則同 lib/courseGroups.ts。
 */
const placeOf = (c: Course): string =>
  c.schoolName ? schoolLabel(c.city, c.schoolName, '・') : UNASSIGNED_GROUP;

/** 班級顯示名。拆不出來就用校務系統給的整串 */
const classOf = (c: Course): string => c.className || c.name;

/**
 * 批改作業的入口頁。
 *
 * 以前是本學期所有作業混成一整片卡片，班級一多就找不到；同一班的作業也被拆散。
 * 現在分成兩段：
 *   上：待批改 —— 老師打開這頁最常做的事，不用捲、不用篩
 *   下：所有班級 —— 依「縣市＋學校」分組，班級內照老師排的順序、附編號
 *
 * 三種身分格式一致：每一筆都寫出縣市與學校（授課教師也可能跨縣市）。
 * 縣市／學校／班級在 api/courses.ts 的 toCourse() 就填好在 Course 上，這裡不再拆字串。
 */
export const GradingHub: React.FC<GradingHubProps> = ({
  courses,
  assignments,
  submissions,
  currentSemester,
  onSemesterChange,
  semesterOptions,
  onOpenAssignment,
  onBack,
}) => {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('all');
  const [phase, setPhase] = useState<PhaseFilter>('all');
  const [showAllPending, setShowAllPending] = useState(false);
  /** 使用者手動展開／收合過的區塊。沒動過的依預設（見 isOpen） */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const semesterCourses = useMemo(
    () => courses.filter((c) => c.semester === currentSemester && !c.isArchived),
    [courses, currentSemester],
  );

  /**
   * 每個班的作業：完整順序（含未開放，編號才會和作業管理一致），
   * 但只列出已開放的 —— 未開放的學生看不到，不會有東西要批改。
   */
  const perCourse = useMemo(() => {
    const map = new Map<
      string,
      { no: Record<string, number>; list: { a: Assignment; pending: number; submitted: number; total: number }[] }
    >();
    semesterCourses.forEach((c) => {
      const full = orderedAssignments(assignments, c.id);
      const no = orderNumbers(full);
      const list = full
        .filter((a) => assignmentPhase(a) !== 'draft')
        .map((a) => {
          const st = submissionStats(a, submissions);
          return { a, pending: st.pending, submitted: st.submitted, total: st.total };
        });
      map.set(c.id, { no, list });
    });
    return map;
  }, [semesterCourses, assignments, submissions]);

  const pendingOf = (courseId: string): number =>
    (perCourse.get(courseId)?.list ?? []).reduce((n, x) => n + x.pending, 0);

  /* ── 待批改 ─────────────────────────────────────────── */
  const pendingRows = useMemo(() => {
    const rows: { course: Course; a: Assignment; no: number; pending: number }[] = [];
    semesterCourses.forEach((c) => {
      const info = perCourse.get(c.id);
      info?.list.forEach((x) => {
        if (x.pending > 0) rows.push({ course: c, a: x.a, no: info.no[x.a.id], pending: x.pending });
      });
    });
    // 份數多的先來；一樣多時照學校、班級、作業編號，順序才穩定
    return rows.sort(
      (p, q) =>
        q.pending - p.pending ||
        placeOf(p.course).localeCompare(placeOf(q.course)) ||
        classOf(p.course).localeCompare(classOf(q.course)) ||
        p.no - q.no,
    );
  }, [semesterCourses, perCourse]);
  const pendingTotal = pendingRows.reduce((n, r) => n + r.pending, 0);
  const shownPending = showAllPending ? pendingRows : pendingRows.slice(0, PENDING_PREVIEW);

  /* ── 所有班級 ───────────────────────────────────────── */
  const cityCounts = useMemo(() => cityCountsOf(semesterCourses), [semesterCourses]);
  const cityChips = cityChipsOf(cityCounts);
  // 換學期後原本選的縣市可能不存在了，退回全部
  const activeCity = city === 'all' || cityCounts[city] ? city : 'all';

  const visibleCourses = useMemo(() => {
    const byCity =
      activeCity === 'all'
        ? semesterCourses
        : semesterCourses.filter((c) => (c.city ?? UNASSIGNED_GROUP) === activeCity);
    return filterCoursesByQuery(byCity, query);
  }, [semesterCourses, activeCity, query]);

  const groups = useMemo(() => groupCoursesBySchool(visibleCourses), [visibleCourses]);
  const schoolCount = useMemo(
    () => groupCoursesBySchool(semesterCourses).length,
    [semesterCourses],
  );

  /** 學校預設展開；班級有待批改才預設展開 */
  const isOpen = (id: string, byDefault: boolean) => toggled[id] ?? byDefault;
  const flip = (id: string, byDefault: boolean) =>
    setToggled((prev) => ({ ...prev, [id]: !(prev[id] ?? byDefault) }));

  const phaseTag = (a: Assignment) => {
    const p = assignmentPhase(a);
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-caption whitespace-nowrap border ${
          p === 'open'
            ? 'bg-success-100 text-success-700 border-success-200'
            : 'bg-mauve-100 text-mauve-700 border-mauve-200'
        }`}
      >
        {PHASE_LABEL[p]}
        {hasDeadline(a) && p === 'open' && (
          <span className="ml-1 opacity-80">・截止 {deadlineLabel(a)}</span>
        )}
      </span>
    );
  };

  const pendingPill = (n: number, suffix = '') => (
    <span className="shrink-0 px-2 py-0.5 rounded-full text-caption tabular-nums whitespace-nowrap bg-warning-100 text-warning-700 border border-warning-200">
      {n}{suffix}
    </span>
  );

  const numberBadge = (n: number) => (
    <span className="shrink-0 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1 rounded-md text-caption tabular-nums border border-border-strong text-text-secondary">
      {n}
    </span>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* 頁首 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          id="grading-btn-back"
          onClick={onBack}
          title="返回"
          className="p-2 -ml-2 rounded-full hover:bg-card/50 text-text-secondary transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="min-w-0">
          <h2 className="text-display font-bold text-text-primary tracking-tight">批改作業</h2>
          <p className="text-text-secondary text-ui">先處理待批改，或從下方依學校找到班級</p>
        </div>
        <label className="ml-auto flex items-center gap-2 bg-card/60 border border-border rounded-full px-4 py-2 cursor-pointer w-full sm:w-auto">
          <Calendar size={16} className="text-primary shrink-0" />
          <span className="text-caption text-text-secondary whitespace-nowrap">學期</span>
          <select
            id="grading-hub-select-semester"
            value={currentSemester}
            onChange={(e) => onSemesterChange(e.target.value)}
            className="flex-1 min-w-0 bg-transparent outline-none appearance-none cursor-pointer text-body text-text-primary pr-5"
          >
            {semesterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="text-text-secondary -ml-5 pointer-events-none shrink-0" />
        </label>
      </div>

      {/* 待批改 */}
      <section id="grading-hub-pending">
        <h3 className="flex items-center gap-2 text-title font-bold text-text-primary mb-3">
          <ClipboardCheck size={18} className="text-primary shrink-0" />
          待批改
          <span className="text-body font-normal text-text-secondary tabular-nums">{pendingTotal} 份</span>
        </h3>
        {pendingRows.length === 0 ? (
          <p className="text-body text-text-muted py-8 text-center bg-surface-soft/30 rounded-xl border border-dashed border-border">
            目前沒有待批改的作業
          </p>
        ) : (
          <ul className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
            {shownPending.map(({ course, a, no, pending }) => (
              <li key={a.id}>
                <button
                  id={`grading-hub-pending-${a.id}`}
                  onClick={() => onOpenAssignment(a.id)}
                  className="w-full text-left flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 hover:bg-surface-soft transition-colors"
                >
                  <span
                    className={`text-caption whitespace-nowrap ${
                      course.schoolName ? 'text-text-secondary' : 'px-1.5 rounded bg-warning-100 text-warning-700'
                    }`}
                  >
                    {placeOf(course)}
                  </span>
                  <span className="text-body text-text-primary whitespace-nowrap">{classOf(course)}</span>
                  <span className="flex items-center gap-2 min-w-0 flex-1 basis-48">
                    {numberBadge(no)}
                    <span className="text-body text-text-primary truncate">{a.title}</span>
                  </span>
                  {pendingPill(pending, ' 份')}
                  <ChevronRight size={16} className="shrink-0 text-text-muted" />
                </button>
              </li>
            ))}
            {pendingRows.length > PENDING_PREVIEW && (
              <li>
                <button
                  id="grading-hub-pending-more"
                  onClick={() => setShowAllPending((v) => !v)}
                  className="w-full px-4 py-2.5 text-caption text-primary hover:bg-surface-soft transition-colors"
                >
                  {showAllPending ? '收合' : `顯示全部 ${pendingRows.length} 筆`}
                </button>
              </li>
            )}
          </ul>
        )}
      </section>

      {/* 所有班級 */}
      <section id="grading-hub-classes" className="space-y-3">
        <h3 className="flex flex-wrap items-center gap-2 text-title font-bold text-text-primary">
          <School size={18} className="text-primary shrink-0" />
          所有班級
          <span className="text-body font-normal text-text-secondary tabular-nums">
            {schoolCount} 所學校、{semesterCourses.length} 班
          </span>
        </h3>

        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            id="grading-hub-input-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋縣市、學校、班級或課程代碼"
            className="w-full bg-surface/60 border border-border rounded-brand pl-10 pr-10 py-2.5 text-ui text-text-primary placeholder:text-text-muted outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20 transition-colors [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              id="grading-hub-btn-clearsearch"
              onClick={() => setQuery('')}
              title="清除搜尋"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {cityChips.map((chip) => (
            <button
              key={chip}
              id={`grading-hub-filter-city-${chip}`}
              onClick={() => setCity(chip)}
              className={`px-3 py-1.5 rounded-lg text-caption whitespace-nowrap transition-colors border ${
                activeCity === chip
                  ? 'bg-primary text-on-accent border-primary'
                  : chip === UNASSIGNED_GROUP
                    ? 'bg-warning-100 text-warning-700 border-warning-200 hover:bg-warning-200'
                    : 'text-text-secondary border-border hover:bg-surface-soft'
              }`}
            >
              {chip === 'all' ? '全部' : chip}
              <span className="ml-1.5 tabular-nums opacity-80">{cityCounts[chip] ?? 0}</span>
            </button>
          ))}
          <span className="hidden sm:block w-px h-5 bg-border mx-1" aria-hidden="true" />
          {PHASE_FILTERS.map((f) => (
            <button
              key={f.key}
              id={`grading-hub-filter-phase-${f.key}`}
              onClick={() => setPhase(f.key)}
              className={`px-3 py-1.5 rounded-lg text-caption whitespace-nowrap transition-colors border ${
                phase === f.key
                  ? 'bg-secondary text-on-accent border-secondary'
                  : 'text-text-secondary border-border hover:bg-surface-soft'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {groups.length === 0 ? (
          <p className="text-body text-text-muted py-10 text-center bg-surface-soft/30 rounded-xl border border-dashed border-border">
            {query.trim() ? `找不到符合「${query.trim()}」的班級` : '這個學期沒有班級'}
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const sid = `school:${g.key}`;
              const schoolPending = g.courses.reduce((n, c) => n + pendingOf(c.id), 0);
              const schoolOpen = isOpen(sid, true);
              const unassigned = g.key === UNASSIGNED_GROUP;
              return (
                <div key={g.key} className="border border-border rounded-xl bg-card/40">
                  <button
                    id={`grading-hub-school-${g.key}`}
                    onClick={() => flip(sid, true)}
                    aria-expanded={schoolOpen}
                    className="w-full flex flex-wrap items-center gap-2 px-4 py-3 text-left"
                  >
                    {schoolOpen ? (
                      <ChevronDown size={16} className="shrink-0 text-text-secondary" />
                    ) : (
                      <ChevronRight size={16} className="shrink-0 text-text-secondary" />
                    )}
                    {unassigned ? (
                      <span className="px-2 py-0.5 rounded text-caption bg-warning-100 text-warning-700 border border-warning-200">
                        {UNASSIGNED_GROUP}
                      </span>
                    ) : (
                      <>
                        {showCitySeparately(g.city, g.schoolName) && (
                          <span className="text-body text-text-secondary">{g.city}</span>
                        )}
                        <span className="text-ui font-bold text-text-primary">{g.schoolName}</span>
                      </>
                    )}
                    <span className="text-caption text-text-secondary whitespace-nowrap">{g.courses.length} 班</span>
                    <span className="ml-auto">
                      {schoolPending > 0 ? (
                        pendingPill(schoolPending, ' 份待批改')
                      ) : (
                        <span className="text-caption text-text-muted whitespace-nowrap">都改完了</span>
                      )}
                    </span>
                  </button>

                  {schoolOpen && (
                    <div className="px-3 pb-3 sm:pl-9 space-y-2">
                      {g.courses.map((c) => {
                        const info = perCourse.get(c.id);
                        const all = info?.list ?? [];
                        const rows = phase === 'all' ? all : all.filter((x) => assignmentPhase(x.a) === phase);
                        const pending = pendingOf(c.id);
                        const cid = `class:${c.id}`;
                        const classOpen = isOpen(cid, pending > 0);
                        return (
                          <div key={c.id} className="bg-card border border-border rounded-lg overflow-hidden">
                            <button
                              id={`grading-hub-class-${c.id}`}
                              onClick={() => flip(cid, pending > 0)}
                              aria-expanded={classOpen}
                              className="w-full flex flex-wrap items-center gap-2 px-3 py-2.5 text-left bg-surface-soft/50 hover:bg-surface-soft transition-colors"
                            >
                              {classOpen ? (
                                <ChevronDown size={14} className="shrink-0 text-text-secondary" />
                              ) : (
                                <ChevronRight size={14} className="shrink-0 text-text-secondary" />
                              )}
                              <span className="text-body font-bold text-text-primary">{classOf(c)}</span>
                              <span className="text-caption text-text-secondary whitespace-nowrap">{all.length} 份作業</span>
                              <span className="ml-auto">
                                {pending > 0 ? (
                                  pendingPill(pending, ' 份待批改')
                                ) : (
                                  <span className="text-caption text-text-muted whitespace-nowrap">都改完了</span>
                                )}
                              </span>
                            </button>
                            {classOpen && (
                              <ul className="divide-y divide-border">
                                {rows.length === 0 ? (
                                  <li className="px-3 py-3 text-caption text-text-muted">
                                    {all.length === 0 ? '這個班還沒有開放的作業' : '這個篩選下沒有作業'}
                                  </li>
                                ) : (
                                  rows.map(({ a, pending: p, submitted, total }) => (
                                    <li key={a.id}>
                                      <button
                                        id={`grading-hub-assignment-${a.id}`}
                                        onClick={() => onOpenAssignment(a.id)}
                                        className="w-full text-left flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 hover:bg-surface-soft transition-colors"
                                      >
                                        <span className="flex items-center gap-2 min-w-0 flex-1 basis-40">
                                          {numberBadge(info?.no[a.id] ?? 0)}
                                          <span className="text-body text-text-primary truncate">{a.title}</span>
                                        </span>
                                        {phaseTag(a)}
                                        <span className="text-caption text-text-secondary tabular-nums whitespace-nowrap">
                                          已繳 {submitted}/{total}
                                        </span>
                                        {p > 0 && pendingPill(p)}
                                        <ChevronRight size={14} className="shrink-0 text-text-muted" />
                                      </button>
                                    </li>
                                  ))
                                )}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
