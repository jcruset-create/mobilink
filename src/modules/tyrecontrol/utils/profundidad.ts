// Qué profundidad manda: la de la última revisión o la del propio neumático.
//
// Es la misma regla que aplica la APK (profundidadVigente en
// tyrecontrol_app/lib/models/models.dart). Si se cambia aquí hay que cambiarla
// allí: el técnico y el panel tienen que decir lo mismo de la misma rueda.
//
// Hasta ahora ganaba SIEMPRE la medición, y por eso un reesculturado no se
// veía: el neumático conserva su id, así que la medición vieja (4.7 mm) tapaba
// para siempre los 8 mm recién informados. Lo mismo con un usado montado con
// su profundidad a mano.

export type MedicionProf = {
  profundidad_mm?: number | null;
  /** Cuándo se tomó la medición (ISO). Sin ella no se puede comparar. */
  medido_en?: string | null;
} | null | undefined;

export type NeumaticoProf = {
  profundidad_actual_mm?: number | null;
  /** Lo mantiene un trigger en la base de datos, no las RPC. */
  profundidad_actualizada_en?: string | null;
} | null | undefined;

/**
 * Profundidad vigente en mm, o null si no hay ningún dato.
 *
 * Ante la duda (falta alguna de las dos fechas) manda la MEDICIÓN: es un dato
 * tomado con sonda sobre la rueda, y es el comportamiento que había antes de
 * esta corrección.
 */
export function profundidadVigente(med: MedicionProf, neu: NeumaticoProf): number | null {
  const medida = med?.profundidad_mm ?? null;
  const propia = neu?.profundidad_actual_mm ?? null;
  if (medida == null) return propia;
  if (propia == null) return medida;

  const tMed = fecha(med?.medido_en);
  const tProp = fecha(neu?.profundidad_actualizada_en);
  if (tMed == null || tProp == null) return medida;
  return tProp > tMed ? propia : medida;
}

function fecha(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
