import React, { useEffect, useMemo, useState } from "react";
import { X, Check, RefreshCcw, Loader2, Info, Search, School } from "lucide-react";
import { fetchSyncCourses, importSyncCourse, type SyncCourse } from "../api/courses";
import { semesterLabel } from "../lib/semester";
import { isAdmin, type CurrentUser } from "../lib/access";

interface SyncSchoolModalProps {
  onClose: () => void;
  /** 匯入跑完、至少一門成功之後呼叫，讓外面重新載入課程清單 */
  onImported: () => Promise<void>;
  existingCourseCodes: string[];
  currentSemester: string;
  /** 只影響顯示（管理人員多看授課教師）。看得到哪些班級由伺服器端決定 */
  user: CurrentUser;
}

/** 依學校把班級收成一組，順便記住縣市 */
interface SchoolGroup {
  key: string;
  city: string;
  schoolName: string;
  classes: SyncCourse[];
}

/** 解析不到縣市或學校的，統一收在這一組，不要散落各處 */
const UNKNOWN_CITY = '待確認';

/** 這一輪匯入裡每門課的狀態。沒輪到的不在表裡 */
type ImportStatus = 'running' | 'done' | 'failed';

const TAG = "shrink-0 px-1.5 py-0.5 rounded border text-caption whitespace-nowrap";
const NEUTRAL_TAG = `${TAG} bg-surface-soft border-border text-text-secondary`;

/**
 * 同步校務系統。
 *
 * 聯合報的課橫跨全台國中小，一個學期可選的班級有數十個，
 * 攤成一條清單找不到東西。所以這裡是「縣市篩選 → 學校分組 → 勾班級」。
 *
 * 清單來自 GET /service/instructor/sync/get_courses（DevAPI）。
 * 已經匯入過的班級（比對 code）照樣列出、標上「已匯入」，可以勾選再次匯入。
 */
export const SyncSchoolModal = ({
  onClose,
  onImported,
  existingCourseCodes,
  currentSemester,
  user,
}: SyncSchoolModalProps) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 匯入中才有值：已經處理完（成功或失敗）幾門／總共幾門 */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [importStatus, setImportStatus] = useState<Record<string, ImportStatus>>({});
  const importing = progress !== null;
  const [city, setCity] = useState<string>("all");
  const [query, setQuery] = useState("");
  /** null = 還在讀 */
  const [catalog, setCatalog] = useState<SyncCourse[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchSyncCourses()
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('讀取校務系統課程失敗:', e);
        setLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = () => {
    setCatalog(null);
    setLoadFailed(false);
    setAttempt((n) => n + 1);
  };

  /**
   * 後端一律回**今天所在**的學期。老師在課程頁切到別的學期時，
   * 標頭寫的是那個學期，清單就不能拿本學期的課頂替 —— 所以這裡還是要比對。
   */
  const available = useMemo(
    () => (catalog ?? []).filter((c) => c.semester === currentSemester),
    [catalog, currentSemester],
  );

  const importedCodes = useMemo(
    () => new Set(existingCourseCodes),
    [existingCourseCodes],
  );

  const cityCounts = useMemo(() => {
    const counts: Record<string, number> = { all: available.length };
    available.forEach((c) => {
      const key = c.city ?? UNKNOWN_CITY;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [available]);

  const groups = useMemo<SchoolGroup[]>(() => {
    const term = query.trim().toLowerCase();
    const rows = available.filter((c) => {
      if (city !== "all" && (c.city ?? UNKNOWN_CITY) !== city) return false;
      if (!term) return true;
      return [c.schoolName, c.className, c.code, ...c.teacherNames].some((s) =>
        s?.toLowerCase().includes(term),
      );
    });

    const bySchool = new Map<string, SchoolGroup>();
    rows.forEach((row) => {
      const rowCity = row.city ?? UNKNOWN_CITY;
      const rowSchool = row.schoolName ?? '未能辨識的學校';
      const key = `${rowCity}/${rowSchool}`;
      const group = bySchool.get(key);
      if (group) {
        group.classes.push(row);
      } else {
        bySchool.set(key, {
          key,
          city: rowCity,
          schoolName: rowSchool,
          classes: [row],
        });
      }
    });
    return [...bySchool.values()];
  }, [available, city, query]);

  const toggle = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );

  /** 整所學校一次勾選或取消 —— 一間學校常常是整批開課 */
  const toggleSchool = (group: SchoolGroup) => {
    const ids = group.classes.map((c) => c.id);
    const allOn = ids.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) =>
      allOn
        ? prev.filter((id) => !ids.includes(id))
        : [...prev, ...ids.filter((id) => !prev.includes(id))],
    );
  };

  /**
   * 一次匯入一門，逐門更新進度。一門失敗不中斷其他門。
   *
   * 全部成功就關視窗；有失敗的就留著，勾選只剩失敗的那幾門，
   * 老師直接再按一次就是重試。
   */
  const handleSync = async () => {
    const targets = available.filter((c) => selectedIds.includes(c.id));
    const failed: string[] = [];
    setImportStatus({});
    for (const [i, course] of targets.entries()) {
      setProgress({ done: i, total: targets.length });
      setImportStatus((prev) => ({ ...prev, [course.id]: 'running' }));
      try {
        await importSyncCourse(course);
        setImportStatus((prev) => ({ ...prev, [course.id]: 'done' }));
      } catch (e) {
        console.error(`匯入課程 ${course.code} 失敗:`, e);
        failed.push(course.id);
        setImportStatus((prev) => ({ ...prev, [course.id]: 'failed' }));
      }
    }
    setProgress({ done: targets.length, total: targets.length });

    // 部分成功也要重讀，課程清單才看得到剛匯入的那幾門
    if (failed.length < targets.length) await onImported();

    if (failed.length === 0) {
      onClose();
      return;
    }
    setSelectedIds(failed);
    setProgress(null);
  };

  const failedCount = Object.values(importStatus).filter((s) => s === 'failed').length;

  const emptyMessage =
    available.length > 0
      ? "換個縣市或關鍵字再找找看。"
      : isAdmin(user)
        ? "校務系統裡沒有本學期的班級。"
        : "校務系統裡沒有您本學期的授課班級。";

  /**
   * 晶片由**實際資料**產生，不是寫死的示範縣市清單 ——
   * 否則校務系統送來別的縣市（花蓮縣…）就沒有對應晶片，那些班級篩不到。
   */
  const filterChips = [
    { key: "all", label: "全部" },
    ...Object.keys(cityCounts)
      .filter((k) => k !== "all" && k !== UNKNOWN_CITY)
      .sort()
      .map((c) => ({ key: c, label: c })),
    ...(cityCounts[UNKNOWN_CITY] ? [{ key: UNKNOWN_CITY, label: UNKNOWN_CITY }] : []),
  ];

  return (
    <div id="course-sync-modal" className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
      ></div>

      <div className="relative w-full max-w-3xl bg-surface rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[88vh] border border-border">
        {/* 標頭 */}
        <div className="p-5 sm:p-6 border-b border-border flex justify-between items-start gap-4 bg-card/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-title font-bold text-text-primary flex items-center gap-2">
              <RefreshCcw size={19} className="text-primary shrink-0" />
              同步校務系統課程
            </h2>
            <p className="text-caption text-text-secondary mt-1 font-normal">
              {semesterLabel(currentSemester)}．挑選要開作文課的班級，學生名單會一併帶入
            </p>
          </div>
          <button
            id="course-sync-btn-close"
            onClick={onClose}
            className="shrink-0 p-2 text-text-muted hover:text-text-primary hover:bg-surface-soft rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* 縣市篩選與搜尋 */}
        <div className="px-5 sm:px-6 pt-4 pb-3 border-b border-border shrink-0 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                id={`course-sync-filter-${chip.key}`}
                onClick={() => setCity(chip.key)}
                className={`px-3 py-1.5 rounded-lg text-caption whitespace-nowrap transition-colors ${
                  city === chip.key
                    ? "bg-primary text-on-accent"
                    : "text-text-secondary hover:bg-surface-soft border border-border"
                }`}
              >
                {chip.label}
                <span className="tap-target ml-1.5 tabular-nums">
                  {cityCounts[chip.key] ?? 0}
                </span>
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              id="course-sync-input-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋學校或班級…"
              className="w-full pl-9 pr-3 py-2.5 border border-border rounded-brand bg-surface/60 text-text-primary text-body placeholder:text-text-muted focus:bg-surface focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
            />
          </div>
        </div>

        {/* 學校與班級 */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {loadFailed ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-full bg-danger-50 flex items-center justify-center mb-3">
                <Info size={28} className="text-danger-700" />
              </div>
              <h3 className="text-title font-bold text-text-primary">
                讀不到校務系統的課程
              </h3>
              <p className="text-body text-text-secondary mt-1">
                可能是校務系統暫時沒有回應，請稍後再試。
              </p>
              <button
                id="course-sync-btn-retry"
                onClick={retry}
                className="mt-4 px-5 py-2.5 rounded-brand text-ui border border-border text-text-primary hover:bg-surface-soft transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <RefreshCcw size={15} className="shrink-0" />
                重新讀取
              </button>
            </div>
          ) : catalog === null ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-text-secondary">
              <Loader2 size={28} className="animate-spin text-primary mb-3" />
              <p className="text-body">正在讀取校務系統的課程…</p>
            </div>
          ) : groups.length > 0 ? (
            <div className="flex flex-col gap-5">
              {groups.map((group) => {
                const ids = group.classes.map((c) => c.id);
                const allOn = ids.every((id) => selectedIds.includes(id));
                return (
                  <section key={group.key}>
                    <div className="flex items-center justify-between gap-3 mb-2.5 pb-2 border-b border-border">
                      <h3 className="text-ui text-text-primary flex items-center gap-2 min-w-0">
                        <School size={15} className="text-primary shrink-0" />
                        <span className="truncate">
                          {/* 校名本身就帶縣市（「新北市石門實中」），不要再補一次 */}
                          {group.schoolName}
                        </span>
                        <span className="shrink-0 text-caption text-text-secondary whitespace-nowrap">
                          {group.classes.length} 個班級
                        </span>
                      </h3>
                      <button
                        id={`course-sync-btn-selectall-${group.key}`}
                        onClick={() => toggleSchool(group)}
                        disabled={importing}
                        className="shrink-0 text-caption text-primary hover:underline whitespace-nowrap disabled:opacity-50 disabled:no-underline"
                      >
                        {allOn ? "取消整校" : "選取整校"}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {group.classes.map((course) => {
                        const on = selectedIds.includes(course.id);
                        const status = importStatus[course.id];
                        return (
                          <button
                            key={course.id}
                            id={`course-sync-item-${course.id}`}
                            onClick={() => toggle(course.id)}
                            // 匯入途中勾選不會有作用（要跑哪幾門在開始時就定了），乾脆鎖住
                            disabled={importing}
                            className={`text-left px-3.5 py-3 rounded-brand border transition-all flex items-center gap-3 disabled:cursor-default ${
                              on
                                ? "border-primary bg-primary/5"
                                : "border-border bg-card hover:border-primary/40"
                            }`}
                          >
                            <span
                              className={`w-5 h-5 shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                                on
                                  ? "bg-primary border-primary text-on-accent"
                                  : "border-border bg-surface"
                              }`}
                            >
                              {on && <Check size={13} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="block text-body text-text-primary truncate">
                                  {/* 沒有班級名稱就退回課程代碼，不要留空 */}
                                  {course.className ?? course.code}
                                </span>
                                {/* 判定規則同 toCourse：校名認不出縣市就是待確認 */}
                                {!course.city && (
                                  <span
                                    title="縣市無法從校名判定，匯入後請到「待確認」補齊"
                                    className="shrink-0 px-1.5 py-0.5 rounded bg-warning-100 text-warning-700 border border-warning-200 text-caption whitespace-nowrap"
                                  >
                                    待確認
                                  </span>
                                )}
                                {/* 這一輪的匯入狀態優先；沒輪到的才看是不是早就匯入過 */}
                                {status === 'running' ? (
                                  <span className={`${NEUTRAL_TAG} inline-flex items-center gap-1`}>
                                    <Loader2 size={11} className="animate-spin shrink-0" />
                                    匯入中
                                  </span>
                                ) : status === 'done' ? (
                                  <span className={`${NEUTRAL_TAG} inline-flex items-center gap-1`}>
                                    <Check size={11} className="shrink-0" />
                                    已完成
                                  </span>
                                ) : status === 'failed' ? (
                                  <span className={`${TAG} bg-danger-50 border-danger-200 text-danger-700`}>
                                    匯入失敗
                                  </span>
                                ) : importedCodes.has(course.code) ? (
                                  <span
                                    title="這個班級已經在系統裡，勾選會再匯入一次"
                                    className={NEUTRAL_TAG}
                                  >
                                    已匯入
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block text-caption text-text-secondary">
                                {course.code}
                              </span>
                              {/* 一門課常有七、八位授課教師，自成一行，不跟代碼擠在一起 */}
                              {isAdmin(user) && course.teacherNames.length > 0 && (
                                <span className="mt-0.5 block text-caption text-text-muted">
                                  {course.teacherNames.join('、')}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-full bg-surface-soft flex items-center justify-center mb-3">
                <Info size={28} className="text-text-muted" />
              </div>
              <h3 className="text-title font-bold text-text-primary">
                沒有符合的班級
              </h3>
              <p className="text-body text-text-secondary mt-1">
                {emptyMessage}
              </p>
            </div>
          )}
        </div>

        {/* 動作 */}
        <div className="p-5 sm:p-6 bg-surface-soft/50 border-t border-border flex flex-wrap justify-between items-center gap-3 shrink-0">
          <div className="text-body font-normal text-text-secondary">
            已選擇{" "}
            <span className="text-primary font-bold tabular-nums">
              {selectedIds.length}
            </span>{" "}
            個班級
            {!importing && failedCount > 0 && (
              <p role="alert" className="text-caption text-danger-700 mt-0.5">
                {failedCount} 個班級匯入失敗，已保留勾選，可以再試一次。
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              id="course-btn-cancel-sync"
              onClick={onClose}
              className="px-5 py-2.5 text-ui text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
            >
              取消
            </button>
            <button
              id="course-btn-confirm-sync"
              disabled={selectedIds.length === 0 || importing}
              onClick={handleSync}
              className="px-7 py-2.5 rounded-brand text-ui bg-primary text-on-accent hover:bg-primary/90 shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all flex items-center gap-2 whitespace-nowrap"
            >
              {progress ? (
                <>
                  <Loader2 size={17} className="animate-spin shrink-0" />
                  正在匯入{" "}
                  <span className="tabular-nums">
                    {progress.done} / {progress.total}
                  </span>
                </>
              ) : (
                <>
                  <RefreshCcw size={17} className="shrink-0" />
                  確認導入
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
