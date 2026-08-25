/**
 * Indicadores de la red.
 *
 * Cinco, y pocos a propósito. Un panel con veinte números no lo mira nadie: se
 * convierte en decoración. Éstos son los que contestan preguntas que alguien se
 * hace de verdad sobre una red de cajas.
 *
 * **Todos se calculan sobre lo que Central ya tiene proyectado**, no
 * consultando el módulo de caja. Es lo que permite que un informe de doce meses
 * no toque las tablas por las que pasa el dinero de hoy.
 */

import pool from "../../db.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Kpis = {
  desde: string;
  hasta: string;
  /** Jornadas cerradas en el periodo. */
  jornadas: number;
  /** Efectivo que ha entrado por caja, sumando cierres. */
  efectivoCentimos: number;
  /** Suma de descuadres en valor absoluto: lo que no cuadró, sin compensar. */
  descuadreCentimos: number;
  /** Jornadas que descuadraron, sobre el total. */
  jornadasConDescuadre: number;
  /**
   * Días medios entre cerrar una jornada y que su dinero llegue al banco.
   *
   * Es el indicador que más dice de una red: mide dinero parado en un cajón.
   */
  diasHastaElBanco: number | null;
};

export type KpiPorCentro = {
  centroId: string | null;
  centro: string | null;
  jornadas: number;
  efectivoCentimos: number;
  descuadreCentimos: number;
};

/**
 * El descuadre se suma **en valor absoluto**.
 *
 * Un día que sobran 20 € y otro que faltan 20 € no son una red que cuadra: son
 * dos días que no cuadraron. Sumarlos con su signo daría cero y escondería
 * exactamente el problema que el indicador viene a enseñar.
 */
export async function kpis(empresaId: string, desde: string, hasta: string): Promise<Kpis> {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS jornadas,
       COALESCE(SUM(ingreso_bancario_centimos), 0) AS efectivo,
       COALESCE(SUM(ABS(COALESCE(diferencia_centimos, 0))), 0) AS descuadre,
       COUNT(*) FILTER (WHERE COALESCE(diferencia_centimos, 0) <> 0)::int AS con_descuadre
     FROM central_sessions
     WHERE empresa_id = $1 AND estado = 'CLOSED' AND fecha BETWEEN $2 AND $3`,
    [empresaId, desde, hasta]
  );

  /*
   * Días hasta el banco: de la fecha de la jornada a la del ingreso que la
   * recogió. Solo cuentan las conciliadas — una jornada cuyo dinero sigue sin
   * ingresar no tiene un plazo todavía, y contarla como cero rebajaría la media
   * justo por el caso que peor está.
   */
  const { rows: plazo } = await pool.query(
    `SELECT AVG(d.fecha - s.fecha)::numeric AS dias
       FROM central_deposit_sources src
       JOIN central_sessions s ON s.session_id = src.session_id
       JOIN central_bank_deposits d ON d.deposit_id = src.deposit_id
      WHERE src.empresa_id = $1 AND s.fecha BETWEEN $2 AND $3
        AND d.estado = 'CONFIRMADO' AND d.fecha IS NOT NULL`,
    [empresaId, desde, hasta]
  );

  const r = rows[0];
  return {
    desde,
    hasta,
    jornadas: r.jornadas,
    efectivoCentimos: Number(r.efectivo),
    descuadreCentimos: Number(r.descuadre),
    jornadasConDescuadre: r.con_descuadre,
    diasHastaElBanco: plazo[0]?.dias == null ? null : Number(Number(plazo[0].dias).toFixed(1)),
  };
}

/** Lo mismo, partido por taller: es donde se ve quién se sale de la media. */
export async function porCentro(
  empresaId: string,
  desde: string,
  hasta: string
): Promise<KpiPorCentro[]> {
  const hayCentros = (
    await pool.query(`SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`)
  ).rows[0]?.hay;

  const { rows } = await pool.query(
    `SELECT s.centro_id,
            ${hayCentros ? "ce.nombre" : "NULL::text"} AS centro_nombre,
            COUNT(*)::int AS jornadas,
            COALESCE(SUM(s.ingreso_bancario_centimos), 0) AS efectivo,
            COALESCE(SUM(ABS(COALESCE(s.diferencia_centimos, 0))), 0) AS descuadre
       FROM central_sessions s
       ${hayCentros ? "LEFT JOIN app_centros ce ON ce.id = s.centro_id" : ""}
      WHERE s.empresa_id = $1 AND s.estado = 'CLOSED' AND s.fecha BETWEEN $2 AND $3
      GROUP BY s.centro_id${hayCentros ? ", ce.nombre" : ""}
      ORDER BY descuadre DESC`,
    [empresaId, desde, hasta]
  );

  return rows.map((r: any) => ({
    centroId: r.centro_id ?? null,
    centro: r.centro_nombre ?? null,
    jornadas: r.jornadas,
    efectivoCentimos: Number(r.efectivo),
    descuadreCentimos: Number(r.descuadre),
  }));
}

/** Las jornadas del periodo, para exportar. */
export async function jornadasParaExportar(
  empresaId: string,
  desde: string,
  hasta: string,
  centroId: string | null
) {
  const { rows } = await pool.query(
    `SELECT s.fecha, s.session_id, s.register_id, c.nombre AS caja, s.estado,
            s.fondo_inicial_centimos, s.contado_centimos, s.diferencia_centimos,
            s.ingreso_bancario_centimos, s.conciliada
       FROM central_sessions s
       LEFT JOIN cash_registers c ON c.id = s.register_id
      WHERE s.empresa_id = $1 AND s.fecha BETWEEN $2 AND $3
        AND ($4::uuid IS NULL OR s.centro_id = $4)
      ORDER BY s.fecha, s.session_id`,
    [empresaId, desde, hasta, centroId]
  );
  return rows;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
