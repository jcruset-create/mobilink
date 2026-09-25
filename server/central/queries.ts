/**
 * Consultas de supervisión de la red.
 *
 * Todo sale de las proyecciones `central_*`: ni una sola consulta a las tablas
 * `cash_*`. Es lo que permite que mañana Central esté en otra base de datos, o
 * en otro servicio, sin reescribir estas consultas.
 *
 * Y todo va filtrado por empresa, siempre, con el `empresaId` que resuelve el
 * servidor desde la sesión. Nunca llega del cliente.
 */

import pool from "../db.ts";

export type CajaEnRed = {
  registerId: number;
  centroId: string | null;
  centroNombre: string | null;
  nombre: string | null;
  codigo: string | null;
  jornadaAbiertaId: number | null;
  ultimaActividadMs: number | null;
  ultimaFechaCerrada: string | null;
  /** Días desde el último cierre. Es el número que delata a la caja olvidada. */
  diasSinCerrar: number | null;
  ingresadoCentimos: number;
};

export type ResumenRed = {
  cajas: number;
  jornadasAbiertas: number;
  descuadres: number;
  descuadreCentimos: number;
  cobradoHoyCentimos: number;
  eventosTardios: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ¿Existe la tabla de talleres?
 *
 * En una instalación sin la fundación SaaS —y en la base desechable de las
 * pruebas— `app_centros` no existe, y un JOIN contra ella tumba la consulta
 * entera. Central tiene que seguir enseñando la red aunque los talleres no
 * estén dados de alta: sin nombre de taller, pero funcionando. Es el mismo
 * criterio que usa `cash/hierarchy.ts`, y por el mismo motivo.
 */
async function hayCentros(): Promise<boolean> {
  const { rows } = await pool.query(`SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`);
  return Boolean(rows[0]?.hay);
}

/** El JOIN al taller, o una columna vacía si esa tabla no está. */
async function joinCentro(alias: string, columna: string) {
  return (await hayCentros())
    ? { select: `${alias}.nombre AS centro_nombre`, join: `LEFT JOIN app_centros ${alias} ON ${alias}.id = ${columna}` }
    : { select: `NULL::text AS centro_nombre`, join: "" };
}

/**
 * El resumen de arriba de la pantalla.
 *
 * `descuadres` cuenta jornadas con diferencia distinta de cero **de los últimos
 * 30 días**, no de toda la historia: un descuadre de hace dos años no es una
 * incidencia abierta, y ponerlo en el contador haría que el número no bajara
 * nunca y que nadie lo mirase.
 */
export async function resumenRed(empresaId: string): Promise<ResumenRed> {
  const { rows } = await pool.query(
    `SELECT
       -- La misma union que el listado, y por lo mismo: una caja que aun no ha
       -- emitido eventos existe y el contador tiene que decirlo, pero lo que
       -- Central ya conocia tampoco puede dejar de contarse.
       (SELECT COUNT(*)::int FROM (
          SELECT id AS register_id FROM cash_registers
           WHERE empresa_id = $1 AND activa
          UNION
          SELECT register_id FROM central_registers WHERE empresa_id = $1
        ) u) AS cajas,
       (SELECT COUNT(*)::int FROM central_sessions
         WHERE empresa_id = $1 AND estado IN ('OPEN','REOPENED')) AS abiertas,
       (SELECT COUNT(*)::int FROM central_sessions
         WHERE empresa_id = $1 AND COALESCE(diferencia_centimos,0) <> 0
           AND fecha >= CURRENT_DATE - 30) AS descuadres,
       (SELECT COALESCE(SUM(ABS(diferencia_centimos)),0) FROM central_sessions
         WHERE empresa_id = $1 AND COALESCE(diferencia_centimos,0) <> 0
           AND fecha >= CURRENT_DATE - 30) AS descuadre_centimos,
       (SELECT COALESCE(SUM(cobros_centimos),0) FROM central_sessions
         WHERE empresa_id = $1 AND fecha = CURRENT_DATE) AS cobrado_hoy,
       (SELECT COUNT(*)::int FROM central_events
         WHERE empresa_id = $1 AND resultado = 'TARDIO') AS tardios`,
    [empresaId]
  );
  const r = rows[0];
  return {
    cajas: r.cajas,
    jornadasAbiertas: r.abiertas,
    descuadres: r.descuadres,
    descuadreCentimos: Number(r.descuadre_centimos),
    cobradoHoyCentimos: Number(r.cobrado_hoy),
    eventosTardios: r.tardios,
  };
}

/**
 * Las cajas de la red.
 *
 * El nombre del taller y el de la caja se traen con LEFT JOIN, y con LEFT a
 * propósito: una caja cuyo taller no esté asignado tiene que SALIR igual, sin
 * taller. Con un JOIN a secas desaparecerían justo las cajas que hay que
 * arreglar, que es el peor sitio donde esconderlas.
 *
 * Y por lo mismo se manda sobre la UNIÓN de las dos tablas, no sobre una:
 *
 * - `cash_registers` es el censo de cajas. `central_registers` es una
 *   proyección de eventos y solo tiene fila cuando la caja ha emitido alguno,
 *   así que mandando la proyección **una caja recién dada de alta, o que aún no
 *   ha movido un euro, no aparecía** — justo la que hay que vigilar el primer
 *   día. Sale con los datos de supervisión a nulo, que es la verdad: existe y
 *   todavía no ha hecho nada.
 * - Pero mandar solo el censo tampoco vale: lo que Central ya conoce y en el
 *   censo no está (una caja retirada, o eventos llegados de otra instalación)
 *   desaparecería del listado y del contador. Se contaba antes; seguir
 *   contándolo no es opcional.
 *
 * La unión es la única forma de no esconder nada por ninguno de los dos lados,
 * que es la regla de esta pantalla entera.
 */
export async function cajasEnRed(empresaId: string, centroId?: string | null): Promise<CajaEnRed[]> {
  const centro = await joinCentro("t", "COALESCE(r.centro_id, c.centro_id)");
  const { rows } = await pool.query(
    `WITH ids AS (
        -- Las de baja no son red viva y no entran por aqui; si movieron dinero
        -- entran igual por la rama de Central, que es la que guarda su rastro.
        SELECT id AS register_id FROM cash_registers
         WHERE empresa_id = $1 AND activa
        UNION
        SELECT register_id FROM central_registers WHERE empresa_id = $1
      )
      SELECT ids.register_id,
            COALESCE(r.centro_id, c.centro_id) AS centro_id,
            r.jornada_abierta_id, r.ultima_actividad_ms,
            r.ultima_fecha_cerrada,
            COALESCE(r.ingresado_centimos, 0) AS ingresado_centimos,
            c.nombre AS caja_nombre, c.codigo,
            ${centro.select},
            CASE WHEN r.ultima_fecha_cerrada IS NULL THEN NULL
                 ELSE (CURRENT_DATE - r.ultima_fecha_cerrada) END AS dias_sin_cerrar
       FROM ids
       LEFT JOIN cash_registers c ON c.id = ids.register_id
       LEFT JOIN central_registers r ON r.register_id = ids.register_id
       ${centro.join}
      WHERE ($2::uuid IS NULL OR COALESCE(r.centro_id, c.centro_id) = $2)
      ORDER BY centro_nombre NULLS FIRST, c.nombre NULLS LAST`,
    [empresaId, centroId ?? null]
  );

  return rows.map((r: any) => ({
    registerId: r.register_id,
    centroId: r.centro_id ?? null,
    centroNombre: r.centro_nombre ?? null,
    nombre: r.caja_nombre ?? null,
    codigo: r.codigo ?? null,
    jornadaAbiertaId: r.jornada_abierta_id ?? null,
    ultimaActividadMs: r.ultima_actividad_ms == null ? null : Number(r.ultima_actividad_ms),
    ultimaFechaCerrada:
      r.ultima_fecha_cerrada instanceof Date
        ? r.ultima_fecha_cerrada.toISOString().slice(0, 10)
        : (r.ultima_fecha_cerrada ?? null),
    diasSinCerrar: r.dias_sin_cerrar == null ? null : Number(r.dias_sin_cerrar),
    ingresadoCentimos: Number(r.ingresado_centimos),
  }));
}

/** Las jornadas de la red, para el listado con filtros. */
export async function jornadasEnRed(
  empresaId: string,
  filtros: { desde?: string; hasta?: string; centroId?: string | null; soloDescuadres?: boolean }
) {
  const cond: string[] = ["s.empresa_id = $1"];
  const params: unknown[] = [empresaId];

  if (filtros.desde) {
    params.push(filtros.desde);
    cond.push(`s.fecha >= $${params.length}`);
  }
  if (filtros.hasta) {
    params.push(filtros.hasta);
    cond.push(`s.fecha <= $${params.length}`);
  }
  if (filtros.centroId) {
    params.push(filtros.centroId);
    cond.push(`s.centro_id = $${params.length}`);
  }
  if (filtros.soloDescuadres) cond.push(`COALESCE(s.diferencia_centimos,0) <> 0`);

  const centro = await joinCentro("t", "s.centro_id");
  const { rows } = await pool.query(
    `SELECT s.*, c.nombre AS caja_nombre, c.codigo, ${centro.select}
       FROM central_sessions s
       LEFT JOIN cash_registers c ON c.id = s.register_id
       ${centro.join}
      WHERE ${cond.join(" AND ")}
      ORDER BY s.fecha DESC NULLS LAST, s.session_id DESC
      LIMIT 200`,
    params
  );

  return rows.map((r: any) => ({
    sessionId: r.session_id,
    registerId: r.register_id,
    caja: r.caja_nombre ?? null,
    codigo: r.codigo ?? null,
    centro: r.centro_nombre ?? null,
    fecha: r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : (r.fecha ?? null),
    estado: r.estado,
    operaciones: r.operaciones,
    cobrosCentimos: Number(r.cobros_centimos),
    pagosCentimos: Number(r.pagos_centimos),
    efectivoNetoCentimos: Number(r.efectivo_neto_centimos),
    contadoCentimos: r.contado_centimos == null ? null : Number(r.contado_centimos),
    diferenciaCentimos: r.diferencia_centimos == null ? null : Number(r.diferencia_centimos),
    ingresoBancarioCentimos:
      r.ingreso_bancario_centimos == null ? null : Number(r.ingreso_bancario_centimos),
    anulaciones: r.anulaciones,
    reaperturas: r.reaperturas,
  }));
}

// ── Posición global de efectivo ────────────────────────────────────────────

export type PosicionGlobal = {
  /** En los cajones ahora mismo. */
  enCajonesCentimos: number;
  /** Fuera del cajón y sin volver: banco por un lado, personas por otro. */
  enTransitoCentimos: number;
  enTransitoBancoCentimos: number;
  enTransitoPersonasCentimos: number;
  transitosAbiertos: number;
  /**
   * Apartado en cierres que todavía no ha recogido ningún ingreso bancario,
   * MENOS lo que se devolvió al cajón reponiendo el fondo. Es el neto, el
   * mismo número que enseña la caja: el bruto ofrecería un dinero que ya no
   * está en la bolsa.
   */
  pendienteBancoCentimos: number;
  /** Lo repuesto al cajón y todavía sin ingresar. Ya está restado arriba. */
  repuestoCentimos: number;
  /**
   * Monedas que el banco no admitió y se quedaron en la tienda. No están en el
   * cajón, ni de camino, ni esperando al banco: es un cuarto sitio, y sin él
   * el total de la red se deja euros por el camino.
   */
  remanenteCentimos: number;
  /** La suma de los cuatro. Es TODO el efectivo de la red y no repite ni un euro. */
  totalCentimos: number;
};

export type TransitoAbierto = {
  clase: string;
  documentoId: number;
  numero: string | null;
  caja: string | null;
  centro: string | null;
  responsable: string | null;
  importeCentimos: number;
  abiertoEnMs: number | null;
  /** Días que lleva fuera. Es el número que convierte un olvido en una pregunta. */
  dias: number | null;
};

/**
 * Cuánto efectivo hay en la red y dónde está.
 *
 * **La regla que gobierna esta consulta: cada euro se cuenta en un sitio y solo
 * en uno.** El módulo de caja asienta el dinero en el momento en que se mueve
 * físicamente, no cuando se planea, así que:
 *
 * · Lo que se fue al banco a cambiar YA salió del cajón. Está en `transitos`.
 * · Los 50 € que lleva alguien YA salieron del cajón. Están en `transitos`.
 * · Lo que un cierre aparta para el banco YA salió del cajón. Está en
 *   `pendiente`, hasta que un ingreso bancario lo recoge y lo concilia.
 * · Lo que se sacó de ese montón para reponer el fondo VOLVIÓ al cajón, y el
 *   `MANUAL_IN` que lo asienta ya lo ha sumado ahí. Se RESTA del pendiente:
 *   dejarlo era contar los mismos billetes en los dos sitios, que es
 *   exactamente lo que hacía descuadrar la pantalla contra la caja.
 * · Las monedas que el banco no admite se quedan en la tienda como remanente.
 *   No están en ninguno de los tres sitios anteriores, así que van aparte.
 *
 * Sumarlos al cajón sería contarlos dos veces; no sumarlos sería perderlos, y
 * es lo que hace que un arqueo descuadre 200 € sin que nadie recuerde por qué.
 *
 * El cajón se calcula con la ÚLTIMA jornada de cada caja: si está abierta, el
 * fondo más el efectivo neto del día; si está cerrada, el cambio que se dejó
 * para mañana. El fondo inicial no se suma dos veces porque la apertura no pasa
 * por `registrarOperacion` y por tanto no entra en el efectivo neto.
 */
export async function posicionGlobal(empresaId: string): Promise<PosicionGlobal> {
  const { rows } = await pool.query(
    `WITH ultima AS (
       SELECT DISTINCT ON (register_id)
              register_id, estado, fondo_inicial_centimos,
              efectivo_neto_centimos, cambio_final_centimos
         FROM central_sessions
        WHERE empresa_id = $1
        ORDER BY register_id, fecha DESC NULLS LAST, session_id DESC
     ),
     cajon AS (
       SELECT COALESCE(SUM(
         CASE WHEN estado IN ('OPEN','REOPENED')
              THEN fondo_inicial_centimos + efectivo_neto_centimos
              ELSE COALESCE(cambio_final_centimos, 0) END), 0) AS centimos
         FROM ultima
     )
     SELECT
       (SELECT centimos FROM cajon) AS cajon,
       (SELECT COALESCE(SUM(importe_centimos),0) FROM central_transits
         WHERE empresa_id = $1 AND estado = 'ABIERTO') AS transito,
       (SELECT COALESCE(SUM(importe_centimos),0) FROM central_transits
         WHERE empresa_id = $1 AND estado = 'ABIERTO' AND clase = 'CHANGE_ORDER') AS transito_banco,
       (SELECT COALESCE(SUM(importe_centimos),0) FROM central_transits
         WHERE empresa_id = $1 AND estado = 'ABIERTO' AND clase = 'ADVANCE') AS transito_personas,
       (SELECT COUNT(*)::int FROM central_transits
         WHERE empresa_id = $1 AND estado = 'ABIERTO') AS abiertos,
       (SELECT COALESCE(SUM(ingreso_bancario_centimos),0) FROM central_sessions
         WHERE empresa_id = $1 AND estado = 'CLOSED' AND NOT conciliada) AS pendiente,
       (SELECT COALESCE(SUM(importe_centimos),0) FROM central_float_topups
         WHERE empresa_id = $1 AND deposit_id IS NULL) AS repuesto,
       /*
        * El remanente vigente de cada caja: el que dejó su último ingreso
        * confirmado. Es una cadena —cada ingreso arranca del remanente del
        * anterior—, así que sumar todos los ingresos contaría las mismas
        * monedas una vez por ingreso. Solo cuenta el último de cada caja.
        */
       (SELECT COALESCE(SUM(remanente_nuevo_centimos),0) FROM (
          SELECT DISTINCT ON (register_id) remanente_nuevo_centimos
            FROM central_bank_deposits
           WHERE empresa_id = $1 AND estado = 'CONFIRMADO'
           ORDER BY register_id, deposit_id DESC
        ) ultimo) AS remanente`,
    [empresaId]
  );

  const r = rows[0];
  const enCajones = Number(r.cajon);
  const enTransito = Number(r.transito);
  const repuesto = Number(r.repuesto);
  const pendiente = Number(r.pendiente) - repuesto;
  const remanente = Number(r.remanente);

  return {
    enCajonesCentimos: enCajones,
    enTransitoCentimos: enTransito,
    enTransitoBancoCentimos: Number(r.transito_banco),
    enTransitoPersonasCentimos: Number(r.transito_personas),
    transitosAbiertos: r.abiertos,
    pendienteBancoCentimos: pendiente,
    repuestoCentimos: repuesto,
    remanenteCentimos: remanente,
    totalCentimos: enCajones + enTransito + pendiente + remanente,
  };
}

/** Lo que está fuera ahora mismo, con quién y desde cuándo. */
export async function transitosAbiertos(empresaId: string): Promise<TransitoAbierto[]> {
  const centro = await joinCentro("ce", "t.centro_id");
  const { rows } = await pool.query(
    `SELECT t.clase, t.documento_id, t.numero, t.responsable, t.importe_centimos,
            t.abierto_en_ms, c.nombre AS caja, ${centro.select}
       FROM central_transits t
       LEFT JOIN cash_registers c ON c.id = t.register_id
       ${centro.join}
      WHERE t.empresa_id = $1 AND t.estado = 'ABIERTO'
      ORDER BY t.abierto_en_ms`,
    [empresaId]
  );

  const ahora = Date.now();
  return rows.map((r: any) => ({
    clase: r.clase,
    documentoId: Number(r.documento_id),
    numero: r.numero ?? null,
    caja: r.caja ?? null,
    centro: r.centro_nombre ?? null,
    responsable: r.responsable ?? null,
    importeCentimos: Number(r.importe_centimos),
    abiertoEnMs: r.abierto_en_ms == null ? null : Number(r.abierto_en_ms),
    dias:
      r.abierto_en_ms == null
        ? null
        : Math.floor((ahora - Number(r.abierto_en_ms)) / 86_400_000),
  }));
}

// ── Ciclo de ingresos bancarios ────────────────────────────────────────────

export type IngresoEnRed = {
  depositId: number;
  numero: string | null;
  fecha: string | null;
  referencia: string | null;
  caja: string | null;
  centro: string | null;
  importeCentimos: number;
  totalCierresCentimos: number;
  remanenteNuevoCentimos: number;
  estado: string;
  anuladoMotivo: string | null;
  /** De dónde salió cada euro: qué jornada puso cuánto. */
  origen: { sessionId: number; fecha: string | null; importeCentimos: number }[];
};

export type PendienteDeIngresar = {
  registerId: number;
  caja: string | null;
  centro: string | null;
  jornadas: number;
  centimos: number;
  /** Fecha del cierre más antiguo sin ingresar. Es lo que mide el retraso. */
  desde: string | null;
  dias: number | null;
};

/**
 * Los ingresos de la red, cada uno con su origen desglosado.
 *
 * El desglose no es un adorno: cuando el extracto del banco apunta un abono de
 * 3.480 €, la pregunta que hay que contestar es de qué días y de qué caja salió
 * ese dinero. Un ingreso sin origen es un número que no se concilia con nada.
 *
 * Los anulados salen también, marcados. Aquí no se borra nada —misma regla que
 * en la caja— y un ingreso que existió y se anuló es justo lo que alguien va a
 * buscar cuando el extracto no cuadre.
 */
export async function ingresosEnRed(
  empresaId: string,
  filtros: {
    centroId?: string | null;
    registerId?: number | null;
    /** Rango por fecha del ingreso, inclusive. Formato AAAA-MM-DD. */
    desde?: string | null;
    hasta?: string | null;
  } = {}
): Promise<IngresoEnRed[]> {
  const centro = await joinCentro("ce", "d.centro_id");
  const cond: string[] = ["d.empresa_id = $1"];
  const params: unknown[] = [empresaId];

  if (filtros.centroId) {
    params.push(filtros.centroId);
    cond.push(`d.centro_id = $${params.length}`);
  }
  if (filtros.registerId) {
    params.push(filtros.registerId);
    cond.push(`d.register_id = $${params.length}`);
  }
  /*
   * El rango va sobre la fecha del ingreso, que es la del banco. Los que
   * todavía no la tienen quedan FUERA de cualquier rango, y es lo correcto:
   * filtrar por fechas es preguntar «qué se ingresó entre estos días», y algo
   * sin fecha no se ingresó ningún día todavía.
   */
  if (filtros.desde) {
    params.push(filtros.desde);
    cond.push(`d.fecha >= $${params.length}::date`);
  }
  if (filtros.hasta) {
    params.push(filtros.hasta);
    cond.push(`d.fecha <= $${params.length}::date`);
  }

  const { rows } = await pool.query(
    `SELECT d.*, c.nombre AS caja_nombre, ${centro.select},
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'sessionId', s.session_id,
                        'fecha', s.fecha,
                        'importeCentimos', s.importe_centimos)
                      ORDER BY s.fecha, s.session_id)
                 FROM central_deposit_sources s
                WHERE s.deposit_id = d.deposit_id),
              '[]'::json) AS origen
       FROM central_bank_deposits d
       LEFT JOIN cash_registers c ON c.id = d.register_id
       ${centro.join}
      WHERE ${cond.join(" AND ")}
      ORDER BY d.fecha DESC NULLS LAST, d.deposit_id DESC
      LIMIT 200`,
    params
  );

  return rows.map((r: any) => ({
    depositId: r.deposit_id,
    numero: r.numero ?? null,
    fecha: r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : (r.fecha ?? null),
    referencia: r.referencia ?? null,
    caja: r.caja_nombre ?? null,
    centro: r.centro_nombre ?? null,
    importeCentimos: Number(r.importe_centimos),
    totalCierresCentimos: Number(r.total_cierres_centimos),
    remanenteNuevoCentimos: Number(r.remanente_nuevo_centimos),
    estado: r.estado,
    anuladoMotivo: r.anulado_motivo ?? null,
    origen: (r.origen ?? []).map(
      (o: { sessionId: number; fecha: string | null; importeCentimos: string }) => ({
        sessionId: o.sessionId,
        fecha: o.fecha ? String(o.fecha).slice(0, 10) : null,
        importeCentimos: Number(o.importeCentimos),
      })
    ),
  }));
}

/**
 * Lo que cada caja tiene cerrado y todavía no ha llevado al banco.
 *
 * `desde` es la fecha del cierre más antiguo sin ingresar, y es el dato que de
 * verdad importa: 400 € esperando desde ayer es la operativa normal; los mismos
 * 400 € esperando desde hace tres semanas son dinero en un cajón de una tienda,
 * y eso ya es otra cosa.
 */
export async function pendienteDeIngresar(empresaId: string): Promise<PendienteDeIngresar[]> {
  const centro = await joinCentro("ce", "s.centro_id");
  const { rows } = await pool.query(
    `SELECT s.register_id,
            COUNT(*)::int AS jornadas,
            COALESCE(SUM(s.ingreso_bancario_centimos),0) AS centimos,
            MIN(s.fecha) AS desde,
            c.nombre AS caja_nombre, ${centro.select}
       FROM central_sessions s
       LEFT JOIN cash_registers c ON c.id = s.register_id
       ${centro.join}
      WHERE s.empresa_id = $1
        AND s.estado = 'CLOSED'
        AND NOT s.conciliada
        AND COALESCE(s.ingreso_bancario_centimos,0) > 0
      GROUP BY s.register_id, c.nombre, centro_nombre
      ORDER BY MIN(s.fecha)`,
    [empresaId]
  );

  const hoy = new Date();
  return rows.map((r: any) => {
    const desde = r.desde instanceof Date ? r.desde.toISOString().slice(0, 10) : (r.desde ?? null);
    return {
      registerId: r.register_id,
      caja: r.caja_nombre ?? null,
      centro: r.centro_nombre ?? null,
      jornadas: r.jornadas,
      centimos: Number(r.centimos),
      desde,
      dias: desde
        ? Math.floor((hoy.getTime() - new Date(`${desde}T00:00:00Z`).getTime()) / 86_400_000)
        : null,
    };
  });
}

// ── Cambio y arqueos en la red ─────────────────────────────────────────────

export type CambioPorPieza = {
  valorCentimos: number;
  cantidad: number;
  importeCentimos: number;
  /** Cajas que ya no tienen ni una pieza de este valor. */
  cajasSinNinguna: number;
};

export type CajaSinCambio = {
  registerId: number;
  caja: string | null;
  centro: string | null;
  /** Céntimos en monedas (piezas por debajo de 5 €). Es la calderilla. */
  calderillaCentimos: number;
  contadoEnMs: number | null;
};

export type DescuadrePorPieza = {
  valorCentimos: number;
  /** Piezas que faltan (negativo) o sobran (positivo), sumando todas las cajas. */
  diferencia: number;
  cajas: number;
};

/**
 * Umbral de «moneda»: todo lo que vale menos de 5 €.
 *
 * Es donde está la frontera real del problema. Lo que se acaba en un mostrador
 * no son los billetes —de esos siempre entran— sino las monedas para devolver,
 * y el billete más pequeño de curso es el de 5 €.
 */
const MONEDA_MAX_CENTIMOS = 500;

/**
 * El cambio de toda la red, pieza a pieza.
 *
 * `cajasSinNinguna` es el dato que de verdad se mira: que la red tenga 400
 * monedas de 10 c no sirve de nada si están todas en un taller y en el otro no
 * queda ninguna. Un total consolidado sin ese contador engaña.
 */
export async function cambioEnRed(empresaId: string): Promise<CambioPorPieza[]> {
  const { rows } = await pool.query(
    `SELECT valor_centimos,
            COALESCE(SUM(cantidad),0)::int AS cantidad,
            COUNT(*) FILTER (WHERE cantidad = 0)::int AS sin_ninguna
       FROM central_denomination_stock
      WHERE empresa_id = $1
      GROUP BY valor_centimos
      ORDER BY valor_centimos DESC`,
    [empresaId]
  );

  return rows.map((r: any) => ({
    valorCentimos: r.valor_centimos,
    cantidad: r.cantidad,
    importeCentimos: r.valor_centimos * r.cantidad,
    cajasSinNinguna: r.sin_ninguna,
  }));
}

/** Las cajas con menos calderilla, que son las que hay que reponer primero. */
export async function cajasSinCambio(empresaId: string): Promise<CajaSinCambio[]> {
  const centro = await joinCentro("ce", "d.centro_id");
  const { rows } = await pool.query(
    `SELECT d.register_id,
            COALESCE(SUM(d.valor_centimos * d.cantidad) FILTER (WHERE d.valor_centimos < $2), 0)
              AS calderilla,
            MAX(d.contado_en_ms) AS contado_en_ms,
            c.nombre AS caja_nombre, ${centro.select}
       FROM central_denomination_stock d
       LEFT JOIN cash_registers c ON c.id = d.register_id
       ${centro.join}
      WHERE d.empresa_id = $1
      GROUP BY d.register_id, c.nombre, centro_nombre
      ORDER BY calderilla`,
    [empresaId, MONEDA_MAX_CENTIMOS]
  );

  return rows.map((r: any) => ({
    registerId: r.register_id,
    caja: r.caja_nombre ?? null,
    centro: r.centro_nombre ?? null,
    calderillaCentimos: Number(r.calderilla),
    contadoEnMs: r.contado_en_ms == null ? null : Number(r.contado_en_ms),
  }));
}

/**
 * En qué piezas descuadra la red.
 *
 * Un descuadre de 20 € puede ser un billete de 20 que no está o veinte monedas
 * de un euro mal contadas, y no son el mismo problema ni se investigan igual:
 * lo primero se busca, lo segundo se recuenta. El total nunca lo dice.
 */
export async function descuadresPorPieza(empresaId: string): Promise<DescuadrePorPieza[]> {
  const { rows } = await pool.query(
    `SELECT valor_centimos,
            COALESCE(SUM(diferencia),0)::int AS diferencia,
            COUNT(*) FILTER (WHERE diferencia <> 0)::int AS cajas
       FROM central_denomination_stock
      WHERE empresa_id = $1 AND diferencia <> 0
      GROUP BY valor_centimos
      ORDER BY ABS(SUM(diferencia) * valor_centimos) DESC`,
    [empresaId]
  );

  return rows.map((r: any) => ({
    valorCentimos: r.valor_centimos,
    diferencia: r.diferencia,
    cajas: r.cajas,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
