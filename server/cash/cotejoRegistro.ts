/**
 * El rastro de los cotejos con el ERP, que es lo que sostiene la puerta del
 * cierre.
 *
 * Vive aparte de `cotejoErp.ts` a propósito: allí no se escribe nada, y esa
 * regla —«un cotejo informa, no toca el dinero»— vale más si no hay que
 * releerla cada vez para comprobar que sigue siendo verdad. Esto escribe, y
 * está claro qué escribe: cifras de un cotejo. Ningún movimiento de caja sale
 * nunca de aquí.
 *
 * ## Lo que se guarda y lo que no
 *
 * No se guarda la captura, ni las líneas, ni un nombre de cliente. Solo cuántas
 * líneas había, cuántas cuadraron, por cuánto se diferencian y cómo estaba la
 * jornada en ese momento. Con eso basta para decidir si se puede cerrar, y así
 * guardarlo no crea ningún depósito de datos personales.
 */

import type { PoolClient } from "pg";
import pool from "../db.ts";
import type { Informe } from "./domain/cotejo.ts";
import { huellaDeJornada, type CotejoGuardado } from "./domain/puertaDeCierre.ts";

type Cliente = Pick<PoolClient, "query">;

/**
 * Cómo está la jornada AHORA, en dos cifras.
 *
 * Las mismas operaciones que mira el cotejo —vivas, cobros y pagos— porque la
 * huella tiene que cambiar exactamente cuando cambiaría el informe. Si contara
 * también las entregas o los ingresos bancarios, el cotejo caducaría al hacer
 * el ingreso del banco sin que el ERP tuviera nada que ver.
 */
export async function huellaDeLaJornada(
  client: Cliente,
  empresaId: string,
  sessionId: number
): Promise<string> {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(o.id), 0)::int AS ultima,
            COALESCE(SUM(o.importe_centimos), 0)::bigint AS suma
       FROM cash_operations o
       JOIN cash_sessions s ON s.id = o.session_id
      WHERE o.session_id = $1
        AND s.empresa_id = $2
        AND o.estado = 'CONFIRMED'
        AND o.tipo IN ('COLLECTION','PAYMENT')`,
    [sessionId, empresaId]
  );
  const r = rows[0]!;
  return huellaDeJornada({
    ultimaOperacionId: Number(r.ultima),
    sumaCentimos: Number(r.suma),
  });
}

/**
 * Apuntar que se ha cotejado.
 *
 * `informe` viene a null cuando la lectura salió bloqueante. Se apunta igual, y
 * como NO cuadrado: que alguien haya pegado una captura ilegible no es haber
 * cotejado, pero sí es algo que conviene que quede —si el cierre luego se
 * fuerza, el histórico enseña que se intentó.
 */
export async function registrarCotejo(
  empresaId: string,
  sessionId: number,
  userId: string | null,
  informe: Informe | null
): Promise<void> {
  const huella = await huellaDeLaJornada(pool, empresaId, sessionId);
  const aRevisar = informe
    ? informe.soloEnErp.length +
      informe.soloEnMobilink.length +
      informe.ambiguas.length +
      informe.discrepanciasDeForma.length
    : 0;

  await pool.query(
    `INSERT INTO cash_erp_reconciliations
       (empresa_id, session_id, cuadra, huella, lineas_erp, emparejadas, a_revisar,
        diferencia_cobros_centimos, diferencia_pagos_centimos, lectura_bloqueante,
        cotejado_por, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      empresaId,
      sessionId,
      informe?.cuadra ?? false,
      huella,
      informe ? informe.emparejadas.length + informe.soloEnErp.length + informe.ambiguas.length : 0,
      informe?.emparejadas.length ?? 0,
      aRevisar,
      informe?.totales.diferenciaCobros ?? 0,
      informe?.totales.diferenciaPagos ?? 0,
      informe === null,
      userId,
      Date.now(),
    ]
  );
}

/** El último cotejo de la jornada, o null si no se ha cotejado nunca. */
export async function ultimoCotejo(
  client: Cliente,
  sessionId: number
): Promise<CotejoGuardado | null> {
  const { rows } = await client.query(
    `SELECT cuadra, huella, created_at_ms
       FROM cash_erp_reconciliations
      WHERE session_id = $1
      ORDER BY id DESC
      LIMIT 1`,
    [sessionId]
  );
  if (rows.length === 0) return null;
  return {
    cuadra: Boolean(rows[0]!.cuadra),
    huella: String(rows[0]!.huella),
    creadoEnMs: Number(rows[0]!.created_at_ms),
  };
}

/** Lo que la pantalla de Cierre necesita para avisar ANTES de que pulsen. */
export type EstadoDelCotejo = {
  /**
   * Esta caja exige el cotejo para cerrar.
   *
   * Va aquí y no se deduce en la pantalla porque quien decide es el servidor:
   * si la pantalla se lo inventara, avisaría donde no toca y —peor— callaría
   * donde sí, y la persona se encontraría la puerta al pulsar.
   */
  exigido: boolean;
  /** Nunca se ha cotejado esta jornada. */
  falta: boolean;
  /** Se cotejó, pero después se tocó la jornada. */
  caducado: boolean;
  /** El último cotejo daba todo por cuadrado. */
  cuadra: boolean;
  cotejadoEnMs: number | null;
};

/** Si la caja de esta jornada exige el cotejo para cerrar. */
async function cajaExigeCotejo(
  client: Cliente,
  empresaId: string,
  sessionId: number
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT c.exigir_cotejo_erp
       FROM cash_sessions s
       JOIN cash_registers c ON c.id = s.register_id
      WHERE s.id = $1 AND s.empresa_id = $2`,
    [sessionId, empresaId]
  );
  return Boolean(rows[0]?.exigir_cotejo_erp);
}

export async function estadoDelCotejo(
  empresaId: string,
  sessionId: number
): Promise<EstadoDelCotejo> {
  const [cotejo, huella, exigido] = await Promise.all([
    ultimoCotejo(pool, sessionId),
    huellaDeLaJornada(pool, empresaId, sessionId),
    cajaExigeCotejo(pool, empresaId, sessionId),
  ]);
  if (!cotejo) {
    return { exigido, falta: true, caducado: false, cuadra: false, cotejadoEnMs: null };
  }
  return {
    exigido,
    falta: false,
    caducado: cotejo.huella !== huella,
    cuadra: cotejo.cuadra,
    cotejadoEnMs: cotejo.creadoEnMs,
  };
}
