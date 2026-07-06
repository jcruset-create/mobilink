import type { ReactNode } from "react";
import { X } from "lucide-react";

export const inputCls =
  "w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500";

export const btnPrimary =
  "rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50";
export const btnSecondary =
  "rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50";
export const btnDanger =
  "rounded-xl bg-rose-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50";
export const btnMini =
  "rounded-lg bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export function TextField(props: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <Field label={props.label}>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className={inputCls}
      />
    </Field>
  );
}

export function SelectField(props: {
  label: string; value: string; onChange: (v: string) => void; children: ReactNode;
}) {
  return (
    <Field label={props.label}>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)} className={inputCls}>
        {props.children}
      </select>
    </Field>
  );
}

export function TextAreaField(props: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <Field label={props.label}>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        rows={props.rows ?? 3}
        className={inputCls}
      />
    </Field>
  );
}

export function CheckField(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="h-4 w-4 accent-sky-500"
      />
      <span className="text-sm text-slate-200">{props.label}</span>
    </label>
  );
}

export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${className}`}>
      {children}
    </span>
  );
}

export function Card({ title, value, hint, accent }: { title: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-slate-800 p-4">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
      <div className={`mt-1 text-2xl font-black ${accent ?? "text-slate-100"}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide, full }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; full?: boolean;
}) {
  const sizeCls = full
    ? "h-[96vh] max-w-[98vw]"
    : wide
      ? "max-h-[90vh] max-w-4xl"
      : "max-h-[90vh] max-w-2xl";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`flex w-full ${sizeCls} flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-slate-100`}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
          <h3 className="text-sm font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-700 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800"><table className="w-full text-sm">{children}</table></div>;
}

export const thCls = "px-3 py-2 text-left text-[11px] uppercase text-slate-400";
export const tdCls = "px-3 py-2";

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-6 text-center text-sm text-slate-500">{text}</td>
    </tr>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{children}</div>;
}
