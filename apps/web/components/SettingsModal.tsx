import React, { useEffect } from 'react';
import { Check, Settings, X } from 'lucide-react';
import {
  AVATAR_GROUP_LABEL,
  AVATAR_SETS,
  avatarUrl,
  type AvatarAudience,
  type AvatarGroup,
  type AvatarPreset,
} from '../lib/avatar';

interface SettingsModalProps {
  /** 學生或老師：決定用哪一組頭像、提示文字怎麼寫 */
  audience: AvatarAudience;
  /** 元素 id 的前綴。教師端沿用原本的 settings-*，學生端是 student-settings-* */
  idPrefix: string;
  isOpen: boolean;
  onClose: () => void;
  avatar: AvatarPreset;
  onChooseAvatar: (id: string) => void;
  theme: 'light' | 'dark';
  onChangeTheme: (theme: 'light' | 'dark') => void;
  /** 放在最下面的額外區塊（教師端的「展示資料」重置） */
  children?: React.ReactNode;
}

const GROUPS: AvatarGroup[] = ['male', 'female'];

/** 配色下面那句說明，依使用者換說法 */
const THEME_HINT: Record<AvatarAudience, string> = {
  student: '碑拓是深色模式，晚上寫作比較不刺眼。',
  teacher: '碑拓是深色模式：以石面為底、字口透紙色，適合夜間批改。',
};

/**
 * 個人設定：換頭像、換介面配色。學生端與教師端共用。
 *
 * 以前學生選單裡的「個人設定」按了沒有反應；教師端的設定視窗則是另外
 * 寫在 TeacherLayout 裡、只有配色。兩邊現在是同一個視窗，差別只在頭像那一組。
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  audience,
  idPrefix,
  isOpen,
  onClose,
  avatar,
  onChooseAvatar,
  theme,
  onChangeTheme,
  children,
}) => {
  const labels = AVATAR_GROUP_LABEL[audience];
  // Esc 關閉
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // z-[1100]：要蓋過學生端手機底部導覽（z-[1001]），否則「完成」會被擋住
  return (
    <div id={`${idPrefix}-modal`} className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose}></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idPrefix}-title`}
        className="relative w-full max-w-lg max-h-[90vh] bg-card rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-border-card animate-pop-in"
      >
        <div className="px-6 py-5 border-b border-border flex justify-between items-center">
          <h2 id={`${idPrefix}-title`} className="text-title font-bold text-text-primary flex items-center gap-2">
            <Settings size={20} className="text-primary" />
            個人設定
          </h2>
          <button
            id={`${idPrefix}-btn-close`}
            onClick={onClose}
            title="關閉"
            className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-soft rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-7 overflow-y-auto">
          {/* 頭像 */}
          <section>
            <div className="flex items-center gap-4 mb-4">
              <img
                src={avatarUrl(avatar)}
                alt="目前的頭像"
                referrerPolicy="no-referrer"
                className="w-16 h-16 rounded-full ring-4 ring-sun-300 shrink-0"
              />
              <div>
                <p className="text-ui font-bold text-text-primary">選一個喜歡的頭像</p>
                <p className="text-caption text-text-secondary mt-0.5">點一下就換好了</p>
              </div>
            </div>

            <div className="space-y-4">
              {GROUPS.map((group) => (
                <div key={group}>
                  <p className="text-caption font-bold text-text-muted tracking-wider mb-2">
                    {labels[group]}
                  </p>
                  <div role="radiogroup" aria-label={`${labels[group]}頭像`} className="grid grid-cols-5 gap-2 sm:gap-3">
                    {AVATAR_SETS[audience].filter((p) => p.group === group).map((p, i) => {
                      const selected = p.id === avatar.id;
                      return (
                        <button
                          key={p.id}
                          id={`${idPrefix}-avatar-${p.id}`}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={`${labels[group]}造型 ${i + 1}`}
                          onClick={() => onChooseAvatar(p.id)}
                          className={`relative aspect-square rounded-full transition-all outline-none focus-visible:ring-4 focus-visible:ring-primary/40 ${
                            selected
                              ? 'ring-4 ring-primary scale-105'
                              : 'ring-1 ring-border hover:ring-2 hover:ring-primary/50 hover:scale-105'
                          }`}
                        >
                          <img
                            src={avatarUrl(p)}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="w-full h-full rounded-full"
                          />
                          {selected && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-primary text-on-accent flex items-center justify-center ring-2 ring-card">
                              <Check size={14} strokeWidth={3} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-caption text-text-secondary leading-relaxed">
              頭像會記在這台電腦或手機上。換一台裝置登入時，需要再選一次。
            </p>
          </section>

          {/* 介面配色 */}
          <section className="pt-5 border-t border-border">
            <p className="text-ui font-bold text-text-primary mb-3">介面配色</p>
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: 'light', name: '宣紙', en: 'Light' },
                { key: 'dark', name: '碑拓', en: 'Dark' },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  id={`${idPrefix}-btn-theme-${t.key}`}
                  type="button"
                  onClick={() => onChangeTheme(t.key)}
                  className={`px-4 py-3 rounded-xl border-2 font-bold transition-all flex flex-col items-center gap-1 ${
                    theme === t.key
                      ? 'border-primary bg-primary/5 text-primary shadow-sm'
                      : 'border-border bg-card text-text-secondary hover:border-primary/30'
                  }`}
                >
                  <span className="text-title">{t.name}</span>
                  <span className="text-caption opacity-60 uppercase tracking-widest">{t.en}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-caption text-text-secondary leading-relaxed">
              {THEME_HINT[audience]}
            </p>
          </section>

          {children}
        </div>

        <div className="px-6 py-4 bg-surface-soft/50 border-t border-border flex justify-end">
          <button
            id={`${idPrefix}-btn-done`}
            onClick={onClose}
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-on-accent rounded-full font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
