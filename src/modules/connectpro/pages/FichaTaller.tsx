/**
 * Connect Pro — Ficha de taller: operarios (con teléfono para llamarles),
 * unidades móviles, panel Lite, KPIs y asistencias del taller.
 * Ruta: /connect/empresas/:id/talleres/:wid
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Button, ErrorBanner, EmptyState } from "../components/ui";
import TablaUnidades from "../components/TablaUnidades";
import TarjetaOperario, { type Operator } from "../components/TarjetaOperario";
import { LitePanel } from "./Talleres";
import {
  ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES, WORKSHOP_TIER, WORKSHOP_TIER_LABELS,
  WORKSHOP_TIER_STYLES, fmtDateTime, type WorkshopIntegrationType,
} from "../types";

type Workshop = {
  id: number; name: string; phone: string | null; latitude: number; longitude: number;
  radiusKm: number; connectStatus: string; currentScore: number; providerName: string | null;
  providerCompanyId: number | null; integrationType: WorkshopIntegrationType;
  networkParticipation: boolean; liteCode: string | null;
};

type Kpis = Record<string, number | null>;

const KPI_LABELS: Record<string, string> = {
  services: "Servicios", finished: "Finalizados", acceptanceRate: "% aceptación",
  slaCompliance: "% SLA", avgAcceptMin: "Aceptación (min)", avgTravelMin: "Desplazamiento (min)",
  avgWorkMin: "Trabajo (min)", avgStatusQuality: "Calidad de estados",
};

const TABS = ["Operarios", "Unidades móviles", "KPIs", "Asistencias"] as const;

export default function FichaTaller() {
  const { id: empresaId, wid } = useParams();
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const canOperate = hasRole(user, "operator");

  const [w, setW] = useState<Workshop | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Operarios");
  const [operators, setOperators] = useState<Operator[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [asistencias, setAsistencias] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contacto, setContacto] = useState({ name: "", phone: "", role: "" });

  const load = useCallback(() => {
    boFetch<Workshop>(`/workshops/${wid}`).then(setW).catch((e) => setError(e.message));
    boFetch<{ data: Operator[] }>(`/workshops/${wid}/operators`).then((r) => setOperators(r.data)).catch(() => {});
  }, [wid]);
  useEffect(load, [load]);

  useEffect(() => {
    if (tab === "KPIs") boFetch<Kpis>(`/workshops/${wid}/kpis?days=30`).then(setKpis).catch(() => {});
    if (tab === "Asistencias") {
      boFetch<{ data: any[] }>(`/assistances?workshopId=${wid}&limit=50`).then((r) => setAsistencias(r.data)).catch(() => {});
    }
  }, [tab, wid]);

  const añadirContacto = async () => {
    if (!contacto.name.trim()) { setError("El nombre del contacto es obligatorio."); return; }
    setBusy(true);
    try {
      await boFetch(`/workshops/${wid}/contacts`, { method: "POST", body: contacto });
      setContacto({ name: "", phone: "", role: "" });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (!w) return <p className="text-sm text-slate-500">{error ?? "Cargando…"}</p>;

  return (
    <div>
      <PageTitle
        title={w.name}
        subtitle={
          <span>
            <Link className="text-cyan-300 hover:underline" to={`/connect/empresas/${empresaId ?? w.providerCompanyId ?? ""}`}>
              ← {w.providerName ?? "Empresa"}
            </Link>
            {" · "}
            <Badge className={WORKSHOP_TIER_STYLES[w.integrationType]}>
              {WORKSHOP_TIER[w.integrationType]} · {WORKSHOP_TIER_LABELS[w.integrationType]}
            </Badge>
            {w.liteCode && <span className="ml-2 font-mono text-[12px] text-violet-300">Código app: {w.liteCode}</span>}
            {w.phone && <a className="ml-3 text-cyan-300 hover:underline" href={`tel:${w.phone}`}>📞 {w.phone}</a>}
            <a
              className="ml-3 text-cyan-300 hover:underline" target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps?q=${w.latitude},${w.longitude}`}
            >
              Ver en mapa ↗
            </a>
          </span>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

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

      {tab === "Operarios" && (
        <div className="flex flex-col gap-4">
          {operators.length === 0 ? (
            <EmptyState message={
              w.integrationType === "external"
                ? "Taller externo sin contactos todavía: añade abajo a quién llamar."
                : "Sin operarios registrados en este taller."
            } />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {operators.map((op) => <TarjetaOperario key={`${op.source}-${op.id}`} op={op} />)}
            </div>
          )}

          {canOperate && (
            <Card className="p-4">
              <h3 className="mb-2 text-[13px] font-semibold text-slate-300">Añadir contacto manual (encargado, centralita…)</h3>
              <div className="flex flex-wrap gap-2">
                <Input placeholder="Nombre *" value={contacto.name} onChange={(e) => setContacto({ ...contacto, name: e.target.value })} className="w-48" />
                <Input placeholder="Teléfono" value={contacto.phone} onChange={(e) => setContacto({ ...contacto, phone: e.target.value })} className="w-36" />
                <Input placeholder="Cargo" value={contacto.role} onChange={(e) => setContacto({ ...contacto, role: e.target.value })} className="w-40" />
                <Button onClick={añadirContacto} disabled={busy}>Añadir</Button>
              </div>
            </Card>
          )}

          {w.integrationType === "lite" && (
            <LitePanel workshop={w as any} canEdit={canEdit} onError={setError} />
          )}
        </div>
      )}

      {tab === "Unidades móviles" && (
        w.integrationType === "lite" ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-slate-400">
              Un taller Lite no tiene unidades con GPS de flota: la posición sale del móvil de sus
              operarios durante cada asistencia. Gestión de dispositivos en la pestaña Operarios.
            </p>
            <LitePanel workshop={w as any} canEdit={canEdit} onError={setError} />
          </div>
        ) : (
          <TablaUnidades endpoint={`/workshops/${wid}/mobile-units`} canMove={canEdit} workshops={w ? [{ id: w.id, name: w.name }] : []} />
        )
      )}

      {tab === "KPIs" && (
        !kpis ? <p className="text-sm text-slate-500">Cargando…</p> : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(KPI_LABELS).map(([key, label]) => (
              <div key={key} className="rounded-lg border border-slate-700 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="text-[18px] font-bold text-slate-100">{kpis[key] ?? "—"}</div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "Asistencias" && (
        asistencias.length === 0 ? <EmptyState message="Sin asistencias registradas en este taller." /> : (
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-700">
                <Th>Asistencia</Th><Th>Estado</Th><Th>Cliente</Th><Th>Dirección</Th><Th>Creada</Th>
              </tr></thead>
              <tbody>
                {asistencias.map((a) => (
                  <tr key={a.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <Td>
                      <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${a.id}`}>
                        #{a.id}{a.expedientNumber ? ` · ${a.expedientNumber}` : ""}
                      </Link>
                    </Td>
                    <Td>
                      <Badge className={ASSISTANCE_STATUS_STYLES[a.status] ?? "border-slate-600 text-slate-400"}>
                        {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status}
                      </Badge>
                    </Td>
                    <Td>{a.customerName || a.clientName || "-"}</Td>
                    <Td className="max-w-[280px] truncate">{a.address}</Td>
                    <Td className="whitespace-nowrap text-[12px] text-slate-500">{fmtDateTime(Number(a.createdAtMs))}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}
    </div>
  );
}
