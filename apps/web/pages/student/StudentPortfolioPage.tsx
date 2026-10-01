import React, { useMemo, useState } from "react";
import { BookOpen, Stamp } from "lucide-react";
import { PageHeader, PAGE_CONTAINER } from "../../components/PageHeader";
import { AnthologyPreview, type AnthologyPreviewData } from "../../components/anthology/AnthologyPreview";
import { CheckRow } from "../../components/anthology/CheckRow";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";
import { semesterLabel } from "../../lib/semester";
import { imageUrlOf } from "../../api/ai";
import { ConsentChoice, FeaturedBadge } from "../../components/FeaturedConsent";
import {
  buildBook, pickMyWorks, schoolNameOf, titleOf, toEntry, type AnthologyOptions,
} from "../../lib/anthology";

const OPTION_LABELS: Array<[keyof AnthologyOptions, string]> = [
  ["includeCover", "封面"],
  ["includeToc", "目錄（含頁碼）"],
  ["showText", "作文內容"],
  ["showComment", "老師評語"],
  ["showScore", "級分"],
  ["showImages", "手寫原稿（一張一頁）"],
  ["showFeatured", "標示佳作"],
];

/**
 * 我的作品集（學生端）。
 *
 * 把自己**已發還**的作品挑一挑、排成 A4 作品集，列印或另存 PDF。
 * 排版引擎與老師的「製作成果集」同一套（lib/anthology.ts），只是目錄依學期分組、
 * 每一列是題目（toEntry 的 personal 版）。
 *
 * 另外，被老師選為佳作的作品在這裡決定**要不要公開在數位作品集的同校觀摩**。
 * 使用者決定這個意願放在 UDN（2026-10-01）；家長的同意在數位作品集那邊，
 * 兩個都同意才會公開。還沒決定前一律不公開。
 */
export const StudentPortfolioPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const { submissions, assignments, courses, studentName, handleSetPublishConsent } = useAppState();

  const works = useMemo(
    () => pickMyWorks(submissions, assignments, courses),
    [submissions, assignments, courses],
  );
  const semesters = useMemo(
    () => [...new Set(works.map((w) => w.course.semester))],
    [works],
  );

  // ── 挑選：預設全選，記的是「拿掉的」 ──
  const [semesterFilter, setSemesterFilter] = useState<string>("all");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const visible = works.filter((w) => semesterFilter === "all" || w.course.semester === semesterFilter);
  const chosen = visible.filter((w) => !excluded.has(w.submission.id));
  const toggle = (ids: string[], on: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.delete(id) : next.add(id)));
      return next;
    });

  // ── 公開意願：存在共用的 studentData（AppState），學習概況、我的作業看到的是同一份 ──
  const [consentError, setConsentError] = useState<string | null>(null);
  const saveConsent = async (id: string, willing: boolean) => {
    setConsentError(null);
    if (!(await handleSetPublishConsent(id, willing))) setConsentError("沒有存進去，請稍後再試一次。");
  };

  // ── 內容與預覽 ──
  const [options, setOptions] = useState<AnthologyOptions>({
    includeCover: true, includeToc: true, showText: true,
    showComment: true, showScore: true, showImages: true, showFeatured: true,
  });
  const defaultTitle = studentName ? `${studentName}的作品集` : "我的作品集";
  const [bookTitle, setBookTitle] = useState("");
  const [preview, setPreview] = useState<AnthologyPreviewData | null>(null);

  const openPreview = () => {
    const entries = chosen.map((p) =>
      toEntry(p, p.submission, { layout: "personal", featured: p.submission.isFeatured === true, imageUrl: imageUrlOf }),
    );
    const sems = [...new Set(chosen.map((p) => p.course.semester))];
    const schools = [...new Set(chosen.map((p) => schoolNameOf(p.course)).filter(Boolean))];
    setPreview({
      pages: buildBook(entries, options),
      entries,
      options,
      cover: {
        title: bookTitle.trim() || defaultTitle,
        subtitle: "寫作成長紀錄",
        scope: schools.join("、"),
        semester: sems.length <= 1
          ? semesterLabel(sems[0] ?? "")
          : `${semesterLabel(sems[0])}～${semesterLabel(sems[sems.length - 1])}`,
      },
    });
  };

  const featuredCount = works.filter((w) => w.submission.isFeatured).length;
  const canPreview =
    chosen.length > 0 &&
    (options.showText || options.showComment || options.showScore || options.showImages);

  return (
    <div className={`${PAGE_CONTAINER} space-y-6 pb-12`}>
      <PageHeader
        title="我的作品集"
        subtitle="把已經發還的作品排成一本 A4 作品集，可以列印或另存成 PDF"
        onBack={canGoBack ? goBack : undefined}
        backId="portfolio-btn-back"
      />

      {works.length === 0 ? (
        <p className="text-body text-text-muted py-12 text-center bg-card rounded-brand border border-dashed border-border-strong">
          還沒有發還的作品。老師發還之後，作品就會出現在這裡。
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* ── 1. 挑作品 ── */}
          <section className="bg-card border border-border-card shadow-paper rounded-brand p-4 md:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-title font-bold text-text-primary">1. 挑選作品</h3>
              <div className="flex flex-wrap gap-2">
                {["all", ...semesters].map((sem) => (
                  <button
                    key={sem}
                    id={`portfolio-semester-${sem}`}
                    type="button"
                    onClick={() => setSemesterFilter(sem)}
                    className={`px-3 py-1 rounded-full text-caption border transition-colors ${
                      semesterFilter === sem
                        ? "bg-primary border-primary text-on-accent"
                        : "bg-card border-border-strong text-text-secondary hover:border-primary hover:text-primary"
                    }`}
                  >
                    {sem === "all" ? "全部學期" : semesterLabel(sem)}
                  </button>
                ))}
              </div>
            </div>

            {featuredCount > 0 && (
              <div className="flex items-start gap-2 rounded-xl bg-secondary/5 border border-secondary/30 px-3 py-2 text-caption text-text-secondary">
                <Stamp size={16} className="text-secondary shrink-0 mt-0.5" />
                <span>
                  你有 {featuredCount} 篇作品被老師選為<b className="text-secondary">佳作</b>。
                  可以決定要不要讓同校同學在數位作品集觀摩 —— 還需要家長同意才會公開，還沒決定前不會公開。
                </span>
              </div>
            )}
            {consentError && <p className="text-caption text-danger-700">{consentError}</p>}

            {semesters
              .filter((sem) => semesterFilter === "all" || sem === semesterFilter)
              .map((sem) => {
                const group = visible.filter((w) => w.course.semester === sem);
                const ids = group.map((w) => w.submission.id);
                const n = ids.filter((id) => !excluded.has(id)).length;
                return (
                  <div key={sem} className="border border-border rounded-xl p-2">
                    <CheckRow
                      id={`portfolio-semester-all-${sem}`}
                      checked={n === ids.length}
                      indeterminate={n > 0 && n < ids.length}
                      onChange={() => toggle(ids, n !== ids.length)}
                      className="font-bold text-text-primary"
                    >
                      {semesterLabel(sem)}
                      <span className="ml-2 text-caption font-normal text-text-muted">
                        已選 {n}／{ids.length} 篇
                      </span>
                    </CheckRow>
                    <ul className="pl-6">
                      {group.map((w) => {
                        const s = w.submission;
                        return (
                          <li key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1 pr-2">
                            <CheckRow
                              id={`portfolio-work-${s.id}`}
                              checked={!excluded.has(s.id)}
                              onChange={() => toggle([s.id], excluded.has(s.id))}
                              className="text-body text-text-secondary"
                            >
                              <span className="text-text-primary">{titleOf(w.assignment)}</span>
                              {s.result && (
                                <span className="ml-2 text-caption text-text-muted">{s.result.totalScore} 級分</span>
                              )}
                              {s.isFeatured && <span className="ml-2"><FeaturedBadge /></span>}
                            </CheckRow>
                            {s.isFeatured && (
                              <div className="pl-11 sm:pl-0 pb-2 sm:pb-0">
                                <ConsentChoice
                                  id={`portfolio-consent-${s.id}`}
                                  value={s.publishConsent ?? null}
                                  onChange={(willing) => void saveConsent(s.id, willing)}
                                />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
          </section>

          {/* ── 2. 內容與預覽 ── */}
          <div className="space-y-6">
            <section className="bg-card border border-border-card shadow-paper rounded-brand p-4 md:p-6 space-y-3">
              <h3 className="text-title font-bold text-text-primary">2. 要印哪些內容</h3>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-text-secondary">書名</span>
                <input
                  id="portfolio-input-title"
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
                    id={`portfolio-option-${key}`}
                    checked={options[key]}
                    onChange={() => setOptions((o) => ({ ...o, [key]: !o[key] }))}
                    className="text-body text-text-secondary"
                  >
                    {label}
                  </CheckRow>
                ))}
              </div>
            </section>

            <section className="bg-card border border-border-card shadow-paper rounded-brand p-4 md:p-6 space-y-3">
              <p className="text-body text-text-primary">
                已選 <span className="text-title font-bold text-primary">{chosen.length}</span> 篇
              </p>
              <button
                id="portfolio-btn-preview"
                type="button"
                onClick={openPreview}
                disabled={!canPreview}
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-on-accent px-4 py-2.5 rounded-xl text-body font-bold shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <BookOpen size={16} /> 預覽作品集
              </button>
            </section>
          </div>
        </div>
      )}

      {preview && <AnthologyPreview preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
};
