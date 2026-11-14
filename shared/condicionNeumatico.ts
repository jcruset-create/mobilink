/**
 * Condición de la goma de una operación y recuento de montajes — UN criterio
 * para panel (InformeIntervencion, ficha del vehículo) y servidor (PDF).
 *
 * - Con `condicion` explícita (histórico de albaranes importado) manda ella:
 *   un recauchutado no es nuevo aunque no lleve el marcador [USADO].
 * - Sin ella, el marcador de siempre: la RPC de montaje escribe «[USADO]» en
 *   las observaciones cuando la goma sale del almacén de usados.
 */
export type CondicionNeumatico = "nueva" | "usada" | "recauchutada";

export interface OperacionConCondicion {
  tipo_operacion?: string | null;
  is_anulada?: boolean | null;
  condicion?: string | null;
  observaciones?: string | null;
  posicion_origen?: { codigo_posicion?: string | null } | null;
  posicion_destino?: { codigo_posicion?: string | null } | null;
  posicion_origen_id?: string | null;
  posicion_destino_id?: string | null;
  estado_anterior?: string | null;
  /** Procedencia de la posición en el histórico importado; las operaciones normales no la traen. */
  posicion_fuente?: string | null;
}

export function condicionDeOperacion(o: OperacionConCondicion): CondicionNeumatico {
  if (o.condicion === "nueva" || o.condicion === "usada" || o.condicion === "recauchutada") return o.condicion;
  return (o.observaciones ?? "").includes("[USADO]") ? "usada" : "nueva";
}

/** ¿Se sabe en qué posición se hizo? (código o id de posición, origen o destino). */
export function tienePosicion(o: OperacionConCondicion): boolean {
  return !!(o.posicion_destino?.codigo_posicion || o.posicion_origen?.codigo_posicion || o.posicion_destino_id || o.posicion_origen_id);
}

export interface ResumenMontajes {
  /** Operaciones no anuladas, de cualquier tipo. */
  total: number;
  /** Montajes y sustituciones (una goma puesta) por condición. */
  montajes: number;
  /** Gomas retiradas: desmontajes y la cara «sale» de una sustitución. */
  desmontajes: number;
  porCondicion: Record<CondicionNeumatico, number>;
  conPosicion: number;
  sinPosicion: number;
  /** De las que tienen posición: confirmada (registrada o indicada) frente a deducida por la regla de ejes. */
  posicionConfirmada: number;
  posicionDeducida: number;
}

/** ¿La posición se dedujo (regla 2 nuevas → eje 1, 4 → eje 2, 6 → 2 al eje 1 y 4 al eje 2) en vez de registrarse? */
export function esPosicionDeducida(o: OperacionConCondicion): boolean {
  return tienePosicion(o) && o.posicion_fuente === "deducida";
}

/** Recuento honesto: el total son operaciones, no posiciones conocidas. */
export function resumenMontajes(ops: OperacionConCondicion[]): ResumenMontajes {
  const activas = ops.filter((o) => !o.is_anulada);
  // La cara que ENTRA de una sustitución es la que no venía de «montado»:
  // misma regla que la ficha de intervención y el PDF.
  const montajes = activas.filter((o) =>
    (o.tipo_operacion === "montaje" || o.tipo_operacion === "sustitucion") && o.estado_anterior !== "montado");
  const desmontajes = activas.filter((o) =>
    o.tipo_operacion === "desmontaje" || (o.tipo_operacion === "sustitucion" && o.estado_anterior === "montado"));
  const porCondicion: Record<CondicionNeumatico, number> = { nueva: 0, usada: 0, recauchutada: 0 };
  for (const o of montajes) porCondicion[condicionDeOperacion(o)]++;
  // La posición se cuenta sobre las gomas PUESTAS: la salida repite la de su
  // entrada y contarla otra vez duplicaría.
  const conPosicion = montajes.filter(tienePosicion).length;
  const posicionDeducida = montajes.filter(esPosicionDeducida).length;
  return { total: activas.length, montajes: montajes.length, desmontajes: desmontajes.length, porCondicion,
    conPosicion, sinPosicion: montajes.length - conPosicion,
    posicionConfirmada: conPosicion - posicionDeducida, posicionDeducida };
}

/** «4 montajes: 2 nuevos · 2 usados» (solo las condiciones con algo). */
export function textoPorCondicion(r: Pick<ResumenMontajes, "porCondicion">): string {
  const partes: string[] = [];
  if (r.porCondicion.nueva) partes.push(`${r.porCondicion.nueva} ${r.porCondicion.nueva === 1 ? "nuevo" : "nuevos"}`);
  if (r.porCondicion.usada) partes.push(`${r.porCondicion.usada} ${r.porCondicion.usada === 1 ? "usado" : "usados"}`);
  if (r.porCondicion.recauchutada) partes.push(`${r.porCondicion.recauchutada} ${r.porCondicion.recauchutada === 1 ? "recauchutado" : "recauchutados"}`);
  return partes.join(" · ");
}
