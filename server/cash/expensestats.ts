/**
 * En qué se va el dinero.
 *
 * Suma pagos por concepto y por periodo, los desglosa por destino y compara
 * con el periodo anterior. Es de solo lectura: aquí no se toca ni una fila.
 *
 * ## Solo lo clasificado, y dicho en voz alta
 *
 * Clasificar no es obligatorio —fue la decisión—, así que hay pagos sin
 * concepto y siempre los habrá. La tentación es esconderlos; el problema es que
 * entonces «hemos gastado 4.200 € en dietas este mes» convive con un total del
 * mostrador que no cuadra, y nadie sabe por qué.
 *
 * Así que **lo sin clasificar se cuenta y se enseña**, como una línea más. Un
 * hueco que se ve se rellena; uno escondido crece.
 *
 * ## El periodo se corta por la FECHA DE LA JORNADA
 *
 * Y no por `created_at_ms`. Un pago hecho a las 00:40 mientras la caja del día
 * anterior sigue abierta pertenece a esa jornada: es la que lo cerró y la que
 * lo cuadró. Cortar por el reloj metería ese gasto en el mes siguiente y
 * descuadraría el arqueo contra las estadísticas justo en fin de mes, que es
 * cuando alguien los compara.
 *
 * ## Céntimos enteros
 *
 * Todo son `BIGINT` sumados en la base y devueltos como enteros. Ni un `float`
 * en el camino: 0,1 + 0,2 no es 0,3 y una estadística de gasto que se desvía
 * un céntimo por cada mil operaciones acaba en una reunión.
 */

import pool from "../db.ts";
import { ErrorCaja } from "./repository.ts";

export type Granularidad = "dia" | "mes" | "anio";

export type FiltroGasto = {
  empresaId: string;
  /** Fechas de jornada, inclusive las dos. `YYYY-MM-DD`. */
  desde: string;
  hasta: string;
  granularidad: Granularidad;
  /** `null` = consolidado de toda la empresa. */
  centroId: string | null;
  /** Para bajar al desglose de UN concepto. */
  conceptoId: number | null;
};

export type LineaConcepto = {
  /** `null` = los pagos sin clasificar. */
  conceptoId: number | null;
  codigo: string | null;
  nombre: string;
  importeCentimos: number;
  operaciones: number;
};

export type LineaDestino = {
  destinoId: number | null;
  nombre: string;
  importeCentimos: number;
  operaciones: number;
};

export type PuntoSerie = {
  /** `2026-09-07`, `2026-09` o `2026`, según la granularidad. */
  periodo: string;
  importeCentimos: number;
  operaciones: number;
};

export type InformeGasto = {
  desde: string;
  hasta: string;
  granularidad: Granularidad;
  centroId: string | null;
  totalCentimos: number;
  operaciones: number;
  /** Cuánto del total NO está clasificado. Se enseña, no se esconde. */
  sinClasificarCentimos: number;
  conceptos: LineaConcepto[];
  destinos: LineaDestino[];
  serie: PuntoSerie[];
  /** El mismo tramo, justo antes. `null` si no se pidió comparar. */
  comparacion: {
    desde: string;
    hasta: string;
    totalCentimos: number;
    operaciones: number;
    /** Diferencia en céntimos. Positivo = se ha gastado más. */
    diferenciaCentimos: number;
    /** `null` cuando el periodo anterior fue cero: dividir entre cero no es «+100 %». */
    variacion: number | null;
  } | null;
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `date_trunc` no vale sobre un DATE con el formato que queremos enseñar. */
const FORMATO: Record<Granularidad, string> = {
  dia: "YYYY-MM-DD",
  mes: "YYYY-MM",
  anio: "YYYY",
};

function exigirFechas(desde: string, hasta: string): void {
  if (!FECHA.test(desde) || !FECHA.test(hasta)) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Las fechas tienen que ser YYYY-MM-DD.", 400);
  }
  if (desde > hasta) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "La fecha de inicio va después de la de fin.", 400);
  }
}

/**
 * El tramo inmediatamente anterior, de la MISMA longitud.
 *
 * Comparar septiembre con agosto tiene truco: uno tiene 30 días y otro 31, así
 * que «se ha gastado más» podría ser solo que el mes es más largo. Se compara
 * contra los mismos N días de antes, que es la comparación honesta.
 */
function tramoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const d = new Date(`${desde}T00:00:00Z`);
  const h = new Date(`${hasta}T00:00:00Z`);
  const dias = Math.round((h.getTime() - d.getTime()) / 86_400_000) + 1;
  const finAnterior = new Date(d.getTime() - 86_400_000);
  const inicioAnterior = new Date(finAnterior.getTime() - (dias - 1) * 86_400_000);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { desde: iso(inicioAnterior), hasta: iso(finAnterior) };
}

/**
 * Las filas de gasto del periodo: cada una con su importe, su concepto y su
 * destino.
 *
 * Casi siempre una fila es una operación. La excepción es el pago de una
 * liquidación de gastos de trabajadores: en la caja es UN pago por el total
 * —82,28 €— pero son varios gastos de distinta clase —66,40 de dietas y 15,88
 * de peajes—. Ese pago no lleva concepto (una operación solo admite uno), así
 * que contarlo por la operación lo dejaría entero en «sin clasificar», que es
 * justo lo que no es. Se cuenta por sus TICKETS, y el total no cambia: las
 * líneas incluidas suman lo que se pagó, y eso lo comprueba el pago.
 *
 * El destino de cada ticket se deriva igual que al pagar: si el concepto
 * imputa a una persona, es el trabajador de la liquidación; si a un centro de
 * coste, el del ticket; si a nadie, nadie.
 *
 * `MANUAL_OUT` entra junto con `PAYMENT`: una salida de caja es gasto igual que
 * un pago a proveedor, y dejarla fuera daría un total menor que el que ve quien
 * cierra la caja.
 *
 * Parámetros: $1 empresa, $2 desde, $3 hasta, $4 centro (o null).
 */
const GASTOS = `
  WITH pagos AS (
    SELECT o.id, o.importe_centimos, o.expense_concept_id, o.expense_target_id, s.fecha
      FROM cash_operations o
      JOIN cash_sessions s ON s.id = o.session_id
      JOIN cash_registers r ON r.id = s.register_id
     WHERE o.empresa_id = $1
       AND o.tipo IN ('PAYMENT','MANUAL_OUT')
       AND o.estado = 'CONFIRMED'
       /*
        * Las inversas de una anulación, fuera. Anular un pago deja el original
        * en REVERSED —ya fuera por el estado— y crea una operación inversa del
        * MISMO tipo, confirmada, con el importe en positivo y sin concepto. Sin
        * esta línea, cada pago anulado seguía sumando como gasto «sin
        * clasificar»: 20 € pagados y anulados eran 20 € de gasto.
        */
       AND o.reversa_de_id IS NULL
       AND s.fecha BETWEEN $2::date AND $3::date
       AND ($4::uuid IS NULL OR r.centro_id = $4::uuid)
  ),
  gastos AS (
    SELECT p.id AS operacion_id, p.fecha, p.importe_centimos AS importe,
           p.expense_concept_id AS concepto_id, p.expense_target_id AS destino_id
      FROM pagos p
     WHERE NOT EXISTS (SELECT 1 FROM cash_expense_claims cl WHERE cl.operation_pago_id = p.id)
    UNION ALL
    SELECT p.id, p.fecha, l.importe_centimos, l.expense_concept_id,
           CASE k.tipo_destino
             WHEN 'PERSONA' THEN cl.expense_target_id
             WHEN 'CENTRO_COSTE' THEN l.expense_target_id
             ELSE NULL
           END
      FROM pagos p
      JOIN cash_expense_claims cl ON cl.operation_pago_id = p.id
      JOIN cash_expense_claim_lines l ON l.claim_id = cl.id AND l.situacion = 'INCLUIDA'
      LEFT JOIN cash_expense_concepts k ON k.id = l.expense_concept_id
  )`;

/*
 * «Operaciones» sigue queriendo decir operaciones de caja: el pago de una
 * liquidación con cuatro tickets es UNA, aunque aporte cuatro filas de gasto.
 * Por eso se cuentan distintas.
 */
async function totalDe(
  empresaId: string,
  desde: string,
  hasta: string,
  centroId: string | null
): Promise<{ total: number; operaciones: number }> {
  const { rows } = await pool.query(
    `${GASTOS}
     SELECT COALESCE(SUM(g.importe), 0)::bigint AS total,
            COUNT(DISTINCT g.operacion_id)::int AS operaciones
       FROM gastos g`,
    [empresaId, desde, hasta, centroId]
  );
  return { total: Number(rows[0].total), operaciones: Number(rows[0].operaciones) };
}

export async function informeDeGasto(
  f: FiltroGasto,
  comparar: boolean
): Promise<InformeGasto> {
  exigirFechas(f.desde, f.hasta);

  const parametros = [f.empresaId, f.desde, f.hasta, f.centroId];

  /*
   * Por concepto. El `LEFT JOIN` y el COALESCE del nombre son lo que hace que
   * los pagos sin clasificar aparezcan como una línea más en vez de
   * desaparecer de la suma.
   */
  const { rows: porConcepto } = await pool.query(
    `${GASTOS}
     SELECT c.id AS concepto_id, c.codigo, COALESCE(c.nombre, 'Sin clasificar') AS nombre,
            SUM(g.importe)::bigint AS importe, COUNT(DISTINCT g.operacion_id)::int AS operaciones
       FROM gastos g
       LEFT JOIN cash_expense_concepts c ON c.id = g.concepto_id
      /*
       * El filtro de concepto se aplica AQUÍ también, y no solo a la serie y
       * a los destinos. Sin esto, elegir «Dietas» dejaba el gráfico filtrado
       * y el total con el gasto entero: dos números en la misma pantalla que
       * no se pueden sumar, y el que se cree es el grande.
       */
      WHERE ($5::int IS NULL OR g.concepto_id = $5::int)
      GROUP BY c.id, c.codigo, c.nombre
      ORDER BY importe DESC`,
    [...parametros, f.conceptoId]
  );

  /*
   * Por destino. Si se ha pedido un concepto concreto, se limita a él: «gasto
   * en dietas por operario» es la pregunta útil. Sin filtro, mezclaría personas
   * y centros de coste en una sola lista, que no significa nada.
   */
  const { rows: porDestino } = await pool.query(
    `${GASTOS}
     SELECT d.id AS destino_id, COALESCE(d.nombre, 'Sin destino') AS nombre,
            SUM(g.importe)::bigint AS importe, COUNT(DISTINCT g.operacion_id)::int AS operaciones
       FROM gastos g
       LEFT JOIN cash_expense_targets d ON d.id = g.destino_id
      WHERE ($5::int IS NULL OR g.concepto_id = $5::int)
        /*
         * Sin concepto elegido, solo lo que TIENE destino: mezclar operarios y
         * centros de coste en una lista no significa nada, y una fila «Sin
         * destino» con el resto del gasto entero no es un desglose.
         */
        AND ($5::int IS NOT NULL OR g.destino_id IS NOT NULL)
      GROUP BY d.id, d.nombre
      ORDER BY importe DESC`,
    [...parametros, f.conceptoId]
  );

  const { rows: serie } = await pool.query(
    `${GASTOS}
     SELECT to_char(g.fecha, '${FORMATO[f.granularidad]}') AS periodo,
            SUM(g.importe)::bigint AS importe, COUNT(DISTINCT g.operacion_id)::int AS operaciones
       FROM gastos g
      WHERE ($5::int IS NULL OR g.concepto_id = $5::int)
      GROUP BY periodo
      ORDER BY periodo`,
    [...parametros, f.conceptoId]
  );

  const conceptos: LineaConcepto[] = porConcepto.map((r) => ({
    conceptoId: r.concepto_id ?? null,
    codigo: r.codigo ?? null,
    nombre: r.nombre,
    importeCentimos: Number(r.importe),
    operaciones: Number(r.operaciones),
  }));

  const totalCentimos = conceptos.reduce((a, c) => a + c.importeCentimos, 0);
  /*
   * Sin filtro de concepto, las operaciones se cuentan aparte y DISTINTAS: el
   * pago de una liquidación con dietas y peajes sale en los dos conceptos, y
   * sumar por concepto lo contaría dos veces. Con un concepto elegido, la suma
   * es de un solo grupo y ya es exacta.
   */
  const operaciones =
    f.conceptoId == null
      ? (await totalDe(f.empresaId, f.desde, f.hasta, f.centroId)).operaciones
      : conceptos.reduce((a, c) => a + c.operaciones, 0);
  const sinClasificar = conceptos.find((c) => c.conceptoId == null);

  let comparacion: InformeGasto["comparacion"] = null;
  if (comparar) {
    const t = tramoAnterior(f.desde, f.hasta);
    const antes = await totalDe(f.empresaId, t.desde, t.hasta, f.centroId);
    comparacion = {
      desde: t.desde,
      hasta: t.hasta,
      totalCentimos: antes.total,
      operaciones: antes.operaciones,
      diferenciaCentimos: totalCentimos - antes.total,
      /*
       * `null` y no Infinity ni 100 cuando antes fue cero. «Ha subido un
       * infinito por ciento» no se puede enseñar, y «+100 %» sería mentira:
       * pasar de 0 a 50 € no es duplicar nada.
       */
      variacion: antes.total === 0 ? null : (totalCentimos - antes.total) / antes.total,
    };
  }

  return {
    desde: f.desde,
    hasta: f.hasta,
    granularidad: f.granularidad,
    centroId: f.centroId,
    totalCentimos,
    operaciones,
    sinClasificarCentimos: sinClasificar?.importeCentimos ?? 0,
    conceptos,
    destinos: porDestino.map((r) => ({
      destinoId: r.destino_id ?? null,
      nombre: r.nombre,
      importeCentimos: Number(r.importe),
      operaciones: Number(r.operaciones),
    })),
    serie: serie.map((r) => ({
      periodo: r.periodo,
      importeCentimos: Number(r.importe),
      operaciones: Number(r.operaciones),
    })),
    comparacion,
  };
}
