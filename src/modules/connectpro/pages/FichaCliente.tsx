/**
 * Connect Pro — Ficha de cliente.
 *
 * El listado de clientes servía para lo operativo (SLA y prioridad), pero para
 * facturar hace falta el resto: datos fiscales y cómo se le factura. Sigue el
 * mismo patrón que la ficha de proveedor: campos editables sueltos o la ficha
 * entera de una vez.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Badge, Button, ErrorBanner } from "../components/ui";
import { Campo } from "../components/CampoFicha";
import type { Client } from "./Clientes";

type Contacto = {
  id: number; name: string; surname: string | null; role: string | null;
  phone: string | null; mobile: string | null; email: string | null;
  isPrimary: boolean; active: boolean;
};

type Ficha = { client: Client; contacts: Contacto[] };

/** Campos que se editan como texto cuando se abre la ficha entera. */
const CAMPOS_FICHA = [
  "legalName", "commercialName", "taxId", "address", "postalCode", "city",
  "province", "country", "currency", "paymentMethod", "paymentTerms",
  "billingPeriodicity", "costCenter", "project", "billingSeries", "taxConfig",
  "billingNotes", "notes",
] as const;

export default function FichaCliente() {
  const { id } = useParams();
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<Ficha>(`/clients/${id}`).then(setF).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await boFetch(`/clients/${id}`, { method: "PATCH", body });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const guardarFicha = async () => {
    if (!edicion) return;
    await patch(edicion);
    setEdicion(null);
  };

  if (!f) return <div className="text-sm text-slate-400">Cargando ficha…</div>;
  const c = f.client as any;

  return (
    <div>
      <PageTitle
        title={c.commercialName || c.name}
        subtitle={<Link className="text-cyan-300 hover:underline" to="/connect/clientes">← Clientes</Link>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="mb-3 flex items-center gap-2">
        <Badge className={c.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-500"}>
          {c.active ? "Activo" : "Inactivo"}
        </Badge>
        {canEdit && (edicion === null ? (
          <Button variant="ghost" onClick={() => setEdicion(Object.fromEntries(
            CAMPOS_FICHA.map((campo) => [campo, String(c[campo] ?? "")])))}>
            ✎ Editar ficha
          </Button>
        ) : (
          <>
            <Button disabled={busy} onClick={guardarFicha}>Guardar cambios</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEdicion(null)}>Cancelar</Button>
          </>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-cyan-300">Datos fiscales</h3>
          <Campo label="Razón social" value={c.legalName} canEdit={canEdit} edicion={edicion} campo="legalName" onEdit={setEdicion} onSave={(v) => patch({ legalName: v })} />
          <Campo label="Nombre comercial" value={c.commercialName} canEdit={canEdit} edicion={edicion} campo="commercialName" onEdit={setEdicion} onSave={(v) => patch({ commercialName: v })} />
          <Campo label="CIF / NIF / VAT" value={c.taxId} canEdit={canEdit} edicion={edicion} campo="taxId" onEdit={setEdicion} onSave={(v) => patch({ taxId: v })} />
          <Campo label="Dirección fiscal" value={c.address} canEdit={canEdit} edicion={edicion} campo="address" onEdit={setEdicion} onSave={(v) => patch({ address: v })} />
          <Campo label="Código postal" value={c.postalCode} canEdit={canEdit} edicion={edicion} campo="postalCode" onEdit={setEdicion} onSave={(v) => patch({ postalCode: v })} />
          <Campo label="Población" value={c.city} canEdit={canEdit} edicion={edicion} campo="city" onEdit={setEdicion} onSave={(v) => patch({ city: v })} />
          <Campo label="Provincia" value={c.province} canEdit={canEdit} edicion={edicion} campo="province" onEdit={setEdicion} onSave={(v) => patch({ province: v })} />
          <Campo label="País" value={c.country} canEdit={canEdit} edicion={edicion} campo="country" onEdit={setEdicion} onSave={(v) => patch({ country: v })} />
          <Campo label="Moneda" value={c.currency} canEdit={canEdit} edicion={edicion} campo="currency" onEdit={setEdicion} onSave={(v) => patch({ currency: v })} placeholder="EUR" />
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-cyan-300">Facturación</h3>
          <Campo label="Forma de pago" value={c.paymentMethod} canEdit={canEdit} edicion={edicion} campo="paymentMethod" onEdit={setEdicion} onSave={(v) => patch({ paymentMethod: v })} placeholder="P. ej. transferencia" />
          <Campo label="Condiciones de pago" value={c.paymentTerms} canEdit={canEdit} edicion={edicion} campo="paymentTerms" onEdit={setEdicion} onSave={(v) => patch({ paymentTerms: v })} placeholder="P. ej. 60 días" />
          <Campo label="Periodicidad" value={c.billingPeriodicity} canEdit={canEdit} edicion={edicion} campo="billingPeriodicity" onEdit={setEdicion} onSave={(v) => patch({ billingPeriodicity: v })} placeholder="mensual, quincenal…" />
          <Campo label="Centro de coste" value={c.costCenter} canEdit={canEdit} edicion={edicion} campo="costCenter" onEdit={setEdicion} onSave={(v) => patch({ costCenter: v })} />
          <Campo label="Proyecto" value={c.project} canEdit={canEdit} edicion={edicion} campo="project" onEdit={setEdicion} onSave={(v) => patch({ project: v })} />
          <Campo label="Serie de facturación" value={c.billingSeries} canEdit={canEdit} edicion={edicion} campo="billingSeries" onEdit={setEdicion} onSave={(v) => patch({ billingSeries: v })} />
          <Campo label="Config. fiscal / IVA" value={c.taxConfig} canEdit={canEdit} edicion={edicion} campo="taxConfig" onEdit={setEdicion} onSave={(v) => patch({ taxConfig: v })} />
          <Campo label="Observaciones" value={c.billingNotes} canEdit={canEdit} edicion={edicion} campo="billingNotes" onEdit={setEdicion} onSave={(v) => patch({ billingNotes: v })} />

          {/* Interruptores: se guardan al momento, no esperan al botón de la
              ficha, porque son de sí/no y no hay nada que redactar. */}
          <div className="mt-3 flex flex-col gap-2 border-t border-slate-700/40 pt-3 text-[13px]">
            <label className="flex items-center gap-2 text-slate-200">
              <input type="checkbox" disabled={!canEdit || busy} checked={c.billingGrouped === true}
                onChange={(e) => patch({ billingGrouped: e.target.checked })} />
              Factura agrupada (una factura por periodo, no por servicio)
            </label>
            <label className="flex items-center gap-2 text-slate-200">
              <input type="checkbox" disabled={!canEdit || busy} checked={c.referenceRequired === true}
                onChange={(e) => patch({ referenceRequired: e.target.checked })} />
              Referencia obligatoria
            </label>
            <label className="flex items-center gap-2 text-slate-200">
              <input type="checkbox" disabled={!canEdit || busy} checked={c.purchaseOrderRequired === true}
                onChange={(e) => patch({ purchaseOrderRequired: e.target.checked })} />
              Nº de pedido obligatorio
            </label>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-cyan-300">Operativa</h3>
          <Campo label="Email de contacto" value={c.contactEmail} canEdit={canEdit} onSave={(v) => patch({ contactEmail: v })} />
          <Campo label="Teléfono" value={c.contactPhone} canEdit={canEdit} onSave={(v) => patch({ contactPhone: v })} />
          <Campo label="Notas" value={c.notes} canEdit={canEdit} edicion={edicion} campo="notes" onEdit={setEdicion} onSave={(v) => patch({ notes: v })} />
          <div className="mt-2 text-[12px] text-slate-500">
            SLA por defecto: {c.defaultSlaMinutes ? `${c.defaultSlaMinutes} min` : "—"} ·
            Prioridad: {c.defaultPriority === "urgente" ? "urgente" : "normal"}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-cyan-300">Contactos</h3>
          {f.contacts.length === 0 ? (
            <p className="text-[13px] text-slate-500">
              Sin contactos. Se podrán añadir desde aquí cuando esté la gestión de
              contactos compartida entre proveedor, taller y cliente.
            </p>
          ) : (
            <ul className="space-y-2 text-[13px]">
              {f.contacts.map((k) => (
                <li key={k.id} className="border-b border-slate-700/40 pb-1.5">
                  <span className="font-semibold text-slate-100">{[k.name, k.surname].filter(Boolean).join(" ")}</span>
                  {k.isPrimary && <Badge className="ml-2 border-cyan-500/40 bg-cyan-500/10 text-cyan-300">Principal</Badge>}
                  {k.role && <span className="ml-2 text-slate-500">{k.role}</span>}
                  <div className="text-slate-400">
                    {[k.phone, k.mobile, k.email].filter(Boolean).join(" · ") || "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
