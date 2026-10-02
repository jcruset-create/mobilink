/**
 * Configuración del módulo (`self_storage_settings`): el valor del centro gana
 * al de la empresa, y el de la empresa al valor por defecto del código.
 *
 * Cada clave conocida tiene aquí su valor por defecto y su validación. Una
 * clave que no está en la lista no se puede leer ni guardar: así no aparecen
 * ajustes «fantasma» que nadie sabe qué hacen.
 */

import { z } from "zod";
import type { Ejecutor } from "./db.ts";

export const AJUSTES = {
  /** IVA por defecto del ALQUILER de un trastero nuevo (no de otros conceptos). */
  "units.default_rental_tax_rate": { esquema: z.number().min(0).max(100), defecto: 21 },
  /** Minutos que dura una reserva temporal (fase 2/4). */
  "reservations.ttl_minutes": { esquema: z.number().int().min(1).max(24 * 60), defecto: 15 },
  /**
   * Primer cobro SEPA de un cliente NUEVO (fase 2): por defecto NO se da acceso
   * hasta que el cobro se confirma. Un cliente con contrato activo cuyo recibo
   * está en `processing` no se bloquea: eso es otra regla, no esta.
   */
  "billing.first_sepa_payment_access_policy": {
    esquema: z.enum(["wait_for_success", "allow_while_processing"]),
    defecto: "wait_for_success" as "wait_for_success" | "allow_while_processing",
  },
} as const;

export type ClaveAjuste = keyof typeof AJUSTES;
export type ValorAjuste<K extends ClaveAjuste> = z.infer<(typeof AJUSTES)[K]["esquema"]>;

export async function leerAjuste<K extends ClaveAjuste>(
  db: Ejecutor,
  empresaId: string,
  centerId: string | null,
  clave: K
): Promise<ValorAjuste<K>> {
  const { rows } = await db.query(
    `SELECT value FROM self_storage_settings
      WHERE empresa_id = $1 AND key = $2 AND (center_id = $3 OR center_id IS NULL)
      ORDER BY center_id NULLS LAST
      LIMIT 1`,
    [empresaId, clave, centerId]
  );
  const def = AJUSTES[clave];
  if (!rows.length) return def.defecto as ValorAjuste<K>;
  const r = def.esquema.safeParse(rows[0].value);
  // Un valor corrupto en la base no tumba la operación: se usa el defecto y se avisa.
  if (!r.success) {
    console.warn(`[Self Storage] ajuste ${clave} no válido en la base; se usa el valor por defecto`);
    return def.defecto as ValorAjuste<K>;
  }
  return r.data as ValorAjuste<K>;
}
