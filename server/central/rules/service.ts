/**
 * Evaluación de reglas y bandeja de incidencias.
 *
 * Aquí vive lo que el motor no debe saber: de dónde sale el estado de cada caja
 * y qué se hace con las incidencias que salen. El motor
 * (`rules/engine.ts`) sigue sin tocar la base de datos.
 *
 * Dos decisiones que gobiernan la bandeja:
 *
 * **Lo que deja de pasar se cierra solo.** Un tránsito que vuelve, una caja que
 * cierra, un ingreso que se lleva al banco: la incidencia se marca resuelta con
 * motivo `AUTO`. Si hubiera que cerrarlas a mano, la bandeja acumularía avisos
 * de problemas ya arreglados y en dos semanas nadie la abriría.
 *
 * **El descuadre NO se cierra solo.** Es un hecho que ocurrió: el dinero faltó
 * ese día y sigue faltando aunque hoy la caja cuadre. Lo cierra una persona,
 * que es quien puede decir por qué. Cerrarlo automáticamente sería borrar la
 * única señal de que pasó.
 */

import pool from "../../db.ts";
import { registrarAuditoria } from "../../core/auditoria.ts";
import { evaluarRed, type EstadoCaja, type Incidencia, type Regla } from "./engine.ts";
import { avisarDeIncidencia } from "../notifications/service.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Tipos que describen un estado en curso, y que por tanto se cierran solos. */
const SE_CIERRAN_SOLOS = new Set([
  "TRANSITO_DIAS",
  "SIN_CERRAR_DIAS",
  "PENDIENTE_BANCO_DIAS",
  "CALDERILLA_MINIMA",
]);

export async function listarReglas(empresaId: string): Promise<Regla[]> {
  const { rows } = await pool.query(
    `SELECT id, tipo, ambito, ambito_id, umbral, activa
       FROM central_rules WHERE empresa_id = $1
      ORDER BY tipo, ambito, ambito_id NULLS FIRST`,
    [empresaId]
  );
  return rows.map((r: any) => ({
    id: r.id,
    tipo: r.tipo,
    ambito: r.ambito,
    ambitoId: r.ambito_id ?? null,
    umbral: Number(r.umbral),
    activa: r.activa,
  }));
}

export async function guardarRegla(
  ctx: { empresaId: string; userId: string | null; ip?: string },
  e: { tipo: string; ambito: string; ambitoId?: string | null; umbral: number; activa?: boolean }
): Promise<Regla> {
  const ahora = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO central_rules
       (empresa_id, tipo, ambito, ambito_id, umbral, activa, creado_por, creado_en_ms, actualizado_en_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (empresa_id, tipo, ambito, COALESCE(ambito_id, ''))
       DO UPDATE SET umbral = EXCLUDED.umbral, activa = EXCLUDED.activa,
                     actualizado_en_ms = EXCLUDED.actualizado_en_ms
     RETURNING id, tipo, ambito, ambito_id, umbral, activa`,
    [
      ctx.empresaId,
      e.tipo,
      e.ambito,
      e.ambitoId ?? null,
      e.umbral,
      e.activa ?? true,
      ctx.userId,
      ahora,
    ]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "central.rule.save",
    entidad: "central_rules",
    entidadId: String(rows[0].id),
    detalle: e,
    ip: ctx.ip,
  });

  const r = rows[0];
  return {
    id: r.id,
    tipo: r.tipo,
    ambito: r.ambito,
    ambitoId: r.ambito_id ?? null,
    umbral: Number(r.umbral),
    activa: r.activa,
  };
}

/**
 * El estado de cada caja, reunido de las proyecciones.
 *
 * Una sola consulta y no cinco: la evaluación se lanza cada pocos minutos sobre
 * toda la red, y cinco viajes por caja se notarían con cincuenta talleres.
 */
async function estadoDeLaRed(empresaId: string): Promise<EstadoCaja[]> {
  const hayCentros = (
    await pool.query(`SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`)
  ).rows[0]?.hay;

  const zonaSelect = hayCentros ? "ce.zona_id" : "NULL::uuid";
  const zonaJoin = hayCentros ? "LEFT JOIN app_centros ce ON ce.id = r.centro_id" : "";

  const { rows } = await pool.query(
    `WITH ultima AS (
       SELECT DISTINCT ON (register_id)
              register_id, session_id, diferencia_centimos
         FROM central_sessions
        WHERE empresa_id = $1
        ORDER BY register_id, fecha DESC NULLS LAST, session_id DESC
     ),
     transito AS (
       SELECT register_id,
              MIN(abierto_en_ms) AS desde,
              SUM(importe_centimos) AS centimos
         FROM central_transits
        WHERE empresa_id = $1 AND estado = 'ABIERTO'
        GROUP BY register_id
     ),
     pendiente AS (
       SELECT register_id, MIN(fecha) AS desde, SUM(ingreso_bancario_centimos) AS centimos
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
     SELECT r.register_id, r.centro_id, ${zonaSelect} AS zona_id,
            u.session_id, u.diferencia_centimos,
            t.desde AS transito_desde, t.centimos AS transito_centimos,
            p.desde AS pendiente_desde, p.centimos AS pendiente_centimos,
            k.centimos AS calderilla_centimos,
            CASE WHEN r.ultima_fecha_cerrada IS NULL THEN NULL
                 ELSE (CURRENT_DATE - r.ultima_fecha_cerrada) END AS dias_sin_cerrar
       FROM central_registers r
       ${zonaJoin}
       LEFT JOIN ultima u ON u.register_id = r.register_id
       LEFT JOIN transito t ON t.register_id = r.register_id
       LEFT JOIN pendiente p ON p.register_id = r.register_id
       LEFT JOIN calderilla k ON k.register_id = r.register_id
      WHERE r.empresa_id = $1`,
    [empresaId]
  );

  const hoy = Date.now();
  const dias = (ms: number | null) =>
    ms == null ? null : Math.floor((hoy - Number(ms)) / 86_400_000);

  return rows.map((r: any) => ({
    registerId: r.register_id,
    centroId: r.centro_id ?? null,
    zonaId: r.zona_id ?? null,
    sessionId: r.session_id ?? null,
    descuadreCentimos: r.diferencia_centimos == null ? null : Number(r.diferencia_centimos),
    transitoDias: dias(r.transito_desde),
    transitoCentimos: r.transito_centimos == null ? null : Number(r.transito_centimos),
    pendienteDias:
      r.pendiente_desde == null
        ? null
        : Math.floor(
            (hoy - new Date(`${String(r.pendiente_desde).slice(0, 10)}T00:00:00Z`).getTime()) /
              86_400_000
          ),
    pendienteCentimos: r.pendiente_centimos == null ? null : Number(r.pendiente_centimos),
    calderillaCentimos: r.calderilla_centimos == null ? null : Number(r.calderilla_centimos),
  }));
}

export type ResultadoEvaluacion = {
  abiertas: number;
  cerradas: number;
  evaluadas: number;
  /** Incidencias nuevas que han generado al menos un aviso. */
  avisadas: number;
};

/**
 * Evalúa la red y pone al día la bandeja.
 *
 * Es idempotente: lanzarla dos veces seguidas no duplica nada. El índice único
 * parcial sobre las incidencias vivas es lo que lo garantiza — no un `if`.
 */
export async function evaluar(empresaId: string): Promise<ResultadoEvaluacion> {
  const [reglas, cajas] = await Promise.all([listarReglas(empresaId), estadoDeLaRed(empresaId)]);
  const incidencias = evaluarRed(reglas, cajas);
  const ahora = Date.now();

  let avisadas = 0;
  for (const i of incidencias) {
    // Solo se avisa de lo NUEVO. Reevaluar cada cuarto de hora no puede
    // significar un correo cada cuarto de hora del mismo problema.
    const nueva = await abrirIncidencia(empresaId, i, ahora);
    if (nueva) {
      avisadas += (await avisarDeIncidencia(empresaId, nueva)) > 0 ? 1 : 0;
    }
  }
  const cerradas = await cerrarLasQueYaNoPasan(empresaId, incidencias, ahora);

  return { abiertas: incidencias.length, cerradas, evaluadas: cajas.length, avisadas };
}

/**
 * Abre la incidencia si no estaba, y devuelve sus datos SOLO si es nueva.
 *
 * `xmax = 0` distingue en PostgreSQL una fila insertada de una actualizada por
 * el `ON CONFLICT`. Es lo que permite avisar únicamente de lo nuevo sin una
 * segunda consulta ni una condición de carrera entre comprobar y escribir.
 */
async function abrirIncidencia(
  empresaId: string,
  i: Incidencia,
  ahora: number
): Promise<{
  id: string;
  tipo: string;
  registerId: number | null;
  centroId: string | null;
  caja: string | null;
  valor: number;
  umbral: number;
} | null> {
  const { rows } = await pool.query(
    `INSERT INTO central_incidents
       (empresa_id, centro_id, register_id, session_id, tipo, regla_id, clave,
        umbral, valor, detalle, abierta_en_ms, actualizada_en_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
     ON CONFLICT (empresa_id, clave) WHERE estado IN ('ABIERTA','RECONOCIDA')
       -- Ya estaba abierta: se refresca el valor —un tránsito lleva ahora seis
       -- días y no cuatro— sin tocar el estado ni la fecha de apertura, que es
       -- lo que mide cuánto lleva el problema sin resolverse.
       DO UPDATE SET valor = EXCLUDED.valor, umbral = EXCLUDED.umbral,
                     actualizada_en_ms = EXCLUDED.actualizada_en_ms
     RETURNING id, (xmax = 0) AS insertada`,
    [
      empresaId,
      i.detalle.centroId ?? null,
      i.registerId,
      i.detalle.sessionId ?? null,
      i.tipo,
      i.reglaId,
      i.clave,
      i.umbral,
      i.valor,
      JSON.stringify(i.detalle),
      ahora,
    ]
  );

  if (!rows[0]?.insertada) return null;

  const { rows: caja } = await pool.query(`SELECT nombre FROM cash_registers WHERE id = $1`, [
    i.registerId,
  ]);

  return {
    id: String(rows[0].id),
    tipo: i.tipo,
    registerId: i.registerId,
    centroId: (i.detalle.centroId as string) ?? null,
    caja: caja[0]?.nombre ?? null,
    valor: i.valor,
    umbral: i.umbral,
  };
}

async function cerrarLasQueYaNoPasan(
  empresaId: string,
  incidencias: readonly Incidencia[],
  ahora: number
): Promise<number> {
  const vivas = incidencias.map((i) => i.clave);
  const { rowCount } = await pool.query(
    `UPDATE central_incidents
        SET estado = 'RESUELTA', cerrada_en_ms = $2, cerrada_motivo = 'AUTO',
            actualizada_en_ms = $2
      WHERE empresa_id = $1
        AND estado IN ('ABIERTA','RECONOCIDA')
        AND tipo = ANY($3::text[])
        AND NOT (clave = ANY($4::text[]))`,
    [empresaId, ahora, [...SE_CIERRAN_SOLOS], vivas]
  );
  return rowCount ?? 0;
}

export async function listarIncidencias(empresaId: string, soloVivas = true) {
  const { rows } = await pool.query(
    `SELECT i.*, c.nombre AS caja_nombre
       FROM central_incidents i
       LEFT JOIN cash_registers c ON c.id = i.register_id
      WHERE i.empresa_id = $1
        ${soloVivas ? "AND i.estado IN ('ABIERTA','RECONOCIDA')" : ""}
      ORDER BY i.abierta_en_ms DESC
      LIMIT 200`,
    [empresaId]
  );

  return rows.map((r: any) => ({
    id: String(r.id),
    tipo: r.tipo,
    registerId: r.register_id,
    caja: r.caja_nombre ?? null,
    sessionId: r.session_id ?? null,
    umbral: Number(r.umbral),
    valor: Number(r.valor),
    estado: r.estado,
    nota: r.nota ?? null,
    abiertaEnMs: Number(r.abierta_en_ms),
    cerradaMotivo: r.cerrada_motivo ?? null,
    ambitoRegla: r.detalle?.ambitoRegla ?? null,
  }));
}

/** Reconocer o resolver a mano. Queda quién y por qué. */
export async function cambiarIncidencia(
  ctx: { empresaId: string; userId: string | null; ip?: string },
  id: string,
  estado: "RECONOCIDA" | "RESUELTA",
  nota?: string
): Promise<void> {
  const ahora = Date.now();
  await pool.query(
    /*
     * Los casts no son adorno: `$5` se usa como bigint suelto y dentro de un
     * CASE cuya otra rama es NULL, y PostgreSQL deduce entonces dos tipos
     * distintos para el mismo parámetro y se niega a preparar la consulta
     * («inconsistent types deduced»). Con el tipo escrito, no hay nada que
     * deducir.
     */
    `UPDATE central_incidents
        SET estado = $3, nota = COALESCE($4::text, nota), actualizada_en_ms = $5::bigint,
            cerrada_en_ms = CASE WHEN $3 = 'RESUELTA' THEN $5::bigint ELSE NULL END,
            cerrada_por = CASE WHEN $3 = 'RESUELTA' THEN $6::uuid ELSE NULL END,
            cerrada_motivo = CASE WHEN $3 = 'RESUELTA' THEN 'MANUAL' ELSE NULL END
      WHERE id = $1 AND empresa_id = $2`,
    [Number(id), ctx.empresaId, estado, nota ?? null, ahora, ctx.userId]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: `central.incident.${estado.toLowerCase()}`,
    entidad: "central_incidents",
    entidadId: id,
    detalle: { nota: nota ?? null },
    ip: ctx.ip,
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Ciclo automático de evaluación.
 *
 * Cada cuarto de hora y solo para las empresas que tienen reglas: sin reglas no
 * hay nada que evaluar, y recorrer toda la red para no hacer nada es trabajo
 * que se paga en cada vuelta.
 *
 * El intervalo no es corto a propósito. Lo que se vigila aquí se mide en días
 * —un tránsito que no vuelve, una caja sin cerrar— y de los descuadres se
 * entera igualmente en cuanto llega el arqueo. Evaluar cada minuto solo serviría
 * para gastar consultas.
 */
const INTERVALO_MS = 15 * 60_000;
let temporizador: NodeJS.Timeout | null = null;

export async function evaluarTodas(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT DISTINCT empresa_id FROM central_rules WHERE activa`
  );
  for (const r of rows) {
    try {
      await evaluar(r.empresa_id);
    } catch (e) {
      // Una empresa con un problema no puede dejar sin evaluar a las demás.
      console.error("[MC Central] error evaluando reglas de", r.empresa_id, e);
    }
  }
  return rows.length;
}

export function startCentralRulesWorker(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    void evaluarTodas();
  }, INTERVALO_MS);
  temporizador.unref?.();
}
