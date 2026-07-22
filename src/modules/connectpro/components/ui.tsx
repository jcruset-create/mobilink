/** Connect Pro — componentes UI compartidos (tema oscuro, estilo TyreControl). */

import type { ReactNode } from "react";

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-black text-slate-100">{title}</h1>
        {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function KpiCard({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "ok" | "warn" | "bad" }) {
  const tones = {
    default: "border-slate-700 bg-slate-800",
    ok: "border-emerald-500/40 bg-emerald-500/10",
    warn: "border-amber-500/40 bg-amber-500/10",
    bad: "border-red-500/40 bg-red-500/10",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-100">{value}</div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-700 bg-slate-800 ${className}`}>{children}</div>;
}

export function Th({ children }: { children?: ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</th>;
}

export function Td({ children, className = "", colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={`px-3 py-2 text-[13px] text-slate-300 ${className}`}>{children}</td>;
}

export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${className}`}>{children}</span>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100 focus:border-cyan-500 focus:outline-none ${props.className ?? ""}`}
    />
  );
}

export function Button({ variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-cyan-600 text-white hover:bg-cyan-500",
    ghost: "border border-slate-600 text-slate-300 hover:bg-slate-700",
    danger: "bg-red-600/90 text-white hover:bg-red-600",
  };
  return (
    <button
      {...props}
      className={`rounded-lg px-3 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${props.className ?? ""}`}
    />
  );
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
      <span>{message}</span>
      {onClose && <button onClick={onClose} className="ml-3 text-red-400 hover:text-red-200">✕</button>}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">{message}</div>
  );
}
