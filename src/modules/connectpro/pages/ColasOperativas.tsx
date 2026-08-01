/**
 * Connect Pro — colas operativas a pantalla completa.
 *
 * Una pestaña por cola (pendientes, en asignación, activas, atención) con la
 * ficha completa de cada asistencia al estilo de la pantalla de activas de
 * Mobilink Assist, más una pestaña de resumen con todos los estados a la vez.
 * Orden cronológico: primero la más antigua, que es la que más lleva esperando.
 *
 * La cola de cada asistencia la decide el servidor, la misma que usa el tablero
 * del centro de control, para que una asistencia no salga en sitios distintos
 * según la pantalla.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { boFetch } from "../services/api";
import { abrirInforme } from "../services/informe";
import { useConnectEvents } from "../services/events";
import { PageTitle, Card, Badge, Button, ErrorBanner, EmptyState } from "../components/ui";
import { ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES, fmtDateTime } from "../types";

type Hito = { toStatus: string; occurredAtMs: number };
type Cola = "pending" | "assigning" | "active" | "attention";

type Asistencia = {
  id: number; uuid: string; status: string; priority: string; serviceType: string;
  address: string; customerName: string; customerPhone: string;
  expedientNumber: string | null; externalReference: string | null;
  clientName: string | null; clientDisplayName: string | null; partnerName: string | null;
  description: string | null; latitude: number | null; longitude: number | null;
  origin: string; slaMinutes: number | null; slaDeadlineAtMs: number | null;
  createdAtMs: number; updatedAtMs: number;
  assignedTechName: string | null; assignedVehicleName: string | null; assignedVehiclePlate: string | null;
  liteUserName: string | null; coreTech: string | null; coreVehicle: string | null;
  workshopName: string | null; workshopPhone: string | null; integrationType: string | null;
  providerName: string | null; vehicle: string; locationDetails: string;
  operatorLat: number | null; operatorLng: number | null; operatorLocationAtMs: number | null;
  files: number; reportUrl: string | null; timeline: Hito[] | null;
  acceptDeadlineMs: number | null;
  cola: Cola; slaRisk: boolean; slaBreached: boolean;
};

/** Pestañas de la pantalla. La primera es el resumen de todas. */
const PESTANAS: { slug: string; cola: Cola | null; label: string; color: string; borde: string }[] = [
  { slug: "resumen", cola: null, label: "Resumen", color: "text-slate-100", borde: "border-slate-300" },
  { slug: "pendientes", cola: "pending", label: "Pendientes", color: "text-amber-300", borde: "border-amber-400" },
  { slug: "asignacion", cola: "assigning", label: "En asignación", color: "text-fuchsia-300", borde: "border-fuchsia-400" },
  { slug: "activas", cola: "active", label: "Activas", color: "text-emerald-300", borde: "border-emerald-400" },
  { slug: "atencion", cola: "attention", label: "Atención", color: "text-red-300", borde: "border-red-400" },
];

/** El ciclo completo, desde que entra la llamada hasta la vuelta al taller. */
const PASOS = [
  { key: "pending", label: "Pendiente" },
  { key: "searching", label: "Buscando" },
  { key: "awaiting_acceptance", label: "Ofertada" },
  { key: "assigned", label: "Recibida" },
  { key: "technician_assigned", label: "Asignada" },
  { key: "en_route", label: "En camino" },
  { key: "arrived", label: "En punto" },
  { key: "in_progress", label: "Trabajando" },
  { key: "finished", label: "Finalizada" },
  { key: "returning_to_workshop", label: "A taller" },
  { key: "at_workshop", label: "En taller" },
];

function parse(v: string | null | undefined): any {
  try { return v ? JSON.parse(v) : {}; } catch { return {}; }
}

function hora(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function transcurrido(desde: number): string {
  const min = Math.round((Date.now() - Number(desde)) / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

function SlaBadge({ a }: { a: Asistencia }) {
  if (a.slaDeadlineAtMs == null) return null;
  const min = Math.round((a.slaDeadlineAtMs - Date.now()) / 60000);
  return (
    <Badge className={min < 0 ? "border-red-500/60 bg-red-500/15 text-red-300"
      : min < 15 ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : "border-slate-600 text-slate-400"}>
      {min < 0 ? `SLA superado ${-min} min` : `SLA ${min} min`}
    </Badge>
  );
}

/** Semáforo de progreso: pasos hechos con su hora, pendientes en gris. */
function Progreso({ status, timeline }: { status: string; timeline: Hito[] | null }) {
  const horas = new Map((timeline ?? []).map((h) => [h.toStatus, Number(h.occurredAtMs)]));
  const actual = PASOS.findIndex((p) => p.key === status);
  return (
    <div className="flex flex-wrap items-start gap-1">
      {PASOS.map((p, i) => {
        const hecho = horas.has(p.key);
        const esActual = i === actual;
        return (
          <div key={p.key} className="flex min-w-[58px] flex-col items-center gap-0.5">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                esActual ? "bg-cyan-500 text-slate-900"
                : hecho ? "bg-emerald-600/80 text-white"
                : "bg-slate-700 text-slate-500"
              }`}
            >
              {hecho && !esActual ? "✓" : i + 1}
            </div>
            <span className={`text-[10px] ${esActual ? "font-bold text-cyan-300" : hecho ? "text-slate-300" : "text-slate-600"}`}>
              {p.label}
            </span>
            <span className="text-[10px] text-slate-500">{hora(horas.get(p.key))}</span>
          </div>
        );
      })}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  if (valor == null || valor === "" || valor === "-") return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{etiqueta}</div>
      <div className="text-[13px] text-slate-100">{valor}</div>
    </div>
  );
}

function Tarjeta({ a, onError }: { a: Asistencia; onError: (m: string) => void }) {
  const vehiculo = parse(a.vehicle);
  const loc = parse(a.locationDetails);
  const operario = a.assignedTechName ?? a.liteUserName ?? a.coreTech;
  const furgoneta = [a.assignedVehicleName ?? a.coreVehicle, a.assignedVehiclePlate].filter(Boolean).join(" · ");

  return (
    <Card className={`p-4 ${a.cola === "attention" ? "border-red-500/40" : ""}`}>
      {/* Cabecera */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/connect/asistencias/${a.id}`} className="text-[16px] font-black text-slate-100 hover:text-cyan-300">
              {a.expedientNumber ?? `#${a.id}`}
            </Link>
            <Badge className={ASSISTANCE_STATUS_STYLES[a.status] ?? "border-slate-600 text-slate-400"}>
              {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status}
            </Badge>
            {a.priority === "urgente" && (
              <Badge className="border-red-500/40 bg-red-500/10 text-red-300">URGENTE</Badge>
            )}
            <SlaBadge a={a} />
            {a.acceptDeadlineMs && (
              <Badge className="border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300">
                Oferta vence {hora(a.acceptDeadlineMs)}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-[13px] text-slate-300">
            {a.customerName || "Sin nombre"}
            {a.clientDisplayName || a.clientName || a.partnerName
              ? ` · ${a.clientDisplayName ?? a.clientName ?? a.partnerName}` : ""}
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div>Creada {fmtDateTime(a.createdAtMs)}</div>
          <div>Abierta desde hace {transcurrido(a.createdAtMs)}</div>
        </div>
      </div>

      {/* Progreso de estados */}
      <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
        <Progreso status={a.status} timeline={a.timeline} />
      </div>

      {/* Datos operativos */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Dato
          etiqueta="Teléfono del cliente"
          valor={a.customerPhone ? <a className="text-cyan-300 hover:underline" href={`tel:${a.customerPhone}`}>📞 {a.customerPhone}</a> : "-"}
        />
        <Dato
          etiqueta="Ubicación"
          valor={a.latitude != null
            ? <a className="text-cyan-300 hover:underline" target="_blank" rel="noreferrer"
                 href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}>{a.address || "Ver en mapa"}</a>
            : (a.address || "-")}
        />
        <Dato etiqueta="Servicio" valor={`${a.serviceType}${loc.road ? ` · ${loc.road}${loc.km ? ` km ${loc.km}` : ""}` : ""}`} />
        <Dato
          etiqueta="Vehículo"
          valor={[vehiculo.plate, [vehiculo.make, vehiculo.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "-"}
        />
        <Dato etiqueta="Taller" valor={a.workshopName ?? "Sin asignar"} />
        <Dato etiqueta="Empresa" valor={a.providerName ?? "-"} />
        <Dato etiqueta="Operario" valor={operario ?? "Sin asignar"} />
        <Dato etiqueta="Furgoneta" valor={furgoneta || "-"} />
      </div>

      {a.description && (
        <p className="mt-2 whitespace-pre-wrap text-[12px] text-slate-400">{a.description}</p>
      )}

      {/* Acciones */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          to={`/connect/asistencias/${a.id}`}
          className="rounded-lg bg-cyan-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-cyan-500"
        >
          Abrir ficha
        </Link>
        {a.workshopPhone && (
          <a href={`tel:${a.workshopPhone}`} className="rounded-lg border border-slate-600 px-3 py-1.5 text-[13px] text-slate-300 hover:bg-slate-700">
            Llamar al taller
          </a>
        )}
        <Button variant="ghost" onClick={() => abrirInforme(a.id).catch((e) => onError(e.message))}>
          {a.reportUrl ? "Ver informe" : "Informe provisional"}
        </Button>
        {a.files > 0 && <span className="text-[12px] text-slate-500">{a.files} evidencia{a.files !== 1 ? "s" : ""}</span>}
        {a.operatorLocationAtMs && (
          <span className="text-[12px] text-slate-500">
            Última posición del operario: {fmtDateTime(a.operatorLocationAtMs)}
          </span>
        )}
      </div>
    </Card>
  );
}

/** Fila compacta del resumen: lo justo para decidir dónde hay que entrar. */
function Fila({ a }: { a: Asistencia }) {
  const operario = a.assignedTechName ?? a.liteUserName ?? a.coreTech;
  return (
    <Link
      to={`/connect/asistencias/${a.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-700/50 px-3 py-2 hover:bg-slate-700/30"
    >
      <span className="w-[110px] shrink-0 text-[12px] font-bold text-slate-100">
        {a.expedientNumber ?? `#${a.id}`}
      </span>
      <Badge className={ASSISTANCE_STATUS_STYLES[a.status] ?? "border-slate-600 text-slate-400"}>
        {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status}
      </Badge>
      {a.priority === "urgente" && <span className="text-[10px] font-black text-red-400">URG</span>}
      <span className="min-w-0 flex-1 truncate text-[12px] text-slate-300">
        {a.customerName || "Sin nombre"} · {a.serviceType} · {a.address || "sin dirección"}
      </span>
      <span className="text-[11px] text-slate-500">{a.workshopName ?? "sin taller"}</span>
      <span className="text-[11px] text-slate-500">{operario ?? "sin operario"}</span>
      <SlaBadge a={a} />
      <span className="w-[70px] shrink-0 text-right text-[11px] text-slate-500">{transcurrido(a.createdAtMs)}</span>
    </Link>
  );
}

export default function ColasOperativas() {
  const { cola: slug } = useParams<{ cola?: string }>();
  const pestana = PESTANAS.find((p) => p.slug === slug) ?? PESTANAS[0];

  const [rows, setRows] = useState<Asistencia[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const load = useCallback(() => {
    boFetch<{ data: Asistencia[] }>("/assistances/queues")
      .then((r) => { setRows(r.data); setCargando(false); })
      .catch((e) => { setError(e.message); setCargando(false); });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);
  useConnectEvents(() => load());

  const porCola = useMemo(() => {
    const m: Record<Cola, Asistencia[]> = { pending: [], assigning: [], active: [], attention: [] };
    for (const a of rows) (m[a.cola] ?? m.active).push(a);
    return m;
  }, [rows]);

  const visibles = pestana.cola ? porCola[pestana.cola] : rows;

  return (
    <div>
      <PageTitle
        title="Colas operativas"
        subtitle="Todas las asistencias en juego, de la más antigua a la más reciente. Se actualiza sola cada 15 segundos."
        actions={<Link to="/connect/centro" className="text-[13px] text-cyan-300 hover:underline">← Centro de control</Link>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {/* Pestañas */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-700">
        {PESTANAS.map((p) => {
          const n = p.cola ? porCola[p.cola].length : rows.length;
          const activa = p.slug === pestana.slug;
          return (
            <Link
              key={p.slug}
              to={`/connect/colas/${p.slug}`}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-[13px] font-semibold transition ${
                activa ? `${p.borde} ${p.color}` : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {p.label}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${
                activa ? "bg-slate-700 text-slate-100" : "bg-slate-800 text-slate-400"
              }`}>
                {n}
              </span>
            </Link>
          );
        })}
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : pestana.cola == null ? (
        // ── Resumen: todos los estados de un vistazo ──
        rows.length === 0 ? (
          <EmptyState message="No hay ninguna asistencia en juego ahora mismo." />
        ) : (
          <div className="flex flex-col gap-4">
            {PESTANAS.filter((p) => p.cola).map((p) => (
              <Card key={p.slug}>
                <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2.5">
                  <h3 className={`text-[13px] font-bold uppercase tracking-wide ${p.color}`}>
                    {p.label} <span className="ml-1 text-slate-500">({porCola[p.cola!].length})</span>
                  </h3>
                  {porCola[p.cola!].length > 0 && (
                    <Link to={`/connect/colas/${p.slug}`} className="text-[12px] text-cyan-300 hover:underline">
                      Ver a pantalla completa ↗
                    </Link>
                  )}
                </div>
                {porCola[p.cola!].length === 0 ? (
                  <p className="px-4 py-3 text-[12px] text-slate-600">Vacío</p>
                ) : (
                  porCola[p.cola!].map((a) => <Fila key={a.id} a={a} />)
                )}
              </Card>
            ))}
          </div>
        )
      ) : visibles.length === 0 ? (
        <EmptyState message={`No hay ninguna asistencia en «${pestana.label.toLowerCase()}» ahora mismo.`} />
      ) : (
        <div className="flex flex-col gap-3">
          {visibles.map((a) => <Tarjeta key={a.id} a={a} onError={setError} />)}
        </div>
      )}
    </div>
  );
}
