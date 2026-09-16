import React from "react";
import { QuestionBank } from "../components/QuestionBank";
import { useAppState } from "../state/appStateContext";
import { useGoBack } from "../lib/useGoBack";

export const QuestionBankPage: React.FC = () => {
  const { goBack } = useGoBack();
  const { questions, setQuestions, folders, setFolders, currentUser } = useAppState();
  return (
    <QuestionBank
      onBack={goBack}
      questions={questions}
      setQuestions={setQuestions}
      folders={folders}
      setFolders={setFolders}
      user={currentUser}
    />
  );
};
