/**
 * Las reglas de una liquidación de gastos, sin base de datos.
 *
 * Aquí se decide qué puede pasar y qué no: a qué estado lleva cada acción,
 * cuánto suma la liquidación, qué impide presentarla y a quién se imputa cada
 * gasto. El servicio lo aplica dentro de una transacción; la pantalla lo
 * enseña. Vive aparte para poder probarlo entero sin levantar nada, que es lo
 * mismo que hace el resto de `server/cash/domain/`.
 *
 * Lo que NO decide: nada sobre el cajón. Una liquidación no mueve dinero hasta
 * que se paga, y el pago lo valida `registrarOperacion` como cualquier otro.
 */

import type { Centimos } from "../domain/money.ts";

// ── Estados ────────────────────────────────────────────────────────────────

export type EstadoLiquidacion =
  | "BORRADOR"
  | "PRESENTADA"
  | "APROBADA"
  | "RECHAZADA"
  | "PAGADA"
  | "ANULADA";

export type AccionLiquidacion =
  | "PRESENTAR"
  | "APROBAR"
  | "RECHAZAR"
  | "REABRIR"
  | "PAGAR"
  | "ANULAR"
  /** Solo lo dispara la anulación del pago, nunca una persona directamente. */
  | "DESHACER_PAGO";

/**
 * El grafo entero, escrito como datos para que se lea de un vistazo.
 *
 * Dos ausencias que son a propósito:
 *
 * · **PAGADA no se anula.** El dinero ya salió. Para deshacerla hay que anular
 *   el pago en la caja, y es ESA anulación la que la devuelve a APROBADA. Si
 *   se pudiera anular la liquidación directamente, quedaría un pago en el
 *   histórico sin nada que lo justifique.
 * · **PRESENTADA no vuelve a BORRADOR sin pasar por RECHAZADA.** Presentar
 *   congela las líneas; lo que se aprueba tiene que ser lo que se presentó. Si
 *   hay que corregir algo, se rechaza con el motivo y queda escrito por qué.
 */
const TRANSICIONES: Record<EstadoLiquidacion, Partial<Record<AccionLiquidacion, EstadoLiquidacion>>> = {
  BORRADOR: { PRESENTAR: "PRESENTADA", ANULAR: "ANULADA" },
  PRESENTADA: { APROBAR: "APROBADA", RECHAZAR: "RECHAZADA", ANULAR: "ANULADA" },
  /*
   * Una aprobada todavía se puede RECHAZAR mientras no esté pagada: entre la
   * aprobación y el pago puede aparecer un problema —el mismo ticket pagado
   * por otro lado— y la vuelta atrás tiene que dejar escrito por qué, como
   * cualquier rechazo. Anularla sería tirarla entera por un ticket.
   */
  APROBADA: { PAGAR: "PAGADA", RECHAZAR: "RECHAZADA", ANULAR: "ANULADA" },
  RECHAZADA: { REABRIR: "BORRADOR", ANULAR: "ANULADA" },
  PAGADA: { DESHACER_PAGO: "APROBADA" },
  ANULADA: {},
};

/** A dónde lleva la acción, o `null` si desde ahí no se puede. */
export function transicion(
  desde: EstadoLiquidacion,
  accion: AccionLiquidacion
): EstadoLiquidacion | null {
  return TRANSICIONES[desde]?.[accion] ?? null;
}

/**
 * Solo en borrador se tocan las líneas.
 *
 * Presentar congela: lo que se aprueba tiene que ser exactamente lo que se
 * presentó, y lo que se paga, lo que se aprobó.
 */
export function lineasEditables(estado: EstadoLiquidacion): boolean {
  return estado === "BORRADOR";
}

// ── Líneas ─────────────────────────────────────────────────────────────────

export type SituacionLinea = "INCLUIDA" | "EXCLUIDA";

export type EstadoAnalisis = "PENDIENTE" | "ANALIZANDO" | "LISTO" | "FALLIDO" | "OMITIDO";

export type LineaParaReglas = {
  id: number;
  situacion: SituacionLinea;
  fecha: string | null;
  importeCentimos: Centimos;
  conceptoId: number | null;
  conceptoNombre: string | null;
  moneda: string;
  revisada: boolean;
};

export type LineaDeTotal = {
  conceptoId: number | null;
  nombre: string;
  importeCentimos: Centimos;
  lineas: number;
};

export type Totales = {
  porConcepto: LineaDeTotal[];
  totalCentimos: Centimos;
  /** Cuántas líneas cuentan. Las excluidas no. */
  lineas: number;
};

/**
 * Cuánto suma, y cuánto de cada concepto.
 *
 * Solo las INCLUIDAS: una línea excluida sigue en la liquidación —se ve, con
 * su motivo— pero no se paga. Lo sin concepto sale como una línea más en vez
 * de desaparecer, con el mismo criterio que la estadística de gasto: un hueco
 * que se ve se rellena.
 */
export function totalesPorConcepto(lineas: readonly LineaParaReglas[]): Totales {
  const grupos = new Map<string, LineaDeTotal>();
  let total = 0;
  let cuenta = 0;
  for (const l of lineas) {
    if (l.situacion !== "INCLUIDA") continue;
    total += l.importeCentimos;
    cuenta += 1;
    const clave = l.conceptoId == null ? "-" : String(l.conceptoId);
    const previo = grupos.get(clave);
    if (previo) {
      previo.importeCentimos += l.importeCentimos;
      previo.lineas += 1;
    } else {
      grupos.set(clave, {
        conceptoId: l.conceptoId,
        nombre: l.conceptoId == null ? "Sin concepto" : (l.conceptoNombre ?? "Concepto"),
        importeCentimos: l.importeCentimos,
        lineas: 1,
      });
    }
  }
  /*
   * De mayor a menor, y el «Sin concepto» siempre al final: es lo que falta
   * por hacer, no una categoría más que compita por el primer puesto.
   */
  const porConcepto = [...grupos.values()].sort((a, b) => {
    if ((a.conceptoId == null) !== (b.conceptoId == null)) return a.conceptoId == null ? 1 : -1;
    return b.importeCentimos - a.importeCentimos || a.nombre.localeCompare(b.nombre, "es");
  });
  return { porConcepto, totalCentimos: total, lineas: cuenta };
}

/** De qué día a qué día son los tickets que cuentan. */
export function periodoDe(lineas: readonly LineaParaReglas[]): {
  desde: string | null;
  hasta: string | null;
} {
  let desde: string | null = null;
  let hasta: string | null = null;
  for (const l of lineas) {
    if (l.situacion !== "INCLUIDA" || !l.fecha) continue;
    // Fechas ISO: el orden de texto es el orden de calendario.
    if (desde == null || l.fecha < desde) desde = l.fecha;
    if (hasta == null || l.fecha > hasta) hasta = l.fecha;
  }
  return { desde, hasta };
}

// ── Qué impide presentar ───────────────────────────────────────────────────

export type CodigoBloqueo =
  | "SIN_LINEAS"
  | "TOTAL_CERO"
  | "LINEA_SIN_FECHA"
  | "LINEA_SIN_IMPORTE"
  | "LINEA_SIN_CONCEPTO"
  | "LINEA_EN_OTRA_MONEDA"
  | "LINEA_SIN_REVISAR"
  | "DUPLICADO_SIN_RESOLVER";

export type Bloqueo = { codigo: CodigoBloqueo; lineaId: number | null; mensaje: string };

/**
 * Todo lo que impide presentar, no solo lo primero.
 *
 * La pantalla lo enseña entero de una vez: descubrir los fallos de uno en uno,
 * pulsando «Presentar» cada vez, es la forma más lenta de arreglarlos.
 *
 * Lo que NO se mira, y es la regla más importante de este fichero: **si la
 * lectura automática ha funcionado.** Una línea cuya lectura falló, o que no
 * se llegó a leer, se presenta igual si una persona ha puesto los datos y la
 * ha dado por revisada. La IA ayuda; nunca es requisito para cobrar un gasto.
 *
 * Solo cuentan las INCLUIDAS. Una excluida no se paga, así que lo que le falte
 * no impide nada.
 */
export function bloqueosParaPresentar(
  lineas: readonly LineaParaReglas[],
  /** Líneas con alguna coincidencia de duplicado todavía sin resolver. */
  conDuplicadoPendiente: ReadonlySet<number>
): Bloqueo[] {
  const incluidas = lineas.filter((l) => l.situacion === "INCLUIDA");
  if (incluidas.length === 0) {
    return [{ codigo: "SIN_LINEAS", lineaId: null, mensaje: "No hay ningún ticket incluido." }];
  }

  const bloqueos: Bloqueo[] = [];
  incluidas.forEach((l, i) => {
    const cual = `Ticket ${i + 1}`;
    if (!l.fecha) {
      bloqueos.push({ codigo: "LINEA_SIN_FECHA", lineaId: l.id, mensaje: `${cual}: falta la fecha.` });
    }
    if (!(l.importeCentimos > 0)) {
      bloqueos.push({ codigo: "LINEA_SIN_IMPORTE", lineaId: l.id, mensaje: `${cual}: falta el importe.` });
    }
    if (l.conceptoId == null) {
      bloqueos.push({ codigo: "LINEA_SIN_CONCEPTO", lineaId: l.id, mensaje: `${cual}: falta el concepto de gasto.` });
    }
    if (l.moneda !== "EUR") {
      bloqueos.push({
        codigo: "LINEA_EN_OTRA_MONEDA",
        lineaId: l.id,
        mensaje: `${cual}: está en ${l.moneda}. Pon el importe en euros y cambia la moneda.`,
      });
    }
    if (!l.revisada) {
      bloqueos.push({ codigo: "LINEA_SIN_REVISAR", lineaId: l.id, mensaje: `${cual}: nadie lo ha revisado todavía.` });
    }
    if (conDuplicadoPendiente.has(l.id)) {
      bloqueos.push({
        codigo: "DUPLICADO_SIN_RESOLVER",
        lineaId: l.id,
        mensaje: `${cual}: puede estar repetido. Decide si lo es antes de presentar.`,
      });
    }
  });

  /*
   * Solo si todo lo demás está bien. Con líneas sin importe, «el total es
   * cero» es la consecuencia y no la causa, y enseñarlo también confunde.
   */
  if (bloqueos.length === 0 && totalesPorConcepto(lineas).totalCentimos <= 0) {
    bloqueos.push({ codigo: "TOTAL_CERO", lineaId: null, mensaje: "La liquidación suma cero." });
  }
  return bloqueos;
}

// ── A quién se imputa cada gasto ───────────────────────────────────────────

export type TipoDestino = "NINGUNO" | "PERSONA" | "CENTRO_COSTE";

/**
 * El destino de la estadística para una línea.
 *
 * Categoría y persona son dos preguntas distintas. La persona a la que se le
 * DEVUELVE el dinero es siempre la de la cabecera. A quién se IMPUTA el gasto
 * lo dice el concepto:
 *
 *   Dietas      (PERSONA)       → al trabajador de la liquidación
 *   Ferretería  (CENTRO_COSTE)  → al centro de coste que diga la línea, o a nadie
 *   Varios      (NINGUNO)       → a nadie
 *
 * Es exactamente lo que acepta `validarClasificacionGasto` de `config.ts`, que
 * se llama con este resultado al pagar.
 */
export function destinoDerivado(
  tipoDestino: TipoDestino,
  destinoDeLaLiquidacion: number,
  destinoDeLaLinea: number | null
): number | null {
  if (tipoDestino === "PERSONA") return destinoDeLaLiquidacion;
  if (tipoDestino === "CENTRO_COSTE") return destinoDeLaLinea;
  return null;
}

// ── Duplicados ─────────────────────────────────────────────────────────────

/** Mayúsculas, sin puntuación: «B-43.044.379» y «b43044379» son el mismo NIF. */
export function nifNormalizado(nif: string | null | undefined): string | null {
  const limpio = String(nif ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return limpio.length >= 5 ? limpio : null;
}

/** Sin tildes ni signos, en minúsculas y con los espacios colapsados. */
function nombreNormalizado(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Lo que hace que dos tickets sean el mismo gasto aunque sean dos ficheros.
 *
 * El mismo ticket escaneado dos veces, o fotografiado y escaneado, da dos
 * ficheros con huellas distintas. Lo que coincide es quién lo emitió, qué día
 * y por cuánto. El NIF manda sobre el nombre cuando está, porque el nombre de
 * un establecimiento se lee de mil maneras.
 *
 * `null` si falta algo de eso: sin fecha o sin importe no se puede afirmar que
 * dos papeles sean el mismo, y un falso positivo obliga a alguien a justificar
 * un ticket que no estaba repetido.
 */
export function claveDeDuplicado(l: {
  emisorNif: string | null;
  emisorNombre: string;
  fecha: string | null;
  importeCentimos: Centimos;
}): string | null {
  if (!l.fecha || !(l.importeCentimos > 0)) return null;
  const nif = nifNormalizado(l.emisorNif);
  if (nif) return `${l.fecha}|${l.importeCentimos}|NIF:${nif}`;
  const nombre = nombreNormalizado(l.emisorNombre ?? "");
  if (nombre.length < 3) return null;
  return `${l.fecha}|${l.importeCentimos}|NOMBRE:${nombre}`;
}
