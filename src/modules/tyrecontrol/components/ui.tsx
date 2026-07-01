import type { ReactNode } from "react";
import { X } from "lucide-react";

export const inputCls =
  "w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500";

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

export function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ok ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}`}>
      {children}
    </span>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-slate-100">
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
