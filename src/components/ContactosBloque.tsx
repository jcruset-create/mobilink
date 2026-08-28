/**
 * Contactos de una ficha: taller, proveedor o cliente.
 *
 * El mismo bloque para las tres porque los contactos viven en una sola tabla,
 * colgados por ownerType/ownerId. Guardar un único contacto suelto en la ficha
 * significaba que, al cambiar esa persona, se sobrescribía y se perdía a quién
 * llamábamos antes.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

export type OwnerContacto = "workshop" | "provider" | "client";

type Contacto = {
  id: number;
  name: string; surname: string | null; role: string | null;
  phone: string | null; mobile: string | null; email: string | null;
  isPrimary: boolean; forAssistance: boolean; forAdmin: boolean;
  forBilling: boolean; forEmergency: boolean; active: boolean;
};

const VACIO = {
  name: "", surname: "", role: "", phone: "", mobile: "", email: "",
  isPrimary: false, forAssistance: false, forAdmin: false, forBilling: false, forEmergency: false,
};

/** Para qué sirve cada contacto: es lo que decide a quién se avisa de qué. */
const USOS: [keyof typeof VACIO, string][] = [
  ["forAssistance", "Asistencias"],
  ["forAdmin", "Administración"],
  ["forBilling", "Facturación"],
  ["forEmergency", "Urgencias"],
];

export default function ContactosBloque({ ownerType, ownerId, titulo }: {
  ownerType: OwnerContacto;
  ownerId: number;
  titulo?: string;
}) {
  const [rows, setRows] = useState<Contacto[]>([]);
  const [nuevo, setNuevo] = useState({ ...VACIO });
  const [abrirAlta, setAbrirAlta] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pedir = useCallback(async (ruta: string, init?: RequestInit) => {
    const res = await fetch(`${API_BASE}${ruta}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...getAdminHeaders() },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "Error de servidor");
    return data;
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await pedir(`/api/contactos?ownerType=${ownerType}&ownerId=${ownerId}`);
      setRows(d.data);
    } catch (e: any) { setError(e.message); }
  }, [pedir, ownerType, ownerId]);
  useEffect(() => { void load(); }, [load]);

  const añadir = async () => {
    if (!nuevo.name.trim()) { setError("El nombre del contacto es obligatorio."); return; }
    setBusy(true); setError("");
    try {
      await pedir("/api/contactos", {
        method: "POST",
        body: JSON.stringify({ ...nuevo, ownerType, ownerId }),
      });
      setNuevo({ ...VACIO });
      setAbrirAlta(false);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const editar = async (id: number, cambios: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      await pedir(`/api/contactos/${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const input = (valor: string, alCambiar: (v: string) => void, marcador: string) => (
    <input
      value={valor}
      onChange={(e) => alCambiar(e.target.value)}
      placeholder={marcador}
      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
    />
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-black uppercase tracking-wide text-slate-300">{titulo ?? "Contactos"}</h3>
        <button onClick={() => setAbrirAlta(!abrirAlta)} className="text-xs text-slate-400 hover:text-orange-400">
          {abrirAlta ? "cancelar" : "+ añadir"}
        </button>
      </div>
      {error && <p className="mb-2 text-[12px] text-red-300">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-[13px] text-slate-500">Sin contactos todavía.</p>
      ) : (
        <ul className="space-y-2 text-[13px]">
          {rows.map((c) => (
            <li key={c.id} className={`border-b border-slate-700/40 pb-1.5 ${c.active ? "" : "opacity-50"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-100">{[c.name, c.surname].filter(Boolean).join(" ")}</span>
                {c.isPrimary && <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 text-[10px] font-bold text-sky-300">Principal</span>}
                {USOS.filter(([k]) => (c as any)[k]).map(([k, etiqueta]) => (
                  <span key={k} className="rounded border border-slate-600 px-1.5 text-[10px] text-slate-400">{etiqueta}</span>
                ))}
                {c.role && <span className="text-slate-500">{c.role}</span>}
              </div>
              <div className="text-slate-400">{[c.phone, c.mobile, c.email].filter(Boolean).join(" · ") || "—"}</div>
              <div className="mt-0.5 flex gap-3 text-[11px]">
                {!c.isPrimary && c.active && (
                  <button disabled={busy} onClick={() => void editar(c.id, { isPrimary: true })}
                    className="text-slate-500 hover:text-orange-400">hacer principal</button>
                )}
                <button disabled={busy} onClick={() => void editar(c.id, { active: !c.active })}
                  className="text-slate-500 hover:text-orange-400">
                  {c.active ? "desactivar" : "reactivar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {abrirAlta && (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {input(nuevo.name, (v) => setNuevo({ ...nuevo, name: v }), "Nombre *")}
            {input(nuevo.surname, (v) => setNuevo({ ...nuevo, surname: v }), "Apellidos")}
            {input(nuevo.role, (v) => setNuevo({ ...nuevo, role: v }), "Cargo")}
            {input(nuevo.phone, (v) => setNuevo({ ...nuevo, phone: v }), "Teléfono")}
            {input(nuevo.mobile, (v) => setNuevo({ ...nuevo, mobile: v }), "Móvil")}
            {input(nuevo.email, (v) => setNuevo({ ...nuevo, email: v }), "Email")}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-slate-300">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={nuevo.isPrimary}
                onChange={(e) => setNuevo({ ...nuevo, isPrimary: e.target.checked })} />
              Principal
            </label>
            {USOS.map(([c, etiqueta]) => (
              <label key={c} className="flex items-center gap-1.5">
                <input type="checkbox" checked={Boolean(nuevo[c])}
                  onChange={(e) => setNuevo({ ...nuevo, [c]: e.target.checked })} />
                {etiqueta}
              </label>
            ))}
            <button onClick={() => void añadir()} disabled={busy || !nuevo.name.trim()}
              className="rounded bg-orange-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              Añadir contacto
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
