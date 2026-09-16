import React, { useMemo, useState } from 'react';
import {
  Camera,
  Check,
  FileText,
  Loader2,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { Assignment, Submission } from '../types';
import { seatLabel } from '../mockData';
import { checkImageFile } from '../lib/questionMeta';
import { fileToBase64 } from '../lib/fileToBase64';
import { extractTextFromImage } from '../services/geminiService';

interface ProxySubmitModalProps {
  assignment: Assignment;
  /** App.tsx 已經把名冊與繳交狀態合併好了，這裡不重算 */
  rosterSubmissions: Submission[];
  onClose: () => void;
  onProxySubmit: (studentId: string, studentName: string, content: string) => void;
}

/**
 * 代繳交：老師把紙本作文登錄進系統。
 *
 * 一次一位。左邊挑人、右邊拍照或打字，OCR 出來的文字**一定要老師確認過**
 * 才存檔 —— 手寫辨識本來就會錯字，直接存進去等於拿錯的文本去打分數。
 *
 * 存檔後停在「待批改」，不自動送 AI。批改的時機留給老師按「批次批改」。
 */
export const ProxySubmitModal: React.FC<ProxySubmitModalProps> = ({
  assignment,
  rosterSubmissions,
  onClose,
  onProxySubmit,
}) => {
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState({ current: 0, total: 0 });
  /** 逐張回報的問題（格式不符、太大、辨識失敗），不中斷其他張 */
  const [fileIssues, setFileIssues] = useState<string[]>([]);
  /** 這次開窗已經登錄了幾位。給老師一個進度感 */
  const [doneCount, setDoneCount] = useState(0);

  /** 還沒交的人。草稿也算 —— 學生寫了沒送出，紙本一樣要登錄 */
  const pendingStudents = useMemo(
    () =>
      rosterSubmissions.filter(
        (s) => s.status === 'Unsubmitted' || s.status === 'Draft',
      ),
    [rosterSubmissions],
  );

  const active = pendingStudents.find((s) => s.studentId === activeStudentId);

  const selectStudent = (studentId: string) => {
    setActiveStudentId(studentId);
    setContent('');
    setFileIssues([]);
  };

  const processImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    const issues: string[] = [];

    // 先擋掉格式與大小不對的，剩下的才送 OCR
    const usable = all.filter((f) => {
      const problem = checkImageFile(f);
      if (problem) issues.push(`${f.name}：${problem}`);
      return !problem;
    });

    if (usable.length === 0) {
      setFileIssues(issues);
      return;
    }

    setIsOcrLoading(true);
    setOcrProgress({ current: 0, total: usable.length });
    let combined = '';

    try {
      for (let i = 0; i < usable.length; i++) {
        setOcrProgress({ current: i + 1, total: usable.length });
        const file = usable[i];
        try {
          const base64 = await fileToBase64(file);
          const text = await extractTextFromImage(base64, file.type);
          if (text) combined += (combined ? '\n\n' : '') + text;
          else issues.push(`${file.name}：辨識不到文字`);
        } catch {
          // 單張失敗不該讓整批停下來
          issues.push(`${file.name}：辨識失敗`);
        }
      }

      if (combined) {
        setContent((prev) => (prev ? prev + '\n\n' + combined : combined));
      }
    } finally {
      setIsOcrLoading(false);
      setOcrProgress({ current: 0, total: 0 });
      // 全軍覆沒通常是沒有 API 金鑰。明講，並讓老師改用打字，不要卡死
      if (!combined) {
        issues.push('這一批都沒有辨識出文字。可以直接在下方打字登錄。');
      }
      setFileIssues(issues);
    }
  };

  const save = () => {
    if (!active || !content.trim()) return;
    onProxySubmit(active.studentId, active.studentName, content.trim());
    setDoneCount((n) => n + 1);
    setActiveStudentId(null);
    setContent('');
    setFileIssues([]);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/45 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-surface rounded-2xl shadow-2xl border border-border flex flex-col max-h-[88vh] overflow-hidden">
        {/* 標頭 */}
        <div className="p-5 border-b border-border flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="text-title font-bold text-text-primary flex items-center gap-2">
              <Camera size={18} className="shrink-0 text-secondary" />
              批次代繳交
            </h3>
            <p className="text-caption text-text-secondary mt-1">
              {assignment.title}
              <span className="mx-2 text-text-muted">·</span>
              尚未繳交 {pendingStudents.length} 人
              {doneCount > 0 && (
                <span className="ml-2 text-success-600">已登錄 {doneCount} 位</span>
              )}
            </p>
          </div>
          <button
            id="proxysubmit-btn-close"
            onClick={onClose}
            className="tap-target shrink-0 p-2 rounded-full text-text-secondary hover:bg-surface-soft transition-colors"
            title="關閉"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
          {/* 左：未繳交名單 */}
          <div className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-border overflow-y-auto max-h-40 md:max-h-none">
            {pendingStudents.length === 0 ? (
              <p className="p-5 text-caption text-text-secondary text-center">
                全班都交齊了
              </p>
            ) : (
              <ul className="p-2 space-y-1">
                {pendingStudents.map((s) => {
                  const isActive = s.studentId === activeStudentId;
                  return (
                    <li key={s.studentId}>
                      <button
                        id={`proxysubmit-btn-student-${s.studentId}`}
                        onClick={() => selectStudent(s.studentId)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-body transition-colors flex items-center gap-2 ${
                          isActive
                            ? 'bg-secondary/10 text-secondary border border-secondary/30'
                            : 'text-text-primary hover:bg-surface-soft border border-transparent'
                        }`}
                      >
                        <span className="text-caption text-text-muted font-mono shrink-0">
                          {seatLabel(s.studentId)}
                        </span>
                        <span className="truncate">{s.studentName}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 右：登錄區 */}
          <div className="flex-1 overflow-y-auto p-5 min-w-0">
            {!active ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 gap-2">
                <UserCheck size={28} className="text-text-muted" />
                <p className="text-body text-text-secondary">
                  從左邊挑一位學生，開始登錄他的紙本作文
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-caption text-text-muted font-mono">
                    {seatLabel(active.studentId)}
                  </span>
                  <span className="text-title font-bold text-text-primary">
                    {active.studentName}
                  </span>
                </div>

                {/* 上傳。相機與選檔分開兩顆，手機上 capture 才會直接開相機 */}
                <div className="flex flex-wrap gap-2">
                  <label
                    id="proxysubmit-btn-camera"
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary text-on-accent text-body cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    <Camera size={16} className="shrink-0" />
                    拍照辨識
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        processImages(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <label
                    id="proxysubmit-btn-upload"
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-text-primary text-body cursor-pointer hover:bg-surface-soft transition-colors"
                  >
                    <Upload size={16} className="shrink-0" />
                    選擇照片
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        processImages(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {content && (
                    <button
                      id="proxysubmit-btn-clear"
                      onClick={() => setContent('')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-body text-text-secondary hover:bg-surface-soft transition-colors"
                    >
                      <Trash2 size={14} className="shrink-0" />
                      清空
                    </button>
                  )}
                </div>

                {isOcrLoading && (
                  <div className="flex items-center gap-2 text-body text-primary">
                    <Loader2 size={16} className="animate-spin shrink-0" />
                    {ocrProgress.total > 1
                      ? `正在辨識第 ${ocrProgress.current} / ${ocrProgress.total} 張…`
                      : '正在辨識…'}
                  </div>
                )}

                {fileIssues.length > 0 && (
                  <ul className="space-y-1 bg-warning-100 border border-warning-200 rounded-xl px-4 py-3">
                    {fileIssues.map((msg, i) => (
                      <li key={i} className="text-caption text-warning-700">
                        {msg}
                      </li>
                    ))}
                  </ul>
                )}

                <div>
                  <label
                    htmlFor="proxysubmit-textarea-content"
                    className="text-caption text-text-secondary uppercase tracking-widest mb-2 flex items-center gap-1.5"
                  >
                    <FileText size={12} className="shrink-0" />
                    作文內容（辨識後請先確認再存檔）
                  </label>
                  <textarea
                    id="proxysubmit-textarea-content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={12}
                    placeholder="拍照辨識的文字會出現在這裡，也可以直接打字。"
                    className="w-full px-4 py-3 rounded-xl bg-card border border-border text-essay text-text-primary outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors resize-y"
                  />
                  <p className="mt-1.5 text-caption text-text-muted">
                    {content.trim().length} 字
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 頁尾 */}
        <div className="p-4 border-t border-border flex items-center justify-end gap-2 shrink-0">
          <button
            id="proxysubmit-btn-cancel"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-body text-text-secondary hover:bg-surface-soft transition-colors"
          >
            關閉
          </button>
          <button
            id="proxysubmit-btn-save"
            onClick={save}
            disabled={!active || !content.trim() || isOcrLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-on-accent text-body shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={16} className="shrink-0" />
            存檔並換下一位
          </button>
        </div>
      </div>
    </div>
  );
};
