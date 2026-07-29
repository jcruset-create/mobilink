/**
 * Connect Pro — Asistencias activas a pantalla completa.
 *
 * Una tarjeta por asistencia con toda la información operativa y el progreso
 * de estados, al estilo de la pantalla de activas de Mobilink Assist.
 * Orden cronológico: primero la más antigua, que es la que más lleva esperando.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { abrirInforme } from "../services/informe";
import { useConnectEvents } from "../services/events";
import { PageTitle, Card, Badge, Button, ErrorBanner, EmptyState } from "../components/ui";
import { ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES, fmtDateTime } from "../types";

type Hito = { toStatus: string; occurredAtMs: number };

type Activa = {
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
};

/** Los 8 pasos del ciclo, como el semáforo de estados de Assist. */
const PASOS = [
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
          <div key={p.key} className="flex min-w-[62px] flex-col items-center gap-0.5">
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

function TarjetaActiva({ a, onError }: { a: Activa; onError: (m: string) => void }) {
  const vehiculo = parse(a.vehicle);
  const loc = parse(a.locationDetails);
  const operario = a.assignedTechName ?? a.liteUserName ?? a.coreTech;
  const furgoneta = [a.assignedVehicleName ?? a.coreVehicle, a.assignedVehiclePlate].filter(Boolean).join(" · ");
  const slaMin = a.slaDeadlineAtMs != null ? Math.round((a.slaDeadlineAtMs - Date.now()) / 60000) : null;

  return (
    <Card className="p-4">
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
            {slaMin != null && (
              <Badge className={slaMin < 0 ? "border-red-500/60 bg-red-500/15 text-red-300"
                : slaMin < 15 ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-slate-600 text-slate-400"}>
                {slaMin < 0 ? `SLA superado ${-slaMin} min` : `SLA ${slaMin} min`}
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
        <Button variant="ghost" onClick={() => abrirInforme(a.id, a.reportUrl).catch((e) => onError(e.message))}>
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

export default function AsistenciasActivas() {
  const [rows, setRows] = useState<Activa[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const load = useCallback(() => {
    boFetch<{ data: Activa[] }>("/assistances/active")
      .then((r) => { setRows(r.data); setCargando(false); })
      .catch((e) => { setError(e.message); setCargando(false); });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);
  useConnectEvents(() => load());

  return (
    <div>
      <PageTitle
        title={`Asistencias activas${rows.length ? ` (${rows.length})` : ""}`}
        subtitle="Todas las asistencias en curso, de la más antigua a la más reciente. Se actualiza sola cada 15 segundos."
        actions={<Link to="/connect/centro" className="text-[13px] text-cyan-300 hover:underline">← Centro de control</Link>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState message="No hay ninguna asistencia activa ahora mismo." />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((a) => <TarjetaActiva key={a.id} a={a} onError={setError} />)}
        </div>
      )}
    </div>
  );
}
