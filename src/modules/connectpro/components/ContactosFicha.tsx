/**
 * Contactos de una ficha: taller, proveedor o cliente.
 *
 * Es el mismo bloque para las tres porque los contactos viven en una sola
 * tabla, colgados por ownerType/ownerId. Antes solo los talleres tenían
 * contactos, y de proveedor o cliente se guardaba uno suelto en la ficha;
 * cuando esa persona cambiaba, no había dónde apuntar a la siguiente.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Card, Input, Button, Badge } from "./ui";

export type OwnerContacto = "workshop" | "provider" | "client";

export type Contacto = {
  id: number;
  name: string; surname: string | null; role: string | null;
  phone: string | null; mobile: string | null; email: string | null;
  contactType: string | null;
  isPrimary: boolean; forAssistance: boolean; forAdmin: boolean;
  forBilling: boolean; forEmergency: boolean;
  active: boolean; notes: string | null;
};

const VACIO = {
  name: "", surname: "", role: "", phone: "", mobile: "", email: "",
  isPrimary: false, forAssistance: false, forAdmin: false, forBilling: false, forEmergency: false,
};

/** Para qué sirve cada contacto: lo que decide a quién se avisa de qué. */
const USOS: [keyof typeof VACIO, string][] = [
  ["forAssistance", "Asistencias"],
  ["forAdmin", "Administración"],
  ["forBilling", "Facturación"],
  ["forEmergency", "Urgencias"],
];

export default function ContactosFicha({ ownerType, ownerId, canEdit, titulo }: {
  ownerType: OwnerContacto;
  ownerId: number;
  canEdit: boolean;
  titulo?: string;
}) {
  const [rows, setRows] = useState<Contacto[]>([]);
  const [nuevo, setNuevo] = useState({ ...VACIO });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<{ data: Contacto[] }>(`/contacts?ownerType=${ownerType}&ownerId=${ownerId}`)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message));
  }, [ownerType, ownerId]);
  useEffect(load, [load]);

  const añadir = async () => {
    if (!nuevo.name.trim()) { setError("El nombre del contacto es obligatorio."); return; }
    setBusy(true); setError(null);
    try {
      await boFetch("/contacts", { method: "POST", body: { ...nuevo, ownerType, ownerId } });
      setNuevo({ ...VACIO });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const editar = async (id: number, body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      await boFetch(`/workshop-contacts/${id}`, { method: "PATCH", body });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-cyan-300">{titulo ?? "Contactos"}</h3>
      {error && <p className="mb-2 text-[12px] text-red-300">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-[13px] text-slate-500">Sin contactos todavía.</p>
      ) : (
        <ul className="mb-3 space-y-2 text-[13px]">
          {rows.map((c) => (
            <li key={c.id} className={`border-b border-slate-700/40 pb-2 ${c.active ? "" : "opacity-50"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-100">
                  {[c.name, c.surname].filter(Boolean).join(" ")}
                </span>
                {c.isPrimary && <Badge className="border-cyan-500/40 bg-cyan-500/10 text-cyan-300">Principal</Badge>}
                {USOS.filter(([k]) => (c as any)[k]).map(([k, etiqueta]) => (
                  <Badge key={k} className="border-slate-600 text-slate-400">{etiqueta}</Badge>
                ))}
                {c.role && <span className="text-slate-500">{c.role}</span>}
              </div>
              <div className="text-slate-400">
                {[c.phone, c.mobile, c.email].filter(Boolean).join(" · ") || "—"}
              </div>
              {canEdit && (
                <div className="mt-1 flex gap-3 text-[11px]">
                  {!c.isPrimary && c.active && (
                    <button className="text-slate-500 hover:text-cyan-300" disabled={busy}
                      onClick={() => editar(c.id, { isPrimary: true })}>
                      hacer principal
                    </button>
                  )}
                  <button className="text-slate-500 hover:text-cyan-300" disabled={busy}
                    onClick={() => editar(c.id, { active: !c.active })}>
                    {c.active ? "desactivar" : "reactivar"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="border-t border-slate-700/40 pt-3">
          <h4 className="mb-2 text-[13px] font-semibold text-slate-300">Añadir contacto</h4>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Nombre *" value={nuevo.name} onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })} className="w-40" />
            <Input placeholder="Apellidos" value={nuevo.surname} onChange={(e) => setNuevo({ ...nuevo, surname: e.target.value })} className="w-40" />
            <Input placeholder="Cargo" value={nuevo.role} onChange={(e) => setNuevo({ ...nuevo, role: e.target.value })} className="w-36" />
            <Input placeholder="Teléfono" value={nuevo.phone} onChange={(e) => setNuevo({ ...nuevo, phone: e.target.value })} className="w-32" />
            <Input placeholder="Móvil" value={nuevo.mobile} onChange={(e) => setNuevo({ ...nuevo, mobile: e.target.value })} className="w-32" />
            <Input placeholder="Email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} className="w-56" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-slate-300">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={nuevo.isPrimary}
                onChange={(e) => setNuevo({ ...nuevo, isPrimary: e.target.checked })} />
              Principal
            </label>
            {USOS.map(([campo, etiqueta]) => (
              <label key={campo} className="flex items-center gap-1.5">
                <input type="checkbox" checked={Boolean(nuevo[campo])}
                  onChange={(e) => setNuevo({ ...nuevo, [campo]: e.target.checked })} />
                {etiqueta}
              </label>
            ))}
            <Button disabled={busy || !nuevo.name.trim()} onClick={añadir}>Añadir</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
