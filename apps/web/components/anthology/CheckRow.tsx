import React from "react";
import { Check } from "lucide-react";

/** 勾選框。整列都可以點 */
export const CheckRow: React.FC<{
  id: string; checked: boolean; indeterminate?: boolean; onChange: () => void;
  children: React.ReactNode; className?: string;
}> = ({ id, checked, indeterminate, onChange, children, className = "" }) => (
  <button
    id={id}
    type="button"
    role="checkbox"
    aria-checked={indeterminate ? "mixed" : checked}
    onClick={onChange}
    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-surface-soft/60 transition-colors ${className}`}
  >
    <span
      className={`w-5 h-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
        checked || indeterminate ? "bg-primary border-primary text-on-accent" : "border-border-strong bg-card"
      }`}
    >
      {checked && <Check size={14} />}
      {!checked && indeterminate && <span className="w-2.5 h-0.5 bg-on-accent rounded" />}
    </span>
    <span className="min-w-0 flex-1">{children}</span>
  </button>
);
