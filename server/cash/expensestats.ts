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
import { proveedorDeFila, type ViaProveedor } from "./domain/proveedores.ts";

export type { ViaProveedor };

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
    SELECT o.id, o.importe_centimos, o.expense_concept_id, o.expense_target_id, s.fecha,
           o.numero, o.party_nombre, o.external_document_reference, r.nombre AS caja,
           doc.party_external_id AS erp_codigo, doc.party_nombre AS erp_nombre, doc.numero AS doc_numero
      FROM cash_operations o
      JOIN cash_sessions s ON s.id = o.session_id
      JOIN cash_registers r ON r.id = s.register_id
      LEFT JOIN cash_external_documents doc ON doc.id = o.documento_id
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
           p.expense_concept_id AS concepto_id, p.expense_target_id AS destino_id,
           /* A quién se le paga: ver «Por proveedor» más abajo. */
           p.erp_codigo, NULL::text AS nif,
           COALESCE(NULLIF(p.erp_nombre, ''), p.party_nombre) AS proveedor_nombre,
           p.numero, p.caja,
           COALESCE(NULLIF(p.doc_numero, ''), p.external_document_reference) AS documento,
           NULL::int AS linea_id
      FROM pagos p
     WHERE NOT EXISTS (SELECT 1 FROM cash_expense_claims cl WHERE cl.operation_pago_id = p.id)
    UNION ALL
    SELECT p.id, p.fecha, l.importe_centimos, l.expense_concept_id,
           CASE k.tipo_destino
             WHEN 'PERSONA' THEN cl.expense_target_id
             WHEN 'CENTRO_COSTE' THEN l.expense_target_id
             ELSE NULL
           END,
           /* En una liquidación, el proveedor es el EMISOR de cada ticket, no el trabajador. */
           NULL::text, l.emisor_nif, l.emisor_nombre,
           p.numero, p.caja,
           'Liquidación ' || cl.numero || ' · ' || cl.empleado_nombre,
           l.id
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

// ── Por proveedor ──────────────────────────────────────────────────────────
//
// A quién se le paga, con el mismo corte que el reparto por concepto: mismas
// filas de gasto, mismo periodo por fecha de jornada, mismas anulaciones
// fuera. Solo cambia por qué se agrupa.
//
// El proveedor no es un campo de la operación: hay que reconocerlo, y cada
// origen trae lo suyo. Se usa lo más fiable que haya, en este orden:
//
//   1. El CÓDIGO de proveedor de la ERP, si el pago salda una factura suya.
//      Es el único identificador que no depende de cómo se escribió nada.
//   2. El NIF del emisor, en los tickets de una liquidación de gastos. Ahí el
//      proveedor es el restaurante o la autopista del ticket, no el
//      trabajador: él es el destino, y para eso ya está el desglose por
//      destino.
//   3. El NOMBRE escrito, en un pago a mano. Sin mayúsculas, tildes,
//      puntuación ni forma jurídica: «Repsol» y «REPSOL, S.A.» son el mismo.
//      Lo que no une es «Gasolinera Repsol Valls», y se dice en la pantalla.
//
// Lo que no trae nada —una salida de caja sin nombre— sale como «Sin
// proveedor», igual que lo sin clasificar: el total tiene que cuadrar.
//
// La agrupación se hace aquí y no en SQL porque la normalización del nombre
// es código que se prueba sin base, y son las filas de un periodo de UNA
// empresa: cientos, no millones.

export type LineaProveedor = {
  /** `null` = los pagos sin proveedor reconocible. */
  clave: string | null;
  nombre: string;
  via: ViaProveedor | null;
  /** El código de la ERP o el NIF, tal y como se enseña. `null` si va por nombre. */
  identificador: string | null;
  importeCentimos: number;
  operaciones: number;
  /** El concepto con más importe dentro de este proveedor. `null` = sin clasificar. */
  conceptoPrincipal: string | null;
  /** Cuántos de sus gastos están sin clasificar: lo que «Clasificar como…» rellenaría. */
  pendientesDeClasificar: number;
};

export type InformeProveedores = {
  desde: string;
  hasta: string;
  centroId: string | null;
  conceptoId: number | null;
  totalCentimos: number;
  operaciones: number;
  sinProveedorCentimos: number;
  proveedores: LineaProveedor[];
};

export type PagoDeProveedor = {
  operacionId: number;
  /** El ticket, si el gasto sale de una liquidación: se clasifica ticket a ticket. */
  lineaId: number | null;
  conceptoId: number | null;
  numero: string;
  fecha: string;
  caja: string;
  documento: string | null;
  concepto: string | null;
  destino: string | null;
  importeCentimos: number;
};

type FilaProveedor = {
  operacionId: number;
  lineaId: number | null;
  conceptoId: number | null;
  numero: string;
  fecha: string;
  caja: string;
  documento: string | null;
  concepto: string | null;
  destino: string | null;
  importeCentimos: number;
  erpCodigo: string | null;
  nif: string | null;
  nombre: string | null;
};

async function filasDeProveedores(
  f: Omit<FiltroGasto, "granularidad">
): Promise<FilaProveedor[]> {
  exigirFechas(f.desde, f.hasta);
  const { rows } = await pool.query(
    `${GASTOS}
     SELECT g.operacion_id, g.linea_id, g.concepto_id, g.numero, g.fecha::text AS fecha, g.caja, g.documento,
            g.importe, g.erp_codigo, g.nif, g.proveedor_nombre,
            c.nombre AS concepto, d.nombre AS destino
       FROM gastos g
       LEFT JOIN cash_expense_concepts c ON c.id = g.concepto_id
       LEFT JOIN cash_expense_targets d ON d.id = g.destino_id
      WHERE ($5::int IS NULL OR g.concepto_id = $5::int)
      ORDER BY g.fecha, g.operacion_id, g.linea_id`,
    [f.empresaId, f.desde, f.hasta, f.centroId, f.conceptoId]
  );
  return rows.map((r) => ({
    operacionId: Number(r.operacion_id),
    lineaId: r.linea_id == null ? null : Number(r.linea_id),
    conceptoId: r.concepto_id == null ? null : Number(r.concepto_id),
    numero: r.numero,
    fecha: r.fecha,
    caja: r.caja,
    documento: r.documento || null,
    concepto: r.concepto ?? null,
    destino: r.destino ?? null,
    importeCentimos: Number(r.importe),
    erpCodigo: r.erp_codigo ?? null,
    nif: r.nif ?? null,
    nombre: r.proveedor_nombre ?? null,
  }));
}

export async function gastoPorProveedor(
  f: Omit<FiltroGasto, "granularidad">
): Promise<InformeProveedores> {
  const filas = await filasDeProveedores(f);

  type Grupo = {
    via: ViaProveedor | null;
    identificador: string | null;
    /** El nombre que se enseña: el más reciente. Las filas vienen por fecha. */
    nombre: string;
    importe: number;
    operaciones: Set<number>;
    porConcepto: Map<string | null, number>;
    pendientes: number;
  };
  const grupos = new Map<string | null, Grupo>();
  const todas = new Set<number>();

  for (const fila of filas) {
    todas.add(fila.operacionId);
    const p = proveedorDeFila(fila);
    const clave = p?.clave ?? null;
    let g = grupos.get(clave);
    if (!g) {
      g = {
        via: p?.via ?? null,
        identificador: p?.identificador ?? null,
        nombre: "",
        importe: 0,
        operaciones: new Set(),
        porConcepto: new Map(),
        pendientes: 0,
      };
      grupos.set(clave, g);
    }
    if (fila.nombre?.trim()) g.nombre = fila.nombre.trim();
    g.importe += fila.importeCentimos;
    g.operaciones.add(fila.operacionId);
    g.porConcepto.set(fila.concepto, (g.porConcepto.get(fila.concepto) ?? 0) + fila.importeCentimos);
    if (fila.conceptoId == null) g.pendientes += 1;
  }

  const proveedores: LineaProveedor[] = [...grupos].map(([clave, g]) => {
    let principal: string | null = null;
    let maximo = -1;
    for (const [concepto, importe] of g.porConcepto) {
      if (importe > maximo) {
        maximo = importe;
        principal = concepto;
      }
    }
    return {
      clave,
      nombre: clave == null ? "Sin proveedor" : g.nombre || g.identificador || "—",
      via: g.via,
      identificador: g.identificador,
      importeCentimos: g.importe,
      operaciones: g.operaciones.size,
      conceptoPrincipal: principal,
      pendientesDeClasificar: g.pendientes,
    };
  });
  /* De mayor a menor; a igual importe, por nombre, para que el orden no baile entre consultas. */
  proveedores.sort((a, b) => b.importeCentimos - a.importeCentimos || a.nombre.localeCompare(b.nombre, "es"));

  return {
    desde: f.desde,
    hasta: f.hasta,
    centroId: f.centroId,
    conceptoId: f.conceptoId,
    totalCentimos: proveedores.reduce((a, p) => a + p.importeCentimos, 0),
    operaciones: todas.size,
    sinProveedorCentimos: grupos.get(null)?.importe ?? 0,
    proveedores,
  };
}

/**
 * Los pagos de UN proveedor, para el desplegable de la tabla. `clave` `null`
 * = los sin proveedor. Una liquidación aporta una línea por ticket de ese
 * proveedor, con el número de la operación de caja que la pagó.
 */
export async function pagosDeProveedor(
  f: Omit<FiltroGasto, "granularidad">,
  clave: string | null
): Promise<PagoDeProveedor[]> {
  const filas = await filasDeProveedores(f);
  return filas
    .filter((fila) => (proveedorDeFila(fila)?.clave ?? null) === clave)
    .reverse()
    .map((p) => ({
      operacionId: p.operacionId,
      lineaId: p.lineaId,
      conceptoId: p.conceptoId,
      numero: p.numero,
      fecha: p.fecha,
      caja: p.caja,
      documento: p.documento,
      concepto: p.concepto,
      destino: p.destino,
      importeCentimos: p.importeCentimos,
    }));
}

/**
 * Lo que «Clasificar como…» rellenaría de un proveedor: sus gastos SIN
 * concepto en el periodo, con lo necesario para recordar la regla. Los ya
 * clasificados no se tocan nunca desde aquí: eso es cosa del detalle, pago a
 * pago.
 */
export async function pendientesDeProveedor(
  f: Omit<FiltroGasto, "granularidad">,
  clave: string
): Promise<{
  proveedor: { via: ViaProveedor; identificador: string | null; nombre: string } | null;
  gastos: { operacionId: number; lineaId: number | null }[];
}> {
  const filas = (await filasDeProveedores({ ...f, conceptoId: null })).filter(
    (fila) => proveedorDeFila(fila)?.clave === clave
  );
  const ultima = filas[filas.length - 1];
  const p = ultima ? proveedorDeFila(ultima) : null;
  return {
    proveedor: p && ultima ? { via: p.via, identificador: p.identificador, nombre: ultima.nombre ?? "" } : null,
    gastos: filas
      .filter((fila) => fila.conceptoId == null)
      .map((fila) => ({ operacionId: fila.operacionId, lineaId: fila.lineaId })),
  };
}

