import { lazy, Suspense, useEffect, useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";
import { loadRoadsideTrackingFromBackend } from "../modules/roadsideAssistanceApi";
import type { RoadsideAssistanceStatus, RoadsideTrackingResponse } from "../modules/roadsideAssistanceTypes";
import {
  avisoDeSeguimiento,
  horaConSegundos,
  horaCorta,
  pasosDeSeguimiento,
} from "../modules/seguimientoEnTarjeta";

const RoadsideMap = lazy(() => import("./RoadsideMap"));

/**
 * El seguimiento de una asistencia dentro de la tarjeta de Pantalla técnicos.
 *
 * Tres bloques y nada más: el aviso con la ETA, el mapa y la tira de pasos.
 * Los datos salen de la misma llamada pública que usa la página del cliente
 * (`/api/roadside-tracking/:token`), cada 20 segundos, como allí. No hay
 * nada nuevo en el servidor: lo que ve el taller es lo que ve el cliente.
 */

type Props = {
  trackingToken: string;
  /** Lo que ya trae la tarjeta, para pintar algo antes de la primera respuesta. */
  status: string;
  etaMinutos?: number | null;
  etaKm?: string | null;
  /** Pasos a pintar; por defecto los de una asistencia. */
  flujo?: readonly RoadsideAssistanceStatus[];
};

const CADA_MS = 20_000;

export default function SeguimientoAsistenciaCard({ trackingToken, status, etaMinutos, etaKm, flujo }: Props) {
  const [data, setData] = useState<RoadsideTrackingResponse | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      try {
        const r = await loadRoadsideTrackingFromBackend(trackingToken);
        if (activo) setData(r);
      } catch {
        /* sin respuesta se deja lo último que había */
      }
    }
    void cargar();
    const t = window.setInterval(() => void cargar(), CADA_MS);
    return () => {
      activo = false;
      window.clearInterval(t);
    };
  }, [trackingToken]);

  const a = data?.assistance;
  const aviso = avisoDeSeguimiento(
    a ?? { status, etaMinutos, etaKm }
  );
  const pasos = a ? pasosDeSeguimiento(a, data?.events ?? [], flujo) : [];

  if (data?.expired) return null;

  return (
    <div className="mt-3 space-y-2">
      {aviso && (
        <div className={`flex items-center gap-3 rounded-2xl px-3 py-2 text-white ${aviso.tono === "teal" ? "bg-teal-600" : "bg-blue-600"}`}>
          <img src="/van-icon.png" alt="" className="h-9 w-auto shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-black">{aviso.titulo}</div>
            <div className="text-xs font-semibold text-blue-100">{aviso.detalle}</div>
            {aviso.actualizadoMs != null && (
              <div className="text-[11px] text-blue-200">
                Actualizado: {horaConSegundos(aviso.actualizadoMs)}
                {data?.etaWarning ? " · usando último ETA guardado" : ""}
              </div>
            )}
          </div>
        </div>
      )}

      {a && a.latitude != null && a.longitude != null && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="h-44">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">Cargando mapa…</div>}>
              <RoadsideMap
                assistanceLat={a.latitude}
                assistanceLng={a.longitude}
                vehicleLat={data?.vehiclePosition?.lat}
                vehicleLng={data?.vehiclePosition?.lng}
                vehiclePlate={data?.vanPlate || null}
                etaMinutos={a.etaMinutos}
                etaKm={a.etaKm}
                workshopLat={a.status === "en_camino_base" ? data?.workshop?.lat ?? null : null}
                workshopLng={a.status === "en_camino_base" ? data?.workshop?.lng ?? null : null}
              />
            </Suspense>
          </div>
          {a.etaActualizadoAt != null && (
            <div className="px-3 py-1 text-[11px] font-semibold text-slate-400">
              Última actualización: {horaConSegundos(a.etaActualizadoAt)}
            </div>
          )}
        </div>
      )}

      {pasos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pasos.map((p) => (
            <div
              key={p.status}
              className={`min-w-[88px] flex-1 rounded-lg border px-2 py-1.5 text-[11px] ${
                p.estado === "hecho"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : p.estado === "actual"
                    ? "border-orange-300 bg-orange-50 font-black text-orange-800"
                    : "border-slate-200 bg-slate-50 text-slate-400"
              }`}
            >
              <div className="flex items-center gap-1 font-bold">
                {p.estado === "hecho" ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className={`h-3 w-3 ${p.estado === "actual" ? "animate-pulse" : ""}`} />}
                {p.etiqueta}
              </div>
              {p.horaMs != null && <div className="pl-4 font-mono text-[10px] tabular-nums">{horaCorta(p.horaMs)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
