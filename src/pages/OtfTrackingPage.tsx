/**
 * Seguimiento público de una OTF, para el responsable de la base: sin sesión,
 * con el enlace que le llega por correo al salir la furgoneta (o que copia la
 * oficina). Dónde está la furgoneta, cuándo llega, cómo van los trabajos y a
 * quién llamar, hasta que vuelve al taller.
 *
 * Los datos: /api/otf-tracking/:token, cada 20 segundos.
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Clock3, Phone } from "lucide-react";
import { horaCorta } from "../modules/seguimientoEnTarjeta";
import { avisoDeOtf, faseDeOtf, pasosDeOtf, type OtfSeguible } from "../modules/seguimientoOtf";

const RoadsideMap = lazy(() => import("../components/RoadsideMap"));

type Respuesta = {
  otf: OtfSeguible & {
    id: number; clientName: string | null; baseName: string | null; direccion: string | null;
    lat: number | null; lng: number | null; assignedTechName: string | null;
  };
  progreso: { hechos: number; total: number };
  vehiclePosition: { lat: number; lng: number } | null;
  eta: { minutos: number; km: string } | null;
  workshop: { lat: number; lng: number } | null;
  vanPlate: string | null;
  techPhone: string | null;
  actualizadoMs: number;
  enCurso: boolean;
  caducado: boolean;
};

const CADA_MS = 20_000;

/** Lo que se le dice al cliente en cada momento, en una frase. */
export function estadoParaCliente(d: Pick<Respuesta, "otf" | "progreso">): string {
  const f = faseDeOtf(d.otf);
  const { hechos, total } = d.progreso;
  switch (f) {
    case "asignada": return "La visita está programada.";
    case "en_camino": return "El técnico va de camino a su base.";
    case "en_punto": return "El técnico ha llegado a la base.";
    case "trabajando": return total ? `El técnico está trabajando: ${hechos} de ${total} trabajos hechos.` : "El técnico está trabajando.";
    case "finalizada": return "Los trabajos han terminado.";
    case "en_camino_base": return "Los trabajos han terminado y la furgoneta vuelve al taller.";
    case "llegada_taller": return "La furgoneta ha vuelto al taller. Gracias.";
  }
}

export default function OtfTrackingPage() {
  const { token } = useParams();
  const [d, setD] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    async function cargar() {
      try {
        const r = await fetch(`/api/otf-tracking/${encodeURIComponent(token ?? "")}`);
        const b = await r.json().catch(() => null);
        if (!r.ok) throw new Error(b?.error ?? "No se pudo cargar el seguimiento");
        if (vivo) { setD(b); setError(""); }
      } catch (e: any) {
        if (vivo) setError(e.message);
      }
    }
    void cargar();
    const t = window.setInterval(() => void cargar(), CADA_MS);
    return () => { vivo = false; window.clearInterval(t); };
  }, [token]);

  if (error && !d) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center text-slate-700">
        <div className="max-w-sm rounded-2xl bg-white p-6 shadow">
          <div className="text-lg font-black">Seguimiento no disponible</div>
          <div className="mt-2 text-sm">{error}</div>
        </div>
      </div>
    );
  }
  if (!d) return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500">Cargando…</div>;

  if (d.caducado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center text-slate-700">
        <div className="max-w-sm rounded-2xl bg-white p-6 shadow">
          <div className="text-lg font-black">Este seguimiento ha terminado</div>
          <div className="mt-2 text-sm">La visita de Mobilink{d.otf.baseName ? ` a ${d.otf.baseName}` : ""} ya ha concluido.</div>
        </div>
      </div>
    );
  }

  const o = d.otf;
  const aviso = avisoDeOtf(o, d.eta);
  const pasos = pasosDeOtf(o);
  const vuelta = o.enCaminoBaseAtMs != null && o.arrivedAtWorkshopMs == null;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-[#0f1c3a] px-4 py-4 text-white">
        <div className="mx-auto max-w-2xl">
          <div className="text-xs font-bold uppercase tracking-wider text-sky-200">Mobilink · Seguimiento de la visita</div>
          <h1 className="text-xl font-black">{o.baseName || o.clientName || "Su base"}</h1>
          {o.direccion && <div className="text-sm text-slate-300">{o.direccion}</div>}
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-base font-black">{estadoParaCliente(d)}</div>
          {o.assignedTechName && (
            <div className="mt-1 text-sm text-slate-600">
              Técnico: <b>{o.assignedTechName}</b>{d.vanPlate ? ` · furgoneta ${d.vanPlate}` : ""}
            </div>
          )}
          {d.techPhone && d.enCurso && (
            <a
              href={`tel:${d.techPhone}`}
              className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white hover:bg-emerald-700"
            >
              <Phone className="h-4 w-4" /> Llamar al técnico
            </a>
          )}
        </div>

        {aviso && (
          <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-white ${aviso.tono === "teal" ? "bg-teal-600" : "bg-blue-600"}`}>
            <img src="/van-icon.png" alt="" className="h-10 w-auto shrink-0" />
            <div>
              <div className="text-base font-black">{aviso.titulo}</div>
              <div className="text-sm font-semibold text-blue-50">{aviso.detalle}</div>
            </div>
          </div>
        )}

        {o.lat != null && o.lng != null && d.enCurso && (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="h-72">
              <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-400">Cargando mapa…</div>}>
                <RoadsideMap
                  assistanceLat={o.lat}
                  assistanceLng={o.lng}
                  vehicleLat={d.vehiclePosition?.lat}
                  vehicleLng={d.vehiclePosition?.lng}
                  vehiclePlate={d.vanPlate || null}
                  etaMinutos={d.eta?.minutos ?? null}
                  etaKm={d.eta?.km ?? null}
                  workshopLat={vuelta ? d.workshop?.lat ?? null : null}
                  workshopLng={vuelta ? d.workshop?.lng ?? null : null}
                />
              </Suspense>
            </div>
            <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-500">
              Se actualiza solo · última vez a las {horaCorta(d.actualizadoMs)}
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="mb-2 text-sm font-black">La visita, paso a paso</div>
          <ol className="flex flex-col gap-2">
            {pasos.map((p) => (
              <li key={p.fase} className="flex items-center gap-3 text-sm">
                {p.estado === "hecho" ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <Clock3 className={`h-5 w-5 shrink-0 ${p.estado === "actual" ? "animate-pulse text-orange-600" : "text-slate-300"}`} />
                )}
                <span className={`flex-1 ${p.estado === "pendiente" ? "text-slate-400" : p.estado === "actual" ? "font-black" : ""}`}>{p.etiqueta}</span>
                {p.horaMs != null && <span className="font-mono text-xs tabular-nums text-slate-500">{horaCorta(p.horaMs)}</span>}
              </li>
            ))}
          </ol>
          {d.progreso.total > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs font-bold text-slate-600">
                <span>Trabajos</span><span>{d.progreso.hechos} / {d.progreso.total}</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-orange-500" style={{ width: `${(d.progreso.hechos / d.progreso.total) * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
