/**
 * Selector de subcontratación para la asistencia: proveedor → taller → contacto.
 *
 * Sustituye a escribir el taller a mano. Escribirlo suelto significaba que el
 * mismo taller aparecía de cuatro maneras y que, para llamar, había que
 * buscar el teléfono en otro sitio.
 *
 * Solo ofrece talleres ACTIVOS: mandar trabajo a uno dado de baja es lo que la
 * ficha intenta evitar. Los históricos no se tocan — una asistencia antigua
 * sigue enseñando el suyo aunque hoy esté inactivo.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

export type Subcontrata = {
  proveedorId: number | null;
  proveedorTallerId: number | null;
  proveedorContactoId: number | null;
  clienteFacturacionId: number | null;
};

export const SUBCONTRATA_VACIA: Subcontrata = {
  proveedorId: null, proveedorTallerId: null,
  proveedorContactoId: null, clienteFacturacionId: null,
};

type Proveedor = { id: number; name: string; taxId: string | null; city: string | null; status: string };
type Taller = {
  id: number; name: string; city: string | null; phone: string | null;
  emergencyPhone: string | null; email: string | null; assistanceEmail: string | null;
  open24h: boolean; active: boolean;
};
type Contacto = {
  id: number; name: string; surname: string | null; role: string | null;
  phone: string | null; mobile: string | null; email: string | null; active: boolean;
};
type Cliente = { id: number; name: string; taxId: string | null };

async function pedir(ruta: string) {
  const res = await fetch(`${API_BASE}${ruta}`, { headers: getAdminHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Error de servidor");
  return data;
}

const selectCls =
  "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500 disabled:opacity-50";

export default function SelectorSubcontrata({ valor, onChange }: {
  valor: Subcontrata;
  onChange: (s: Subcontrata) => void;
}) {
  const [q, setQ] = useState("");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [talleres, setTalleres] = useState<Taller[]>([]);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [error, setError] = useState("");

  // La búsqueda la resuelve el servidor; se espera a dejar de teclear.
  useEffect(() => {
    const t = setTimeout(() => {
      pedir(`/api/proveedores?q=${encodeURIComponent(q)}`)
        .then((d) => setProveedores(d.data))
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    pedir("/api/clientes-facturacion").then((d) => setClientes(d.data)).catch(() => { /* opcional */ });
  }, []);

  const cargarTalleres = useCallback((proveedorId: number) => {
    pedir(`/api/proveedores/${proveedorId}/talleres?soloActivos=true`)
      .then((d) => setTalleres(d.data))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (valor.proveedorId) cargarTalleres(valor.proveedorId);
    else setTalleres([]);
  }, [valor.proveedorId, cargarTalleres]);

  useEffect(() => {
    if (!valor.proveedorTallerId) { setContactos([]); return; }
    pedir(`/api/contactos?ownerType=workshop&ownerId=${valor.proveedorTallerId}`)
      .then((d) => setContactos(d.data.filter((c: Contacto) => c.active)))
      .catch((e) => setError(e.message));
  }, [valor.proveedorTallerId]);

  const taller = talleres.find((t) => t.id === valor.proveedorTallerId);
  const contacto = contactos.find((c) => c.id === valor.proveedorContactoId);

  return (
    <div className="space-y-2">
      {error && <p className="text-[12px] text-red-300">{error}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar proveedor: nombre, CIF, población, teléfono…"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
        />
        <select
          value={valor.proveedorId ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            // Cambiar de proveedor invalida taller y contacto: son suyos.
            onChange({ ...valor, proveedorId: id, proveedorTallerId: null, proveedorContactoId: null });
          }}
          className={selectCls}
        >
          <option value="">— Proveedor —</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.taxId ? ` · ${p.taxId}` : ""}{p.city ? ` · ${p.city}` : ""}
              {p.status !== "active" ? " (suspendido)" : ""}
            </option>
          ))}
        </select>

        <select
          value={valor.proveedorTallerId ?? ""}
          disabled={!valor.proveedorId}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onChange({ ...valor, proveedorTallerId: id, proveedorContactoId: null });
          }}
          className={selectCls}
        >
          <option value="">{valor.proveedorId ? "— Taller / centro —" : "Elige antes un proveedor"}</option>
          {talleres.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.city ? ` · ${t.city}` : ""}{t.open24h ? " · 24 h" : ""}
            </option>
          ))}
        </select>

        <select
          value={valor.proveedorContactoId ?? ""}
          disabled={!valor.proveedorTallerId}
          onChange={(e) => onChange({ ...valor, proveedorContactoId: e.target.value ? Number(e.target.value) : null })}
          className={selectCls}
        >
          <option value="">
            {valor.proveedorTallerId
              ? (contactos.length ? "— Contacto —" : "Este taller no tiene contactos")
              : "Elige antes un taller"}
          </option>
          {contactos.map((c) => (
            <option key={c.id} value={c.id}>
              {[c.name, c.surname].filter(Boolean).join(" ")}{c.role ? ` · ${c.role}` : ""}
            </option>
          ))}
        </select>

        <select
          value={valor.clienteFacturacionId ?? ""}
          onChange={(e) => onChange({ ...valor, clienteFacturacionId: e.target.value ? Number(e.target.value) : null })}
          className={selectCls}
          title="Solo si se factura a alguien distinto de quien solicita el servicio"
        >
          <option value="">— Se factura al mismo que solicita —</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.taxId ? ` · ${c.taxId}` : ""}</option>
          ))}
        </select>
      </div>

      {/* Lo que hace falta para llamar, sin salir de la pantalla. */}
      {taller && (
        <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-[13px]">
          <div className="font-semibold text-slate-100">
            {taller.name}
            {taller.open24h && (
              <span className="ml-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] font-bold text-emerald-300">24 h</span>
            )}
          </div>
          <div className="text-slate-400">
            {[
              taller.phone && `Tel. ${taller.phone}`,
              taller.emergencyPhone && `Urgencias ${taller.emergencyPhone}`,
              taller.assistanceEmail || taller.email,
            ].filter(Boolean).join(" · ") || "Sin datos de contacto"}
          </div>
          {contacto && (
            <div className="text-sky-300">
              {[contacto.name, contacto.surname].filter(Boolean).join(" ")}
              {contacto.phone || contacto.mobile ? ` · ${contacto.phone ?? contacto.mobile}` : ""}
              {contacto.email ? ` · ${contacto.email}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Guarda la subcontratación de una asistencia ya creada. */
export async function guardarSubcontrata(assistanceId: number, s: Subcontrata) {
  const res = await fetch(`${API_BASE}/api/roadside-assistances/${assistanceId}/subcontrata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getAdminHeaders() },
    body: JSON.stringify(s),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(d?.error ?? "No se pudo guardar la subcontratación");
  }
  return res.json();
}
