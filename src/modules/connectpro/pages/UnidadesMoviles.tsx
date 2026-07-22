/**
 * Connect Pro — Unidades móviles (Fase 3): estado en vivo derivado del core
 * y de Webfleet, con estado manual del operador (motivo obligatorio).
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectEvents } from "../services/events";
import { PageTitle, Card, Th, Td, Badge, Select, Input, Button, ErrorBanner, EmptyState } from "../components/ui";
import { fmtDateTime } from "../types";

type Unit = {
  id: number; name: string; plate: string | null; status: string; providerName: string | null;
  technicianRef: string | null; latitude: number | null; longitude: number | null;
  positionText: string | null; speedKmh: number | null; connectionStatus: string | null;
  activeAssistanceId: number | null; expedientNumber: string | null;
  manualStatus: string | null; manualReason: string | null; manualByName: string | null;
  lastReportAtMs: number | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  available: { label: "Disponible", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  at_base: { label: "En base", cls: "border-teal-500/40 bg-teal-500/10 text-teal-300" },
  reserved: { label: "Reservada", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  assigned: { label: "Asistencia asignada", cls: "border-blue-500/40 bg-blue-500/10 text-blue-300" },
  en_route_to_assistance: { label: "En desplazamiento", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  working: { label: "Trabajando", cls: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" },
  waiting_instructions: { label: "Esperando instrucciones", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  waiting_material: { label: "Esperando material", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  finishing: { label: "Finalizando", cls: "border-teal-500/40 bg-teal-500/10 text-teal-300" },
  returning_to_base: { label: "Vuelta al taller", cls: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300" },
  resting: { label: "En descanso", cls: "border-slate-500/40 bg-slate-500/10 text-slate-300" },
  unavailable: { label: "No disponible", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  out_of_service: { label: "Fuera de servicio", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  breakdown: { label: "Averiada", cls: "border-red-500/60 bg-red-500/15 text-red-300" },
  no_connection: { label: "Sin conexión", cls: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  shift_ended: { label: "Jornada finalizada", cls: "border-slate-600 text-slate-400" },
  unknown: { label: "Desconocido", cls: "border-slate-600 text-slate-500" },
};

const MANUAL_OPTIONS = ["unavailable", "out_of_service", "breakdown", "resting", "shift_ended", "waiting_material"];

export default function UnidadesMoviles() {
  const [rows, setRows] = useState<Unit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [manual, setManual] = useState({ status: "unavailable", reason: "" });

  const load = useCallback(() => {
    boFetch<{ data: Unit[] }>("/mobile-units").then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);
  useConnectEvents(() => load());

  const fijar = async (id: number) => {
    if (!manual.reason.trim()) { setError("Indica el motivo del estado manual."); return; }
    setBusy(true); setError(null);
    try {
      await boFetch(`/mobile-units/${id}/status`, { method: "PATCH", body: manual });
      setEditing(null); setManual({ status: "unavailable", reason: "" });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const limpiar = async (id: number) => {
    setBusy(true); setError(null);
    try {
      await boFetch(`/mobile-units/${id}/status`, { method: "PATCH", body: { status: null } });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle
        title="Unidades móviles"
        subtitle="Estado en vivo derivado de las asistencias del taller y de Webfleet. El estado manual del operador tiene prioridad."
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {rows.length === 0 ? (
        <EmptyState message="Sin unidades sincronizadas todavía (se cargan automáticamente desde los vehículos de asistencia del taller)." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Unidad</Th><Th>Matrícula</Th><Th>Estado</Th><Th>Técnico</Th><Th>Asistencia</Th>
              <Th>Posición</Th><Th>Últ. señal</Th><Th></Th>
            </tr></thead>
            <tbody>
              {rows.map((u) => {
                const st = STATUS[u.status] ?? STATUS.unknown;
                return (
                  <tr key={u.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <Td className="font-semibold text-slate-100">{u.name}</Td>
                    <Td>{u.plate ?? "-"}</Td>
                    <Td>
                      <Badge className={st.cls}>{st.label}</Badge>
                      {u.manualStatus && (
                        <div className="mt-0.5 text-[10px] text-amber-300" title={u.manualReason ?? undefined}>
                          manual · {u.manualByName}{u.manualReason ? ` — ${u.manualReason}` : ""}
                        </div>
                      )}
                    </Td>
                    <Td>{u.technicianRef ?? "-"}</Td>
                    <Td>
                      {u.activeAssistanceId
                        ? <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${u.activeAssistanceId}`}>
                            #{u.activeAssistanceId}{u.expedientNumber ? ` · ${u.expedientNumber}` : ""}
                          </Link>
                        : "-"}
                    </Td>
                    <Td className="max-w-[200px]">
                      {u.latitude != null ? (
                        <a className="text-cyan-300 hover:underline" target="_blank" rel="noreferrer"
                           href={`https://www.google.com/maps?q=${u.latitude},${u.longitude}`}>
                          {u.positionText ?? `${u.latitude.toFixed(4)}, ${u.longitude?.toFixed(4)}`}
                        </a>
                      ) : "-"}
                      {u.speedKmh != null && u.speedKmh > 0 && <span className="ml-1 text-[11px] text-slate-500">{Math.round(u.speedKmh)} km/h</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-[12px] text-slate-500">{fmtDateTime(u.lastReportAtMs)}</Td>
                    <Td>
                      {editing === u.id ? (
                        <div className="flex items-center gap-1">
                          <Select value={manual.status} onChange={(e) => setManual({ ...manual, status: e.target.value })}>
                            {MANUAL_OPTIONS.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                          </Select>
                          <Input placeholder="Motivo *" value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} className="w-40" />
                          <Button disabled={busy} onClick={() => fijar(u.id)}>OK</Button>
                          <Button variant="ghost" onClick={() => setEditing(null)}>✕</Button>
                        </div>
                      ) : u.manualStatus ? (
                        <Button variant="ghost" disabled={busy} onClick={() => limpiar(u.id)}>Volver a automático</Button>
                      ) : (
                        <Button variant="ghost" onClick={() => setEditing(u.id)}>Estado manual…</Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
