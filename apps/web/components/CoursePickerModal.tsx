import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, School, Search, Users, X } from 'lucide-react';
import { Course } from '../types';
import { filterCoursesByQuery } from '../lib/courseSearch';
import {
  groupCoursesBySchool,
  cityCountsOf,
  cityChipsOf,
  UNASSIGNED_GROUP,
  schoolScopeValue,
} from '../lib/courseGroups';

interface CoursePickerModalProps {
  /** 可選的班級。已經過學期與身分篩選，這裡不再過濾 */
  courses: Course[];
  /** 目前選到的範圍：班級 id，或 schoolScopeValue() 產生的「整間學校」 */
  selectedScope: string | null;
  onSelect: (scope: string) => void;
  onClose: () => void;
}

/**
 * 選擇班級。
 *
 * 聯合報管理人員看得到全省的班級，一個學期就有數十個 —— 攤成一條下拉
 * 找不到東西（同步校務系統那個視窗早就踩過這題，見 SyncSchoolModal）。
 * 所以這裡一樣是「縣市篩選 → 搜尋 → 學校分組」，只是從複選勾選
 * 改成單選：點一個班就選定並關閉，不需要再按確認。
 */
export const CoursePickerModal: React.FC<CoursePickerModalProps> = ({
  courses,
  selectedScope,
  onSelect,
  onClose,
}) => {
  const [city, setCity] = useState<string>('all');
  const [query, setQuery] = useState('');
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Esc 關閉。視窗蓋住整個畫面，一定要留一條不用找滑鼠的退路
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 開啟時捲到目前選中的班級，不然在幾十個班裡不知道自己在哪
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  const cityCounts = useMemo(() => cityCountsOf(courses), [courses]);
  const chips = useMemo(() => cityChipsOf(cityCounts), [cityCounts]);

  const groups = useMemo(() => {
    const byCity =
      city === 'all'
        ? courses
        : courses.filter((c) => (c.city ?? UNASSIGNED_GROUP) === city);
    // 搜尋走 lib/courseSearch.ts：涵蓋整串課名、代碼、縣市、學校、班級、教師，
    // 而且支援空白分隔的多關鍵字 AND。不要在這裡自己寫 includes
    return groupCoursesBySchool(filterCoursesByQuery(byCity, query));
  }, [courses, city, query]);

  const shown = groups.reduce((n, g) => n + g.courses.length, 0);

  return (
    <div
      id="course-picker-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
    >
      <div
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-2xl bg-surface rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[88vh] border border-border">
        {/* 標頭 */}
        <div className="p-5 sm:p-6 border-b border-border flex justify-between items-start gap-4 bg-card/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-title font-bold text-text-primary">選擇班級</h2>
            <p className="text-caption text-text-secondary mt-1">
              可搜尋學校、縣市、班級、課程代碼或授課教師
            </p>
          </div>
          <button
            id="course-picker-btn-close"
            onClick={onClose}
            title="關閉"
            className="tap-target shrink-0 p-2 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 縣市篩選與搜尋 */}
        <div className="px-5 sm:px-6 pt-4 pb-3 border-b border-border shrink-0 flex flex-col gap-3">
          {chips.length > 2 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((chip) => (
                <button
                  key={chip}
                  id={`course-picker-filter-${chip}`}
                  onClick={() => setCity(chip)}
                  className={`px-3 py-1.5 rounded-lg text-caption whitespace-nowrap transition-colors ${
                    city === chip
                      ? 'bg-primary text-on-accent'
                      : 'text-text-secondary hover:bg-surface-soft border border-border'
                  }`}
                >
                  {chip === 'all' ? '全部' : chip}
                  <span className="tap-target ml-1.5 tabular-nums">
                    {cityCounts[chip] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <input
              id="course-picker-input-search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋學校或班級…"
              className="w-full pl-9 pr-3 py-2.5 border border-border rounded-brand bg-surface/60 text-text-primary text-body placeholder:text-text-muted focus:bg-surface focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
            />
          </div>
        </div>

        {/* 學校與班級 */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {shown > 0 ? (
            <div className="flex flex-col gap-5">
              {groups.map((group) => (
                <section key={group.key}>
                  {/*
                    學校與班級要一眼分得出上下層：學校是**深一階的橫帶**、班級是白色卡片。
                    先前學校只是一行字加一條細線、班級是 bg-card/40，兩者對底色都幾乎沒有
                    差別（使用者回報「分色太接近」）。學校列捲動時釘在最上面，
                    班級一多（實測一所學校 16 班）才不會忘記自己在看哪一所。
                  */}
                  {/* 底色一定要**實色**：sticky 的橫帶半透明時，底下捲過去的班級會透出來，
                      兩層字疊在一起（使用者回報看不清楚）。primary-50 是實色，
                      而且在碑拓模式會換成深藍，不必另外處理。 */}
                  <div className="sticky top-0 z-10 flex items-center gap-2 rounded-xl border border-primary-200 border-l-4 border-l-primary bg-primary-50 px-3 py-2 shadow-sm">
                    <School size={15} className="text-primary shrink-0" />
                    <h3 className="text-ui font-bold text-primary truncate">
                      {group.label}
                    </h3>
                    <span className="ml-auto shrink-0 text-caption text-primary/80 tabular-nums">
                      {group.courses.length} 班
                    </span>
                  </div>

                  {/* 左邊那條線把班級收在學校底下，層級看得出來 */}
                  <ul className="mt-2 ml-3 flex flex-col gap-1.5 border-l-2 border-border pl-3">
                    {/*
                      全校：看整間學校的總覽（各班一列）。
                      放在班級清單的第一個 —— 老師的視線本來就從上往下找。
                    */}
                    <li>
                      <button
                        ref={selectedScope === schoolScopeValue(group.key) ? selectedRef : undefined}
                        id={`course-picker-btn-school-${group.key}`}
                        onClick={() => {
                          onSelect(schoolScopeValue(group.key));
                          onClose();
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-brand border shadow-sm transition-all flex items-center gap-3 ${
                          selectedScope === schoolScopeValue(group.key)
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-card border-border hover:border-primary/50 hover:shadow-md text-text-primary'
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-body">全校總覽</span>
                          <span className="block text-caption text-text-secondary truncate">
                            {group.courses.length} 個班級一起看
                          </span>
                        </span>
                        <span className="shrink-0 flex items-center gap-1 text-caption text-text-secondary tabular-nums">
                          <Users size={12} />
                          {group.courses.reduce((n, c) => n + (c.studentCount ?? 0), 0)}
                        </span>
                        {selectedScope === schoolScopeValue(group.key) && (
                          <Check size={16} className="shrink-0 text-primary" />
                        )}
                      </button>
                    </li>
                    {group.courses.map((course) => {
                      const isSelected = course.id === selectedScope;
                      return (
                        <li key={course.id}>
                          <button
                            ref={isSelected ? selectedRef : undefined}
                            id={`course-picker-btn-course-${course.id}`}
                            onClick={() => {
                              onSelect(course.id);
                              onClose();
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-brand border shadow-sm transition-all flex items-center gap-3 ${
                              isSelected
                                ? 'bg-primary/10 border-primary text-primary'
                                : 'bg-card border-border hover:border-primary/50 hover:shadow-md text-text-primary'
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="text-body truncate">
                                  {course.className || course.name}
                                </span>
                                {/*
                                  已封存的班級要標出來。名稱看不出差別
                                  （「國一信班」與「國一忠班」都在同一所學校），
                                  選進去卻是一張沒有資料的空表，會以為系統壞了。
                                  仍然可以選 —— 查過去學期的成績是正當需求。
                                */}
                                {course.isArchived && (
                                  <span className="shrink-0 px-1.5 py-0.5 rounded bg-ink-100 text-ink-600 border border-ink-200 text-caption whitespace-nowrap">
                                    已封存
                                  </span>
                                )}
                              </span>
                              <span className="block text-caption text-text-secondary truncate">
                                {course.code}
                                {course.teacherName && ` · ${course.teacherName}`}
                              </span>
                            </span>
                            <span className="shrink-0 flex items-center gap-1 text-caption text-text-secondary tabular-nums">
                              <Users size={12} />
                              {course.studentCount}
                            </span>
                            {isSelected && (
                              <Check size={16} className="shrink-0 text-primary" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center text-text-secondary">
              <Search size={40} className="mx-auto mb-3 opacity-30" />
              {/*
                訊息要和課程管理一致：搜不到跟「本來就沒有課」是兩件事，
                講錯會讓管理人員以為資料掉了
              */}
              <p className="text-body">
                {query.trim()
                  ? `找不到符合「${query.trim()}」的課程`
                  : '這個縣市沒有課程'}
              </p>
              {query.trim() && (
                <button
                  id="course-picker-btn-reset"
                  onClick={() => setQuery('')}
                  className="text-body mt-3 text-primary hover:underline"
                >
                  清除搜尋條件
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
