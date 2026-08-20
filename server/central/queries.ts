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
       (SELECT COUNT(*)::int FROM central_registers WHERE empresa_id = $1) AS cajas,
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
 */
export async function cajasEnRed(empresaId: string, centroId?: string | null): Promise<CajaEnRed[]> {
  const centro = await joinCentro("t", "r.centro_id");
  const { rows } = await pool.query(
    `SELECT r.register_id, r.centro_id, r.jornada_abierta_id, r.ultima_actividad_ms,
            r.ultima_fecha_cerrada, r.ingresado_centimos,
            c.nombre AS caja_nombre, c.codigo,
            ${centro.select},
            CASE WHEN r.ultima_fecha_cerrada IS NULL THEN NULL
                 ELSE (CURRENT_DATE - r.ultima_fecha_cerrada) END AS dias_sin_cerrar
       FROM central_registers r
       LEFT JOIN cash_registers c ON c.id = r.register_id
       ${centro.join}
      WHERE r.empresa_id = $1
        AND ($2::uuid IS NULL OR r.centro_id = $2)
      ORDER BY centro_nombre NULLS FIRST, c.nombre`,
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
  /** Apartado en cierres que todavía no ha recogido ningún ingreso bancario. */
  pendienteBancoCentimos: number;
  /** La suma de los tres. Es TODO el efectivo de la red y no repite ni un euro. */
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
         WHERE empresa_id = $1 AND estado = 'CLOSED' AND NOT conciliada) AS pendiente`,
    [empresaId]
  );

  const r = rows[0];
  const enCajones = Number(r.cajon);
  const enTransito = Number(r.transito);
  const pendiente = Number(r.pendiente);

  return {
    enCajonesCentimos: enCajones,
    enTransitoCentimos: enTransito,
    enTransitoBancoCentimos: Number(r.transito_banco),
    enTransitoPersonasCentimos: Number(r.transito_personas),
    transitosAbiertos: r.abiertos,
    pendienteBancoCentimos: pendiente,
    totalCentimos: enCajones + enTransito + pendiente,
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
/* eslint-enable @typescript-eslint/no-explicit-any */
