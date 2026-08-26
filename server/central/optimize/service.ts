/**
 * Reparto de efectivo sobre datos reales.
 *
 * Lo que tiene cada caja sale del último arqueo (`central_denomination_stock`),
 * que es la foto contada a mano. Lo que necesita sale de la predicción de la
 * fase 17, repartida en piezas.
 */

import pool from "../../db.ts";
import { repartir, type PosicionCaja, type Reparto } from "./domain.ts";
import { prediccionDeCaja } from "../forecast/service.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MONEDA_MAX_CENTIMOS = 500;

/**
 * Convierte «le faltan 45 €» en piezas concretas.
 *
 * Se reparte **en la proporción en que esa caja las gasta**, no a partes
 * iguales ni con las más grandes: una caja que devuelve sobre todo monedas de
 * 1 € necesita monedas de 1 €, y mandarle el equivalente en piezas de 2 € la
 * deja igual de bloqueada con el mismo dinero dentro.
 */
async function piezasQueNecesita(
  empresaId: string,
  registerId: number,
  faltaCentimos: number
): Promise<{ valor: number; cantidad: number }[]> {
  if (faltaCentimos <= 0) return [];

  const { rows } = await pool.query(
    `SELECT m.valor_unitario_centimos AS valor,
            SUM(m.cantidad)::int AS piezas
       FROM cash_denomination_movements m
       JOIN cash_sessions s ON s.id = m.session_id
      WHERE s.empresa_id = $1 AND s.register_id = $2
        AND m.direccion = 'OUT' AND m.motivo = 'CHANGE_GIVEN'
        AND m.valor_unitario_centimos < $3
      GROUP BY m.valor_unitario_centimos`,
    [empresaId, registerId, MONEDA_MAX_CENTIMOS]
  );

  const total = rows.reduce((a: number, r: any) => a + r.valor * r.piezas, 0);
  if (total === 0) return [];

  return rows
    .map((r: any) => ({
      valor: r.valor,
      // Proporción del importe que esa pieza representa en su consumo real.
      cantidad: Math.round((faltaCentimos * ((r.valor * r.piezas) / total)) / r.valor),
    }))
    .filter((p: { cantidad: number }) => p.cantidad > 0);
}

export async function repartoDeLaRed(empresaId: string, horizonteDias = 7): Promise<Reparto & {
  cajas: number;
}> {
  const { rows } = await pool.query(
    `SELECT register_id FROM central_registers WHERE empresa_id = $1`,
    [empresaId]
  );

  const posiciones: PosicionCaja[] = [];

  for (const r of rows) {
    const registerId = r.register_id;

    const { rows: stock } = await pool.query(
      `SELECT valor_centimos AS valor, cantidad, centro_id
         FROM central_denomination_stock
        WHERE empresa_id = $1 AND register_id = $2 AND valor_centimos < $3`,
      [empresaId, registerId, MONEDA_MAX_CENTIMOS]
    );

    // Sin arqueo no hay foto fiable de sus piezas: no entra en el reparto. Es
    // preferible dejarla fuera a moverle dinero a ciegas.
    if (stock.length === 0) continue;

    const prediccion = await prediccionDeCaja(empresaId, registerId, horizonteDias);
    const necesita = await piezasQueNecesita(
      empresaId,
      registerId,
      prediccion.porDia.reduce((a, d) => a + d.esperadoCentimos, 0)
    );

    posiciones.push({
      registerId,
      centroId: stock[0].centro_id ?? null,
      stock: stock.map((s: any) => ({ valor: s.valor, cantidad: s.cantidad })),
      necesita,
    });
  }

  return { ...repartir(posiciones), cajas: posiciones.length };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
