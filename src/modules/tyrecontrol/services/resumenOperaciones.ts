/**
 * Resumen determinista de operaciones — EL generador, en singular.
 *
 * Lo usan el panel (VehiculoDetalle) y el servidor (POST
 * /api/tyrecontrol/intervencion/cerrar). Hasta la fase 1 del rediseño de
 * Intervenciones había dos copias del mapa de verbos —esta y una incrustada
 * en server/index.ts— y ya divergían: la del servidor no conocía las
 * correcciones y etiquetaba por medida donde el panel usaba el número
 * interno. §3.4 del prompt: unificar antes de añadir un tercer redactor.
 *
 * Autocontenido a propósito (sin imports): lo importa el servidor con tsx,
 * igual que itvValores.ts y checkpoint.ts, así que no puede depender de
 * ../types ni de nada del panel. Por eso define su propia vista estructural
 * de la operación (OperacionParaResumen) en vez de usar OperacionNeumatico.
 */

/** Lo mínimo que hay que saber de una operación para redactarla. */
export interface OperacionParaResumen {
  tipo_operacion: string;
  motivo?: string | null;
  is_anulada?: boolean | null;
  posicion_origen?: { codigo_posicion?: string | null; nombre?: string | null } | null;
  posicion_destino?: { codigo_posicion?: string | null; nombre?: string | null } | null;
  neumatico?: {
    numero_interno?: string | null;
    codigo_interno?: string | null;
    medida?: string | null;
  } | null;
}

// Verbo (participio) por tipo de operación, para redactar el informe.
const VERBO: Record<string, { uno: string; varios: string }> = {
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

// Motivo en minúsculas para la prosa: "Reparación (desgaste irregular)".
// Un motivo fuera de la lista (los catálogos son editables) no revienta:
// se imprime con los guiones bajos convertidos en espacios.
const MOTIVO_PROSA: Record<string, string> = {
  desgaste: "desgaste", pinchazo: "pinchazo", rotura: "rotura", preventivo: "preventivo",
  desgaste_irregular: "desgaste irregular", cambio_estacional: "cambio estacional",
  reparacion: "reparación", fin_vida: "fin de vida", error_montaje: "error de montaje", otro: "otro",
};

/// Etiqueta del lugar: posición si se sabe; si no, el neumático (número
/// interno antes que medida, que es lo que enseña el panel).
function posLabel(o: OperacionParaResumen): string {
  const p = o.posicion_destino ?? o.posicion_origen;
  return (
    p?.nombre ?? p?.codigo_posicion ??
    o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? o.neumatico?.medida ?? ""
  );
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
export function resumenOperaciones(ops: OperacionParaResumen[]): string[] {
  const activas = ops.filter((o) => !o.is_anulada);
  if (activas.length === 0) return [];

  const porTipo = new Map<string, string[]>();
  const reparacionesPorMotivo = new Map<string, string[]>();

  for (const o of activas) {
    if (o.tipo_operacion === "reparacion") {
      const motivo = o.motivo
        ? MOTIVO_PROSA[o.motivo] ?? o.motivo.replace(/_/g, " ")
        : "reparación";
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
