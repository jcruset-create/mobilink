import { useEffect, useState } from "react";
import type { MontajeActual, PosicionVehiculo, TipoVehiculo } from "../types";
import { presionTxt } from "../types";
import {
  listarUltimasMedicionesVehiculo, listarPresionesCatalogoPorModelo,
  listarFotosCatalogoPorModelo, claveModeloCatalogo, obtenerUmbralesEmpresa,
} from "../services/data";

/**
 * Vista de revisión del vehículo: el plano en el centro y una ficha por
 * neumático a cada lado, como la hoja que se mira en el taller.
 *
 * Es solo presentación: montar, desmontar y calibrar siguen en el plano
 * interactivo. Aquí lo que importa es que de un vistazo se vea qué rueda
 * está bien y cuál no.
 */

const VERDE = { borde: "border-emerald-500/60", texto: "text-emerald-300", punto: "bg-emerald-400" };
const AMBAR = { borde: "border-amber-500/70", texto: "text-amber-300", punto: "bg-amber-400" };
const ROJO = { borde: "border-rose-500/70", texto: "text-rose-300", punto: "bg-rose-400" };

interface Props {
  vehiculoId: string;
  empresaId: string;
  tipo?: TipoVehiculo | null;
  imagen?: string | null;
  posiciones: PosicionVehiculo[];
  montajes: MontajeActual[];
  onFicha?: (neumaticoId: string) => void;
}

export default function FichasNeumaticos({ vehiculoId, empresaId, tipo, imagen, posiciones, montajes, onFicha }: Props) {
  const [mediciones, setMediciones] = useState<Record<string, { profundidad_mm: number | null; presion_bar: number | null }>>({});
  const [presiones, setPresiones] = useState<Record<string, number>>({});
  const [fotos, setFotos] = useState<Record<string, string>>({});
  const [minima, setMinima] = useState(3);
  const [aviso, setAviso] = useState(5);

  useEffect(() => {
    listarUltimasMedicionesVehiculo(vehiculoId).then(setMediciones).catch(() => setMediciones({}));
  }, [vehiculoId]);
  useEffect(() => {
    listarPresionesCatalogoPorModelo().then(setPresiones).catch(() => setPresiones({}));
    listarFotosCatalogoPorModelo().then(setFotos).catch(() => setFotos({}));
  }, []);
  useEffect(() => {
    obtenerUmbralesEmpresa(empresaId)
      .then((u) => { if (u) { setMinima(u.profundidad_minima_mm); setAviso(u.profundidad_aviso_mm); } })
      .catch(() => { /* se quedan los valores por defecto */ });
  }, [empresaId]);

  // Numeración estable: el orden de revisión si está definido, si no el visual.
  const ordenadas = [...posiciones].sort((a, b) =>
    (a.orden_revision ?? a.orden_visual ?? 0) - (b.orden_revision ?? b.orden_visual ?? 0));
  const numeroDe = new Map(ordenadas.map((p, i) => [p.id, i + 1]));

  const izquierda = ordenadas.filter((p) => p.lado === "izq");
  const derecha = ordenadas.filter((p) => p.lado === "der");
  const sinLado = ordenadas.filter((p) => p.lado !== "izq" && p.lado !== "der");

  function Ficha({ p }: { p: PosicionVehiculo }) {
    const montaje = montajes.find((m) => m.posicion_id === p.id);
    const neu = montaje?.neumatico;
    const num = numeroDe.get(p.id) ?? 0;

    if (!neu) {
      return (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-slate-300">{num}</span>
            <span className="text-[12px] font-bold uppercase text-slate-400">{p.nombre ?? p.codigo_posicion}</span>
          </div>
          <div className="mt-2 text-[12px] text-slate-500">Sin neumático montado.</div>
        </div>
      );
    }

    const medicion = mediciones[neu.id];
    const profundidad = medicion?.profundidad_mm ?? neu.profundidad_actual_mm ?? null;
    const clave = neu.marca && neu.modelo && neu.medida
      ? claveModeloCatalogo(neu.marca, neu.modelo) : "";
    const presionMedida = medicion?.presion_bar ?? null;
    const presionRecom = neu.producto_almacen?.referencia?.presion_maxima_bar
      ?? presiones[`${neu.marca}|${neu.modelo}|${neu.medida}`.toLowerCase().replace(/\s+/g, "")] ?? null;

    // El color sale de la profundidad: por debajo del mínimo legal es crítico.
    const c = profundidad == null ? VERDE : profundidad < minima ? ROJO : profundidad < aviso ? AMBAR : VERDE;
    const foto = fotos[clave];

    return (
      <button
        onClick={() => onFicha?.(neu.id)}
        className={`w-full rounded-xl border-2 ${c.borde} bg-slate-900/80 p-3 text-left transition hover:bg-slate-800/80`}
      >
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full ${c.punto} text-[11px] font-bold text-slate-900`}>{num}</span>
          <span className={`text-[12px] font-bold uppercase leading-tight ${c.texto}`}>{p.nombre ?? p.codigo_posicion}</span>
        </div>

        <div className="mt-2 flex gap-3">
          {foto ? (
            <img src={foto} alt={neu.modelo ?? ""} className="h-24 w-16 shrink-0 rounded bg-slate-950 object-contain" />
          ) : (
            <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded border border-dashed border-slate-700 text-[9px] text-slate-600">sin foto</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-black text-slate-100">{neu.codigo_interno ?? neu.numero_serie ?? "—"}</div>
            <div className="truncate text-[12px] text-slate-300">{neu.medida ?? "—"}</div>
            <div className="truncate text-[12px] text-slate-300">{[neu.marca, neu.modelo].filter(Boolean).join(" ") || "—"}</div>
            {neu.dot && <div className="text-[12px] text-slate-400">DOT {neu.dot}</div>}
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[11px] font-bold text-slate-400">Prof.</span>
              <span className={`text-[13px] font-black ${c.texto}`}>{profundidad != null ? `${profundidad} mm` : "—"}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold text-slate-400">Pres.</span>
              <span className="text-[13px] font-semibold text-slate-200">
                {presionMedida != null ? `${presionTxt(presionMedida)} bar` : presionRecom != null ? `${presionTxt(presionRecom)} bar` : "—"}
              </span>
            </div>
          </div>
        </div>
        <div className={`mt-2 h-2.5 w-2.5 rounded-full ${c.punto}`} />
      </button>
    );
  }

  if (posiciones.length === 0) return null;

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        {izquierda.map((p) => <Ficha key={p.id} p={p} />)}
      </div>

      {/* Mismo recuadro para todos los modelos (3:2, como el plano del
          semirremolque), para que en la tablet no baile el tamaño. */}
      <div className="overflow-hidden rounded-xl bg-slate-950" style={{ aspectRatio: "3 / 2" }}>
        {imagen ? (
          <img src={imagen} alt={tipo?.nombre ?? "plano"} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-slate-500">
            Sin imagen de chasis para esta configuración.
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {derecha.map((p) => <Ficha key={p.id} p={p} />)}
      </div>

      {sinLado.length > 0 && (
        <div className="flex flex-col gap-3 lg:col-span-3">
          {sinLado.map((p) => <Ficha key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}
