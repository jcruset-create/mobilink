/**
 * Tesorería predictiva sobre datos reales.
 *
 * El historial de consumo sale del **libro mayor de piezas**, que es donde
 * consta cada moneda que salió del cajón. No de los totales de la jornada: un
 * cobro de 50 € pagado con tarjeta no gasta calderilla, y contarlo inflaría la
 * predicción justo en los días de más facturación.
 */

import pool from "../../db.ts";
import { predecir, type JornadaConsumo, type Prediccion } from "./domain.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Cuántas jornadas hacia atrás se miran. Ocho semanas: dos meses de patrón. */
export const JORNADAS_A_MIRAR = 56;

/** Lo que se considera moneda: por debajo del billete más pequeño. */
const MONEDA_MAX_CENTIMOS = 500;

/**
 * Qué salidas del cajón son CONSUMO de verdad.
 *
 * Lo destapó una prueba: contando todas las salidas, el **cambio final** que se
 * deja para mañana entraba como consumo del día. Una caja que cierra con 300 €
 * en monedas aparecía gastando 300 € diarios, y la predicción mandaba al banco
 * todos los días a por un dinero que no se había gastado: estaba en el cajón.
 *
 * Consumo es lo que sale y no vuelve:
 *
 * · `CHANGE_GIVEN` — el cambio que se le da al cliente. Es el grueso.
 * · `SUPPLIER_PAYMENT` y `MANUAL_OUT` — dinero que sale de la caja.
 *
 * Lo que NO es consumo, y por qué:
 *
 * · `CLOSING_FLOAT` — se queda en el cajón para mañana.
 * · `BANK_DEPOSIT` y `CASH_DELIVERY` — sale, pero no se ha gastado en cambio;
 *   son billetes, y además vuelven o se convierten.
 * · `CARTRIDGE_OPENED` y `BAG_OPENED` — movimientos internos de valor neto
 *   cero: sale el tubo y entran sus monedas. Contarlos sería contar dos veces.
 */
const MOTIVOS_DE_CONSUMO = ["CHANGE_GIVEN", "SUPPLIER_PAYMENT", "MANUAL_OUT"];

export async function historialDeCaja(
  empresaId: string,
  registerId: number
): Promise<JornadaConsumo[]> {
  const { rows } = await pool.query(
    `SELECT s.fecha,
            COALESCE(SUM(m.valor_unitario_centimos * m.cantidad), 0) AS salida,
            COALESCE(SUM(m.valor_unitario_centimos * m.cantidad)
                     FILTER (WHERE m.valor_unitario_centimos < $3), 0) AS calderilla
       FROM cash_sessions s
       JOIN cash_denomination_movements m ON m.session_id = s.id
      WHERE s.empresa_id = $1 AND s.register_id = $2 AND s.estado = 'CLOSED'
        AND m.direccion = 'OUT'
        AND m.motivo = ANY($5::text[])
      GROUP BY s.fecha
      ORDER BY s.fecha DESC
      LIMIT $4`,
    [empresaId, registerId, MONEDA_MAX_CENTIMOS, JORNADAS_A_MIRAR, MOTIVOS_DE_CONSUMO]
  );

  return rows
    .map((r: any) => ({
      fecha: r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : String(r.fecha).slice(0, 10),
      salidaCentimos: Number(r.salida),
      calderillaCentimos: Number(r.calderilla),
    }))
    .reverse();
}

async function calderillaActual(empresaId: string, registerId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(valor_centimos * cantidad), 0) AS centimos
       FROM central_denomination_stock
      WHERE empresa_id = $1 AND register_id = $2 AND valor_centimos < $3`,
    [empresaId, registerId, MONEDA_MAX_CENTIMOS]
  );
  return Number(rows[0]?.centimos ?? 0);
}

export async function prediccionDeCaja(
  empresaId: string,
  registerId: number,
  horizonteDias = 7
): Promise<Prediccion & { registerId: number; calderillaActualCentimos: number }> {
  const [historial, calderilla] = await Promise.all([
    historialDeCaja(empresaId, registerId),
    calderillaActual(empresaId, registerId),
  ]);

  // Se predice a partir de MAÑANA: lo de hoy ya está pasando.
  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  return {
    registerId,
    calderillaActualCentimos: calderilla,
    ...predecir(historial, calderilla, manana, horizonteDias),
  };
}

/** Las cajas que hay que reponer antes, primero. */
export async function prediccionDeLaRed(empresaId: string, horizonteDias = 7) {
  const { rows } = await pool.query(
    `SELECT register_id FROM central_registers WHERE empresa_id = $1`,
    [empresaId]
  );

  const predicciones = [];
  for (const r of rows) {
    predicciones.push(await prediccionDeCaja(empresaId, r.register_id, horizonteDias));
  }

  /*
   * Orden: primero las que menos aguantan. Las que no se pueden predecir van al
   * final y no primero — no saber no es una urgencia, y ponerlas arriba
   * enterraría las que sí necesitan cambio mañana.
   */
  return predicciones.sort((a, b) => {
    if (a.diasDeAutonomia == null) return 1;
    if (b.diasDeAutonomia == null) return -1;
    return a.diasDeAutonomia - b.diasDeAutonomia;
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
