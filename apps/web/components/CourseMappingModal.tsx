import React, { useState } from 'react';
import { X, Info, Save, School } from 'lucide-react';
import { Course, SchoolLevel } from '../types';
import { CITIES } from '../lib/schoolName';

interface CourseMappingModalProps {
  /** 需要補齊縣市／學校的課程 */
  courses: Course[];
  onClose: () => void;
  onSave: (updated: Course[]) => void;
}

type Draft = Record<string, { city: string; schoolName: string; schoolLevel: SchoolLevel }>;

/**
 * 待確認課程的修正。
 *
 * 校務系統給的是一整串課程名稱，匯入時會自動拆成縣市／學校／班級，
 * 但一定有拆不乾淨的（全銜、分校、缺縣市）。那些課程照樣建立，
 * 只是縣市與學校留空並標記待確認 —— 猜錯比留白危險，因為看不見。
 *
 * 這個畫面就是留白的出口：管理人員一次把它們指到正確的學校底下。
 */
export const CourseMappingModal: React.FC<CourseMappingModalProps> = ({
  courses,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(
      courses.map((c) => [
        c.id,
        {
          city: c.city ?? '',
          schoolName: c.schoolName ?? '',
          schoolLevel: c.schoolLevel ?? '國中',
        },
      ]),
    ),
  );

  const patch = (id: string, part: Partial<Draft[string]>) =>
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...part } }));

  const ready = courses.filter(
    (c) => draft[c.id]?.city.trim() && draft[c.id]?.schoolName.trim(),
  );

  const handleSave = () => {
    onSave(
      ready.map((c) => ({
        ...c,
        city: draft[c.id].city.trim(),
        schoolName: draft[c.id].schoolName.trim(),
        schoolLevel: draft[c.id].schoolLevel,
        parseConfidence: 'high' as const,
      })),
    );
    onClose();
  };

  return (
    <div
      id="course-mapping-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-3xl bg-surface rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[88vh] border border-border">
        <div className="p-5 sm:p-6 border-b border-border flex justify-between items-start gap-4 bg-card/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-title font-bold text-text-primary flex items-center gap-2">
              <School size={19} className="text-primary shrink-0" />
              待確認的課程歸屬
            </h2>
            <p className="text-caption text-text-secondary mt-1 font-normal">
              這些課程的縣市或學校無法從名稱自動判定，請指定後它們才會出現在正確的學校底下
            </p>
          </div>
          <button
            id="course-mapping-btn-close"
            onClick={onClose}
            className="shrink-0 p-2 text-text-muted hover:text-text-primary hover:bg-surface-soft rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {courses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-full bg-surface-soft flex items-center justify-center mb-3">
                <Info size={28} className="text-text-muted" />
              </div>
              <h3 className="text-title font-bold text-text-primary">沒有待確認的課程</h3>
              <p className="text-body text-text-secondary mt-1">
                目前所有課程的縣市與學校都已經確定。
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {courses.map((course) => (
                <li
                  key={course.id}
                  id={`course-mapping-row-${course.id}`}
                  className="bg-card border border-border rounded-brand p-4 flex flex-col gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-caption text-text-secondary">校務系統原始名稱</p>
                    <p className="text-body text-text-primary break-all">{course.name}</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-caption text-text-secondary">縣市</span>
                      <select
                        id={`course-mapping-city-${course.id}`}
                        value={draft[course.id]?.city ?? ''}
                        onChange={(e) => patch(course.id, { city: e.target.value })}
                        className="px-3 py-2 border border-border rounded-brand bg-surface/60 text-text-primary text-body focus:bg-surface focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
                      >
                        <option value="">請選擇</option>
                        {CITIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-caption text-text-secondary">學校</span>
                      <input
                        id={`course-mapping-school-${course.id}`}
                        value={draft[course.id]?.schoolName ?? ''}
                        onChange={(e) => patch(course.id, { schoolName: e.target.value })}
                        placeholder="例：淡江中學"
                        className="px-3 py-2 border border-border rounded-brand bg-surface/60 text-text-primary text-body placeholder:text-text-muted focus:bg-surface focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-caption text-text-secondary">學制</span>
                      <select
                        id={`course-mapping-level-${course.id}`}
                        value={draft[course.id]?.schoolLevel ?? '國中'}
                        onChange={(e) =>
                          patch(course.id, { schoolLevel: e.target.value as SchoolLevel })
                        }
                        className="px-3 py-2 border border-border rounded-brand bg-surface/60 text-text-primary text-body focus:bg-surface focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
                      >
                        <option value="國中">國中</option>
                        <option value="國小">國小</option>
                      </select>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-5 sm:p-6 bg-surface-soft/50 border-t border-border flex flex-wrap justify-between items-center gap-3 shrink-0">
          <span className="text-body text-text-secondary">
            已填妥{' '}
            <span className="text-primary font-bold tabular-nums">{ready.length}</span> /{' '}
            {courses.length}
          </span>
          <div className="flex gap-3">
            <button
              id="course-mapping-btn-cancel"
              onClick={onClose}
              className="px-5 py-2.5 text-ui text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
            >
              取消
            </button>
            <button
              id="course-mapping-btn-save"
              onClick={handleSave}
              disabled={ready.length === 0}
              className="px-7 py-2.5 rounded-brand text-ui bg-primary text-on-accent hover:bg-primary/90 shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all flex items-center gap-2 whitespace-nowrap"
            >
              <Save size={17} className="shrink-0" />
              儲存歸屬
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
