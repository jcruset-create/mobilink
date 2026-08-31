/**
 * Campo de una ficha (proveedor, cliente…). Se puede tocar de dos maneras y
 * las dos conviven: suelto —"editar" al lado, para corregir un dato— o dentro
 * de la edición de la ficha entera, cuando `edicion` trae el borrador.
 *
 * Vive aquí y no dentro de una pantalla porque lo usan varias fichas.
 */
import { useEffect, useState } from "react";
import { Input, Button } from "./ui";

export function Campo({ label, value, onSave, canEdit, placeholder, edicion, campo, onEdit }: {
  label: string; value: string | null; canEdit: boolean; placeholder?: string;
  onSave: (v: string) => Promise<void>;
  /** Borrador de la ficha completa, o null si no se está editando entera. */
  edicion?: Record<string, string> | null;
  campo?: string;
  onEdit?: (e: Record<string, string>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);

  // Con la ficha entera abierta, el campo es un cuadro de texto sin más: el
  // botón de guardar es el de arriba, uno para todos.
  if (edicion && campo && onEdit) {
    return (
      <div className="flex items-center gap-2 border-b border-slate-700/40 py-1.5 text-[13px]">
        <span className="w-40 shrink-0 text-slate-500">{label}</span>
        <Input
          value={edicion[campo] ?? ""}
          placeholder={placeholder}
          className="w-64"
          onChange={(e) => onEdit({ ...edicion, [campo]: e.target.value })}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-slate-700/40 py-1.5 text-[13px]">
      <span className="w-40 shrink-0 text-slate-500">{label}</span>
      {editing ? (
        <>
          <Input value={v} onChange={(e) => setV(e.target.value)} className="w-64" placeholder={placeholder} autoFocus />
          <Button onClick={async () => { await onSave(v); setEditing(false); }}>Guardar</Button>
          <Button variant="ghost" onClick={() => { setV(value ?? ""); setEditing(false); }}>✕</Button>
        </>
      ) : (
        <>
          <span className="text-slate-200">{value || <span className="text-slate-600">{placeholder ?? "—"}</span>}</span>
          {canEdit && (
            <button className="text-[11px] text-slate-500 hover:text-cyan-300" onClick={() => setEditing(true)}>editar</button>
          )}
        </>
      )}
    </div>
  );
}
