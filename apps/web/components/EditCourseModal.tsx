import React, { useState } from "react";
import {
  Bot,
  X,
  Edit,
  Save,
} from "lucide-react";
import { Course } from "../types";
import { AVAILABLE_AI_MODELS } from "../mockData";
import { SHOW_AI_MODEL_PICKER } from "../lib/features";

export const EditCourseModal = ({
  course,
  onClose,
  onSave,
}: {
  course: Course;
  onClose: () => void;
  onSave: (c: Course) => void;
}) => {
  const [selectedModels, setSelectedModels] = useState<string[]>(
    course.aiModels || [],
  );

  const toggleModel = (model: string) => {
    if (selectedModels.includes(model)) {
      setSelectedModels(selectedModels.filter((m) => m !== model));
    } else {
      setSelectedModels([...selectedModels, model]);
    }
  };

  return (
    <div id="course-modal-set-ai-model" className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-border flex justify-between items-start bg-card">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Edit size={24} className="text-primary" />
              <h2 className="text-heading font-bold text-text-primary">
                設定批改模型
              </h2>
            </div>
            <p className="text-text-secondary">
              {course.name} ({course.code})
            </p>
          </div>
          <button id="dashboard-btn-create-assignment"
            onClick={onClose}
            className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface-soft rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 bg-surface-soft">
          {/* Course Name */}
          <div className="mb-8">
            <label className="block text-body text-text-primary mb-2">
              課程名稱
            </label>
            <div className="bg-card border border-border rounded-xl p-4 text-text-secondary cursor-not-allowed">
              {course.name}
            </div>
            <p className="text-caption text-text-secondary mt-2">
              * 課程名稱同步自校務系統，無法在此修改
            </p>
          </div>

          {/* AI Models */}
          {/* 依需求隱藏。課程的 aiModels 欄位保留，批改照舊使用 —— 見 lib/features.ts */}
          {SHOW_AI_MODEL_PICKER && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Bot size={20} className="text-primary" />
              <label className="text-body text-text-primary">
                本課程可使用的 AI 助手 (可複選)
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {AVAILABLE_AI_MODELS.map((model) => {
                const isSelected = selectedModels.includes(model);
                return (
                  <div
                    key={model}
                    onClick={() => toggleModel(model)}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? "border-primary bg-primary/5" : "border-transparent bg-card hover:border-border"}`}
                  >
                    <div
                      className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-primary text-on-accent" : "border-2 border-border"}`}
                    >
                      {isSelected && <Bot size={14} />}
                    </div>
                    <span
                      className={`font-normal ${isSelected ? "text-primary" : "text-text-primary"}`}
                    >
                      {model}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-card flex justify-end gap-3">
          <button id="dashboard-btn-grade-assignment"
            onClick={onClose}
            className="px-6 py-2.5 text-text-secondary hover:bg-surface-soft rounded-xl font-bold transition-colors"
          >
            取消
          </button>
          <button id="dashboard-btn-view-grades"
            onClick={() => onSave({ ...course, aiModels: selectedModels })}
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-on-accent rounded-xl font-bold flex items-center gap-2 transition-colors"
          >
            <Save size={18} /> 儲存設定
          </button>
        </div>
      </div>
    </div>
  );
};

