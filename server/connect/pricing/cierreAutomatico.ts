/**
 * Cierre automático de la tarifa.
 *
 * Está APAGADO de fábrica. Se enciende por centro de control desde
 * Configuración, y mientras esté apagado no hace absolutamente nada: el cierre
 * lo sigue disparando una persona desde la ficha.
 *
 * Va en un pase periódico y no en el momento en que la asistencia pasa a
 * terminada, por tres razones:
 *
 *  1. **Soporta la espera.** La etapa final es INMUTABLE: una vez cerrada, un
 *     neumático que el taller comunique después ya no entra en la tarifa y hay
 *     que meterlo como ajuste manual auditado. Por eso hay un margen
 *     configurable —24 h por defecto— antes de cerrar.
 *  2. **Es reintentable.** Si falla por lo que sea, el pase siguiente lo
 *     vuelve a intentar. Enganchado a la transición, se habría perdido.
 *  3. **No puede romper el cierre del servicio.** Un error tarificando no
 *     debe impedir que una asistencia pase a terminada.
 *
 * Y una decisión que conviene entender: se cierra en el estado en que esté la
 * tarifa, aunque salga a revisión manual. Una tarifa que no cuadra y se ve es
 * mejor que un servicio que no se factura porque nadie se acordó de cerrarlo.
 */

import db from "../../db.ts";
import { finalizar } from "./service.ts";
import {
  leerAjustesCierre, normalizarEspera, ESPERA_POR_DEFECTO_MIN,
  type AjustesCierre,
} from "./ajustesCierre.ts";

// Se reexportan para que quien use el cierre no tenga que saber que la
// política vive en otro fichero.
export { leerAjustesCierre, ESPERA_POR_DEFECTO_MIN, type AjustesCierre };

/**
 * Cuándo terminó de verdad: el instante de la transición a terminada o
 * anulada. Si por lo que sea no hay historial, se cae a `updatedAtMs`, que es
 * peor pero es lo que hay.
 */
const SQL_TERMINADA_EN = `COALESCE(
  (SELECT MAX(h."occurredAtMs") FROM connect_status_history h
    WHERE h."assistanceId" = ca.id AND h."toStatus" IN ('finished','cancelled')),
  ca."updatedAtMs")`;

export interface ResultadoCierre {
  centros: number;
  cerradas: number;
  fallidas: number;
  /** Detalle por asistencia, para el log y para poder explicar qué pasó. */
  detalle: { assistanceId: number; estado: string | null; error?: string }[];
}

/**
 * Un pase de cierre automático sobre todos los centros que lo tengan activo.
 *
 * El límite por pase existe para que estrenar el interruptor en una central
 * con mil asistencias sin cerrar no bloquee el worker durante minutos: se van
 * cerrando en tandas, pase a pase.
 */
export async function pasadaDeCierreAutomatico(limitePorPase = 50): Promise<ResultadoCierre> {
  const centros = await db.query(
    `SELECT id, settings FROM connect_control_centers
      WHERE "deletedAtMs" IS NULL AND status = 'active'
        AND settings LIKE '%cierreAutomatico%'`,
  );

  const salida: ResultadoCierre = { centros: 0, cerradas: 0, fallidas: 0, detalle: [] };

  for (const c of centros.rows) {
    const ajustes = leerAjustesCierre(c.settings);
    if (!ajustes.activo) continue;
    salida.centros++;

    const candidatas = await asistenciasPorCerrar(Number(c.id), ajustes.esperaMin, limitePorPase);
    for (const id of candidatas) {
      try {
        const r = await finalizar(id, { distanceSource: "routed" });
        if (r) {
          salida.cerradas++;
          salida.detalle.push({ assistanceId: id, estado: r.estado });
        } else {
          // Sin centro de control o sin tarifario: no es un fallo, es que no
          // hay nada que cerrar. Se deja para que lo vea el humano.
          salida.detalle.push({ assistanceId: id, estado: null });
        }
      } catch (err: any) {
        salida.fallidas++;
        salida.detalle.push({ assistanceId: id, estado: null, error: err?.message ?? String(err) });
      }
    }
  }

  return salida;
}

/**
 * Asistencias terminadas o anuladas, con el margen ya cumplido, que tienen
 * forfait comprometido pero no cierre.
 *
 * Se exige la etapa `locked` a propósito: sin forfait comprometido no hay
 * nada que regularizar, y cerrar ahí produciría una tarifa desde cero con la
 * configuración de hoy en lugar de con la que se pactó. Esas se quedan en
 * «pendientes de cierre» para que las mire una persona.
 *
 * ⚠ La espera se mide desde la TRANSICIÓN a terminada, no desde
 * `updatedAtMs`. Esa columna la reescribe cualquier cambio en la asistencia
 * —incluido el propio bloqueo del forfait—, así que usarla haría que la
 * ventana de espera se reiniciara sola y hubiera servicios que no se cerraran
 * nunca mientras alguien siguiera tocándolos.
 */
async function asistenciasPorCerrar(
  controlCenterId: number,
  esperaMin: number,
  limite: number,
): Promise<number[]> {
  const corte = Date.now() - esperaMin * 60_000;
  const r = await db.query(
    `SELECT ca.id, ${SQL_TERMINADA_EN} AS "terminadaEnMs"
       FROM connect_assistances ca
      WHERE ca."controlCenterId" = $1
        AND ca.status IN ('finished', 'cancelled')
        AND ${SQL_TERMINADA_EN} <= $2
        AND EXISTS (SELECT 1 FROM connect_assistance_pricings p
                     WHERE p."assistanceId" = ca.id AND p.stage = 'locked')
        AND NOT EXISTS (SELECT 1 FROM connect_assistance_pricings p
                         WHERE p."assistanceId" = ca.id AND p.stage = 'final')
      ORDER BY "terminadaEnMs"
      LIMIT $3`,
    [controlCenterId, corte, limite],
  );
  return r.rows.map((x: any) => Number(x.id));
}

/**
 * Cuántas cerraría ahora mismo, sin cerrar ninguna.
 *
 * Es lo que enseña la pantalla de Configuración antes de encender el
 * interruptor: «con esta espera se cerrarían N servicios». Encender esto a
 * ciegas en una central con seiscientos servicios sin cerrar es una sorpresa
 * que conviene ahorrarse.
 */
export async function simularCierre(controlCenterId: number, esperaMin: number): Promise<{
  cerrariaAhora: number; pendientesTotal: number; esperaMin: number;
}> {
  const [conEspera, total] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances ca
        WHERE ca."controlCenterId" = $1 AND ca.status IN ('finished','cancelled')
          AND ${SQL_TERMINADA_EN} <= $2
          AND EXISTS (SELECT 1 FROM connect_assistance_pricings p
                       WHERE p."assistanceId" = ca.id AND p.stage = 'locked')
          AND NOT EXISTS (SELECT 1 FROM connect_assistance_pricings p
                           WHERE p."assistanceId" = ca.id AND p.stage = 'final')`,
      [controlCenterId, Date.now() - esperaMin * 60_000]),
    db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances ca
        WHERE ca."controlCenterId" = $1 AND ca.status IN ('finished','cancelled')
          AND NOT EXISTS (SELECT 1 FROM connect_assistance_pricings p
                           WHERE p."assistanceId" = ca.id AND p.stage = 'final')`,
      [controlCenterId]),
  ]);

  return {
    cerrariaAhora: conEspera.rows[0].n,
    pendientesTotal: total.rows[0].n,
    esperaMin,
  };
}

/** Guarda el interruptor y la espera en `settings` sin pisar el resto. */
export async function guardarAjustesCierre(
  controlCenterId: number,
  ajustes: { activo: boolean; esperaMin: number },
): Promise<AjustesCierre> {
  const r = await db.query(
    `SELECT settings FROM connect_control_centers WHERE id = $1`, [controlCenterId]);
  if (!r.rows[0]) throw new Error("Centro de control no encontrado");

  const actual = (() => {
    const v = r.rows[0].settings;
    if (v == null) return {} as Record<string, any>;
    if (typeof v !== "string") return v as Record<string, any>;
    try { return JSON.parse(v) ?? {}; } catch { return {}; }
  })();

  const espera = normalizarEspera(ajustes.esperaMin);

  const nuevo = {
    ...actual,
    pricing: {
      ...(actual.pricing ?? {}),
      cierreAutomatico: ajustes.activo === true,
      cierreAutomaticoEsperaMin: espera,
    },
  };

  await db.query(
    `UPDATE connect_control_centers SET settings = $1, "updatedAtMs" = $2 WHERE id = $3`,
    [JSON.stringify(nuevo), Date.now(), controlCenterId]);

  return { activo: ajustes.activo === true, esperaMin: espera };
}
