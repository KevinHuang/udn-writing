import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { routes } from '../lib/routes';
import { useAppState } from '../state/appStateContext';
import React, { useState, useRef, useEffect } from 'react';
import { 
  LayoutDashboard, 
  BookOpen, 
  Award, 
  LogOut, 
  ChevronDown,
  Bell,
  Settings,
  HelpCircle,
  GraduationCap
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import { SettingsModal } from './SettingsModal';
import { avatarUrl, useAvatar } from '../lib/avatar';
import { deadlineOf, assignmentPhase, canStudentSubmit } from '../lib/assignments';

/**
 * 學生端的版面。
 *
 * 先前它同時是**版面**與**畫面切換器**（一個 switch (viewState) 決定要
 * render 哪一頁）。現在切換交給 router，這裡只剩頁首、通知、底部導覽，
 * 內容由 <Outlet /> 填。
 */
export const StudentPortal: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const {
    studentName, assignments, submissions, currentSemester,
    handleLogout, session, theme, applyTheme,
  } = useAppState();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // 頭像依 user.id 記在這台裝置上（見 lib/avatar.ts）
  const [avatar, chooseAvatar] = useAvatar(session?.id ?? studentName ?? 'student', 'student');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };

    if (isProfileOpen || isNotificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileOpen, isNotificationsOpen]);

  /**
   * 學生端的通知。
   *
   * 原本還有一支「即將截止」提醒，發出時機由作業上的自動提醒設定決定。
   * 該功能整個移除後，這裡只剩逾期未繳 —— 那是狀態，不是提醒設定。
   */
  const notifications = React.useMemo(() => {
    const notifs: { id: string; title: string; message: string; time: string; assignmentId: string; isOverdue: boolean }[] = [];
    const now = new Date();

    assignments.forEach(assignment => {
      if (assignment.status !== 'Published') return;

      const submission = submissions.find(s => s.assignmentId === assignment.id);
      if (submission && ['Pending', 'Graded', 'Published'].includes(submission.status)) {
        return; // Already submitted
      }

      const deadline = deadlineOf(assignment);

      // 只提醒「過了截止但還能補交」的：不收遲交的，提醒了也做不到
      if (assignmentPhase(assignment, now) === 'ended' && canStudentSubmit(assignment, now)) {
        notifs.push({
          id: `notif-overdue-${assignment.id}`,
          title: '作業已截止，仍可遲交',
          message: `「${assignment.title}」已於 ${(deadline as Date).toLocaleDateString()} 截止，老師允許遲交，現在繳交會標示為遲交。`,
          time: (deadline as Date).toLocaleString(),
          assignmentId: assignment.id,
          isOverdue: true
        });
      }
    });

    return notifs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [assignments, submissions]);

  /** id 就是路徑，一律走 lib/routes.ts。key 另外給，路徑改了元素 id 不會跟著變。 */
  const navItems = [
    { key: 'dashboard', path: routes.studentDashboard(), label: '學習概況', icon: LayoutDashboard },
    { key: 'assignments', path: routes.studentAssignments(), label: '我的作業', icon: BookOpen },
    { key: 'grades', path: routes.studentGrades(), label: '成績紀錄', icon: Award },
  ];

  /** 學習概況要精準比對，其他比前綴 —— 作答頁底下也要讓「我的作業」保持亮著。 */
  const isActivePath = (path: string) =>
    path === routes.studentDashboard()
      ? pathname === path
      : pathname === path || pathname.startsWith(path + '/');

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation Bar */}
      {/* 頂端列：聯合學苑設計稿的暖色漸層膠囊，浮在點陣紙上（與教師端 Navigation 同一套） */}
      <header className="sticky top-0 z-50 px-2 sm:px-4 lg:px-6 pt-2 sm:pt-3">
        <div className="max-w-[1400px] mx-auto rounded-3xl lg:rounded-full bg-gradient-to-r from-sun-300 via-sun-400 to-sun-500 shadow-paper px-3 sm:px-5 lg:px-6 h-16 flex items-center justify-between gap-2">
          {/* Logo */}
          {/*
            標題這一組原本也是 shrink-0，於是 375px 的手機上
            左右兩組加起來 436px，右邊的頭像與身分切換被擠出畫面外，
            整頁還多出 61px 的橫向捲動。改成可壓縮並截斷 ——
            要犧牲的是標題文字，不是操作鍵。
          */}
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 overflow-hidden group cursor-pointer active:scale-95 transition-transform">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-card rounded-full flex items-center justify-center text-secondary shadow-sm group-hover:rotate-3 transition-all shrink-0">
              <GraduationCap size={18} className="sm:size-[22px]" strokeWidth={1.5} />
            </div>
            <BrandMark
              trailing={
                <span className="hidden sm:block text-caption text-text-primary bg-card/70 px-2 py-0.5 rounded-full tracking-widest">
                  {currentSemester}
                </span>
              }
            />
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden lg:flex items-center gap-1 overflow-x-auto no-scrollbar px-4">
            {/*
              id 要帶 item.key。以前三顆按鈕共用同一個寫死的
              "student-nav-btn-profile" —— 重複 id 是無效 HTML，而且這個專案
              拿 id 當測試掛鉤，選到的永遠是第一顆。
              下面那排手機版導覽本來就是 `...-${item.key}`，對齊它。
            */}
            {navItems.map((item) => (
              <button id={`student-nav-btn-${item.key}`}
                key={item.key}
                onClick={() => navigate(item.path)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-body font-bold transition-all duration-300 whitespace-nowrap active:scale-95 ${
                  isActivePath(item.path)
                    ? 'bg-secondary text-on-accent shadow-md shadow-secondary/25'
                    : 'text-text-primary hover:bg-card/60'
                }`}
              >
                <item.icon size={18} strokeWidth={2} />
                {item.label}
              </button>
            ))}
          </nav>

          {/* User Profile & Actions */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="relative" ref={notificationsRef}>
              <button 
                id="student-nav-btn-notifications" 
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className={`hidden sm:block p-2.5 hover:bg-card/60 rounded-full transition-all duration-300 relative active:scale-95 ${isNotificationsOpen ? 'bg-card shadow-md text-secondary' : 'text-text-primary'}`}
              >
                <Bell size={20} />
                {notifications.length > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-danger-500 rounded-full border-2 border-card"></span>
                )}
              </button>

              {isNotificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-card rounded-2xl shadow-xl border border-border/50 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="p-4 border-b border-border/50 bg-surface-soft/50 flex items-center justify-between">
                    <h3 className="font-bold text-text-primary">通知</h3>
                    <span className="text-caption font-normal text-primary bg-primary/10 px-2 py-1 rounded-full">
                      {notifications.length} 則新通知
                    </span>
                  </div>
                  <div className="max-h-[400px] overflow-y-auto">
                    {notifications.length > 0 ? (
                      <div className="divide-y divide-border/50">
                        {notifications.map(notif => (
                          <div 
                            key={notif.id} 
                            className="p-4 hover:bg-surface-soft/50 transition-colors cursor-pointer"
                            onClick={() => {
                              setIsNotificationsOpen(false);
                              navigate(routes.studentAssignments({ focusId: notif.assignmentId }));
                            }}
                          >
                            <div className="flex gap-3">
                              <div className={`w-2 h-2 mt-2 rounded-full shrink-0 ${notif.isOverdue ? 'bg-danger-500' : 'bg-primary'}`} />
                              <div>
                                <h4 className={`text-body font-bold mb-1 ${notif.isOverdue ? 'text-danger-600' : 'text-text-primary'}`}>
                                  {notif.title}
                                </h4>
                                <p className="text-caption text-text-secondary leading-relaxed mb-2">
                                  {notif.message}
                                </p>
                                <span className="text-caption font-normal text-text-tertiary">
                                  {notif.time}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-text-secondary">
                        <Bell size={24} className="mx-auto mb-2 opacity-20" />
                        <p className="text-body">目前沒有新通知</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="hidden sm:block h-8 w-px bg-text-primary/15 mx-1"></div>

            <div className="relative" ref={profileRef}>
              <button id="student-nav-btn-account" 
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-secondary text-on-accent shadow-md shadow-secondary/25 hover:brightness-110 transition-all duration-300 cursor-pointer group active:scale-95"
              >
                {/* 設計稿：橘紅膠囊裡放頭像與姓名 */}
                <div className="w-8 h-8 rounded-full bg-card overflow-hidden p-0.5 shrink-0 relative z-10">
                  <img src={avatarUrl(avatar)} alt="" referrerPolicy="no-referrer" className="rounded-full bg-card w-full h-full object-cover" />
                </div>
                {studentName && (
                  <span className="hidden sm:block max-w-[8rem] truncate text-body font-bold">{studentName}</span>
                )}
                <ChevronDown size={14} className={`shrink-0 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Profile Dropdown */}
              {isProfileOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-card rounded-2xl shadow-xl border border-border py-3 animate-fade-in z-50">
                  <div className="px-4 py-2 border-b border-border/30 mb-2">
                    <p className="text-caption text-text-secondary uppercase tracking-widest mb-1">帳號類型</p>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-primary rounded-full"></span>
                      <span className="text-body text-text-primary">學生帳號</span>
                    </div>
                  </div>
                  
                  {/*
                    這裡以前有一顆寫死的「切換至教師界面」—— 原型的假切換，
                    每個學生都看得到。學生帳號沒有教師身分，按了只會被後端擋下來。
                  */}
                  {/*
                    手機上鈴鐺收進這個選單 —— 頁首放不下鈴鐺＋頭像＋標題，
                    「聯合報雲寫作教室」會被擠掉一半（使用者回報）。
                  */}
                  <button
                    id="student-nav-btn-notifications-mobile"
                    onClick={() => {
                      setIsProfileOpen(false);
                      setIsNotificationsOpen(true);
                    }}
                    className="sm:hidden w-full px-4 py-2.5 text-left text-body text-text-secondary hover:bg-surface flex items-center gap-3 transition-colors"
                  >
                    <Bell size={18} /> 通知
                    {notifications.length > 0 && (
                      <span className="ml-auto text-caption font-bold px-2 py-0.5 rounded-full bg-danger-500 text-on-accent">
                        {notifications.length}
                      </span>
                    )}
                  </button>

                  <button id="student-nav-btn-settings"
                    onClick={() => {
                      setIsSettingsOpen(true);
                      setIsProfileOpen(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-body text-text-secondary hover:bg-surface flex items-center gap-3 transition-colors"
                  >
                    <Settings size={18} /> 個人設定
                  </button>
                  <button id="student-nav-btn-help" className="w-full px-4 py-2.5 text-left text-body text-text-secondary hover:bg-surface flex items-center gap-3 transition-colors">
                    <HelpCircle size={18} /> 幫助中心
                  </button>
                  
                  <div className="h-px bg-border/30 my-2"></div>
                  
                  <button id="student-nav-btn-logout" onClick={() => void handleLogout()} className="w-full px-4 py-2.5 text-left text-body text-danger-500 hover:bg-danger-50 flex items-center gap-3 transition-colors">
                    <LogOut size={18} /> 登出系統
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <SettingsModal
        audience="student"
        idPrefix="student-settings"
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        avatar={avatar}
        onChooseAvatar={chooseAvatar}
        theme={theme}
        onChangeTheme={applyTheme}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-10 pb-24 lg:pb-10">
        <Outlet />
      </main>

      {/* Bottom Navigation Bar - Mobile & Tablet Portrait */}
      <div id="student-nav-bottom-bar" className="lg:hidden fixed bottom-0 left-0 right-0 bg-card/90 backdrop-blur-xl border-t border-border px-2 pb-safe pt-2 z-[1001] shadow-[0_-4px_20px_-2px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-around max-w-md mx-auto relative">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = isActivePath(item.path);
            
            return (
              <button
                key={item.key}
                id={`student-nav-bottom-btn-${item.key}`}
                onClick={() => navigate(item.path)}
                className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all active:scale-90 ${
                  isActive ? 'text-primary' : 'text-text-secondary opacity-50'
                }`}
              >
                <div className={`p-1 rounded-lg transition-colors ${isActive ? 'bg-primary/10' : ''}`}>
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span className="text-caption tracking-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
