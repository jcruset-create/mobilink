import type React from "react";

type EmptyStateProps = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
};

export default function EmptyState({
  icon: Icon,
  title,
  text,
}: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
      <Icon className="mx-auto h-7 w-7 text-slate-400" />
      <div className="mt-3 font-medium">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{text}</div>
    </div>
  );
}