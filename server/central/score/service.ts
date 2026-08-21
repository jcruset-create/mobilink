/**
 * Cash Health Score sobre datos reales.
 *
 * Aquí vive lo que el motor no debe saber: de dónde salen las señales. El motor
 * (`score/domain.ts`) sigue siendo una función pura que se prueba en un
 * milisegundo.
 *
 * Todo sale de las proyecciones de Central, no del módulo de caja: puntuar la
 * red entera no puede tocar las tablas por las que pasa el dinero de hoy.
 */

import pool from "../../db.ts";
import { puntuar, puntuarGrupo, type Puntuacion, type SenalesCaja } from "./domain.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Ventana que se mira. Un mes: lo bastante para un patrón, lo bastante reciente. */
export const DIAS_DE_VENTANA = 30;

export async function senalesDeLaRed(empresaId: string): Promise<SenalesCaja[]> {
  const { rows } = await pool.query(
    `WITH ventana AS (
       SELECT register_id,
              COUNT(*)::int AS jornadas,
              COUNT(*) FILTER (WHERE COALESCE(diferencia_centimos,0) <> 0)::int AS con_descuadre,
              COALESCE(SUM(ABS(COALESCE(diferencia_centimos,0))),0) AS descuadre,
              COALESCE(SUM(COALESCE(ingreso_bancario_centimos,0)),0) AS efectivo
         FROM central_sessions
        WHERE empresa_id = $1 AND estado = 'CLOSED'
          AND fecha >= CURRENT_DATE - $2::int
        GROUP BY register_id
     ),
     transito AS (
       SELECT register_id, MIN(abierto_en_ms) AS desde
         FROM central_transits
        WHERE empresa_id = $1 AND estado = 'ABIERTO'
        GROUP BY register_id
     ),
     pendiente AS (
       SELECT register_id, MIN(fecha) AS desde
         FROM central_sessions
        WHERE empresa_id = $1 AND estado = 'CLOSED' AND NOT conciliada
          AND COALESCE(ingreso_bancario_centimos,0) > 0
        GROUP BY register_id
     ),
     calderilla AS (
       SELECT register_id, SUM(valor_centimos * cantidad) AS centimos
         FROM central_denomination_stock
        WHERE empresa_id = $1 AND valor_centimos < 500
        GROUP BY register_id
     )
     SELECT r.register_id, r.centro_id,
            COALESCE(v.jornadas,0) AS jornadas,
            COALESCE(v.con_descuadre,0) AS con_descuadre,
            COALESCE(v.descuadre,0) AS descuadre,
            COALESCE(v.efectivo,0) AS efectivo,
            CASE WHEN r.ultima_fecha_cerrada IS NULL THEN NULL
                 ELSE (CURRENT_DATE - r.ultima_fecha_cerrada) END AS dias_sin_cerrar,
            t.desde AS transito_desde,
            p.desde AS pendiente_desde,
            k.centimos AS calderilla
       FROM central_registers r
       LEFT JOIN ventana v ON v.register_id = r.register_id
       LEFT JOIN transito t ON t.register_id = r.register_id
       LEFT JOIN pendiente p ON p.register_id = r.register_id
       LEFT JOIN calderilla k ON k.register_id = r.register_id
      WHERE r.empresa_id = $1`,
    [empresaId, DIAS_DE_VENTANA]
  );

  const hoy = Date.now();
  const dias = (ms: unknown) =>
    ms == null ? null : Math.floor((hoy - Number(ms)) / 86_400_000);

  const diasDesdeFecha = (f: unknown) => {
    if (f == null) return null;
    const iso = f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10);
    return Math.floor((hoy - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
  };

  return rows.map((r: any) => ({
    registerId: r.register_id,
    jornadas: Number(r.jornadas),
    jornadasConDescuadre: Number(r.con_descuadre),
    descuadreCentimos: Number(r.descuadre),
    efectivoCentimos: Number(r.efectivo),
    diasSinCerrar: r.dias_sin_cerrar == null ? null : Number(r.dias_sin_cerrar),
    transitoDiasAbierto: dias(r.transito_desde),
    pendienteBancoDias: diasDesdeFecha(r.pendiente_desde),
    calderillaCentimos: r.calderilla == null ? null : Number(r.calderilla),
  }));
}

export type SaludDeLaRed = {
  puntos: number | null;
  conDatos: number;
  sinDatos: number;
  peores: (Puntuacion & { caja: string | null; centro: string | null })[];
  cajas: Puntuacion[];
};

export async function saludDeLaRed(empresaId: string): Promise<SaludDeLaRed> {
  const senales = await senalesDeLaRed(empresaId);
  const cajas = senales.map(puntuar);
  const grupo = puntuarGrupo(cajas);

  // Los nombres se resuelven solo para las que se van a enseñar.
  const ids = grupo.peores.map((p) => p.registerId);
  const nombres = new Map<number, { caja: string | null; centro: string | null }>();

  if (ids.length > 0) {
    const hayCentros = (
      await pool.query(`SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`)
    ).rows[0]?.hay;

    const { rows } = await pool.query(
      `SELECT c.id, c.nombre, ${hayCentros ? "ce.nombre" : "NULL::text"} AS centro
         FROM cash_registers c
         ${hayCentros ? "LEFT JOIN app_centros ce ON ce.id = c.centro_id" : ""}
        WHERE c.id = ANY($1::int[])`,
      [ids]
    );
    for (const r of rows) nombres.set(r.id, { caja: r.nombre, centro: r.centro ?? null });
  }

  return {
    puntos: grupo.puntos,
    conDatos: grupo.conDatos,
    sinDatos: grupo.sinDatos,
    peores: grupo.peores.map((p) => ({
      ...p,
      caja: nombres.get(p.registerId)?.caja ?? null,
      centro: nombres.get(p.registerId)?.centro ?? null,
    })),
    cajas,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
