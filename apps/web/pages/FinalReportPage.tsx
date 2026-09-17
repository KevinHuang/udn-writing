import React, { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { FinalReportList } from "../components/FinalReportList";
import { useAppState } from "../state/appStateContext";
import { useApiList } from "../state/useApiList";
import { useGoBack } from "../lib/useGoBack";
import { NotFoundPage } from "./NotFoundPage";
import {
  fetchFinalReports, generateFinalReports, type GenerateResult,
} from "../api/finalReports";
import type { FinalReport } from "@udn/shared";

/**
 * 期末總結。
 *
 * 資料只有這一頁在用，而且一個班才幾十筆 —— 所以**不放進 AppState**，
 * 在這裡自己載。AppState 已經很大了，把只有單一頁面消費的資料也塞進去，
 * 每個畫面都要付它的重新渲染成本。
 *
 * 載入仍然走 `useApiList`：它已經處理好「初值就是 loading」與
 * 「重新載入失敗時不要清空既有資料」這兩件事，自己再寫一次只會寫出不一樣的版本。
 */
export const FinalReportPage: React.FC = () => {
  const { courseId } = useParams();
  const { goBack, canGoBack } = useGoBack();
  const { myCourses } = useAppState();

  const course = myCourses.find((c) => c.id === courseId);

  const load = useCallback(
    () => (courseId ? fetchFinalReports(courseId) : Promise.resolve<FinalReport[]>([])),
    [courseId],
  );
  // 找不到班級時不要發請求 —— 下面就要跳 NotFound 了
  const { items: reports, status, reload } = useApiList<FinalReport>(load, !!course);

  const [isGenerating, setIsGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<GenerateResult | undefined>();
  const [genError, setGenError] = useState<string | null>(null);

  if (!courseId || !course) {
    return <NotFoundPage message="找不到這個班級，它可能已經被刪除了。" />;
  }

  const handleGenerate = async () => {
    setIsGenerating(true);
    setLastResult(undefined);
    setGenError(null);
    try {
      setLastResult(await generateFinalReports(courseId));
      // 端點只回數量不回內容，所以要重新載入才看得到新的那幾筆
      await reload();
    } catch (e) {
      console.error('產生期末總結失敗:', e);
      setGenError('產生期末總結失敗，請稍後再試。');
    } finally {
      setIsGenerating(false);
    }
  };

  const error = genError ?? (status === 'error' ? '載入期末總結失敗，請稍後再試。' : null);

  return (
    <>
      {error && (
        <div className="max-w-5xl mx-auto mb-4">
          <div className="bg-danger-100 border border-danger-200 text-danger-700 rounded-brand px-4 py-3 text-body">
            {error}
          </div>
        </div>
      )}
      <FinalReportList
        courseName={course.name}
        reports={reports}
        studentCount={course.studentCount}
        isLoading={status === 'loading'}
        isGenerating={isGenerating}
        lastResult={lastResult}
        onGenerate={handleGenerate}
        onBack={goBack}
        canGoBack={canGoBack}
      />
    </>
  );
};
