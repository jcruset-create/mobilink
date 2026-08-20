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
  const { rows } = await pool.query(
    `SELECT r.register_id, r.centro_id, r.jornada_abierta_id, r.ultima_actividad_ms,
            r.ultima_fecha_cerrada, r.ingresado_centimos,
            c.nombre AS caja_nombre, c.codigo,
            t.nombre AS centro_nombre,
            CASE WHEN r.ultima_fecha_cerrada IS NULL THEN NULL
                 ELSE (CURRENT_DATE - r.ultima_fecha_cerrada) END AS dias_sin_cerrar
       FROM central_registers r
       LEFT JOIN cash_registers c ON c.id = r.register_id
       LEFT JOIN app_centros t ON t.id = r.centro_id
      WHERE r.empresa_id = $1
        AND ($2::uuid IS NULL OR r.centro_id = $2)
      ORDER BY t.nombre NULLS FIRST, c.nombre`,
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

  const { rows } = await pool.query(
    `SELECT s.*, c.nombre AS caja_nombre, c.codigo, t.nombre AS centro_nombre
       FROM central_sessions s
       LEFT JOIN cash_registers c ON c.id = s.register_id
       LEFT JOIN app_centros t ON t.id = s.centro_id
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
/* eslint-enable @typescript-eslint/no-explicit-any */
