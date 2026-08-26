/**
 * Connect Pro — Ficha de empresa de asistencia: datos fiscales y de contacto
 * editables, autorización y tarifas, resumen operativo, talleres (con alta),
 * unidades y KPIs. Ruta: /connect/empresas/:id
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState, KpiCard } from "../components/ui";
import TablaUnidades from "../components/TablaUnidades";
import BotonCoordenadas from "../components/BotonCoordenadas";
import TarjetaOperario, { type Operator } from "../components/TarjetaOperario";
import ImportarTallerWhatsApp, { CAMPOS_IMPORTABLES, type ImportacionConfirmada } from "../components/ImportarTallerWhatsApp";
import {
  WORKSHOP_TIER, WORKSHOP_TIER_LABELS, WORKSHOP_TIER_STYLES, fmtDateTime,
  type Authorization, type WorkshopIntegrationType,
} from "../types";

type Provider = {
  id: number; name: string; legalName: string | null; taxId: string | null;
  address: string | null; city: string | null; postalCode: string | null; province: string | null;
  web: string | null; billingEmail: string | null;
  contactEmail: string | null; contactPhone: string | null;
  status: string; notes: string | null; createdAtMs: number;
};

type WorkshopRow = {
  id: number; name: string; phone: string | null; integrationType: WorkshopIntegrationType;
  networkParticipation: boolean; radiusKm: number; currentScore: number; liteCode: string | null;
  units: number; liteUsers: number; activeAssistances: number;
  latitude: number; longitude: number;
};

type Ficha = {
  provider: Provider;
  authorization: (Authorization & { requiresAcceptance?: boolean; acceptTimeoutMin?: number }) | null;
  workshops: WorkshopRow[];
  summary: {
    units: { total: number; available: number; offline: number };
    last30d: { services: number; finished: number };
    billingMonth: { services: number; amount: number; invoiced: number };
    openIncidents: number;
    avgScore: number | null;
  };
};

const TIERS: WorkshopIntegrationType[] = ["assist", "lite", "external"];

const TALLER_VACIO = {
  name: "", latitude: "", longitude: "", radiusKm: "60", phone: "", integrationType: "assist",
  commercialNetwork: "", address: "", postalCode: "", city: "", province: "", email: "",
  openingHours: "", services: "", notes: "",
};
const TABS = ["Resumen", "Talleres", "Operarios", "Unidades"] as const;

/**
 * Campo de la ficha. Se puede tocar de dos maneras y las dos conviven:
 * suelto —"editar" al lado, para corregir un dato— o dentro de la edición de
 * la ficha entera, cuando `edicion` trae el borrador de todos los campos.
 */
function Campo({ label, value, onSave, canEdit, placeholder, edicion, campo, onEdit }: {
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

export default function FichaEmpresa() {
  const { id } = useParams();
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");

  const [f, setF] = useState<Ficha | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Resumen");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nuevoTaller, setNuevoTaller] = useState(TALLER_VACIO);
  // Operarios de todos los talleres de la empresa, agrupados por taller
  const [operarios, setOperarios] = useState<Record<number, Operator[]> | null>(null);

  const load = useCallback(() => {
    boFetch<Ficha>(`/providers/${id}`).then(setF).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  // Los operarios se cargan al abrir la pestaña, taller a taller
  useEffect(() => {
    if (tab !== "Operarios" || !f || operarios) return;
    Promise.all(
      f.workshops.map((w) =>
        boFetch<{ data: Operator[] }>(`/workshops/${w.id}/operators`)
          .then((r) => [w.id, r.data] as const)
          .catch(() => [w.id, [] as Operator[]] as const),
      ),
    ).then((pares) => setOperarios(Object.fromEntries(pares)));
  }, [tab, f, operarios]);

  /*
   * Editar la ficha entera de una vez.
   *
   * Los campos se pueden tocar uno a uno, pero dar de alta una empresa son
   * once datos seguidos y hacerlo de uno en uno son once idas y venidas al
   * servidor. Con el boton se abren todos, se rellenan y se guardan en una
   * sola escritura, que ademas deja UNA linea en la auditoria en vez de once.
   */
  const [edicion, setEdicion] = useState<Record<string, string> | null>(null);

  const CAMPOS_FICHA = [
    "legalName", "taxId", "address", "city", "postalCode", "province",
    "contactPhone", "contactEmail", "billingEmail", "web", "notes",
  ] as const;

  const abrirEdicion = () => {
    const prov = f?.provider as any;
    setEdicion(Object.fromEntries(CAMPOS_FICHA.map((c) => [c, prov?.[c] ?? ""])));
  };

  const guardarFicha = async () => {
    if (!edicion) return;
    setBusy(true); setError(null);
    try {
      await boFetch(`/providers/${id}`, { method: "PATCH", body: edicion });
      setEdicion(null);
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const patch = async (body: Record<string, unknown>) => {
    try { await boFetch(`/providers/${id}`, { method: "PATCH", body }); load(); }
    catch (e: any) { setError(e.message); }
  };

  const autorizar = async () => {
    setBusy(true);
    try { await boFetch("/authorizations", { method: "POST", body: { providerCompanyId: Number(id) } }); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const crearTaller = async () => {
    const lat = Number(nuevoTaller.latitude), lng = Number(nuevoTaller.longitude);
    if (!nuevoTaller.name.trim() || Number.isNaN(lat) || Number.isNaN(lng)) {
      setError("Nombre, latitud y longitud del taller son obligatorios.");
      return;
    }
    setBusy(true);
    try {
      await boFetch("/workshops", {
        method: "POST",
        body: {
          name: nuevoTaller.name.trim(), latitude: lat, longitude: lng,
          radiusKm: Number(nuevoTaller.radiusKm) || 60, phone: nuevoTaller.phone || null,
          providerCompanyId: Number(id), integrationType: nuevoTaller.integrationType,
          services: nuevoTaller.services.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean),
          commercialNetwork: nuevoTaller.commercialNetwork.trim() || null,
          address: nuevoTaller.address.trim() || null,
          postalCode: nuevoTaller.postalCode.trim() || null,
          city: nuevoTaller.city.trim() || null,
          province: nuevoTaller.province.trim() || null,
          email: nuevoTaller.email.trim() || null,
          openingHours: nuevoTaller.openingHours.trim() || null,
          notes: nuevoTaller.notes.trim() || null,
        },
      });
      setNuevoTaller(TALLER_VACIO);
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  /** La empresa ya la sabemos: solo entran los campos del taller. */
  const aplicarImportacion = (r: ImportacionConfirmada) => {
    setNuevoTaller((t) => {
      const siguiente = { ...t };
      for (const { key } of CAMPOS_IMPORTABLES) {
        const v = r.campos[key];
        if (v != null) siguiente[key] = v;
      }
      if (r.observaciones) siguiente.notes = [siguiente.notes, r.observaciones].filter(Boolean).join("\n");
      return siguiente;
    });
  };

  if (!f) return <p className="text-sm text-slate-500">{error ?? "Cargando…"}</p>;
  const p = f.provider;
  const s = f.summary;

  return (
    <div>
      <PageTitle
        title={p.name}
        subtitle={
          <span>
            <Link className="text-cyan-300 hover:underline" to="/connect/empresas">← Empresas de asistencia</Link>
            {" · "}
            <Badge className={p.status === "active" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}>
              {p.status === "active" ? "Activa" : "Suspendida"}
            </Badge>
            {" "}
            {f.authorization?.status === "active"
              ? <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Autorizada</Badge>
              : <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-300">Sin autorización</Badge>}
            <span className="ml-2 text-[12px] text-slate-500">Alta: {fmtDateTime(p.createdAtMs)}</span>
          </span>
        }
        actions={
          canEdit && (
            <div className="flex gap-2">
              {!f.authorization && <Button onClick={autorizar} disabled={busy}>Autorizar</Button>}
              <Button
                variant={p.status === "active" ? "danger" : "primary"}
                disabled={busy}
                onClick={() => patch({ status: p.status === "active" ? "suspended" : "active" })}
              >
                {p.status === "active" ? "Suspender" : "Reactivar"}
              </Button>
            </div>
          )
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {/* Resumen operativo siempre visible */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Talleres" value={f.workshops.length} />
        <KpiCard label="Unidades" value={s.units.total} />
        <KpiCard label="Disponibles" value={s.units.available} tone={s.units.available > 0 ? "ok" : "warn"} />
        <KpiCard label="Servicios 30 d" value={s.last30d.services} />
        <KpiCard label="Facturación mes" value={`${Number(s.billingMonth.amount).toFixed(0)} €`} />
        <KpiCard label="Incidencias abiertas" value={s.openIncidents} tone={s.openIncidents > 0 ? "warn" : "ok"} />
        <KpiCard label="Score medio" value={s.avgScore != null ? `${s.avgScore}/100` : "—"} />
      </div>

      <div className="mb-3 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${tab === t ? "bg-cyan-600/20 text-cyan-300" : "text-slate-400 hover:bg-slate-800"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Resumen" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {canEdit && (
            <div className="flex items-center gap-2 lg:col-span-2">
              {edicion === null ? (
                <Button variant="ghost" onClick={abrirEdicion}>✎ Editar ficha</Button>
              ) : (
                <>
                  <Button disabled={busy} onClick={guardarFicha}>Guardar cambios</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setEdicion(null)}>Cancelar</Button>
                  <span className="text-[12px] text-slate-500">
                    Se guarda todo de una vez; lo que dejes en blanco se borra.
                  </span>
                </>
              )}
            </div>
          )}
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-cyan-300">Datos fiscales</h3>
            <Campo label="Razón social" value={p.legalName} canEdit={canEdit} edicion={edicion} campo="legalName" onEdit={setEdicion} onSave={(v) => patch({ legalName: v })} />
            <Campo label="CIF / NIF" value={p.taxId} canEdit={canEdit} edicion={edicion} campo="taxId" onEdit={setEdicion} onSave={(v) => patch({ taxId: v })} />
            <Campo label="Dirección" value={p.address} canEdit={canEdit} edicion={edicion} campo="address" onEdit={setEdicion} onSave={(v) => patch({ address: v })} />
            <Campo label="Población" value={p.city} canEdit={canEdit} edicion={edicion} campo="city" onEdit={setEdicion} onSave={(v) => patch({ city: v })} />
            <Campo label="Código postal" value={p.postalCode} canEdit={canEdit} edicion={edicion} campo="postalCode" onEdit={setEdicion} onSave={(v) => patch({ postalCode: v })} />
            <Campo label="Provincia" value={p.province} canEdit={canEdit} edicion={edicion} campo="province" onEdit={setEdicion} onSave={(v) => patch({ province: v })} />
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-cyan-300">Contacto y facturación</h3>
            <Campo label="Teléfono" value={p.contactPhone} canEdit={canEdit} edicion={edicion} campo="contactPhone" onEdit={setEdicion} onSave={(v) => patch({ contactPhone: v })} />
            <Campo label="Email" value={p.contactEmail} canEdit={canEdit} edicion={edicion} campo="contactEmail" onEdit={setEdicion} onSave={(v) => patch({ contactEmail: v })} />
            <Campo label="Email de facturación" value={p.billingEmail} canEdit={canEdit} edicion={edicion} campo="billingEmail" onEdit={setEdicion} onSave={(v) => patch({ billingEmail: v })} />
            <Campo label="Web" value={p.web} canEdit={canEdit} edicion={edicion} campo="web" onEdit={setEdicion} onSave={(v) => patch({ web: v })} />
            <Campo label="Notas" value={p.notes} canEdit={canEdit} edicion={edicion} campo="notes" onEdit={setEdicion} onSave={(v) => patch({ notes: v })} />
            {p.contactPhone && (
              <a href={`tel:${p.contactPhone}`} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[14px] font-bold text-white hover:bg-emerald-500">
                📞 Llamar a la empresa
              </a>
            )}
          </Card>
          <Card className="p-4 lg:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-cyan-300">Autorización y SLA</h3>
            {!f.authorization ? (
              <p className="text-[13px] text-slate-400">
                Sin autorización: la empresa no puede recibir asistencias.
                {canEdit && " Usa el botón Autorizar de arriba."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-[13px] text-slate-300">
                <span>Estado: <b>{f.authorization.status}</b></span>
                <span>SLA aceptación: <b>{f.authorization.slaAcceptMin ?? "—"} min</b></span>
                <span>SLA llegada: <b>{f.authorization.slaArrivalMin ?? "—"} min</b></span>
                <span>Requiere aceptación: <b>{f.authorization.requiresAcceptance ? `Sí (${f.authorization.acceptTimeoutMin} min)` : "No"}</b></span>
                <span>Preferente: <b>{f.authorization.preferred ? "Sí" : "No"}</b></span>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "Talleres" && (
        <div className="flex flex-col gap-4">
          {canEdit && (
            <Card className="p-4">
              <h3 className="mb-2 text-[13px] font-semibold text-slate-300">Añadir taller a {p.name}</h3>
              <ImportarTallerWhatsApp
                empresaFijada
                valoresActuales={Object.fromEntries(
                  CAMPOS_IMPORTABLES.map(({ key }) => [key, nuevoTaller[key] === TALLER_VACIO[key] ? "" : nuevoTaller[key]]),
                )}
                onImportar={aplicarImportacion}
              />
              <div className="flex flex-wrap gap-2">
                <Input placeholder="Nombre *" value={nuevoTaller.name} onChange={(e) => setNuevoTaller({ ...nuevoTaller, name: e.target.value })} className="w-48" />
                <Input placeholder="Latitud *" value={nuevoTaller.latitude} onChange={(e) => setNuevoTaller({ ...nuevoTaller, latitude: e.target.value })} className="w-28" />
                <Input placeholder="Longitud *" value={nuevoTaller.longitude} onChange={(e) => setNuevoTaller({ ...nuevoTaller, longitude: e.target.value })} className="w-28" />
                <Input placeholder="Radio km" value={nuevoTaller.radiusKm} onChange={(e) => setNuevoTaller({ ...nuevoTaller, radiusKm: e.target.value })} className="w-24" />
                <Input placeholder="Teléfono" value={nuevoTaller.phone} onChange={(e) => setNuevoTaller({ ...nuevoTaller, phone: e.target.value })} className="w-36" />
                <Select value={nuevoTaller.integrationType} onChange={(e) => setNuevoTaller({ ...nuevoTaller, integrationType: e.target.value })}>
                  {TIERS.map((t) => <option key={t} value={t}>{WORKSHOP_TIER_LABELS[t]}</option>)}
                </Select>
                <BotonCoordenadas
                  direccion={{
                    address: nuevoTaller.address, postalCode: nuevoTaller.postalCode,
                    city: nuevoTaller.city, province: nuevoTaller.province,
                  }}
                  onEncontrado={(p) => setNuevoTaller({
                    ...nuevoTaller, latitude: String(p.lat), longitude: String(p.lng),
                  })}
                  onError={setError}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Input placeholder="Red comercial (Confortauto…)" value={nuevoTaller.commercialNetwork} onChange={(e) => setNuevoTaller({ ...nuevoTaller, commercialNetwork: e.target.value })} className="w-44" />
                <Input placeholder="Dirección" value={nuevoTaller.address} onChange={(e) => setNuevoTaller({ ...nuevoTaller, address: e.target.value })} className="w-72" />
                <Input placeholder="CP" value={nuevoTaller.postalCode} onChange={(e) => setNuevoTaller({ ...nuevoTaller, postalCode: e.target.value })} className="w-20" />
                <Input placeholder="Municipio" value={nuevoTaller.city} onChange={(e) => setNuevoTaller({ ...nuevoTaller, city: e.target.value })} className="w-40" />
                <Input placeholder="Provincia" value={nuevoTaller.province} onChange={(e) => setNuevoTaller({ ...nuevoTaller, province: e.target.value })} className="w-36" />
                <Input placeholder="Email" value={nuevoTaller.email} onChange={(e) => setNuevoTaller({ ...nuevoTaller, email: e.target.value })} className="w-56" />
                <Input placeholder="Horario" value={nuevoTaller.openingHours} onChange={(e) => setNuevoTaller({ ...nuevoTaller, openingHours: e.target.value })} className="w-72" />
                <Input placeholder="Servicios (tyres, mechanical…)" value={nuevoTaller.services} onChange={(e) => setNuevoTaller({ ...nuevoTaller, services: e.target.value })} className="w-64" />
              </div>
              {nuevoTaller.notes && (
                <div className="mt-2">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Observaciones internas</div>
                  <textarea
                    value={nuevoTaller.notes}
                    onChange={(e) => setNuevoTaller({ ...nuevoTaller, notes: e.target.value })}
                    rows={Math.min(6, nuevoTaller.notes.split("\n").length + 1)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100"
                  />
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button onClick={crearTaller} disabled={busy}>Añadir</Button>
                <Button variant="ghost" onClick={() => setNuevoTaller(TALLER_VACIO)} disabled={busy}>Vaciar</Button>
              </div>
            </Card>
          )}
          {f.workshops.length === 0 ? (
            <EmptyState message="La empresa no tiene talleres todavía." />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-slate-700">
                  <Th>Taller</Th><Th>Producto</Th><Th>Red</Th><Th>Operativa</Th><Th>Teléfono</Th><Th>Score</Th><Th></Th>
                </tr></thead>
                <tbody>
                  {f.workshops.map((w) => (
                    <tr key={w.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      <Td className="font-semibold text-slate-100">
                        <Link className="hover:text-cyan-300" to={`/connect/empresas/${id}/talleres/${w.id}`}>{w.name}</Link>
                        {w.liteCode && <div className="font-mono text-[11px] font-normal text-violet-300">{w.liteCode}</div>}
                      </Td>
                      <Td>
                        <Badge className={WORKSHOP_TIER_STYLES[w.integrationType]}>
                          {WORKSHOP_TIER[w.integrationType]} · {WORKSHOP_TIER_LABELS[w.integrationType]}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge className={w.networkParticipation ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}>
                          {w.networkParticipation ? "Adherido" : "No adherido"}
                        </Badge>
                      </Td>
                      <Td className="text-[12px] text-slate-400">
                        {w.integrationType === "lite"
                          ? `${w.liteUsers} operario${w.liteUsers !== 1 ? "s" : ""} app`
                          : `${w.units} unidad${w.units !== 1 ? "es" : ""}`}
                        {w.activeAssistances > 0 && <span className="ml-2 text-cyan-300">{w.activeAssistances} en curso</span>}
                      </Td>
                      <Td>{w.phone ? <a className="text-cyan-300 hover:underline" href={`tel:${w.phone}`}>{w.phone}</a> : "-"}</Td>
                      <Td>{Math.round(w.currentScore)}/100</Td>
                      <Td>
                        <Link className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-slate-700" to={`/connect/empresas/${id}/talleres/${w.id}`}>
                          Abrir ficha →
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {tab === "Operarios" && (
        !operarios ? <p className="text-sm text-slate-500">Cargando operarios…</p> : (
          <div className="flex flex-col gap-5">
            {f.workshops.map((w) => {
              const ops = operarios[w.id] ?? [];
              return (
                <div key={w.id}>
                  <h3 className="mb-2 text-[13px] font-semibold text-slate-300">
                    <Link className="hover:text-cyan-300" to={`/connect/empresas/${id}/talleres/${w.id}`}>{w.name}</Link>
                    <span className="ml-2 font-normal text-slate-500">
                      {ops.length} operario{ops.length !== 1 ? "s" : ""}
                    </span>
                  </h3>
                  {ops.length === 0 ? (
                    <p className="text-[13px] text-slate-500">
                      Sin operarios ni contactos.{" "}
                      <Link className="text-cyan-300 hover:underline" to={`/connect/empresas/${id}/talleres/${w.id}`}>
                        Añadir desde la ficha del taller →
                      </Link>
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {ops.map((op) => <TarjetaOperario key={`${w.id}-${op.source}-${op.id}`} op={op} />)}
                    </div>
                  )}
                </div>
              );
            })}
            {f.workshops.length === 0 && <EmptyState message="La empresa no tiene talleres todavía." />}
          </div>
        )
      )}

      {tab === "Unidades" && (
        <div className="flex flex-col gap-4">
          {f.workshops.filter((w) => w.integrationType !== "lite").map((w) => (
            <div key={w.id}>
              <h3 className="mb-2 text-[13px] font-semibold text-slate-300">
                <Link className="hover:text-cyan-300" to={`/connect/empresas/${id}/talleres/${w.id}`}>{w.name}</Link>
              </h3>
              <TablaUnidades
                endpoint={`/workshops/${w.id}/mobile-units`}
                canMove={canEdit}
                workshops={f.workshops.filter((x) => x.integrationType !== "lite").map((x) => ({ id: x.id, name: x.name }))}
              />
            </div>
          ))}
          {f.workshops.every((w) => w.integrationType === "lite") && (
            <EmptyState message="Todos los talleres de esta empresa son Lite: sus posiciones salen del móvil de los operarios." />
          )}
        </div>
      )}

    </div>
  );
}
