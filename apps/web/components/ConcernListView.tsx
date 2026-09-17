import React, { useState, useMemo } from "react";
import {
  TrendingUp,
  ArrowLeft,
  AlertTriangle,
  Heart,
  Info,
} from "lucide-react";
import { Submission, Assignment, Course } from "../types";
import { studentStatsForCourse } from "../lib/concern";
import { type LeaveMarks } from "../lib/leave";

export const ConcernListView = ({
  allCourses,
  assignments,
  submissions,
  leaveMarks,
  onBack,
}: {
  allCourses: Course[];
  assignments: Assignment[];
  submissions: Submission[];
  /** 請假註記。與儀表板卡片吃同一份，否則兩邊人數會對不起來 */
  leaveMarks?: LeaveMarks;
  onBack: () => void;
}) => {
  const courseStats = useMemo(() => {
    return allCourses.map((course) => {
      // 學生統計走 lib/concern.ts，與儀表板的關心名單卡片同一套定義
      const studentStats = studentStatsForCourse(
        course,
        assignments,
        submissions,
        new Date(),
        leaveMarks,
      );

      const topStudents = [...studentStats]
        .filter((s) => s.submissionCount > 0)
        .sort((a, b) => b.avgScore - a.avgScore)
        .slice(0, 5);

      const missingStudents = [...studentStats]
        .filter((s) => s.missingCount > 0)
        .sort((a, b) => b.missingCount - a.missingCount)
        .slice(0, 5);

      const missingStudentNames = missingStudents.map((s) => s.name);

      const lowScoreStudents = [...studentStats]
        .filter((s) => !missingStudentNames.includes(s.name))
        .filter((s) => s.submissionCount > 0)
        .sort((a, b) => a.avgScore - b.avgScore)
        .slice(0, 5);

      return {
        course,
        topStudents,
        missingStudents,
        lowScoreStudents,
      };
    });
  }, [allCourses, assignments, submissions, leaveMarks]);

  const [concernTabs, setConcernTabs] = useState<Record<string, "missing" | "lowScore">>(
    {},
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-10">
      <div className="flex items-center gap-4">
        <button id="dashboard-btn-concern-back"
          onClick={onBack}
          className="p-2 rounded-full hover:bg-card/50 text-text-secondary transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-display font-serif font-bold text-text-primary tracking-tight flex items-center gap-3">
          <Heart size={32} className="text-danger-500 fill-danger-500" />
          學生關心名單
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {courseStats.map(({ course, topStudents, missingStudents, lowScoreStudents }) => {
          const activeTab = concernTabs[course.id] || "missing";
          const currentConcernStudents =
            activeTab === "missing" ? missingStudents : lowScoreStudents;

          return (
            <div
              key={course.id}
              className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden"
            >
              <div className="bg-surface-soft/50 px-6 py-4 border-b border-border flex justify-between items-center">
                <h3 className="text-title font-bold text-text-primary">
                  {course.name}
                </h3>
                <span className="text-body text-text-secondary font-normal">
                  {course.studentCount} 位學生
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-4 text-success-600">
                    <TrendingUp size={20} />
                    <h4 className="font-bold">表現優異 (平均最高)</h4>
                    {/*
                      觸控裝置沒有 hover，說明會完全叫不出來。
                      加上 tabIndex 讓它能被點到／聚焦，
                      tooltip 同時吃 hover 與 focus-within。
                    */}
                    <div className="group relative" tabIndex={0}>
                      <Info
                        size={16}
                        className="text-text-muted cursor-help hover:text-text-secondary transition-colors"
                      />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-ink-800 text-ink-50 text-caption rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none w-48 text-center z-10 shadow-xl">
                        班級截至目前已截止作業的成績總平均最高分的學生名單
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-ink-800"></div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {topStudents.length > 0 ? (
                      topStudents.map((s, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 bg-success-50/30 rounded-xl border border-success-100/50"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-success-100 text-success-600 text-caption flex items-center justify-center">
                              {idx + 1}
                            </span>
                            <div>
                              <p className="font-bold text-text-primary">
                                {s.name}
                              </p>
                              <p className="text-caption text-text-secondary">
                                座號: {s.seatNo ?? '—'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-title font-serif font-bold text-success-600">
                              {s.avgScore.toFixed(1)}
                            </p>
                            <p className="text-caption text-text-secondary">
                              平均級分
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-body text-text-secondary italic py-4">
                        尚無成績資料
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-danger-600">
                      <AlertTriangle size={20} />
                      <h4 className="font-bold">需多關注</h4>
                    </div>
                    <div className="flex bg-surface rounded-lg p-1">
                      <button id="dashboard-btn-concern-missing"
                        onClick={() =>
                          setConcernTabs((prev) => ({
                            ...prev,
                            [course.id]: "missing",
                          }))
                        }
                        className={`px-3 py-1 text-caption font-bold rounded-md transition-all flex items-center gap-1 ${
                          activeTab === "missing"
                            ? "bg-card text-danger-600 shadow-sm"
                            : "text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        缺交
                        <div className="group relative" tabIndex={0}>
                          <Info
                            size={12}
                            className="text-text-muted cursor-help"
                          />
                          <div className="absolute bottom-full right-0 mb-2 px-3 py-2 bg-ink-800 text-ink-50 text-caption rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none w-48 text-center z-10 shadow-xl font-normal">
                            班級截至目前已截止作業的作業缺交累積次數最多的學生名單
                            <div className="absolute top-full right-2 border-4 border-transparent border-t-ink-800"></div>
                          </div>
                        </div>
                      </button>
                      <button id="dashboard-btn-concern-lowscore"
                        onClick={() =>
                          setConcernTabs((prev) => ({
                            ...prev,
                            [course.id]: "lowScore",
                          }))
                        }
                        className={`px-3 py-1 text-caption font-bold rounded-md transition-all flex items-center gap-1 ${
                          activeTab === "lowScore"
                            ? "bg-card text-danger-600 shadow-sm"
                            : "text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        低分
                        <div className="group relative" tabIndex={0}>
                          <Info
                            size={12}
                            className="text-text-muted cursor-help"
                          />
                          <div className="absolute bottom-full right-0 mb-2 px-3 py-2 bg-ink-800 text-ink-50 text-caption rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none w-48 text-center z-10 shadow-xl font-normal">
                            班級截至目前已截止作業，扣除已出現在《缺交》名單上的學生後，作業分數平均最低的學生名單
                            <div className="absolute top-full right-2 border-4 border-transparent border-t-ink-800"></div>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {currentConcernStudents.length > 0 ? (
                      currentConcernStudents.map((s, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 bg-danger-50/30 rounded-xl border border-danger-100/50"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-danger-100 text-danger-600 text-caption flex items-center justify-center">
                              {idx + 1}
                            </span>
                            <div>
                              <p className="font-bold text-text-primary">
                                {s.name}
                              </p>
                              <p className="text-caption text-text-secondary">
                                座號: {s.seatNo ?? '—'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            {activeTab === "missing" ? (
                              <p className="text-title font-serif font-bold text-danger-600">
                                {s.missingCount}{" "}
                                <span className="text-caption font-sans">次缺交</span>
                              </p>
                            ) : (
                              <p className="text-title font-serif font-bold text-danger-600">
                                {s.avgScore.toFixed(1)}{" "}
                                <span className="text-caption font-sans">分</span>
                              </p>
                            )}
                            <p className="text-caption text-text-secondary">
                              {activeTab === "missing"
                                ? "需提醒繳交"
                                : "平均級分較低"}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-body text-text-secondary italic py-4">
                        尚無名單資料
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

