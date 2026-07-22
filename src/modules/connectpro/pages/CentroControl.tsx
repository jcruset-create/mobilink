/**
 * Connect Pro — Centro de control operativo: 4 colas de trabajo (pendientes,
 * en asignación, activas, requieren atención) con ficha lateral y acciones
 * rápidas sin abandonar la pantalla. Refresco cada 10 s.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectEvents } from "../services/events";
import { PageTitle, Badge, Button, ErrorBanner } from "../components/ui";
import { ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES, fmtDateTime } from "../types";

type Item = {
  id: number; status: string; priority: string; serviceType: string; address: string;
  customerName: string; customerPhone: string; expedientNumber: string | null;
  externalReference: string | null; clientName: string | null; partnerName: string | null;
  workshopName: string | null; assignedTechName: string | null; coreStatus: string | null;
  origin: string; slaDeadlineAtMs: number | null; slaRisk: boolean; slaBreached: boolean;
  acceptDeadlineMs: number | null; latitude: number | null; longitude: number | null;
  createdAtMs: number;
};

type Board = { pending: Item[]; assigning: Item[]; active: Item[]; attention: Item[] };

function slaBadge(a: Item) {
  if (!a.slaDeadlineAtMs) return null;
  const min = Math.round((a.slaDeadlineAtMs - Date.now()) / 60000);
  if (min < 0) return <Badge className="border-red-500/60 bg-red-500/15 text-red-300">SLA +{-min} min</Badge>;
  if (min < 15) return <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-300">SLA {min} min</Badge>;
  return <Badge className="border-slate-600 text-slate-400">SLA {min} min</Badge>;
}

function QueueCard({ item, onSelect, selected }: { item: Item; onSelect: (i: Item) => void; selected: boolean }) {
  return (
    <button
      onClick={() => onSelect(item)}
      className={`w-full rounded-lg border p-2 text-left transition ${
        selected ? "border-cyan-500 bg-cyan-600/10" : "border-slate-700 bg-slate-800 hover:border-slate-500"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[12px] font-bold text-slate-100">
          #{item.id}{item.expedientNumber ? ` · ${item.expedientNumber}` : ""} — {item.customerName || "Sin nombre"}
        </span>
        {item.priority === "urgente" && <span className="shrink-0 text-[10px] font-black text-red-400">URG</span>}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-slate-400">{item.serviceType} · {item.address || "sin dirección"}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Badge className={ASSISTANCE_STATUS_STYLES[item.status] ?? "border-slate-600 text-slate-400"}>
          {ASSISTANCE_STATUS_LABELS[item.status] ?? item.status}
        </Badge>
        {slaBadge(item)}
        {item.workshopName && <span className="text-[10px] text-slate-500">{item.workshopName}</span>}
      </div>
    </button>
  );
}

function Column({ title, tone, items, onSelect, selectedId }: {
  title: string; tone: string; items: Item[]; onSelect: (i: Item) => void; selectedId: number | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-700 bg-slate-900/60">
      <div className={`flex items-center justify-between rounded-t-xl border-b border-slate-700 px-3 py-2 ${tone}`}>
        <span className="text-[12px] font-bold uppercase tracking-wide">{title}</span>
        <span className="rounded-full bg-slate-900/50 px-2 py-0.5 text-[11px] font-black">{items.length}</span>
      </div>
      <div className="flex max-h-[calc(100vh-240px)] flex-col gap-1.5 overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="p-3 text-center text-[11px] text-slate-600">Vacío</p>
        ) : items.map((i) => <QueueCard key={i.id} item={i} onSelect={onSelect} selected={selectedId === i.id} />)}
      </div>
    </div>
  );
}

export default function CentroControl() {
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<Board>("/control-center")
      .then((b) => {
        setBoard(b);
        setSelected((sel) => {
          if (!sel) return sel;
          const all = [...b.pending, ...b.assigning, ...b.active, ...b.attention];
          return all.find((x) => x.id === sel.id) ?? null;
        });
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // respaldo; el SSE refresca al instante
    return () => clearInterval(t);
  }, [load]);

  // Tiempo real: cualquier cambio de estado o alerta refresca el tablero
  useConnectEvents(() => load());

  const act = async (path: string, body?: unknown) => {
    if (!selected) return;
    setBusy(true); setError(null);
    try { await boFetch(`/assistances/${selected.id}/${path}`, { method: "POST", body }); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle title="Centro de control" subtitle="Colas de trabajo en tiempo real. Selecciona una asistencia para operar sin salir de la pantalla." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {!board ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="flex gap-3">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 xl:grid-cols-4">
            <Column title="Pendientes" tone="text-amber-300" items={board.pending} onSelect={setSelected} selectedId={selected?.id ?? null} />
            <Column title="En asignación" tone="text-fuchsia-300" items={board.assigning} onSelect={setSelected} selectedId={selected?.id ?? null} />
            <Column title="Activas" tone="text-emerald-300" items={board.active} onSelect={setSelected} selectedId={selected?.id ?? null} />
            <Column title="Atención" tone="text-red-300" items={board.attention} onSelect={setSelected} selectedId={selected?.id ?? null} />
          </div>

          {/* Ficha lateral */}
          {selected && (
            <aside className="w-80 shrink-0 rounded-xl border border-slate-700 bg-slate-800 p-3">
              <div className="mb-2 flex items-start justify-between">
                <h2 className="text-sm font-black text-slate-100">
                  #{selected.id}{selected.expedientNumber ? ` · ${selected.expedientNumber}` : ""}
                </h2>
                <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300">✕</button>
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                <Badge className={ASSISTANCE_STATUS_STYLES[selected.status] ?? "border-slate-600 text-slate-400"}>
                  {ASSISTANCE_STATUS_LABELS[selected.status] ?? selected.status}
                </Badge>
                {selected.priority === "urgente" && <Badge className="border-red-500/40 bg-red-500/10 text-red-300">Urgente</Badge>}
                {slaBadge(selected)}
              </div>
              <dl className="mb-3 space-y-1 text-[12px]">
                <div><dt className="inline text-slate-500">Cliente: </dt><dd className="inline text-slate-200">{selected.customerName || "—"}</dd></div>
                <div><dt className="inline text-slate-500">Teléfono: </dt>
                  <dd className="inline">{selected.customerPhone
                    ? <a href={`tel:${selected.customerPhone}`} className="text-cyan-300">{selected.customerPhone}</a> : "—"}</dd></div>
                <div><dt className="inline text-slate-500">Servicio: </dt><dd className="inline text-slate-200">{selected.serviceType}</dd></div>
                <div><dt className="inline text-slate-500">Dirección: </dt><dd className="inline text-slate-200">{selected.address || "—"}</dd></div>
                <div><dt className="inline text-slate-500">Cuenta: </dt><dd className="inline text-slate-200">{selected.clientName ?? selected.partnerName ?? "—"}</dd></div>
                <div><dt className="inline text-slate-500">Taller: </dt><dd className="inline text-slate-200">{selected.workshopName ?? "—"}</dd></div>
                <div><dt className="inline text-slate-500">Técnico: </dt><dd className="inline text-slate-200">{selected.assignedTechName ?? "—"}</dd></div>
                <div><dt className="inline text-slate-500">Creada: </dt><dd className="inline text-slate-200">{fmtDateTime(selected.createdAtMs)}</dd></div>
              </dl>

              <div className="flex flex-col gap-1.5">
                <Link
                  to={`/connect/asistencias/${selected.id}`}
                  className="rounded-lg bg-cyan-600 px-3 py-2 text-center text-[13px] font-medium text-white hover:bg-cyan-500"
                >
                  Abrir ficha completa
                </Link>
                {["pending", "no_coverage", "assignment_failed"].includes(selected.status) && (
                  <Button variant="ghost" disabled={busy} onClick={() => act("search-provider")}>Asignación automática</Button>
                )}
                {["assigned", "technician_assigned", "en_route", "awaiting_acceptance"].includes(selected.status) && (
                  <Button variant="ghost" disabled={busy} onClick={() => {
                    const reason = window.prompt("Motivo de la reasignación:");
                    if (reason?.trim()) act("reassign", { reason: reason.trim() });
                  }}>Reasignar</Button>
                )}
                {selected.latitude != null && (
                  <a
                    href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`}
                    target="_blank" rel="noreferrer"
                    className="rounded-lg border border-slate-600 px-3 py-2 text-center text-[13px] text-cyan-300 hover:bg-slate-700"
                  >
                    Ver en mapa ↗
                  </a>
                )}
                <Button variant="danger" disabled={busy} onClick={() => {
                  const reason = window.prompt("Motivo de la cancelación:");
                  if (reason?.trim()) act("cancel", { reason: reason.trim() });
                }}>Cancelar asistencia</Button>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
