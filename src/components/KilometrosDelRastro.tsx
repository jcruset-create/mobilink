/**
 * Los kilómetros del servicio, según el rastro GPS del móvil del técnico.
 *
 * Calcula y explica; no escribe. El cálculo vive en el servidor
 * (`server/connect/recorrido.ts`) y es el MISMO que usa Assist Central Pro:
 * un solo criterio para los dos paneles, para que dentro de un año no
 * enseñen kilómetros distintos del mismo servicio.
 *
 * Se enseña de qué se fía uno —cuántos puntos, cuántos descartados, qué
 * agujeros tiene el rastro— porque un rastro incompleto da de menos y eso no
 * se ve mirando el número.
 *
 * El botón de darlos por buenos solo sale cuando el técnico no anotó ninguno:
 * corregir a la baja lo que declaró quien hizo el servicio no es cosa de un
 * botón.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Recorrido = {
  ida: number; trabajo: number; vuelta: number; total: number;
  propuestaKm: number; puntos: number; puntosDescartados: number;
  huecos: Array<{ minutos: number; kmEnLineaRecta: number }>;
  minutosSinRastro: number;
  calidad: "bueno" | "con_huecos" | "insuficiente";
};

export default function KilometrosDelRastro({ assistanceId, serviceKm, onAplicado }: {
  assistanceId: number;
  /** Los que anotó el técnico al finalizar, si los anotó. */
  serviceKm: number | null;
  onAplicado?: (km: number) => void;
}) {
  const [r, setR] = useState<Recorrido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aplicados, setAplicados] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/roadside-assistances/${assistanceId}/recorrido`,
        { headers: getAdminHeaders() },
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Error");
      setR((await res.json()).data);
    } catch (e: any) { setError(e.message); }
  }, [assistanceId]);

  useEffect(() => { void cargar(); }, [cargar]);

  if (error || !r) return null;

  const declarados = aplicados ?? serviceKm;

  if (r.calidad === "insuficiente") {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-[13px] text-slate-500">
        Sin rastro GPS suficiente para calcular los kilómetros
        {r.puntos > 0 && ` (${r.puntos} punto${r.puntos === 1 ? "" : "s"})`}.
      </div>
    );
  }

  const aplicar = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/roadside-assistances/${assistanceId}/recorrido/aplicar`,
        {
          method: "POST",
          headers: { ...getAdminHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ km: r.propuestaKm }),
        },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Error guardando");
      setAplicados(r.propuestaKm);
      onAplicado?.(r.propuestaKm);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const diferenciaGrande =
    declarados != null && declarados > 0 &&
    Math.abs(declarados - r.propuestaKm) > Math.max(10, r.propuestaKm * 0.25);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-[13px]">
      <h4 className="mb-1 font-semibold text-slate-200">Kilómetros según el rastro del móvil</h4>
      <p className="text-slate-300">
        Ida {r.ida} km · Vuelta {r.vuelta} km
        {r.trabajo > 0 && <span className="text-slate-500"> · en el punto {r.trabajo} km</span>}
      </p>
      <p className="mt-1 text-slate-200">
        Desplazamiento del servicio: <b>{r.propuestaKm} km</b>
        <span className="text-slate-500"> (ida y vuelta)</span>
      </p>
      <p className="mt-1 text-[12px] text-slate-500">
        {r.puntos} puntos
        {r.puntosDescartados > 0 && `, ${r.puntosDescartados} descartados por saltos o mala precisión`}
      </p>

      {r.huecos.length > 0 && (
        <p className="mt-1 text-[12px] text-amber-300">
          ⚠ El rastro tiene {r.huecos.length} agujero{r.huecos.length === 1 ? "" : "s"} que suman{" "}
          {r.minutosSinRastro} min sin posiciones: lo calculado se queda corto.
        </p>
      )}

      {declarados != null && declarados > 0 ? (
        <p className="mt-2 text-[12px] text-slate-500">
          El técnico anotó {declarados} km.
          {diferenciaGrande && " La diferencia con el rastro es grande: conviene mirarla antes de facturar."}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={aplicar}
            disabled={busy}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "Guardando…" : `Dar por buenos ${r.propuestaKm} km`}
          </button>
          <span className="text-[12px] text-slate-500">
            Se guardan como kilómetros del servicio y queda anotado en el historial.
          </span>
        </div>
      )}

      {error && <p className="mt-1 text-[12px] text-red-300">{error}</p>}
    </div>
  );
}
