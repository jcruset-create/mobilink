/**
 * Ajustes manuales de importes, y la auditoría económica que dejan.
 *
 * El criterio, que ya estaba escrito en el esquema y aquí se cumple:
 * **nunca se sustituye un importe en silencio**. Se guarda el anterior, el
 * nuevo, el motivo y quién lo autorizó. Sin motivo no hay ajuste, y no por
 * burocracia: dentro de seis meses, cuando el cliente pregunte por qué esa
 * asistencia costó 300 en vez de 331, el motivo es la única respuesta posible.
 *
 * Y una decisión que conviene entender antes de tocar esto:
 *
 * **El snapshot NO se reescribe.** Sigue diciendo lo que dijo el tarifario. Lo
 * que la persona decidió vive en `connect_pricing_overrides` y en las líneas.
 * Así la explicación ("por qué costó esto") nunca miente sobre lo que calculó
 * el motor, y la diferencia entre lo calculado y lo cobrado es visible en vez
 * de estar fundida en un único número que ya no se sabe de dónde salió.
 */

import db from "../../db.ts";
import { formatear, restar, porcentajeDe, aDinero, type Dinero } from "./money.ts";
import { autorizarAjuste, leerAjustes } from "./permissions.ts";
import type { ConnectRole } from "../rbac.ts";

export type CampoAjustable = "saleTotal" | "purchaseTotal" | "saleUnitPrice" | "purchaseUnitPrice";

const CAMPOS: CampoAjustable[] = ["saleTotal", "purchaseTotal", "saleUnitPrice", "purchaseUnitPrice"];

export class ErrorAjuste extends Error {
  constructor(readonly codigo: string, mensaje: string, readonly estado = 400) {
    super(mensaje);
  }
}

export interface PeticionAjuste {
  assistanceId: number;
  etapa: "locked" | "final";
  /** Número de línea dentro de la etapa; sin él se ajusta el total. */
  lineNumber?: number | null;
  campo: CampoAjustable;
  valorNuevo: string | number;
  motivo: string;
}

export interface Autor {
  id: number | null;
  nombre: string | null;
  role: ConnectRole;
  controlCenterId: number | null;
}

/**
 * Aplica un ajuste y recalcula los totales de la etapa.
 *
 * Los totales se vuelven a sumar desde las líneas en vez de sumarle la
 * diferencia al total guardado: si algo se descuadró antes, sumar la
 * diferencia arrastra el descuadre, y volver a sumar lo corrige.
 */
export async function ajustarImporte(p: PeticionAjuste, autor: Autor): Promise<{
  ajusteId: number;
  anterior: string | null;
  nuevo: string;
  totales: { venta: string | null; compra: string | null; margen: string | null; margenPct: string | null };
}> {
  if (!CAMPOS.includes(p.campo)) {
    throw new ErrorAjuste("campo_desconocido", `No se puede ajustar "${p.campo}"`);
  }
  const motivo = String(p.motivo ?? "").trim();
  if (motivo.length < 5) {
    throw new ErrorAjuste("motivo_requerido",
      "Hace falta un motivo que explique el ajuste: es lo único que responderá la pregunta dentro de seis meses");
  }
  const nuevo = aDinero(p.valorNuevo);
  if (nuevo == null) throw new ErrorAjuste("importe_invalido", "El importe nuevo no es un número");

  const pricing = await db.query(
    `SELECT p.id, p."controlCenterId", p.currency
       FROM connect_assistance_pricings p
      WHERE p."assistanceId" = $1 AND p.stage = $2`,
    [p.assistanceId, p.etapa],
  );
  if (!pricing.rows[0]) {
    throw new ErrorAjuste("etapa_no_encontrada",
      `Esta asistencia no tiene tarifa en la etapa "${p.etapa}"`, 404);
  }
  const { id: pricingId, controlCenterId } = pricing.rows[0];

  if (autor.controlCenterId != null && Number(controlCenterId) !== autor.controlCenterId) {
    throw new ErrorAjuste("etapa_no_encontrada", "Esta asistencia no es de tu centro de control", 404);
  }

  // Ya facturado: cambiar el importe descuadraría con lo que salió al ERP
  const marcada = await db.query(
    `SELECT side FROM connect_billing_marks WHERE "assistanceId" = $1`, [p.assistanceId]);
  const lado = p.campo.startsWith("sale") ? "sale" : "purchase";
  if (marcada.rows.some((m: any) => m.side === lado)) {
    throw new ErrorAjuste("ya_facturado",
      "Ese lado ya se ha exportado a facturación. Hay que deshacer la exportación antes de tocar el importe", 409);
  }

  const linea = await lineaDestino(pricingId, p.lineNumber ?? null, p.campo);
  const anterior = aDinero(linea.valorActual);

  const veredicto = autorizarAjuste(
    autor.role,
    restar(nuevo, anterior ?? 0n),
    leerAjustes(await settingsDelCentro(controlCenterId)),
  );
  if (!veredicto.permitido) {
    const limite = veredicto.limite != null ? ` (tu límite es ${formatear(veredicto.limite, 2)})` : "";
    throw new ErrorAjuste(veredicto.codigo, `${veredicto.mensaje}${limite}`, 403);
  }

  const ahora = Date.now();
  const ins = await db.query(
    `INSERT INTO connect_pricing_overrides
       ("controlCenterId", "assistanceId", "priceLineId", field, "originalValue", "newValue",
        reason, "authorizedByUserId", "authorizedByName", "authorizedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [controlCenterId, p.assistanceId, linea.id, p.campo,
     anterior == null ? null : formatear(anterior, 4), formatear(nuevo, 4),
     motivo, autor.id, autor.nombre, ahora],
  );

  await db.query(
    `UPDATE connect_assistance_price_lines SET "${p.campo}" = $1 WHERE id = $2`,
    [formatear(nuevo, 4), linea.id],
  );

  const totales = await recalcularTotales(pricingId);

  return {
    ajusteId: Number(ins.rows[0].id),
    anterior: anterior == null ? null : formatear(anterior, 2),
    nuevo: formatear(nuevo, 2),
    totales,
  };
}

/**
 * La línea sobre la que se ajusta.
 *
 * Sin número de línea se entiende que se quiere ajustar el importe del
 * servicio, y eso se traduce a la línea del forfait: es la que representa el
 * precio del servicio. Ajustar "el total" sin decir sobre qué línea dejaría
 * unas líneas que no suman el total, y ese descuadre lo hereda la factura.
 */
async function lineaDestino(pricingId: number, lineNumber: number | null, campo: CampoAjustable) {
  const r = await db.query(
    `SELECT id, "lineNumber", "${campo}" AS "valorActual"
       FROM connect_assistance_price_lines
      WHERE "pricingId" = $1
        AND ($2::int IS NULL OR "lineNumber" = $2)
      ORDER BY CASE WHEN kind = 'FORFAIT' THEN 0 ELSE 1 END, "lineNumber"
      LIMIT 1`,
    [pricingId, lineNumber],
  );
  if (!r.rows[0]) {
    throw new ErrorAjuste("linea_no_encontrada",
      lineNumber == null ? "Esta tarifa no tiene líneas que ajustar" : `No existe la línea ${lineNumber}`, 404);
  }
  return r.rows[0] as { id: number; lineNumber: number; valorActual: string | null };
}

async function settingsDelCentro(controlCenterId: number): Promise<unknown> {
  const r = await db.query(`SELECT settings FROM connect_control_centers WHERE id = $1`, [controlCenterId]);
  return r.rows[0]?.settings ?? null;
}

/**
 * Vuelve a sumar los totales desde las líneas y deja constancia de que la
 * tarifa lleva mano humana: el aviso MANUAL_OVERRIDE y el estado a revisión,
 * para que nadie la dé por buena sin mirarla.
 */
async function recalcularTotales(pricingId: number) {
  const r = await db.query(
    `SELECT SUM("saleTotal") AS venta, SUM("purchaseTotal") AS compra,
            COUNT(*) FILTER (WHERE "saleTotal" IS NULL)::int AS "ventaSinPrecio",
            COUNT(*) FILTER (WHERE "purchaseTotal" IS NULL)::int AS "compraSinPrecio"
       FROM connect_assistance_price_lines WHERE "pricingId" = $1`,
    [pricingId],
  );
  const f = r.rows[0];
  const venta = f.ventaSinPrecio > 0 ? null : aDinero(f.venta);
  const compra = f.compraSinPrecio > 0 ? null : aDinero(f.compra);
  const margen = venta != null && compra != null ? restar(venta, compra) : null;
  const margenPct = margen != null && venta != null ? porcentajeDe(margen, venta) : null;

  const t = (d: Dinero | null) => (d == null ? null : formatear(d, 4));
  await db.query(
    `UPDATE connect_assistance_pricings
        SET "saleTotal" = $1, "purchaseTotal" = $2, "grossMargin" = $3, "grossMarginPct" = $4,
            status = 'manual_review',
            warnings = CASE
              WHEN warnings::text LIKE '%MANUAL_OVERRIDE%' THEN warnings
              ELSE warnings || '[{"codigo":"MANUAL_OVERRIDE"}]'::jsonb
            END
      WHERE id = $5`,
    [t(venta), t(compra), t(margen), t(margenPct), pricingId],
  );

  return {
    venta: venta == null ? null : formatear(venta, 2),
    compra: compra == null ? null : formatear(compra, 2),
    margen: margen == null ? null : formatear(margen, 2),
    margenPct: margenPct == null ? null : formatear(margenPct, 2),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Los ajustes de una asistencia, para la ficha. */
export async function ajustesDe(assistanceId: number): Promise<Record<string, unknown>[]> {
  const r = await db.query(
    `SELECT o.id, o.field, o."originalValue", o."newValue", o.reason,
            o."authorizedByName", o."authorizedAtMs", l."lineNumber", l.description
       FROM connect_pricing_overrides o
       LEFT JOIN connect_assistance_price_lines l ON l.id = o."priceLineId"
      WHERE o."assistanceId" = $1
      ORDER BY o."authorizedAtMs" DESC`,
    [assistanceId],
  );
  return r.rows.map(formatearFila);
}

/**
 * Auditoría económica del periodo: qué se movió a mano, quién y cuánto.
 *
 * El total no suma importes finales sino DIFERENCIAS: lo que interesa no es
 * cuánto se facturó, sino cuánto se apartó de lo que decía la tarifa. Un
 * ajuste de 331 a 330 mueve un euro, no trescientos treinta.
 */
export async function auditoriaEconomica(p: {
  controlCenterId: number | null;
  desdeMs: number;
  hastaMs: number;
}): Promise<{
  ajustes: Record<string, unknown>[];
  porUsuario: Record<string, unknown>[];
  totales: { ajustes: number; asistencias: number; desviacionVenta: string; desviacionCompra: string };
}> {
  const filtro = `o."authorizedAtMs" BETWEEN $1 AND $2 AND ($3::int IS NULL OR o."controlCenterId" = $3)`;
  const args = [p.desdeMs, p.hastaMs, p.controlCenterId];

  const [ajustes, porUsuario, totales] = await Promise.all([
    db.query(
      `SELECT o.id, o."assistanceId", ca."expedientNumber", o.field,
              o."originalValue", o."newValue", o.reason,
              o."authorizedByName", o."authorizedAtMs", l."lineNumber", l.description
         FROM connect_pricing_overrides o
         LEFT JOIN connect_assistances ca ON ca.id = o."assistanceId"
         LEFT JOIN connect_assistance_price_lines l ON l.id = o."priceLineId"
        WHERE ${filtro}
        ORDER BY o."authorizedAtMs" DESC LIMIT 500`, args),
    db.query(
      `SELECT COALESCE(o."authorizedByName", 'Sin identificar') AS usuario,
              COUNT(*)::int AS ajustes,
              COALESCE(SUM(ABS(o."newValue" - COALESCE(o."originalValue", 0))), 0) AS desviacion
         FROM connect_pricing_overrides o
        WHERE ${filtro}
        GROUP BY 1 ORDER BY desviacion DESC`, args),
    db.query(
      `SELECT COUNT(*)::int AS ajustes,
              COUNT(DISTINCT o."assistanceId")::int AS asistencias,
              COALESCE(SUM(o."newValue" - COALESCE(o."originalValue", 0))
                       FILTER (WHERE o.field LIKE 'sale%'), 0) AS "desviacionVenta",
              COALESCE(SUM(o."newValue" - COALESCE(o."originalValue", 0))
                       FILTER (WHERE o.field LIKE 'purchase%'), 0) AS "desviacionCompra"
         FROM connect_pricing_overrides o
        WHERE ${filtro}`, args),
  ]);

  const t = totales.rows[0];
  return {
    ajustes: ajustes.rows.map(formatearFila),
    porUsuario: porUsuario.rows.map((x: any) => ({
      usuario: x.usuario, ajustes: x.ajustes, desviacion: Number(x.desviacion).toFixed(2),
    })),
    totales: {
      ajustes: t.ajustes, asistencias: t.asistencias,
      desviacionVenta: Number(t.desviacionVenta).toFixed(2),
      desviacionCompra: Number(t.desviacionCompra).toFixed(2),
    },
  };
}

/** Los NUMERIC llegan como texto; se sirven con dos decimales y su diferencia. */
function formatearFila(x: any): Record<string, unknown> {
  const anterior = x.originalValue == null ? null : Number(x.originalValue);
  const nuevo = Number(x.newValue);
  return {
    ...x,
    originalValue: anterior == null ? null : anterior.toFixed(2),
    newValue: nuevo.toFixed(2),
    diferencia: (nuevo - (anterior ?? 0)).toFixed(2),
    authorizedAtMs: Number(x.authorizedAtMs),
  };
}
