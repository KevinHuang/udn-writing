
import React, { useState, useRef, useEffect } from 'react';
import { 
  LayoutDashboard, 
  BookOpen, 
  Library, 
  CheckSquare, 
  BarChart3, 
  GraduationCap,
  Users,
  ChevronDown,
  LogOut,
  Settings,
  Check } from 'lucide-react';
import type { IdentityOption, IdentityType } from '../api/auth';
import { IDENTITY_LABEL } from '../lib/identityLabels';
import { useLocation, useNavigate } from 'react-router-dom';
import { routes } from '../lib/routes';
import { BrandMark } from './BrandMark';

interface NavigationProps {
  /** 這個人實際擁有的身分。由後端的 /auth/me 給，不是寫死的三個選項 */
  identities: IdentityOption[];
  activeIdentity: IdentityType | null;
  onSwitchIdentity: (type: IdentityType) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({ identities, activeIdentity, onSwitchIdentity, onOpenSettings, onLogout }) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };

    if (isProfileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileOpen]);

  const navigate = useNavigate();
  const { pathname } = useLocation();

  /**
   * id 就是路徑。一律走 lib/routes.ts，不要寫死字串 ——
   * 改路徑時散落各處的字面值一定會漏掉。
   *
   * key 只是給 React 與測試用的穩定識別字，與路徑分開，
   * 這樣路徑改了不會連元素 id 一起變。
   */
  const menuItems = [
    { key: 'dashboard', path: routes.dashboard(), label: 'HOME', icon: LayoutDashboard },
    { key: 'courses', path: routes.courses(), label: '課程管理', icon: BookOpen },
    { key: 'questions', path: routes.questionBank(), label: '題庫中心', icon: Library },
    // 「作業管理」已整合進課程管理：在班級底下直接看作業、開關、派發、換題。
    // 派發精靈現在只從課程頁的「新增作業」進入，沒有導覽入口。
    { key: 'grading', path: routes.gradingList(), label: '批改作業', icon: CheckSquare },
    { key: 'grades', path: routes.grades(), label: '成績管理', icon: BarChart3 },
  ];

  /**
   * 這個選單項目是不是「現在所在的地方」。
   *
   * 首頁要精準比對，其他項目比前綴 —— 批改作業頁（/grading/:a/:s）
   * 底下的個人批改頁也要讓「批改作業」保持亮著，否則老師點進去之後
   * 導覽列看起來像沒選任何東西。先前那份 ViewState 的寫法是特地為
   * GRADING_EDITOR 加一條例外，前綴比對之後不需要例外了。
   */
  const isActivePath = (path: string) =>
    path === routes.dashboard()
      ? pathname === path
      : pathname === path || pathname.startsWith(path + '/');

  /*
    手機底部導覽直接放全部五項。以前只放四項，第五項「成績管理」收在「更多」裡 ——
    一個選單只裝一個項目，老師每次都得多按一層，五項本來就放得下。
    之後項目超過五個時再考慮收納。
  */
  const bottomNavItems = menuItems;

  return (
    <nav className="sticky top-0 z-40 w-full flex-none transition-all duration-300">
      {/* Main Navigation Bar */}
      <div className="bg-surface/90 backdrop-blur-xl border-b border-border shadow-sm relative z-20">
        <div className="max-w-[1400px] mx-auto px-2 sm:px-4 lg:px-6">
          <div className="flex justify-between h-16 items-center gap-2">
            
            {/* Logo Section - Left */}
            <div id="nav-logo" className="flex items-center gap-2 sm:gap-2.5 shrink-0 group cursor-pointer active:scale-95 transition-transform">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-primary rounded-lg flex items-center justify-center text-on-accent shadow-lg shadow-primary/20 group-hover:rotate-3 transition-all shrink-0">
                <GraduationCap size={18} className="sm:size-[22px]" strokeWidth={1.5} />
              </div>
              <BrandMark />
            </div>

            {/* Navigation Links - Center (Desktop) */}
            <div className="hidden lg:flex flex-1 items-center justify-center px-2">
              <div className="flex items-center gap-1 min-w-max">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isActivePath(item.path);
                  
                  return (
                    <button
                      key={item.key}
                      id={`nav-btn-${item.key}`}
                      onClick={() => navigate(item.path)}
                      className={`flex items-center gap-2 px-4 py-2.5 text-body font-bold rounded-xl transition-all duration-300 whitespace-nowrap active:scale-95 group ${
                        isActive 
                          ? 'bg-primary text-on-accent shadow-md shadow-primary/20' 
                          : 'text-text-primary opacity-70 hover:bg-surface-soft hover:text-primary hover:opacity-100'
                      }`}
                    >
                      <Icon size={16} className={isActive ? 'text-on-accent' : 'text-text-primary opacity-60 group-hover:text-primary group-hover:opacity-100'} strokeWidth={2} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* User Profile - Right Side */}
            <div className="flex items-center gap-1 shrink-0 relative" ref={profileRef}>
               <div 
                id="nav-btn-profile" 
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-1 p-1 rounded-full hover:bg-card hover:shadow-md border border-transparent hover:border-border transition-all duration-300 cursor-pointer group active:scale-95"
               >
                  <div className="w-8 h-8 rounded-full bg-surface-soft border-2 border-card shadow-sm overflow-hidden p-0.5 group-hover:border-primary transition-colors shrink-0 relative z-10">
                      <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Charles" alt="User" className="rounded-full bg-card w-full h-full object-cover" />
                  </div>
                  <ChevronDown size={12} className={`text-text-primary opacity-60 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
               </div>

               {/* Profile Dropdown */}
               {isProfileOpen && (
                 <div className="absolute right-0 top-full mt-2 w-56 bg-card rounded-2xl shadow-xl border border-border py-3 animate-fade-in z-50">
                    <div className="px-4 py-2 border-b border-border/30 mb-2">
                      <p className="text-caption text-text-primary opacity-60 uppercase tracking-widest mb-1">帳號類型</p>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-primary rounded-full"></span>
                        <span className="text-caption text-text-primary">
                          {activeIdentity ? IDENTITY_LABEL[activeIdentity] : '未登入'}
                        </span>
                      </div>
                    </div>
                    
                    {/*
                      只列這個人**真的擁有**的身分。先前是寫死的三個選項，
                      那是原型的假切換；現在來自後端的 /auth/me，
                      而且切換要由後端確認（它會驗你是不是真的有那個身分）。

                      只有一種身分時整段不顯示 —— 一個沒得選的選單只是雜訊。
                    */}
                    {identities.length > 1 && (
                      <>
                        <p className="px-4 pt-1 pb-1.5 text-caption text-text-primary opacity-50">
                          切換身分
                        </p>
                        {identities.map((identity) => (
                          <button
                            key={identity.type}
                            id={`nav-btn-switch-role-${identity.type}`}
                            onClick={() => {
                              if (identity.type !== activeIdentity) onSwitchIdentity(identity.type);
                              setIsProfileOpen(false);
                            }}
                            className={`w-full px-4 py-2 text-left text-caption flex items-center gap-3 transition-colors ${
                              identity.type === activeIdentity
                                ? 'text-primary bg-primary/5'
                                : 'text-mauve-600 hover:bg-mauve-50'
                            }`}
                          >
                            <Users size={16} className="shrink-0" />
                            <span className="min-w-0">
                              {IDENTITY_LABEL[identity.type]}
                              {/* 同一種身分可能橫跨多校，列出來才分得清楚 */}
                              {identity.schools.length > 0 && (
                                <span className="block text-text-muted truncate">
                                  {identity.schools.join('、')}
                                </span>
                              )}
                            </span>
                            {identity.type === activeIdentity && (
                              <Check size={14} className="ml-auto shrink-0" />
                            )}
                          </button>
                        ))}
                      </>
                    )}

                    <div className="h-px bg-border/30 my-2"></div>
                    
                    <button id="nav-btn-settings" 
                      onClick={() => {
                        onOpenSettings();
                        setIsProfileOpen(false);
                      }}
                      className="w-full px-4 py-2 text-left text-caption text-text-primary opacity-70 hover:bg-surface hover:opacity-100 flex items-center gap-3 transition-colors"
                    >
                      <Settings size={16} /> 個人設定
                    </button>
                    
                    <div className="h-px bg-border/30 my-2"></div>
                    
                    <button id="nav-btn-logout" onClick={onLogout} className="w-full px-4 py-2 text-left text-caption text-danger-500 hover:bg-danger-50 flex items-center gap-3 transition-colors">
                      <LogOut size={16} /> 登出系統
                    </button>
                 </div>
               )}
            </div>

          </div>
        </div>
      </div>
      {/* Bottom Navigation Bar - Mobile & Tablet Portrait */}
      <div id="nav-bottom-bar" className="lg:hidden fixed bottom-0 left-0 right-0 bg-card/90 backdrop-blur-xl border-t border-border px-2 pb-safe pt-2 z-[1001] shadow-[0_-4px_20px_-2px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-around max-w-md mx-auto relative">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = isActivePath(item.path);
            
            return (
              <button
                key={item.key}
                id={`nav-bottom-btn-${item.key}`}
                onClick={() => navigate(item.path)}
                className={`flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1.5 rounded-xl transition-all active:scale-90 ${
                  isActive ? 'text-primary' : 'text-text-muted'
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
    </nav>
  );
};
