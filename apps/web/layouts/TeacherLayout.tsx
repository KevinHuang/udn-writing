import React from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Bot, AlertTriangle } from "lucide-react";
import { Navigation } from "../components/Navigation";
import { SettingsModal } from "../components/SettingsModal";
import { avatarUrl, useAvatar } from "../lib/avatar";
import { GradedStatsModal } from "../components/GradedStatsModal";
import { QuestionPickerModal } from "../components/QuestionPickerModal";
import { useAppState } from "../state/appStateContext";
import { routes } from "../lib/routes";
import { UserRole } from "../types";
import type { IdentityType } from "../api/auth";
import { hasDemoData } from "../lib/usePersistentState";

/**
 * 教師端的版面：導覽列、各種全域視窗，中間留給 <Outlet /> 放當前頁面。
 *
 * 先前這一整塊和「要顯示哪一頁」的判斷（renderContent 的十個 if）
 * 綁在同一個 return 裡。拆開之後版面只管版面。
 */
export const TeacherLayout: React.FC = () => {
  const navigate = useNavigate();
  const {
    isBatchGrading,
    batchGradingProgress,
    isGradedStatsOpen,
    setIsGradedStatsOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    switchIdentityTo,
    handleLogout,
    session,
    applyTheme,
    theme,
    resetDemo,
    myCourses,
    assignments,
    submissions,
    questions,
    swappingAssignment,
    setSwappingAssignment,
    handleSwapQuestion,
    confirmDialog,
    setConfirmDialog,
    currentSemester,
  } = useAppState();
  // 頭像依 user.id 記在這台裝置上（見 lib/avatar.ts）
  const [avatar, chooseAvatar] = useAvatar(session?.id ?? session?.name ?? 'teacher', 'teacher');

  /**
   * 切換身分。
   *
   * 學生端與教師端是兩棵不同的路由，換身分等於換到另一棵的根。
   * **先等後端確認**再導航 —— 後端會驗這個人是不是真的擁有那個身分，
   * 搶先導過去再被打回來，使用者只會看到畫面閃一下然後回到原地。
   */
  const handleSwitchIdentity = async (type: IdentityType) => {
    try {
      const role = await switchIdentityTo(type);
      navigate(role === UserRole.STUDENT ? routes.studentDashboard() : routes.dashboard());
    } catch (e) {
      console.error('切換身分失敗:', e);
    }
  };

  return (
          <div id="app-container" className="flex flex-col h-screen font-sans text-text-primary selection:bg-primary/20 selection:text-text-primary overflow-hidden">
            {isBatchGrading && (
              <div id="gradinglist-modal-batch-grading" className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-900/60 backdrop-blur-sm">
                <div className="bg-card p-8 rounded-3xl shadow-2xl max-w-sm w-full mx-4 text-center space-y-6 animate-in fade-in zoom-in duration-300">
                  <div className="relative w-24 h-24 mx-auto">
                    <div className="absolute inset-0 rounded-full border-4 border-ink-100"></div>
                    <div
                      className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin"
                      style={{ animationDuration: "1.5s" }}
                    ></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Bot size={32} className="text-primary animate-bounce" />
                    </div>
                  </div>
  
                  <div>
                    <h3 className="text-title font-bold text-ink-900 mb-2">
                      AI 批改進行中
                    </h3>
                    <p className="text-ink-500 text-body font-normal">
                      正在為您批改作業，請稍候...
                    </p>
                  </div>
  
                  <div className="space-y-2">
                    <div className="flex justify-between text-caption text-ink-600 uppercase tracking-wider">
                      <span>進度</span>
                      <span>
                        {Math.round(
                          (batchGradingProgress.current /
                            batchGradingProgress.total) *
                            100,
                        )}
                        %
                      </span>
                    </div>
                    <div className="h-3 bg-ink-100 rounded-full overflow-hidden border border-ink-200/50">
                      <div
                        className="h-full bg-primary transition-all duration-500 ease-out shadow-[0_0_12px_rgba(99,102,241,0.4)]"
                        style={{
                          width: `${(batchGradingProgress.current / batchGradingProgress.total) * 100}%`,
                        }}
                      ></div>
                    </div>
                    <div className="text-body text-ink-700">
                      {batchGradingProgress.current} /{" "}
                      {batchGradingProgress.total} 份已完成
                    </div>
                  </div>
                </div>
              </div>
            )}
            <GradedStatsModal
              isOpen={isGradedStatsOpen}
              onClose={() => setIsGradedStatsOpen(false)}
              courses={myCourses}
              assignments={assignments}
              submissions={submissions}
              currentSemester={currentSemester}
            />
  
            {/* 個人設定：與學生端同一個視窗（頭像、配色），教師端多一段展示資料重置 */}
            <SettingsModal
              audience="teacher"
              idPrefix="settings"
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              avatar={avatar}
              onChooseAvatar={chooseAvatar}
              theme={theme}
              onChangeTheme={applyTheme}
            >
              {/*
                展示用的重置。這個原型把操作結果存在瀏覽器的 localStorage，
                所以重新整理不會遺失 —— 但示範完要換下一個人看時，
                需要一鍵回到 mockData 的初始狀態。
              */}
              {hasDemoData() && (
                <section className="pt-5 border-t border-border">
                  <p className="text-ui font-bold text-text-primary mb-3">展示資料</p>
                  <button
                    id="settings-btn-reset-demo"
                    onClick={() => {
                      if (
                        window.confirm(
                          "確定要重置嗎？所有派發的作業、批改結果與設定都會回到初始狀態，這個動作無法復原。",
                        )
                      ) {
                        resetDemo();
                      }
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-danger-200 bg-danger-50 text-danger-700 font-bold transition-all hover:border-danger-500 active:scale-95"
                  >
                    重置為初始資料
                  </button>
                  <p className="mt-3 text-caption text-text-secondary leading-relaxed">
                    目前的操作結果存在這台瀏覽器裡，重新整理不會消失。換人示範前可以按這裡清空。
                  </p>
                </section>
              )}
            </SettingsModal>
            <Navigation
              identities={session?.identities ?? []}
              activeIdentity={session?.activeIdentity ?? null}
              onSwitchIdentity={handleSwitchIdentity}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onLogout={() => void handleLogout()}
              userName={session?.name}
              avatarSrc={avatarUrl(avatar)}
            />
            <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 lg:pb-8">
              <Outlet />
            </main>
            
            {/* Confirm Dialog */}
            {/* 更換題目：只在作業已關閉時進得來 */}
            <QuestionPickerModal
              assignment={swappingAssignment}
              questions={questions}
              affectedSubmissions={
                swappingAssignment
                  ? submissions.filter(
                      (sub) => sub.assignmentId === swappingAssignment.id,
                    ).length
                  : 0
              }
              onClose={() => setSwappingAssignment(null)}
              onPick={(question) => {
                if (swappingAssignment) {
                  handleSwapQuestion(swappingAssignment, question);
                }
              }}
            />
  
            {confirmDialog.isOpen && (
              <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
                <div
                  className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
                  onClick={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
                ></div>
                <div className="relative w-full max-w-sm bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-border">
                  <div className="p-6 border-b border-border">
                    <h2 className="text-title font-bold text-text-primary flex items-center gap-2">
                      <AlertTriangle size={20} className="text-amber-500" />
                      {confirmDialog.title}
                    </h2>
                  </div>
                  <div className="p-6">
                    {/* 訊息裡有 
   分段，沒有 pre-line 會全部黏成一坨 */}
                    <p className="text-body text-text-secondary leading-relaxed whitespace-pre-line">
                      {confirmDialog.message}
                    </p>
                  </div>
                  <div className="p-6 bg-surface-soft/50 border-t border-border flex justify-end gap-3">
                    <button
                      onClick={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
                      className="px-4 py-2 text-text-secondary hover:bg-card rounded-xl font-bold transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={confirmDialog.onConfirm}
                      className="px-4 py-2 bg-primary hover:bg-primary/90 text-on-accent rounded-xl font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
                    >
                      確定
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
  );
};
