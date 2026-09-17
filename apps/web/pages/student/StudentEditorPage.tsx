import React from "react";
import { useParams } from "react-router-dom";
import { StudentEssayEditor } from "../../components/StudentEssayEditor";
import { useAppState } from "../../state/appStateContext";
import { useGoBack } from "../../lib/useGoBack";
import { NotFoundPage } from "../NotFoundPage";

export const StudentEditorPage: React.FC = () => {
  const { goBack, canGoBack } = useGoBack();
  const { assignmentId } = useParams();
  const { assignments, questions, submissions, handleSubmitEssay } = useAppState();

  const assignment = assignments.find((a) => a.id === assignmentId);
  const question = questions.find((q) => q.id === assignment?.questionId);
  const existingSubmission = submissions.find((s) => s.assignmentId === assignmentId);

  if (!assignment || !question) return <NotFoundPage message="找不到這份作業。" />;

  return (
    <StudentEssayEditor
      assignment={assignment}
      question={question}
      existingSubmission={existingSubmission}
      onBack={goBack}
      canGoBack={canGoBack}
      // handleSubmitEssay 只收兩個參數：它自己會找出同一位學生對同一份作業
      // 的既有紀錄並就地更新。舊的 StudentPortal 型別宣告寫了第三個
      // submissionId，但那個值從來沒有被用到。
      onSubmit={(content, wordCount) =>
        handleSubmitEssay(assignment.id, content, { wordCount })
      }
      onSaveDraft={(content, wordCount) =>
        handleSubmitEssay(assignment.id, content, { wordCount, isSubmitted: false })
      }
    />
  );
};
