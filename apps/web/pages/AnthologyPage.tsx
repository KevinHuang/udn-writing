import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Loader2 } from "lucide-react";
import { PageHeader, PAGE_CONTAINER } from "../components/PageHeader";
import { SemesterSelect } from "../components/SemesterSelect";
import { AnthologyPreview, type AnthologyPreviewData } from "../components/anthology/AnthologyPreview";
import { CheckRow } from "../components/anthology/CheckRow";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";
import { queryKeys } from "../lib/routes";
import { groupCoursesBySchool } from "../lib/courseGroups";
import { semesterLabel } from "../lib/semester";
import { imageUrlOf } from "../api/ai";
import { fetchSubmissionsByAssignment } from "../api/submissions";
import {
  SOURCE_LABELS, buildBook, pickSubmissions, schoolNameOf, titlesOf, toEntry,
  type AnthologyOptions, type AnthologySource,
} from "../lib/anthology";
import { hasMark } from "../lib/submissionMarks";
import type { Submission } from "../types";

const SOURCES: AnthologySource[] = ["all", "featured", "preselect", "by_title"];

const OPTION_LABELS: Array<[keyof AnthologyOptions, string]> = [
  ["includeCover", "封面"],
  ["includeToc", "目錄（含頁碼）"],
  ["showText", "作文內容"],
  ["showComment", "老師評語"],
  ["showScore", "級分"],
  ["showImages", "手寫原稿（一張一頁）"],
  ["showFeatured", "標示佳作（題頭蓋一顆佳作章）"],
];

/** 同時載入幾份作業的全文。太多會把後端的連線池吃光 */
const LOAD_CONCURRENCY = 4;

/**
 * 成果集：把一個或多個班（可以跨校）的作品排成 A4 文集，列印或另存 PDF。
 *
 * 從數位作品集原型的「製作作品集」移過來 —— 使用者決定教師的功能都做在這個系統，
 * 數位作品集只給學生與家長。
 *
 * 流程：
 *   1. 挑範圍（學期 → 學校 → 班級）、來源（全部／佳作／預選／依題目）、要印什麼
 *   2. 「預覽」才去載入那些作業的全文（摘要沒有作文內容，見 api/submissions.ts）
 *   3. 預覽視窗掛在 body 底下，列印時 index.css 只留它
 *
 * 全文只在這一頁用，所以**不放進 AppState**（理由同 FinalReportPage）。
 */
export const AnthologyPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const [params] = useSearchParams();
  const {
    myCourses, assignments, submissions, submissionMarks,
    currentSemester, semesterOptions, todaySemester,
  } = useAppState();

  // ── 範圍 ──
  const initialCourseId = params.get(queryKeys.course);
  /*
    學期：老師選過就用老師選的，否則跟著網址帶進來的班級。
    用算的不存 state —— 課程是非同步載進來的，第一次渲染時那個班可能還沒到，
    存成 state 的話初值會停在「目前學期」，網址帶的班就被篩掉了。
  */
  const [pickedSemester, setPickedSemester] = useState<string | null>(null);
  const semester =
    pickedSemester ??
    myCourses.find((c) => c.id === initialCourseId)?.semester ??
    currentSemester;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialCourseId ? [initialCourseId] : []),
  );

  const semesterCourses = useMemo(
    () => myCourses.filter((c) => c.semester === semester),
    [myCourses, semester],
  );
  const groups = useMemo(() => groupCoursesBySchool(semesterCourses), [semesterCourses]);
  const selectedCourses = useMemo(
    () => semesterCourses.filter((c) => selectedIds.has(c.id)),
    [semesterCourses, selectedIds],
  );

  const toggleIds = (ids: string[], on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  // ── 來源與內容 ──
  const [source, setSource] = useState<AnthologySource>("featured");
  const [titles, setTitles] = useState<Set<string>>(new Set());
  const availableTitles = useMemo(
    () => titlesOf(selectedCourses, assignments),
    [selectedCourses, assignments],
  );
  const [options, setOptions] = useState<AnthologyOptions>({
    includeCover: true, includeToc: true, showText: true,
    showComment: true, showScore: true, showImages: false, showFeatured: true,
  });
  const [bookTitle, setBookTitle] = useState("");

  const picked = useMemo(
    () => pickSubmissions({
      courses: selectedCourses, assignments, submissions,
      marks: submissionMarks, source, titles,
    }),
    [selectedCourses, assignments, submissions, submissionMarks, source, titles],
  );

  const defaultTitle =
    selectedCourses.length === 1
      ? `${selectedCourses[0].className ?? selectedCourses[0].name} 作品集`
      : `${semesterLabel(semester)} 作品集`;

  // ── 預覽 ──
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AnthologyPreviewData | null>(null);

  const openPreview = async () => {
    setLoadError(null);
    const assignmentIds = [...new Set(picked.map((p) => p.submission.assignmentId))];
    setLoading({ done: 0, total: assignmentIds.length });

    const full = new Map<string, Submission>();
    let done = 0;
    let failed = 0;
    const queue = [...assignmentIds];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          for (const s of await fetchSubmissionsByAssignment(id)) full.set(s.id, s);
        } catch (e) {
          console.error(`載入作業 ${id} 的作品失敗:`, e);
          failed++;
        }
        setLoading({ done: ++done, total: assignmentIds.length });
      }
    };
    await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
    setLoading(null);

    if (failed > 0) {
      // 少幾份作業的成果集看起來是完整的，老師不會發現少了，所以寧可不出
      setLoadError(`有 ${failed} 份作業的作品載入失敗，請稍後再試一次。`);
      return;
    }

    const entries = picked.map((p) =>
      toEntry(p, full.get(p.submission.id) ?? p.submission, {
        layout: "class",
        featured: hasMark(submissionMarks, p.submission.id, "featured"),
        imageUrl: imageUrlOf,
      }),
    );

    const schools = [...new Set(selectedCourses.map(schoolNameOf).filter(Boolean))];
    const schoolText = schools.length > 3
      ? `${schools.slice(0, 3).join("、")} 等 ${schools.length} 校`
      : schools.join("、");
    setPreview({
      pages: buildBook(entries, options),
      entries,
      options,
      cover: {
        title: bookTitle.trim() || defaultTitle,
        subtitle: source === "featured" ? "佳作選集" : source === "preselect" ? "預選作品" : "",
        scope: [schoolText, `${selectedCourses.length} 個班`].filter(Boolean).join("｜"),
        semester: semesterLabel(semester),
      },
    });
  };

  const canPreview =
    picked.length > 0 && !loading &&
    (options.showText || options.showComment || options.showScore || options.showImages);

  return (
    <div className={`${PAGE_CONTAINER} space-y-6 pb-12`}>
      <PageHeader
        title="製作成果集"
        subtitle="把一個或多個班的作品排成 A4 文集，可以列印或另存成 PDF"
        onBack={canGoBack ? goBack : undefined}
        backId="anthology-btn-back"
        actions={
          <SemesterSelect
            id="anthology-select-semester"
            value={semester}
            options={semesterOptions}
            current={todaySemester}
            onChange={(v) => { setPickedSemester(v); setSelectedIds(new Set()); setTitles(new Set()); }}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── 1. 班級 ── */}
        <section className="bg-card border border-border-card shadow-paper rounded-brand p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-title font-bold text-text-primary">1. 選擇班級</h3>
            {semesterCourses.length > 0 && (
              <button
                id="anthology-btn-select-all"
                type="button"
                onClick={() =>
                  toggleIds(semesterCourses.map((c) => c.id), selectedCourses.length !== semesterCourses.length)
                }
                className="text-caption text-primary hover:underline"
              >
                {selectedCourses.length === semesterCourses.length ? "全部取消" : "全選"}
              </button>
            )}
          </div>

          {groups.length === 0 ? (
            <p className="text-body text-text-muted">這個學期沒有班級。</p>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => {
                const ids = g.courses.map((c) => c.id);
                const n = ids.filter((id) => selectedIds.has(id)).length;
                return (
                  <div key={g.key} className="border border-border rounded-xl p-2">
                    <CheckRow
                      id={`anthology-school-${g.key}`}
                      checked={n === ids.length}
                      indeterminate={n > 0 && n < ids.length}
                      onChange={() => toggleIds(ids, n !== ids.length)}
                      className="font-bold text-text-primary"
                    >
                      {g.label}
                      <span className="ml-2 text-caption font-normal text-text-muted">
                        {n > 0 ? `已選 ${n}／${ids.length} 班` : `${ids.length} 班`}
                      </span>
                    </CheckRow>
                    <div className="grid sm:grid-cols-2 gap-x-2 pl-6">
                      {g.courses.map((c) => (
                        <CheckRow
                          key={c.id}
                          id={`anthology-course-${c.id}`}
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleIds([c.id], !selectedIds.has(c.id))}
                          className="text-body text-text-secondary"
                        >
                          {c.className ?? c.name}
                          {c.isArchived && <span className="ml-2 text-caption text-text-muted">已封存</span>}
                        </CheckRow>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="space-y-6">
          {/* ── 2. 作品來源 ── */}
          <section className="bg-card border border-border-card shadow-paper rounded-brand p-4 md:p-6 space-y-3">
            <h3 className="text-title font-bold text-text-primary">2. 收錄哪些作品</h3>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="作品來源">
              {SOURCES.map((s) => (
                <button
                  key={s}
                  id={`anthology-source-${s}`}
                  type="button"
                  role="radio"
                  aria-checked={source === s}
                  onClick={() => setSource(s)}
                  className={`px-3 py-2 rounded-xl text-body border transition-colors ${
                    source === s
                      ? "bg-primary border-primary text-on-accent"
                      : "bg-card border-border-strong text-text-secondary hover:border-primary hover:text-primary"
                  }`}
                >
                  {SOURCE_LABELS[s]}
                </button>
              ))}
            </div>

            {source === "by_title" && (
              <div className="border border-border rounded-xl p-2 max-h-64 overflow-y-auto">
                {availableTitles.length === 0 ? (
                  <p className="text-caption text-text-muted px-3 py-2">先選班級，這裡會列出那些班的題目。</p>
                ) : (
                  <>
                    <CheckRow
                      id="anthology-title-all"
                      checked={availableTitles.every((t) => titles.has(t))}
                      indeterminate={titles.size > 0 && !availableTitles.every((t) => titles.has(t))}
                      onChange={() =>
                        setTitles(availableTitles.every((t) => titles.has(t)) ? new Set() : new Set(availableTitles))
                      }
                      className="font-bold text-text-primary"
                    >
                      全部題目
                    </CheckRow>
                    {availableTitles.map((t) => (
                      <CheckRow
                        key={t}
                        id={`anthology-title-${t}`}
                        checked={titles.has(t)}
                        onChange={() =>
                          setTitles((prev) => {
                            const next = new Set(prev);
                            if (next.has(t)) next.delete(t); else next.add(t);
                            return next;
                          })
                        }
                        className="text-body text-text-secondary"
                      >
                        {t}
                      </CheckRow>
                    ))}
                  </>
                )}
              </div>
            )}
            {(source === "featured" || source === "preselect") && (
              <p className="text-caption text-text-muted">
                收錄在批改清單上蓋了「{SOURCE_LABELS[source]}」章的作品。
              </p>
            )}
          </section>

          {/* ── 3. 內容 ── */}
          <section className="bg-card border border-border-card shadow-paper rounded-brand p-4 md:p-6 space-y-3">
            <h3 className="text-title font-bold text-text-primary">3. 要印哪些內容</h3>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-text-secondary">書名</span>
              <input
                id="anthology-input-title"
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
                placeholder={defaultTitle}
                className="bg-card border border-border-strong rounded-xl px-3 py-2 text-body text-text-primary outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <div>
              {OPTION_LABELS.map(([key, label]) => (
                <CheckRow
                  key={key}
                  id={`anthology-option-${key}`}
                  checked={options[key]}
                  onChange={() => setOptions((o) => ({ ...o, [key]: !o[key] }))}
                  className="text-body text-text-secondary"
                >
                  {label}
                </CheckRow>
              ))}
            </div>
          </section>

          {/* ── 預覽 ── */}
          <section className="bg-card border border-border-card shadow-paper rounded-brand p-4 md:p-6 space-y-3">
            <p className="text-body text-text-primary">
              預計收錄 <span className="text-title font-bold text-primary">{picked.length}</span> 篇
              <span className="text-caption text-text-muted ml-2">
                （{selectedCourses.length} 個班）
              </span>
            </p>
            {picked.length === 0 && selectedCourses.length > 0 && (
              <p className="text-caption text-text-muted">
                {source === "by_title" && titles.size === 0
                  ? "請勾選至少一個題目。"
                  : "勾選的班級裡沒有符合的作品。"}
              </p>
            )}
            {loadError && <p className="text-caption text-danger-700">{loadError}</p>}
            <button
              id="anthology-btn-preview"
              type="button"
              onClick={() => void openPreview()}
              disabled={!canPreview}
              className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-on-accent px-4 py-2.5 rounded-xl text-body font-bold shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />}
              {loading ? `載入作品中（${loading.done}／${loading.total} 份作業）` : "預覽成果集"}
            </button>
          </section>
        </div>
      </div>

      {preview && <AnthologyPreview preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
};
