/**
 * Connect Pro — tabla en vivo de unidades móviles, compartida por la vista
 * transversal, la ficha de empresa y la ficha de taller. Se le pasa el
 * endpoint del que leer; el resto (estado manual, compartir, refresco) es
 * idéntico en las tres.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectEvents } from "../services/events";
import { Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "./ui";
import { fmtDateTime } from "../types";

export type Unit = {
  id: number; name: string; plate: string | null; status: string; providerName: string | null;
  workshopId: number | null;
  technicianRef: string | null; latitude: number | null; longitude: number | null;
  positionText: string | null; speedKmh: number | null; connectionStatus: string | null;
  activeAssistanceId: number | null; expedientNumber: string | null;
  manualStatus: string | null; manualReason: string | null; manualByName: string | null;
  lastReportAtMs: number | null;
  sharedWithCentral: boolean; sharedChangedBy: string | null;
};

export const UNIT_STATUS: Record<string, { label: string; cls: string }> = {
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

type Compartir = {
  id: number; name: string; sharedWithCentral: boolean;
  sharedChangedBy: string | null; sharedChangedAtMs: number | null;
};

export default function TablaUnidades({ endpoint, canMove = false, workshops = [], workshopId = null }: {
  /** De dónde leer: "/mobile-units" o "/workshops/:id/mobile-units". */
  endpoint: string;
  /** Permite mover unidades a otro taller (cc_admin). */
  canMove?: boolean;
  /** Talleres de destino para el selector de mover. */
  workshops?: { id: number; name: string }[];
  /** Taller al que se limita el cuadro de lo compartido, si es la ficha de uno. */
  workshopId?: number | null;
}) {
  const [rows, setRows] = useState<Unit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [manual, setManual] = useState({ status: "unavailable", reason: "" });
  // Lo que el taller NO comparte: aquí solo el nombre, para poder devolverle
  // el permiso. Ni posición, ni matrícula, ni técnico, ni estado.
  const [compartir, setCompartir] = useState<Compartir[] | null>(null);

  const load = useCallback(() => {
    boFetch<{ data: Unit[] }>(endpoint).then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, [endpoint]);

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

  const mover = async (id: number, workshopId: string) => {
    setBusy(true); setError(null);
    try {
      await boFetch(`/mobile-units/${id}`, { method: "PATCH", body: { workshopId: workshopId ? Number(workshopId) : null } });
      setMoving(null);
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  /* Solo lo pide quien administra: para el resto el endpoint responde 403. */
  const abrirCompartir = async () => {
    setError(null);
    try {
      const r = await boFetch<{ data: Compartir[] }>(
        `/mobile-units/sharing${workshopId != null ? `?workshopId=${workshopId}` : ""}`);
      setCompartir(r.data);
    } catch (e: any) { setError(e.message); }
  };

  const cambiarCompartir = async (id: number, shared: boolean) => {
    setBusy(true); setError(null);
    try {
      await boFetch(`/mobile-units/${id}/share`, { method: "PATCH", body: { shared } });
      await abrirCompartir();
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const cuadroCompartir = (
    <div className="mt-2 text-[12px]">
      {compartir === null ? (
        <button onClick={abrirCompartir} className="text-slate-500 hover:text-slate-300 hover:underline">
          Gestionar qué unidades comparte el taller
        </button>
      ) : (
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-slate-300">Unidades compartidas con Central</span>
            <button onClick={() => setCompartir(null)} className="text-slate-500 hover:text-slate-300">✕</button>
          </div>
          <p className="mb-2 text-slate-500">
            Lo que no se comparte no aparece en la tabla y Central no ve ni su posición, ni su
            matrícula, ni su técnico. Aquí solo está el nombre, para poder devolver el permiso.
          </p>
          {compartir.length === 0 ? (
            <span className="text-slate-500">No hay unidades.</span>
          ) : (
            <div className="flex flex-col gap-1">
              {compartir.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <button
                    disabled={busy}
                    onClick={() => cambiarCompartir(c.id, !c.sharedWithCentral)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${c.sharedWithCentral
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-600 bg-slate-800 text-slate-400"}`}
                  >
                    {c.sharedWithCentral ? "Compartida ✓" : "No compartida"}
                  </button>
                  <span className="text-slate-300">{c.name}</span>
                  {c.sharedChangedBy && (
                    <span className="text-[11px] text-slate-600">· {c.sharedChangedBy}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );

  if (error && rows.length === 0) return <ErrorBanner message={error} onClose={() => setError(null)} />;
  if (rows.length === 0) {
    return (
      <>
        <EmptyState message="Ninguna unidad compartida con Central. El taller decide cuáles comparte; las que no comparte no se ven desde aquí." />
        {canMove && cuadroCompartir}
      </>
    );
  }

  return (
    <>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-slate-700">
            <Th>Unidad</Th><Th>Matrícula</Th><Th>Estado</Th><Th>Central</Th><Th>Técnico</Th><Th>Asistencia</Th>
            <Th>Posición</Th><Th>Últ. señal</Th><Th></Th>
          </tr></thead>
          <tbody>
            {rows.map((u) => {
              const st = UNIT_STATUS[u.status] ?? UNIT_STATUS.unknown;
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
                  <Td>
                    <button
                      disabled={busy}
                      title={u.sharedChangedBy ? `Último cambio: ${u.sharedChangedBy}` : "Dejar de compartir con Central: la unidad desaparece de esta pantalla"}
                      onClick={async () => {
                        setBusy(true); setError(null);
                        try { await boFetch(`/mobile-units/${u.id}/share`, { method: "PATCH", body: { shared: !u.sharedWithCentral } }); load(); }
                        catch (e: any) { setError(e.message); } finally { setBusy(false); }
                      }}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${u.sharedWithCentral ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 bg-slate-800 text-slate-400"}`}
                    >
                      {u.sharedWithCentral ? "Compartida ✓" : "No compartida"}
                    </button>
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
                          {MANUAL_OPTIONS.map((s) => <option key={s} value={s}>{UNIT_STATUS[s].label}</option>)}
                        </Select>
                        <Input placeholder="Motivo *" value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} className="w-40" />
                        <Button disabled={busy} onClick={() => fijar(u.id)}>OK</Button>
                        <Button variant="ghost" onClick={() => setEditing(null)}>✕</Button>
                      </div>
                    ) : moving === u.id ? (
                      <div className="flex items-center gap-1">
                        <Select defaultValue={u.workshopId != null ? String(u.workshopId) : ""} onChange={(e) => mover(u.id, e.target.value)}>
                          <option value="">— Sin taller —</option>
                          {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </Select>
                        <Button variant="ghost" onClick={() => setMoving(null)}>✕</Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        {u.manualStatus ? (
                          <Button variant="ghost" disabled={busy} onClick={() => limpiar(u.id)}>Volver a automático</Button>
                        ) : (
                          <Button variant="ghost" onClick={() => setEditing(u.id)}>Estado manual…</Button>
                        )}
                        {canMove && workshops.length > 0 && (
                          <Button variant="ghost" onClick={() => setMoving(u.id)}>Mover…</Button>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {canMove && cuadroCompartir}
    </>
  );
}
