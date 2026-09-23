/**
 * Alta y edición de tipos de vehículo, sin React ni Supabase.
 *
 * Hasta ahora los tipos solo nacían por migración SQL: cuando aparecía una
 * cabeza tractora de 2 ejes había que escribir un `insert` y ejecutarlo a
 * mano. Aquí está la parte que decide, para poder probarla sin panel.
 *
 * La regla que manda: si el tipo tiene configuración de ejes ("2x4x2"), ella
 * decide cuántos ejes y cuántas ruedas tiene. No se teclean aparte, porque
 * entonces un tipo podía decir "3 ejes" y su configuración otra cosa, y el
 * plano de ruedas sale de la configuración.
 */

export interface CuentasDeEjes {
  /** Cuántos ejes: "2x4x2" son 3. */
  ejes: number;
  /** Cuántas ruedas en total: "2x4x2" son 8. */
  ruedas: number;
}

/** Ruedas que Mobilink sabe dibujar en un eje: 2 (simple) y 4 (gemela). */
const RUEDAS_VALIDAS = [2, 4];

/**
 * "2x4x2" → 3 ejes y 8 ruedas. `null` si la etiqueta no se entiende.
 *
 * Mismo criterio que `ruedasPorEje()` del servidor, que es quien genera el
 * plano: si aquí se aceptara algo que allí no, el tipo nacería sin posiciones
 * y nadie podría revisar sus vehículos.
 */
export function cuentasDeConfiguracion(config: string | null | undefined): CuentasDeEjes | null {
  const texto = (config ?? "").trim();
  if (!texto) return null;
  const partes = texto.split(/x/i).map((p) => Number(p.trim()));
  if (!partes.length) return null;
  if (partes.some((n) => !Number.isInteger(n) || !RUEDAS_VALIDAS.includes(n))) return null;
  return { ejes: partes.length, ruedas: partes.reduce((a, b) => a + b, 0) };
}

/**
 * La clave interna del tipo a partir de su descripción: "Cabeza tractora 2
 * ejes" → "cabeza_tractora_2_ejes". Es lo que ya usan los tipos de la
 * semilla (`camion_3_ejes`, `autocar_2x4x4`), y `nombre` es único en la
 * tabla, así que conviene que salga siempre igual del mismo texto.
 */
export function claveDeTipo(descripcion: string): string {
  return descripcion
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Lo que se rellena en el formulario, tal cual sale de los `input`. */
export interface BorradorTipo {
  nombre: string;
  descripcion: string;
  configuracionEjes: string;
  numeroEjes: string;
  numeroRuedas: string;
  revisionDias: string;
  revisionKm: string;
}

export interface TipoParaGuardar {
  nombre: string;
  descripcion: string;
  numero_ejes: number;
  numero_ruedas: number;
  configuracion_ejes: string | null;
  revision_intervalo_dias: number | null;
  revision_intervalo_km: number | null;
}

/**
 * Valida el borrador y lo traduce a la fila. Devuelve `{ error }` con un
 * motivo en castellano, o `{ tipo }` listo para guardar.
 *
 * Se rechaza antes de tocar la base de datos porque `nombre` es único y un
 * tipo a medio hacer estorba: sale en todos los desplegables de alta de
 * vehículos.
 */
export function prepararTipo(b: BorradorTipo): { error: string } | { tipo: TipoParaGuardar } {
  const descripcion = b.descripcion.trim();
  if (!descripcion) return { error: "Falta la descripción: es el nombre que se ve en los desplegables." };

  const nombre = (b.nombre.trim() || claveDeTipo(descripcion));
  if (!/^[a-z0-9_]+$/.test(nombre)) {
    return { error: "La clave solo admite minúsculas, números y guion bajo (ej. camion_3_ejes)." };
  }

  const config = b.configuracionEjes.trim();
  const cuentas = cuentasDeConfiguracion(config);
  if (config && !cuentas) {
    return { error: `No entiendo la configuración «${config}». Se escribe con las ruedas de cada eje: 2x4x2, 2x4x4…` };
  }

  const ejes = cuentas ? cuentas.ejes : Number(b.numeroEjes);
  const ruedas = cuentas ? cuentas.ruedas : Number(b.numeroRuedas);
  if (!Number.isInteger(ejes) || ejes < 1 || ejes > 8) return { error: "El número de ejes va de 1 a 8." };
  if (!Number.isInteger(ruedas) || ruedas < 2 || ruedas > 32) return { error: "El número de ruedas va de 2 a 32." };
  if (ruedas % 2 !== 0) return { error: "El número de ruedas tiene que ser par: van por pares en cada eje." };
  if (ruedas < ejes * 2) return { error: "Hay menos ruedas que ejes: cada eje lleva 2 o 4." };

  const entero = (v: string, limite: string): number | null | { error: string } => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n <= 0) return { error: `${limite} tiene que ser un número entero mayor que cero.` };
    return n;
  };
  const dias = entero(b.revisionDias, "La periodicidad de revisión en días");
  if (dias && typeof dias === "object") return dias;
  const km = entero(b.revisionKm, "La periodicidad de revisión en kilómetros");
  if (km && typeof km === "object") return km;

  return {
    tipo: {
      nombre,
      descripcion,
      numero_ejes: ejes,
      numero_ruedas: ruedas,
      configuracion_ejes: config || null,
      revision_intervalo_dias: dias as number | null,
      revision_intervalo_km: km as number | null,
    },
  };
}
