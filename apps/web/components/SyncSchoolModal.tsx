import React, { useMemo, useState } from "react";
import { X, Check, RefreshCcw, Loader2, Info, Search, School, Users } from "lucide-react";
import { SchoolCourse, SchoolLevel } from "../types";
import { MOCK_SCHOOL_COURSES } from "../mockData";
import { semesterLabel } from "../lib/semester";
import { parseCourseName, type ParsedCourseName } from "../lib/schoolName";
import { canImportCourse, isAdmin, type CurrentUser } from "../lib/access";

interface SyncSchoolModalProps {
  onClose: () => void;
  onConfirm: (selectedCourses: SchoolCourse[]) => void;
  existingCourseCodes: string[];
  currentSemester: string;
  /** 決定看得到哪些班級：管理人員全部，授課教師只有自己名下的 */
  user: CurrentUser;
}

/** 目錄的一列：校務系統原始資料 ＋ 解析出來的縣市／學校／班級 */
interface CatalogRow {
  course: SchoolCourse;
  parsed: ParsedCourseName;
}

/** 依學校把班級收成一組，順便記住縣市與學制 */
interface SchoolGroup {
  key: string;
  city: string;
  schoolName: string;
  schoolLevel: SchoolLevel | null;
  classes: CatalogRow[];
}

/** 解析不到縣市或學校的，統一收在這一組，不要散落各處 */
const UNKNOWN_CITY = '待確認';

/**
 * 同步校務系統。
 *
 * 聯合報的課橫跨全台國中小，一個學期可選的班級有數十個，
 * 攤成一條清單找不到東西。所以這裡是「縣市篩選 → 學校分組 → 勾班級」。
 *
 * 已經匯入過的班級（比對 code）不會出現在這裡，避免重複建立課程。
 */
export const SyncSchoolModal = ({
  onClose,
  onConfirm,
  existingCourseCodes,
  currentSemester,
  user,
}: SyncSchoolModalProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [city, setCity] = useState<string>("all");
  const [query, setQuery] = useState("");

  /**
   * 本學期、尚未匯入、而且這個身分看得到的班級。
   * 解析只在這裡跑一次（整份目錄），render 裡不再逐筆解析。
   */
  const available = useMemo<CatalogRow[]>(
    () =>
      MOCK_SCHOOL_COURSES.filter(
        (c) =>
          c.semester === currentSemester &&
          !existingCourseCodes.includes(c.code) &&
          canImportCourse(user, c.teacherName),
      ).map((course) => ({ course, parsed: parseCourseName(course.name) })),
    [currentSemester, existingCourseCodes, user],
  );

  const cityCounts = useMemo(() => {
    const counts: Record<string, number> = { all: available.length };
    available.forEach(({ parsed }) => {
      const key = parsed.city ?? UNKNOWN_CITY;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [available]);

  const groups = useMemo<SchoolGroup[]>(() => {
    const term = query.trim().toLowerCase();
    const rows = available.filter(({ course, parsed }) => {
      const rowCity = parsed.city ?? UNKNOWN_CITY;
      if (city !== "all" && rowCity !== city) return false;
      if (!term) return true;
      // 解析不到的用原始字串比對，才不會搜不到
      return (
        course.name.toLowerCase().includes(term) ||
        course.code.toLowerCase().includes(term) ||
        course.teacherName.toLowerCase().includes(term)
      );
    });

    const bySchool = new Map<string, SchoolGroup>();
    rows.forEach((row) => {
      const rowCity = row.parsed.city ?? UNKNOWN_CITY;
      const rowSchool = row.parsed.schoolName ?? '未能辨識的學校';
      const key = `${rowCity}/${rowSchool}`;
      const group = bySchool.get(key);
      if (group) {
        group.classes.push(row);
      } else {
        bySchool.set(key, {
          key,
          city: rowCity,
          schoolName: rowSchool,
          schoolLevel: row.parsed.schoolLevel,
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
    const ids = group.classes.map(({ course }) => course.id);
    const allOn = ids.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) =>
      allOn
        ? prev.filter((id) => !ids.includes(id))
        : [...prev, ...ids.filter((id) => !prev.includes(id))],
    );
  };

  const handleSync = () => {
    setIsLoading(true);
    // 模擬校務系統的回應時間
    setTimeout(() => {
      onConfirm(MOCK_SCHOOL_COURSES.filter((c) => selectedIds.includes(c.id)));
      setIsLoading(false);
    }, 1200);
  };

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
          {groups.length > 0 ? (
            <div className="flex flex-col gap-5">
              {groups.map((group) => {
                const ids = group.classes.map(({ course }) => course.id);
                const allOn = ids.every((id) => selectedIds.includes(id));
                return (
                  <section key={group.key}>
                    <div className="flex items-center justify-between gap-3 mb-2.5 pb-2 border-b border-border">
                      <h3 className="text-ui text-text-primary flex items-center gap-2 min-w-0">
                        <School size={15} className="text-primary shrink-0" />
                        <span className="truncate">
                          {group.city}
                          {group.schoolName}
                        </span>
                        {group.schoolLevel && (
                          <span className="shrink-0 px-2 py-0.5 rounded bg-surface-soft border border-border text-caption text-text-secondary whitespace-nowrap">
                            {group.schoolLevel}
                          </span>
                        )}
                        <span className="shrink-0 text-caption text-text-secondary whitespace-nowrap">
                          {group.classes.length} 個班級
                        </span>
                      </h3>
                      <button
                        id={`course-sync-btn-selectall-${group.key}`}
                        onClick={() => toggleSchool(group)}
                        className="shrink-0 text-caption text-primary hover:underline whitespace-nowrap"
                      >
                        {allOn ? "取消整校" : "選取整校"}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {group.classes.map(({ course, parsed }) => {
                        const on = selectedIds.includes(course.id);
                        return (
                          <button
                            key={course.id}
                            id={`course-sync-item-${course.id}`}
                            onClick={() => toggle(course.id)}
                            className={`text-left px-3.5 py-3 rounded-brand border transition-all flex items-center gap-3 ${
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
                                  {/* 解析不到班級就退回原始字串，不要留空 */}
                                  {parsed.className ?? course.name}
                                </span>
                                {parsed.confidence === 'low' && (
                                  <span
                                    title="縣市或學校無法自動判定，匯入後請到「待確認」補齊"
                                    className="shrink-0 px-1.5 py-0.5 rounded bg-warning-100 text-warning-700 border border-warning-200 text-caption whitespace-nowrap"
                                  >
                                    待確認
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 flex items-center gap-2 text-caption text-text-secondary flex-wrap">
                                <span className="whitespace-nowrap">{course.code}</span>
                                <span aria-hidden>・</span>
                                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                  <Users size={11} className="shrink-0" />
                                  {course.studentCount} 位
                                </span>
                                {isAdmin(user) && (
                                  <>
                                    <span aria-hidden>・</span>
                                    <span className="whitespace-nowrap">{course.teacherName}</span>
                                  </>
                                )}
                              </span>
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
                {available.length === 0
                  ? isAdmin(user)
                    ? "本學期校務系統裡的班級都已經加入系統了。"
                    : "您本學期名下的班級都已經加入系統了。"
                  : "換個縣市或關鍵字再找找看。"}
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
              disabled={selectedIds.length === 0 || isLoading}
              onClick={handleSync}
              className="px-7 py-2.5 rounded-brand text-ui bg-primary text-on-accent hover:bg-primary/90 shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all flex items-center gap-2 whitespace-nowrap"
            >
              {isLoading ? (
                <>
                  <Loader2 size={17} className="animate-spin shrink-0" />
                  正在同步…
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
