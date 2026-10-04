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
  /**
   * IVA general de la empresa: TIPO (porcentaje, 21.00), nunca una cuota en
   * euros. Lo usan los contratos NUEVOS (que se quedan con una copia) y los
   * conceptos con política `inherit_default`. Cambiarlo no toca contratos ni
   * facturas existentes. Sustituye a `units.default_rental_tax_rate` (0008).
   */
  default_vat_rate: {
    esquema: z.number().min(0).max(100).refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "como mucho dos decimales"),
    defecto: 21,
  },
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
  /**
   * Datos fiscales del EMISOR de las facturas y los contratos. Sin ellos no se
   * emite nada: una factura sin NIF del emisor no es una factura.
   */
  "billing.issuer": {
    esquema: z
      .object({
        name: z.string().trim().min(1).max(200),
        taxId: z.string().trim().min(5).max(20),
        address: z.string().trim().min(1).max(400),
        email: z.string().trim().max(200).optional(),
        phone: z.string().trim().max(40).optional(),
      })
      .nullable(),
    defecto: null as null | { name: string; taxId: string; address: string; email?: string; phone?: string },
  },
  /** Intentos de apertura por persona y minuto (app, enlace temporal, administración). */
  "access.rate_limit_per_minute": { esquema: z.number().int().min(1).max(120), defecto: 6 },
  /**
   * Call Center: activación FUNCIONAL por empresa. El interruptor global es
   * la variable SELF_STORAGE_CALL_CENTER_ENABLED (apagarla lo para en todas).
   */
  "call_center.enabled": { esquema: z.boolean(), defecto: false },
  /** Centro que se propone por defecto al registrar una llamada. */
  "call_center.default_center_id": { esquema: z.uuid().nullable(), defecto: null as string | null },
  /**
   * Enlaces que el Call Center da a quien llama («la web vende»). Son de la
   * empresa, no del código: ni TLC ni ninguna marca escrita a mano.
   */
  "call_center.links": {
    esquema: z.object({
      brandName: z.string().trim().max(120).nullable(),
      web: z.url().nullable(),
      calculator: z.url().nullable(),
      contracting: z.url().nullable(),
      virtualVisit: z.url().nullable(),
    }),
    defecto: { brandName: null, web: null, calculator: null, contracting: null, virtualVisit: null } as {
      brandName: string | null;
      web: string | null;
      calculator: string | null;
      contracting: string | null;
      virtualVisit: string | null;
    },
  },
  /** Guardar la transcripción de las llamadas (desactivado por defecto) y cuántos días. */
  "call_center.store_transcripts": { esquema: z.boolean(), defecto: false },
  "call_center.transcript_retention_days": { esquema: z.number().int().min(1).max(730), defecto: 90 },
  /**
   * Grabación de audio: NO disponible hasta conectar telefonía real. El ajuste
   * existe para que el «no» sea explícito y no se pueda encender sin querer.
   */
  "call_center.store_audio": { esquema: z.literal(false), defecto: false as const },
  /** Series de numeración: facturas, rectificativas y contratos. */
  "billing.invoice_series": { esquema: z.string().regex(/^[A-Z]{1,5}$/), defecto: "F" },
  "billing.rectifying_series": { esquema: z.string().regex(/^[A-Z]{1,5}$/), defecto: "R" },
  "contracts.series": { esquema: z.string().regex(/^[A-Z]{1,5}$/), defecto: "C" },
  /** Días hasta el vencimiento de una factura de cobro manual (transferencia/efectivo). */
  "billing.due_days": { esquema: z.number().int().min(0).max(120), defecto: 7 },
  /** Plazos del impago, en días desde el fallo del cobro (día 0). */
  "dunning.policy": {
    esquema: z.object({
      firstNoticeDays: z.number().int().min(0).max(365),
      secondNoticeDays: z.number().int().min(0).max(365),
      suspendDays: z.number().int().min(0).max(365),
    }),
    defecto: { firstNoticeDays: 3, secondNoticeDays: 7, suspendDays: 10 },
  },
  /** Condiciones generales que se imprimen en el contrato, con su versión. */
  "contracts.terms_version": { esquema: z.string().trim().min(1).max(40), defecto: "v1" },
  "contracts.terms_text": {
    esquema: z.string().trim().min(1).max(50_000),
    defecto: [
      "1. Objeto. El arrendador cede al cliente el uso del trastero indicado para guardar bienes muebles de lícito comercio.",
      "2. Duración. El contrato se renueva por meses salvo preaviso de cualquiera de las partes.",
      "3. Precio y pago. La cuota mensual se factura por adelantado en el día de facturación indicado. El impago permite al arrendador suspender el acceso al trastero según los plazos comunicados al cliente.",
      "4. Fianza. La fianza se devuelve al finalizar el contrato, una vez comprobado el estado del trastero y saldadas las deudas.",
      "5. Uso. Queda prohibido almacenar materiales peligrosos, perecederos, ilegales o animales.",
      "6. Acceso. El acceso se realiza con los medios facilitados por el arrendador y en el horario del centro.",
      "Estas condiciones son un texto de ejemplo: sustitúyalas por las revisadas por su asesoría en Configuración.",
    ].join("\n\n"),
  },
} as const;

export type ClaveAjuste = keyof typeof AJUSTES;
export type ValorAjuste<K extends ClaveAjuste> = z.infer<(typeof AJUSTES)[K]["esquema"]>;

export function esClaveAjuste(k: string): k is ClaveAjuste {
  return Object.prototype.hasOwnProperty.call(AJUSTES, k);
}

/** Todos los ajustes de la empresa (o del centro), con su valor efectivo. */
export async function leerTodos(db: Ejecutor, empresaId: string, centerId: string | null) {
  const out: Record<string, { value: unknown; isDefault: boolean }> = {};
  for (const k of Object.keys(AJUSTES) as ClaveAjuste[]) {
    const { rows } = await db.query(
      `SELECT 1 FROM self_storage_settings WHERE empresa_id = $1 AND key = $2 AND (center_id = $3 OR center_id IS NULL) LIMIT 1`,
      [empresaId, k, centerId]
    );
    out[k] = { value: await leerAjuste(db, empresaId, centerId, k), isDefault: rows.length === 0 };
  }
  return out;
}

/** Guarda un ajuste (validado). center_id NULL = valor de la empresa. */
export async function guardarAjuste(db: Ejecutor, empresaId: string, centerId: string | null, clave: ClaveAjuste, valor: unknown, userId: string | null) {
  const r = AJUSTES[clave].esquema.safeParse(valor);
  if (!r.success) {
    const { ErrorSelfStorage } = await import("../errors.ts");
    throw new ErrorSelfStorage("AJUSTE_NO_VALIDO", `Valor no válido para «${clave}»: ${r.error.issues[0]?.message ?? ""}`, 422);
  }
  await db.query(
    `INSERT INTO self_storage_settings (empresa_id, center_id, key, value, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (empresa_id, COALESCE(center_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
     DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [empresaId, centerId, clave, JSON.stringify(r.data), userId]
  );
  return r.data;
}

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
