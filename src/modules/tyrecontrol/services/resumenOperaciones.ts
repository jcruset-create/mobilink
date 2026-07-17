import type { OperacionNeumatico, TipoOperacion } from "../types";
import { MOTIVO_OPERACION_LABELS } from "../types";

// Verbo (participio) por tipo de operación, para redactar el informe.
const VERBO: Partial<Record<TipoOperacion, { uno: string; varios: string }>> = {
  montaje: { uno: "Montado", varios: "Montados" },
  desmontaje: { uno: "Desmontado", varios: "Desmontados" },
  sustitucion: { uno: "Sustituido", varios: "Sustituidos" },
  rotacion: { uno: "Rotado", varios: "Rotados" },
  cambio_posicion: { uno: "Cambiado de posición", varios: "Cambiados de posición" },
  intercambio: { uno: "Intercambiado", varios: "Intercambiados" },
  descarte: { uno: "Descartado", varios: "Descartados" },
  correccion_posicion: { uno: "Corregida posición", varios: "Corregidas posiciones" },
  correccion_montado: { uno: "Corregido montaje", varios: "Corregidos montajes" },
};

function posLabel(o: OperacionNeumatico): string {
  const p = o.posicion_destino ?? o.posicion_origen;
  return p?.nombre ?? p?.codigo_posicion ?? o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "";
}

function unirY(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/// Genera un informe breve en lenguaje natural de las operaciones dadas.
/// Ej.: "Sustituidos 2 neumáticos: Eje 3 derecha y Eje 3 izquierda",
///      "Reparación (pinchazo): Eje 1 derecha".
export function resumenOperaciones(ops: OperacionNeumatico[]): string[] {
  const activas = ops.filter((o) => !o.is_anulada);
  if (activas.length === 0) return [];

  const porTipo = new Map<TipoOperacion, string[]>();
  const reparacionesPorMotivo = new Map<string, string[]>();

  for (const o of activas) {
    if (o.tipo_operacion === "reparacion") {
      const motivo = o.motivo ? MOTIVO_OPERACION_LABELS[o.motivo] : "reparación";
      const arr = reparacionesPorMotivo.get(motivo) ?? [];
      const pl = posLabel(o);
      if (pl) arr.push(pl);
      reparacionesPorMotivo.set(motivo, arr);
      continue;
    }
    const arr = porTipo.get(o.tipo_operacion) ?? [];
    const pl = posLabel(o);
    if (pl) arr.push(pl);
    porTipo.set(o.tipo_operacion, arr);
  }

  const lineas: string[] = [];
  for (const [tipo, poss] of porTipo) {
    const v = VERBO[tipo];
    const n = poss.length || activas.filter((o) => o.tipo_operacion === tipo).length;
    const sustantivo = n === 1 ? "neumático" : "neumáticos";
    const verbo = v ? (n === 1 ? v.uno : v.varios) : tipo;
    const lugares = poss.length ? `: ${unirY(poss)}` : "";
    lineas.push(`${verbo} ${n} ${sustantivo}${lugares}`);
  }
  for (const [motivo, poss] of reparacionesPorMotivo) {
    const lugares = poss.length ? `: ${unirY(poss)}` : "";
    lineas.push(`Reparación (${motivo.toLowerCase()})${lugares}`);
  }
  return lineas;
}
