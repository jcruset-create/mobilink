/**
 * Connect Pro — Ficha completa de asistencia: cabecera con estado y SLA,
 * pestañas (resumen, solicitante, vehículo, ubicación, timeline) y acciones.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { Card, Badge, Button, ErrorBanner } from "../components/ui";
import AsignacionTab from "../components/AsignacionTab";
import { ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES, fmtDateTime } from "../types";

type Detail = {
  id: number; uuid: string; status: string; priority: string; serviceType: string;
  expedientNumber: string | null; externalReference: string | null; clientName: string | null;
  partnerName: string | null; workshopName: string | null; workshopPhone: string | null;
  providerName: string | null; assignedTechName: string | null; coreStatus: string | null;
  customerName: string; customerPhone: string; requester: string; locationDetails: string;
  address: string; latitude: number | null; longitude: number | null;
  vehicle: string; description: string | null; origin: string; createdByName: string | null;
  slaMinutes: number | null; slaDeadlineAtMs: number | null; cancelReason: string | null;
  assignmentExplanation: string | null; createdAtMs: number;
};

type TimelineEntry = { fromStatus: string | null; toStatus: string; actorType: string; reason: string | null; occurredAtMs: number };

function parse(v: string | null | undefined): any { try { return v ? JSON.parse(v) : {}; } catch { return {}; } }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === false) return null;
  return (
    <div className="flex gap-2 border-b border-slate-700/40 py-1.5 text-[13px]">
      <span className="w-44 shrink-0 text-slate-500">{label}</span>
      <span className="text-slate-200">{value === true ? "Sí" : value}</span>
    </div>
  );
}

const TABS = ["Resumen", "Asignación", "Solicitante", "Vehículo", "Ubicación", "Timeline"] as const;

export default function FichaAsistencia() {
  const { id } = useParams();
  const { user } = useConnectAuth();
  const canOperate = hasRole(user, "operator");
  const [a, setA] = useState<Detail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Resumen");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<Detail>(`/assistances/${id}`).then(setA).catch((e) => setError(e.message));
    boFetch<{ data: TimelineEntry[] }>(`/assistances/${id}/timeline`).then((r) => setTimeline(r.data)).catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const action = async (path: string, body?: unknown) => {
    setBusy(true); setError(null);
    try { await boFetch(`/assistances/${id}/${path}`, { method: "POST", body }); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const cancelar = () => {
    const reason = window.prompt("Motivo de la cancelación (obligatorio):");
    if (reason?.trim()) action("cancel", { reason: reason.trim() });
  };

  if (!a) return <p className="text-sm text-slate-500">{error ?? "Cargando…"}</p>;

  const requester = parse(a.requester);
  const vehicle = parse(a.vehicle);
  const loc = parse(a.locationDetails);
  const slaRisk = a.slaDeadlineAtMs && !["finished", "cancelled"].includes(a.status)
    ? a.slaDeadlineAtMs - Date.now() : null;

  return (
    <div className="max-w-5xl">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {/* Cabecera */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/connect/asistencias" className="text-slate-500 hover:text-slate-300">←</Link>
            <h1 className="text-lg font-black text-slate-100">
              Asistencia #{a.id}{a.expedientNumber ? ` · Exp. ${a.expedientNumber}` : ""}
            </h1>
            <Badge className={ASSISTANCE_STATUS_STYLES[a.status] ?? "border-slate-600 text-slate-400"}>
              {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status}
            </Badge>
            {a.priority === "urgente" && <Badge className="border-red-500/40 bg-red-500/10 text-red-300">Urgente</Badge>}
            {slaRisk != null && (
              <Badge className={slaRisk < 0 ? "border-red-500/60 bg-red-500/15 text-red-300" : slaRisk < 15 * 60000 ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-slate-600 text-slate-400"}>
                SLA {slaRisk < 0 ? `incumplido (${Math.round(-slaRisk / 60000)} min)` : `${Math.round(slaRisk / 60000)} min restantes`}
              </Badge>
            )}
          </div>
          {canOperate && (
            <div className="flex gap-2">
              {a.status === "draft" && <Button onClick={() => action("submit")} disabled={busy}>Enviar borrador</Button>}
              {["pending", "no_coverage", "assignment_failed"].includes(a.status) && (
                <Button onClick={() => action("search-provider")} disabled={busy}>Asignación automática</Button>
              )}
              {["assigned", "technician_assigned", "en_route", "awaiting_acceptance"].includes(a.status) && (
                <Button
                  variant="ghost" disabled={busy}
                  onClick={() => {
                    const reason = window.prompt("Motivo de la reasignación (obligatorio):");
                    if (reason?.trim()) action("reassign", { reason: reason.trim() });
                  }}
                >
                  Reasignar
                </Button>
              )}
              {!["finished", "cancelled"].includes(a.status) && (
                <Button variant="danger" onClick={cancelar} disabled={busy}>Cancelar</Button>
              )}
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-slate-400">
          <span>Cliente: <b className="text-slate-200">{a.clientName ?? a.partnerName ?? "—"}</b></span>
          <span>Proveedor: <b className="text-slate-200">{a.providerName ?? "—"}</b></span>
          <span>Taller: <b className="text-slate-200">{a.workshopName ?? "—"}</b></span>
          <span>Técnico: <b className="text-slate-200">{a.assignedTechName ?? "—"}</b></span>
          <span>Creada: <b className="text-slate-200">{fmtDateTime(a.createdAtMs)}</b>{a.createdByName ? ` por ${a.createdByName}` : ""}</span>
        </div>
      </Card>

      {/* Pestañas */}
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

      <Card className="p-4">
        {tab === "Resumen" && (
          <div>
            <Row label="Estado" value={ASSISTANCE_STATUS_LABELS[a.status] ?? a.status} />
            <Row label="Tipo de asistencia" value={a.serviceType} />
            <Row label="Referencia externa" value={a.externalReference} />
            <Row label="Origen" value={a.origin} />
            <Row label="Descripción" value={a.description && <span className="whitespace-pre-wrap">{a.description}</span>} />
            <Row label="Explicación de asignación" value={a.assignmentExplanation} />
            <Row label="Estado en Mobilink Assist" value={a.coreStatus} />
            <Row label="Motivo de cancelación" value={a.cancelReason} />
            <Row label="SLA" value={a.slaMinutes ? `${a.slaMinutes} min (límite ${fmtDateTime(a.slaDeadlineAtMs)})` : null} />
          </div>
        )}
        {tab === "Asignación" && (
          <AsignacionTab assistanceId={a.id} status={a.status} canOperate={canOperate} onChanged={load} />
        )}
        {tab === "Solicitante" && (
          <div>
            <Row label="Cliente final" value={a.customerName} />
            <Row label="Teléfono" value={a.customerPhone && <a className="text-cyan-300" href={`tel:${a.customerPhone}`}>{a.customerPhone}</a>} />
            <Row label="Solicitante" value={requester.name} />
            <Row label="Tel. solicitante" value={requester.phone} />
            <Row label="Email" value={requester.email} />
            <Row label="Idioma" value={requester.language} />
            <Row label="Observaciones" value={requester.notes} />
          </div>
        )}
        {tab === "Vehículo" && (
          <div>
            <Row label="Tipo" value={vehicle.type} />
            <Row label="Marca / modelo" value={[vehicle.make, vehicle.model].filter(Boolean).join(" ")} />
            <Row label="Matrícula" value={vehicle.plate} />
            <Row label="VIN" value={vehicle.vin} />
            <Row label="Combustible" value={vehicle.fuel} />
            <Row label="Eléctrico" value={vehicle.electric} />
            <Row label="Remolque" value={vehicle.trailer} />
            <Row label="Peso" value={vehicle.weight} />
            <Row label="Carga" value={vehicle.cargo} />
            <Row label="Mercancía peligrosa" value={vehicle.dangerousGoods} />
          </div>
        )}
        {tab === "Ubicación" && (
          <div>
            <Row label="Dirección" value={a.address} />
            <Row label="Coordenadas" value={a.latitude != null ? `${a.latitude}, ${a.longitude}` : null} />
            <Row label="Carretera / km" value={[loc.road, loc.km ? `km ${loc.km}` : null].filter(Boolean).join(" · ")} />
            <Row label="Sentido" value={loc.direction} />
            <Row label="Referencia" value={loc.placeRef} />
            {a.latitude != null && (
              <a
                href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}
                target="_blank" rel="noreferrer"
                className="mt-3 inline-block rounded-lg border border-slate-600 px-3 py-2 text-[13px] text-cyan-300 hover:bg-slate-700"
              >
                Abrir en Google Maps ↗
              </a>
            )}
          </div>
        )}
        {tab === "Timeline" && (
          <div className="flex flex-col gap-0">
            {timeline.length === 0 ? (
              <p className="text-sm text-slate-500">Sin historial.</p>
            ) : timeline.map((t, i) => (
              <div key={i} className="flex items-start gap-3 border-l-2 border-slate-700 py-2 pl-4">
                <span className="w-32 shrink-0 text-[12px] text-slate-500">{fmtDateTime(t.occurredAtMs)}</span>
                <div>
                  <Badge className={ASSISTANCE_STATUS_STYLES[t.toStatus] ?? "border-slate-600 text-slate-400"}>
                    {ASSISTANCE_STATUS_LABELS[t.toStatus] ?? t.toStatus}
                  </Badge>
                  <span className="ml-2 text-[12px] text-slate-500">({t.actorType})</span>
                  {t.reason && <div className="mt-0.5 text-[12px] text-slate-400">{t.reason}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
