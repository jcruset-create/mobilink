/**
 * El informe mensual de flota: periodo, recuentos y neumáticos por posición.
 *
 * Primera pieza de la réplica del informe de Grupo Soledad
 * (`docs/PLAN_informe_mensual_plana.md`). Aquí no se habla con la base y no
 * se dibuja nada: entran las filas, sale la cabecera del informe.
 *
 * Es la parte donde los números se deciden, así que las decisiones van
 * escritas. Las cuatro que importan:
 *
 * ── 1 · Qué cuenta como «revisada» ──────────────────────────────────────────
 *
 * Una revisión COMPLETADA con fecha dentro del mes. Un borrador no es una
 * revisión —nadie ha terminado de mirar el vehículo— y una anulada tampoco.
 * Las tres variantes de «completada» sí cuentan, incluidas las que acabaron
 * con incidencia: el vehículo se miró, que es lo que el informe dice.
 *
 * ── 2 · Qué es «la flota controlada» ────────────────────────────────────────
 *
 * Los vehículos ACTIVOS de la empresa HOY, no los que había el mes del
 * informe. No es una simplificación por pereza: `tc_vehiculos` guarda
 * `created_at` pero no tiene fecha de baja, así que de un vehículo dado de
 * baja no se sabe cuándo lo fue. Y además los 807 vehículos de Plana tienen
 * todos `created_at` del 31/07/2026, que es el día de la importación, no el
 * día que entraron en la flota.
 *
 * O sea: con los datos que hay, «la flota que había en diciembre» no se
 * puede responder. Se responde «la flota que hay», y el informe lo dice en
 * `avisos` en lugar de presentar un número que parece lo que no es.
 *
 * ── 3 · Las posiciones son `orden_visual`, no el código ─────────────────────
 *
 * El original tiene una rejilla fija de «Posición 1…10» para toda la flota, y
 * un autobús de 6 ruedas y un autocar de 10 comparten las seis primeras. Eso
 * es exactamente `orden_visual`: 1 y 2 el eje delantero, 3 a 6 el segundo, 7
 * en adelante el tercero. Agrupar por `codigo_posicion` daría columnas
 * distintas para `E3_IZQ` y `E3_IZQ_EXT`, que en la rejilla son la misma.
 *
 * Hay un tipo con el `orden_visual` repetido (`tractora_2x2x4` tiene dos
 * posiciones en el 3 y dos en el 4). Eso es un defecto de ese tipo, no algo
 * que esto deba disimular: las mediciones se cuentan donde caen y el informe
 * avisa, porque dos ruedas sumadas en una celda son dos ruedas que nadie
 * encuentra cuando repasa el número.
 *
 * ── 4 · UNA rueda cuenta UNA vez, aunque se mida once ───────────────────────
 *
 * Esto no se vio hasta mirar los datos de verdad. En octubre de 2026, Plana
 * tiene 24.379 mediciones... de 2.116 ruedas. El arco de CheckPoint mide cada
 * vez que el autobús pasa por delante, unas once veces al mes.
 *
 * El original dice «TOTAL NEUMÁTICOS REVISADOS 3.604» para 590 autobuses: seis
 * por autobús, o sea cada rueda una vez. Contar mediciones habría impreso
 * 24.379 donde debe poner 2.116 — un número once veces mayor que parece
 * razonable hasta que alguien lo divide entre la flota.
 *
 * Así que la unidad de este informe es la RUEDA, no la medición: de cada
 * (vehículo, posición) se queda la medición MÁS RECIENTE del mes. Y es la que
 * hace falta de todas formas, porque el original enseña una profundidad por
 * posición, que es la última.
 *
 * ── 5 · Un vehículo sin tipo no tiene posiciones ────────────────────────────
 *
 * Y por tanto no puede salir en ninguna rejilla. En Plana son 82 de 807. No
 * se esconden: cuentan en la flota controlada —existen— y se dicen aparte,
 * porque un total de neumáticos que no cuadra con la flota se mira diez veces
 * antes de descubrir que faltaban ochenta y dos autobuses sin tipo.
 */

/** Los meses, para el título: «DICIEMBRE 2023». */
const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
] as const;

export interface Periodo {
  /** `2026-10` */
  mes: string;
  /** Primer día, inclusive. `2026-10-01` */
  desde: string;
  /** Último día, inclusive. `2026-10-31` */
  hasta: string;
  /** `OCTUBRE 2026` */
  etiqueta: string;
}

export class MesInvalido extends Error {}

/**
 * El periodo de un mes, con sus dos extremos inclusive.
 *
 * Inclusive los dos y no «desde el 1 hasta el 1 del siguiente sin llegar»
 * porque las fechas de revisión son `date`, no instantes: media noche no
 * existe en este dato y un rango semiabierto solo invita a equivocarse.
 */
export function periodoDeMes(mes: string): Periodo {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mes ?? "").trim());
  if (!m) throw new MesInvalido(`El mes tiene que ser «AAAA-MM», y ha llegado «${mes}»`);
  const anyo = Number(m[1]);
  const num = Number(m[2]);
  if (num < 1 || num > 12) throw new MesInvalido(`No existe el mes ${num}`);
  // Día 0 del mes SIGUIENTE es el último del pedido, y acierta con febrero y
  // con los bisiestos sin tener que saberse ninguna regla.
  const ultimo = new Date(Date.UTC(anyo, num, 0)).getUTCDate();
  const dd = (n: number) => String(n).padStart(2, "0");
  return {
    mes: `${m[1]}-${m[2]}`,
    desde: `${m[1]}-${m[2]}-01`,
    hasta: `${m[1]}-${m[2]}-${dd(ultimo)}`,
    etiqueta: `${MESES[num - 1]} ${anyo}`,
  };
}

/** ¿Cae esta fecha dentro del periodo? */
export function enPeriodo(fecha: string | null | undefined, p: Periodo): boolean {
  if (!fecha) return false;
  const f = String(fecha).slice(0, 10);
  return f >= p.desde && f <= p.hasta;
}

/** Los estados de revisión que cuentan como «el vehículo se ha mirado». */
export function revisionCuenta(estado: string | null | undefined): boolean {
  return String(estado ?? "").startsWith("completada");
}

// ── Lo que entra ───────────────────────────────────────────────────────────

export interface VehiculoRef {
  id: string;
  matricula: string | null;
  numeroUnidad: string | null;
  activo: boolean;
  /** `null` = sin tipo, y por tanto sin posiciones. */
  tipoId: string | null;
  baseId: string | null;
  base: string | null;
}

export interface RevisionRef {
  id: string;
  vehiculoId: string;
  fecha: string | null;
  estado: string | null;
}

export interface MedicionRef {
  revisionId: string;
  vehiculoId: string;
  /** `orden_visual` de la posición, 1..N. `null` si la posición no se conoce. */
  posicion: number | null;
  profundidadMm: number | null;
  /** La rueda no estaba, o no se pudo llegar a ella. */
  ausente: boolean;
}

// ── Lo que sale ────────────────────────────────────────────────────────────

export interface Recuentos {
  flotaControlada: number;
  flotaRevisada: number;
  pendientes: number;
  /** Sobre la flota controlada, con dos decimales. 0 si la flota es 0. */
  pctRevisada: number;
  pctPendientes: number;
}

export interface NeumaticosRevisados {
  /** Columnas de la rejilla, de la 1 a la última que tenga algo. */
  posiciones: number[];
  /** Cuántos neumáticos medidos en cada posición, en el mismo orden. */
  porPosicion: number[];
  total: number;
  /** Mediciones sin posición conocida: no caben en la rejilla pero existen. */
  sinPosicion: number;
}

export interface CabeceraMensual {
  empresa: string;
  empresaNombre: string | null;
  periodo: Periodo;
  recuentos: Recuentos;
  neumaticos: NeumaticosRevisados;
  avisos: string[];
}

// ── El cálculo ─────────────────────────────────────────────────────────────

const pct = (parte: number, total: number): number =>
  total === 0 ? 0 : Math.round((parte / total) * 10000) / 100;

/**
 * Flota controlada, revisada y pendiente.
 *
 * `incluirBaja` existe porque las dos lecturas son legítimas: el jefe de
 * taller quiere saber a cuántos de los que ruedan les falta la revisión, y
 * quien repasa el histórico quiere que los números de un mes cerrado no
 * cambien porque un autobús se haya dado de baja después. Por defecto, los
 * que ruedan.
 */
export function recuentos(
  vehiculos: VehiculoRef[],
  revisiones: RevisionRef[],
  periodo: Periodo,
  incluirBaja = false,
): Recuentos {
  const flota = vehiculos.filter((v) => incluirBaja || v.activo);
  const ids = new Set(flota.map((v) => v.id));

  const revisados = new Set<string>();
  for (const r of revisiones) {
    if (!revisionCuenta(r.estado)) continue;
    if (!enPeriodo(r.fecha, periodo)) continue;
    // Una revisión de un vehículo que no está en la flota contada no suma:
    // si no, con `incluirBaja` en false saldrían más revisados que flota.
    if (ids.has(r.vehiculoId)) revisados.add(r.vehiculoId);
  }

  const controlada = flota.length;
  const revisada = revisados.size;
  return {
    flotaControlada: controlada,
    flotaRevisada: revisada,
    pendientes: controlada - revisada,
    pctRevisada: pct(revisada, controlada),
    pctPendientes: pct(controlada - revisada, controlada),
  };
}

/** Una rueda del mes: una posición de un vehículo, con su última medición. */
export interface RuedaDelMes {
  vehiculoId: string;
  posicion: number;
  profundidadMm: number | null;
  /** La fecha de la revisión de la que sale el dato. */
  fecha: string;
  revisionId: string;
}

export interface RuedasDelMes {
  ruedas: RuedaDelMes[];
  /** Mediciones que no dicen en qué posición se tomaron. No se pueden agrupar. */
  sinPosicion: number;
}

/**
 * Las ruedas revisadas del mes, cada una una vez y con su última medición.
 *
 * Es la base de todo el informe: las rejillas por posición, las bandas de
 * profundidad y el detalle por vehículo salen de aquí, así que la regla de
 * «qué medición vale» se decide UNA vez y en un sitio.
 *
 * Vale la MÁS RECIENTE del mes. A igualdad de fecha —y las hay: once pasadas
 * por el arco el mismo día— desempata el `revisionId`, que no es una fecha
 * pero es estable: el mismo fichero de entrada da el mismo informe dos veces.
 * Sin desempate, dos ejecuciones podrían enseñar profundidades distintas y
 * nadie sabría cuál creerse.
 *
 * Una rueda ausente o inaccesible no cuenta: el original dice «TOTAL
 * NEUMÁTICOS REVISADOS», y un hueco donde no hay rueda no es un neumático
 * que alguien haya mirado.
 */
export function ruedasDelMes(
  revisiones: RevisionRef[],
  mediciones: MedicionRef[],
  periodo: Periodo,
  vehiculosContados?: Set<string>,
): RuedasDelMes {
  const fechaDe = new Map<string, string>();
  for (const r of revisiones) {
    if (revisionCuenta(r.estado) && enPeriodo(r.fecha, periodo)) {
      fechaDe.set(r.id, String(r.fecha).slice(0, 10));
    }
  }

  const mejor = new Map<string, RuedaDelMes>();
  let sinPosicion = 0;
  for (const m of mediciones) {
    const fecha = fechaDe.get(m.revisionId);
    if (!fecha) continue;
    if (vehiculosContados && !vehiculosContados.has(m.vehiculoId)) continue;
    if (m.ausente) continue;
    if (m.posicion == null) { sinPosicion += 1; continue; }

    const clave = `${m.vehiculoId}#${m.posicion}`;
    const actual = mejor.get(clave);
    const gana = !actual
      || fecha > actual.fecha
      || (fecha === actual.fecha && m.revisionId > actual.revisionId);
    if (gana) {
      mejor.set(clave, {
        vehiculoId: m.vehiculoId, posicion: m.posicion,
        profundidadMm: m.profundidadMm, fecha, revisionId: m.revisionId,
      });
    }
  }

  return { ruedas: [...mejor.values()], sinPosicion };
}

/** La rejilla «TOTAL NEUMÁTICOS REVISADOS» por posición. */
export function neumaticosRevisados(r: RuedasDelMes): NeumaticosRevisados {
  const porPosicion = new Map<number, number>();
  for (const rueda of r.ruedas) {
    porPosicion.set(rueda.posicion, (porPosicion.get(rueda.posicion) ?? 0) + 1);
  }

  // La rejilla llega hasta la última posición CON algo, no hasta un 10 fijo:
  // una flota de autobuses de seis ruedas no necesita cuatro columnas vacías.
  const ultima = porPosicion.size === 0 ? 0 : Math.max(...porPosicion.keys());
  const posiciones = Array.from({ length: ultima }, (_, i) => i + 1);
  const valores = posiciones.map((p) => porPosicion.get(p) ?? 0);

  return {
    posiciones,
    porPosicion: valores,
    total: valores.reduce((a, b) => a + b, 0),
    sinPosicion: r.sinPosicion,
  };
}

/**
 * Lo que el informe tiene que decir de sí mismo.
 *
 * Un informe que enseña 807 de flota y 3.604 neumáticos sin explicar que 82
 * vehículos no tienen tipo obliga a quien lo lee a buscar el descuadre. Los
 * avisos están para que no tenga que buscarlo.
 */
export function avisosDelMes(
  vehiculos: VehiculoRef[],
  n: NeumaticosRevisados,
  posicionesRepetidas: number,
  incluirBaja: boolean,
): string[] {
  const avisos: string[] = [];

  const sinTipo = vehiculos.filter((v) => (incluirBaja || v.activo) && !v.tipoId).length;
  if (sinTipo > 0) {
    avisos.push(
      `${sinTipo} vehículo(s) de la flota no tienen tipo asignado, así que no tienen `
      + "posiciones y no aparecen en las rejillas por posición. Cuentan en la flota "
      + "controlada porque existen.",
    );
  }

  if (n.sinPosicion > 0) {
    avisos.push(
      `${n.sinPosicion} medición(es) no dicen en qué posición se tomaron: están contadas `
      + "en el total pero no caben en ninguna columna.",
    );
  }

  if (posicionesRepetidas > 0) {
    avisos.push(
      `${posicionesRepetidas} posición(es) de algún tipo de vehículo comparten el mismo `
      + "número de orden, así que dos ruedas caen en la misma columna. Hay que arreglarlo "
      + "en el tipo, no en el informe.",
    );
  }

  // Lo que no se puede saber con lo que hay guardado, dicho en el propio papel.
  avisos.push(
    "La flota controlada es la de HOY: TyreControl no guarda la fecha de baja de un "
    + "vehículo, así que no se puede reconstruir cuántos había en el mes del informe.",
  );

  if (!incluirBaja) {
    const baja = vehiculos.filter((v) => !v.activo).length;
    if (baja > 0) {
      avisos.push(`${baja} vehículo(s) dados de baja quedan fuera de los recuentos.`);
    }
  }

  return avisos;
}
