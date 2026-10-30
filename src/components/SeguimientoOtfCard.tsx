import { lazy, Suspense, useEffect, useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";
import { apiFetch } from "../modules/apiFetch";
import { getAdminHeaders } from "../modules/adminHeaders";
import { horaConSegundos, horaCorta } from "../modules/seguimientoEnTarjeta";
import { avisoDeOtf, pasosDeOtf, type OtfSeguible } from "../modules/seguimientoOtf";

const RoadsideMap = lazy(() => import("./RoadsideMap"));

/**
 * El seguimiento de una OTF dentro de su tarjeta de Pantalla técnicos: el
 * mismo aviso con la ETA, el mismo mapa y la misma tira de pasos que una
 * asistencia (SeguimientoAsistenciaCard). Los datos vienen de
 * `/api/otf/:id/seguimiento` cada 20 segundos.
 */

type Respuesta = {
  otf: OtfSeguible & { lat?: number | null; lng?: number | null };
  vehiclePosition: { lat: number; lng: number } | null;
  eta: { minutos: number; km: string } | null;
  workshop: { lat: number; lng: number } | null;
  vanPlate: string | null;
  actualizadoMs: number;
  expired: boolean;
};

type Props = {
  otfId: number;
  apiBase: string;
  /** Lo que ya trae la tarjeta, para pintar la tira antes de la primera respuesta. */
  otf: OtfSeguible;
};

const CADA_MS = 20_000;

export default function SeguimientoOtfCard({ otfId, apiBase, otf }: Props) {
  const [data, setData] = useState<Respuesta | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      try {
        const res = await apiFetch(`${apiBase}/api/otf/${otfId}/seguimiento`, { headers: getAdminHeaders() });
        if (!res.ok) return;
        const body = (await res.json()) as Respuesta;
        if (activo && body && body.otf) setData(body);
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
  }, [otfId, apiBase]);

  const o = data?.otf ?? otf;
  const aviso = avisoDeOtf(o, data?.eta ?? null);
  const pasos = pasosDeOtf(o);
  const vuelta = o.enCaminoBaseAtMs != null && o.arrivedAtWorkshopMs == null;
  const lat = data?.otf.lat ?? null;
  const lng = data?.otf.lng ?? null;

  if (data?.expired) return null;

  return (
    <div className="mt-3 space-y-2">
      {aviso && (
        <div className={`flex items-center gap-3 rounded-2xl px-3 py-2 text-white ${aviso.tono === "teal" ? "bg-teal-600" : "bg-blue-600"}`}>
          <img src="/van-icon.png" alt="" className="h-9 w-auto shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-black">{aviso.titulo}</div>
            <div className="text-xs font-semibold text-blue-100">{aviso.detalle}</div>
            {data?.actualizadoMs != null && (
              <div className="text-[11px] text-blue-200">Actualizado: {horaConSegundos(data.actualizadoMs)}</div>
            )}
          </div>
        </div>
      )}

      {data && lat != null && lng != null && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="h-44">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">Cargando mapa…</div>}>
              <RoadsideMap
                assistanceLat={lat}
                assistanceLng={lng}
                vehicleLat={data.vehiclePosition?.lat}
                vehicleLng={data.vehiclePosition?.lng}
                vehiclePlate={data.vanPlate || null}
                etaMinutos={data.eta?.minutos ?? null}
                etaKm={data.eta?.km ?? null}
                workshopLat={vuelta ? data.workshop?.lat ?? null : null}
                workshopLng={vuelta ? data.workshop?.lng ?? null : null}
              />
            </Suspense>
          </div>
          <div className="px-3 py-1 text-[11px] font-semibold text-slate-400">
            Última actualización: {horaConSegundos(data.actualizadoMs)}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {pasos.map((p) => (
          <div
            key={p.fase}
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
    </div>
  );
}
