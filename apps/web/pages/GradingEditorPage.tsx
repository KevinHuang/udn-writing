import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GradingEditor } from "../components/GradingEditor";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";
import { routes } from "../lib/routes";
import { NotFoundPage } from "./NotFoundPage";
import { COURSE_ROSTERS } from "../mockData";
import { assignmentRoster, gradableQueue, neighbours } from "../lib/gradingQueue";

export const GradingEditorPage: React.FC = () => {
  const navigate = useNavigate();
  const { goBack } = useGoBack();
  const { assignmentId, submissionId } = useParams();
  const {
    assignments, courses, questions, submissions, gradingResetSeq,
    selectedAiModel, setSelectedAiModel, handleSaveGrading, handleResetGrading,
    handleAutoGrade,
    submissionMarks, toggleMark, ensureSubmissions,
  } = useAppState();

  /**
   * 直接把批改頁的網址貼進來時，全域清單只有摘要（沒有作文）。
   * 補這一份作業的完整內容，否則開出來是一張空白稿。
   */
  useEffect(() => {
    if (assignmentId) void ensureSubmissions(assignmentId);
  }, [assignmentId, ensureSubmissions]);

  /**
   * 要批改的那一份，**從網址現查**。
   *
   * 先前這是 selectedSubmission 這個 state，而它是一份快照 ——
   * 存檔之後不會自己跟著 submissions 走，所以 handleSaveGrading 必須
   * 額外寫一段把快照一起更新，否則畫面上的狀態還停在「待批改」、
   * 「重置批改」也不會出現。現查之後那個同步問題不存在了。
   */
  const submission = submissions.find((s) => s.id === submissionId);
  if (!submission) return <NotFoundPage message="找不到這份作品，它可能已經被清除了。" />;

  const assign = assignments.find((a) => a.id === submission.assignmentId);
  const course = courses.find((c) => c.id === assign?.courseId);
  const availableModels = course?.aiModels || [];
  const q = questions.find((item) => item.id === assign?.questionId);

  /*
    「上一位／下一位」的佇列。順序與批改清單同一支函式算出來，
    清單上的第三位按下一位就真的是第四位。
    只走有交東西的人 —— 跳到未繳交只會開出一份空白稿。
  */
  const queue = assign
    ? gradableQueue(
        assignmentRoster(assign, COURSE_ROSTERS[assign.courseId] || [], submissions),
      )
    : [];
  const { prev, next, index, total } = neighbours(queue, submission.id);

  /** 換人用 replace —— 批改一個班會按幾十次，每按一次留一筆歷史，返回鍵就廢了。 */
  const goTo = (id: string) =>
    navigate(routes.gradingEditor(assignmentId ?? submission.assignmentId, id), { replace: true });

  /*
    用 key 讓 GradingEditor 重新掛載。它把 result 收在自己的 useState 裡，
    兩種情況需要清乾淨：
      換人      —— id 變了。不重掛的話上一位的分數與評語會留在畫面上
      重置批改  —— 學生沒換但結果被清掉了，靠 gradingResetSeq 觸發
    存檔刻意不重掛：存完老師通常接著按「下一位」，
    版面（例如收起原文的專注模式）不該每存一次就彈回來。
  */
  return (
    <GradingEditor
      key={`${submission.id}:${gradingResetSeq}`}
      submission={submission}
      queuePosition={index >= 0 ? { index: index + 1, total } : undefined}
      onPrevStudent={prev ? () => goTo(prev.id) : undefined}
      onNextStudent={next ? () => goTo(next.id) : undefined}
      assignmentTitle={assign?.title}
      assignmentContent={q?.content}
      referenceImageUrl={q?.imageUrl}
      selectedAiModel={selectedAiModel}
      availableModels={availableModels}
      preferredAiModel={q?.preferredAiModel}
      onBack={goBack}
      onSave={handleSaveGrading}
      onSelectAiModel={(model) => setSelectedAiModel(model)}
      onResetGrading={handleResetGrading}
      onAutoGrade={handleAutoGrade}
      marks={submissionMarks}
      onToggleMark={toggleMark}
    />
  );
};
