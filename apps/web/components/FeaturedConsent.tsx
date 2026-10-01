import React, { useState } from 'react';
import { Stamp } from 'lucide-react';

/** 公開意願的三種狀態。null ＝ 還沒決定（觀摩時當成不公開） */
export type Consent = boolean | null;

/**
 * 「願意公開／不公開」兩顆互斥的鍵。
 *
 * 不用開關 —— 開關只有兩種狀態，表達不了「還沒決定」。
 * 點擊一律 stopPropagation：這顆元件常常放在整張可以點的卡片裡（我的作業），
 * 不擋的話學生一按就被帶去別頁。
 */
export const ConsentChoice: React.FC<{
  id: string;
  value: Consent;
  onChange: (willing: boolean) => void;
  disabled?: boolean;
}> = ({ id, value, onChange, disabled = false }) => (
  <div
    className="flex flex-wrap items-center gap-2"
    role="radiogroup"
    aria-label="同校觀摩"
    onClick={(e) => e.stopPropagation()}
  >
    <span className="text-caption text-text-muted whitespace-nowrap">
      同校觀摩{value === null ? '（還沒決定）' : ''}
    </span>
    {([true, false] as const).map((willing) => (
      <button
        key={String(willing)}
        id={`${id}-${willing ? 'yes' : 'no'}`}
        type="button"
        role="radio"
        aria-checked={value === willing}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onChange(willing);
        }}
        className={`px-2.5 py-1 rounded-lg text-caption border transition-colors whitespace-nowrap disabled:opacity-60 ${
          value === willing
            ? willing
              ? 'bg-secondary border-secondary text-on-accent'
              : 'bg-ink-700 border-ink-700 text-ink-50'
            : 'bg-card border-border-strong text-text-secondary hover:border-secondary hover:text-secondary'
        }`}
      >
        {willing ? '願意公開' : '不公開'}
      </button>
    ))}
  </div>
);

/** 題目旁的「佳作」小章。朱砂描邊，與教師端批改清單的佳作章同一個顏色 */
export const FeaturedBadge: React.FC = () => (
  <span className="inline-block shrink-0 px-1.5 rounded-[4px] border border-secondary text-secondary text-caption whitespace-nowrap">
    佳作
  </span>
);

/**
 * 被選為佳作的作品：告訴學生這件事，並讓他決定要不要公開在數位作品集的同校觀摩。
 *
 * 學習概況的「近期發還」、我的作業都用這一個 —— 規則與說明只寫一次。
 * 公開還需要家長同意（在數位作品集那邊），所以文字一定要講清楚
 * 「你同意了也不會馬上公開」，學生與家長才不會以為按了就上架。
 *
 * compact：清單列裡用，只留一行說明與兩顆鍵。
 */
export const FeaturedConsent: React.FC<{
  submissionId: string;
  value: Consent;
  onChange: (willing: boolean) => Promise<boolean>;
  compact?: boolean;
}> = ({ submissionId, value, onChange, compact = false }) => {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const choose = async (willing: boolean) => {
    setSaving(true);
    setFailed(false);
    const ok = await onChange(willing);
    setSaving(false);
    if (!ok) setFailed(true);
  };

  return (
    <div
      id={`featured-consent-${submissionId}`}
      onClick={(e) => e.stopPropagation()}
      className={`rounded-xl border border-secondary/30 bg-secondary/5 ${compact ? 'px-3 py-2' : 'px-3 py-3'} space-y-2 cursor-default`}
    >
      <p className="flex items-start gap-1.5 text-caption text-text-secondary">
        <Stamp size={14} className="text-secondary shrink-0 mt-0.5" />
        <span>
          這篇被老師選為<b className="text-secondary">佳作</b>！
          {!compact && ' 要不要讓同校同學在數位作品集觀摩這篇？還需要家長同意才會公開，還沒決定前不會公開。'}
        </span>
      </p>
      <ConsentChoice
        id={`featured-consent-${submissionId}`}
        value={value}
        disabled={saving}
        onChange={(willing) => void choose(willing)}
      />
      {failed && <p className="text-caption text-danger-700">沒有存進去，請稍後再試一次。</p>}
    </div>
  );
};
