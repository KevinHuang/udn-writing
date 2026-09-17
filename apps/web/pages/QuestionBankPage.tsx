import React from "react";
import { QuestionBank } from "../components/QuestionBank";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";

export const QuestionBankPage: React.FC = () => {
  const { goBack } = useGoBack();
  const { questions, questionOps, folders, folderOps, currentUser } = useAppState();
  return (
    <QuestionBank
      onBack={goBack}
      questions={questions}
      questionOps={questionOps}
      folders={folders}
      folderOps={folderOps}
      user={currentUser}
    />
  );
};
