/**
 * Selector en cascada de proveedor → taller → contacto.
 *
 * Sustituye a escribir el nombre del taller a mano en la asistencia. Escribir
 * texto libre significaba que el mismo taller aparecía de cuatro maneras y que
 * nadie sabía a qué teléfono llamar; eligiéndolo de la ficha, la asistencia
 * queda enganchada al proveedor y al centro de verdad.
 *
 * Solo ofrece talleres ACTIVOS: mandar trabajo a uno dado de baja es
 * exactamente lo que la ficha intenta evitar. Los históricos no se tocan.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Input, Select, Badge } from "./ui";
import type { Contacto } from "./ContactosFicha";

export type Proveedor = {
  id: number; name: string; legalName: string | null; taxId: string | null;
  city: string | null; province: string | null; contactPhone: string | null;
  status: string; workshops: number;
};

export type TallerElegible = {
  id: number; name: string; city: string | null; province: string | null;
  phone: string | null; emergencyPhone: string | null;
  assistanceEmail: string | null; email: string | null;
  open24h: boolean; active: boolean;
};

export type Seleccion = {
  providerCompanyId: number | null;
  workshopId: number | null;
  contactId: number | null;
};

export default function SelectorProveedorTaller({ valor, onChange, disabled }: {
  valor: Seleccion;
  onChange: (s: Seleccion, contexto: { taller?: TallerElegible; contacto?: Contacto }) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [talleres, setTalleres] = useState<TallerElegible[]>([]);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [error, setError] = useState<string | null>(null);

  // La búsqueda la resuelve el servidor: incluye el código del ERP, que en el
  // navegador no tenemos. Se espera a que el usuario deje de teclear.
  useEffect(() => {
    const t = setTimeout(() => {
      boFetch<{ data: Proveedor[] }>(`/providers?q=${encodeURIComponent(q)}`)
        .then((r) => setProveedores(r.data))
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const cargarTalleres = useCallback((providerId: number) => {
    boFetch<{ data: TallerElegible[] }>(`/providers/${providerId}/workshops`)
      .then((r) => setTalleres(r.data.filter((t) => t.active !== false)))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (valor.providerCompanyId) cargarTalleres(valor.providerCompanyId);
    else setTalleres([]);
  }, [valor.providerCompanyId, cargarTalleres]);

  useEffect(() => {
    if (!valor.workshopId) { setContactos([]); return; }
    boFetch<{ data: Contacto[] }>(`/contacts?ownerType=workshop&ownerId=${valor.workshopId}`)
      .then((r) => setContactos(r.data.filter((c) => c.active)))
      .catch((e) => setError(e.message));
  }, [valor.workshopId]);

  const taller = talleres.find((t) => t.id === valor.workshopId);
  const contacto = contactos.find((c) => c.id === valor.contactId);

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-[12px] text-red-300">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar proveedor: nombre, CIF, población, teléfono, código ERP…"
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          className="w-80"
        />
        <Select
          value={valor.providerCompanyId ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            // Cambiar de proveedor invalida taller y contacto: son suyos.
            onChange({ providerCompanyId: id, workshopId: null, contactId: null }, {});
          }}
        >
          <option value="">— Proveedor —</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.taxId ? ` · ${p.taxId}` : ""}{p.city ? ` · ${p.city}` : ""}
              {p.status !== "active" ? " (suspendido)" : ""}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={valor.workshopId ?? ""}
          disabled={disabled || !valor.providerCompanyId}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            const t = talleres.find((x) => x.id === id);
            onChange({ ...valor, workshopId: id, contactId: null }, { taller: t });
          }}
        >
          <option value="">
            {valor.providerCompanyId ? "— Taller / centro —" : "Elige antes un proveedor"}
          </option>
          {talleres.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.city ? ` · ${t.city}` : ""}{t.open24h ? " · 24 h" : ""}
            </option>
          ))}
        </Select>

        <Select
          value={valor.contactId ?? ""}
          disabled={disabled || !valor.workshopId}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onChange({ ...valor, contactId: id }, { taller, contacto: contactos.find((c) => c.id === id) });
          }}
        >
          <option value="">
            {valor.workshopId
              ? (contactos.length ? "— Contacto —" : "Este taller no tiene contactos")
              : "Elige antes un taller"}
          </option>
          {contactos.map((c) => (
            <option key={c.id} value={c.id}>
              {[c.name, c.surname].filter(Boolean).join(" ")}{c.role ? ` · ${c.role}` : ""}
            </option>
          ))}
        </Select>
      </div>

      {/* Lo que hay que saber para llamar, sin salir de la pantalla. */}
      {taller && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-100">{taller.name}</span>
            {taller.open24h && <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">24 h</Badge>}
          </div>
          <div className="text-slate-400">
            {[taller.city, taller.province].filter(Boolean).join(", ") || "Sin dirección"}
          </div>
          <div className="text-slate-400">
            {[
              taller.phone && `Tel. ${taller.phone}`,
              taller.emergencyPhone && `Urgencias ${taller.emergencyPhone}`,
              taller.assistanceEmail || taller.email,
            ].filter(Boolean).join(" · ") || "Sin datos de contacto"}
          </div>
          {contacto && (
            <div className="mt-1 text-cyan-300">
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
