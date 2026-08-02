/**
 * WorkOrderQuoteService — presupuesto de Business Central a partir de una OT real.
 *
 * Hasta ahora el presupuesto se pedía con los códigos del ERP escritos a mano. Aquí se
 * parte de una orden de trabajo de Mobilink (tabla `otf` y sus líneas `otf_trabajos`) y
 * el Hub se encarga de traducir cliente y trabajos a códigos del ERP.
 *
 * Dos operaciones:
 *  - `previewQuoteFromWorkOrder`: qué se enviaría y qué falta por mapear. NO toca el ERP.
 *  - `createQuoteFromWorkOrderId`: crea el presupuesto de verdad.
 *
 * El preview existe porque un trabajo sin mapear enviado tal cual a Business Central
 * produce un error críptico del ERP; es mejor enseñar antes qué falta.
 */

import pool from "../../../db.ts";
import { IntegrationError } from "../../domain/errors.ts";
import type { QuoteLineInput } from "../../domain/models.ts";
import { resolveErpConnector } from "../../connectors/ConnectorRegistry.ts";
import { resolveExternalId } from "./MappingService.ts";
import { createQuoteFromWorkOrder, type CreateQuoteFromWorkOrderResult } from "./SalesQuoteService.ts";

export interface WorkOrderLinePreview {
  /** Id de la línea en otf_trabajos. */
  trabajoId: number;
  /** Identificador de Mobilink que se intenta mapear (la plantilla de trabajo). */
  mobilinkId: string;
  /** Código que recibiría el ERP. */
  externalCode: string;
  /** true si salió de la tabla de mapeos; false si se enviaría tal cual. */
  mapped: boolean;
  description: string;
  quantity: number;
  plate: string | null;
}

export interface WorkOrderQuotePreview {
  workOrderId: string;
  otfId: number;
  clientName: string;
  customer: { mobilinkId: string; externalCode: string; mapped: boolean };
  lines: WorkOrderLinePreview[];
  /** Identificadores sin mapear: lo que hay que resolver antes de enviar a BC. */
  sinMapear: string[];
  /** true si se puede enviar con garantías (todo mapeado). */
  listo: boolean;
}

interface OtfRow {
  id: number;
  clientName: string;
  clientId: number | null;
  status: string;
  notas: string | null;
}

interface TrabajoRow {
  id: number;
  plate: string | null;
  trabajoPlantilla: string | null;
  detalleManual: string | null;
  trabajo: string | null;
  observaciones: string | null;
  status: string;
}

/** Estados de línea que no se facturan: no tiene sentido presupuestarlos. */
const ESTADOS_EXCLUIDOS = new Set(["cancelado", "cancelada", "anulado", "anulada"]);

async function cargarOtf(otfId: number): Promise<{ otf: OtfRow; trabajos: TrabajoRow[] }> {
  const { rows } = await pool.query(`SELECT * FROM otf WHERE id = $1`, [otfId]);
  const otf = rows[0];
  if (!otf) {
    throw IntegrationError.notFound("OTF_NOT_FOUND", `La orden de trabajo ${otfId} no existe`);
  }
  const { rows: trabajos } = await pool.query(
    `SELECT * FROM otf_trabajos WHERE "otfId" = $1 ORDER BY id ASC`,
    [otfId]
  );
  return { otf, trabajos };
}

/**
 * Identificador de Mobilink de una línea.
 *
 * Se prefiere la plantilla de trabajo porque es un valor de catálogo, estable y mapeable;
 * el texto libre sólo sirve como último recurso y casi nunca tendrá mapeo.
 */
function mobilinkIdDeTrabajo(t: TrabajoRow): string {
  return (t.trabajoPlantilla || t.trabajo || t.detalleManual || `TRABAJO-${t.id}`).trim();
}

function descripcionDeTrabajo(t: TrabajoRow): string {
  const partes = [t.trabajo || t.trabajoPlantilla, t.detalleManual, t.observaciones].filter(Boolean);
  const texto = partes.join(" · ");
  // BC corta las descripciones de línea; recortamos aquí para que no sorprenda.
  return texto.length > 100 ? `${texto.slice(0, 97)}…` : texto;
}

export async function previewQuoteFromWorkOrder(params: {
  tenantId: string;
  otfId: number;
}): Promise<WorkOrderQuotePreview> {
  const { otf, trabajos } = await cargarOtf(params.otfId);
  const resolved = await resolveErpConnector(params.tenantId);
  const opts = { tenantId: params.tenantId, system: resolved.key };

  const facturables = trabajos.filter((t) => !ESTADOS_EXCLUIDOS.has((t.status || "").toLowerCase()));

  const customerMobilinkId = String(otf.clientId ?? otf.clientName ?? "").trim();
  if (!customerMobilinkId) {
    throw IntegrationError.validation(
      "OTF_SIN_CLIENTE",
      `La orden de trabajo ${params.otfId} no tiene cliente: no se puede presupuestar`
    );
  }
  const customer = await resolveExternalId("customer", customerMobilinkId, opts);

  const lines: WorkOrderLinePreview[] = [];
  for (const t of facturables) {
    const mobilinkId = mobilinkIdDeTrabajo(t);
    const resuelto = await resolveExternalId("product", mobilinkId, opts);
    lines.push({
      trabajoId: t.id,
      mobilinkId,
      externalCode: resuelto.externalCode,
      mapped: resuelto.mapped,
      description: descripcionDeTrabajo(t),
      quantity: 1,
      plate: t.plate,
    });
  }

  const sinMapear = [
    ...(customer.mapped ? [] : [`cliente '${customerMobilinkId}'`]),
    ...lines.filter((l) => !l.mapped).map((l) => `trabajo '${l.mobilinkId}'`),
  ];

  return {
    workOrderId: `OTF-${otf.id}`,
    otfId: otf.id,
    clientName: otf.clientName,
    customer: { mobilinkId: customerMobilinkId, externalCode: customer.externalCode, mapped: customer.mapped },
    lines,
    sinMapear,
    listo: sinMapear.length === 0 && lines.length > 0,
  };
}

/**
 * Crea el presupuesto en el ERP a partir de la OT.
 *
 * Por defecto exige que todo esté mapeado: en el flujo real del taller es preferible
 * parar y avisar de qué falta antes que mandar a Business Central un código inventado.
 * Con `permitirSinMapear` se puede forzar el envío tal cual (útil cuando los códigos de
 * Mobilink ya coinciden con los del ERP).
 */
export async function createQuoteFromWorkOrderId(params: {
  tenantId: string;
  otfId: number;
  permitirSinMapear?: boolean;
  currency?: string;
}): Promise<CreateQuoteFromWorkOrderResult & { preview: WorkOrderQuotePreview }> {
  const preview = await previewQuoteFromWorkOrder({ tenantId: params.tenantId, otfId: params.otfId });

  if (preview.lines.length === 0) {
    throw IntegrationError.validation(
      "OTF_SIN_TRABAJOS",
      `La orden de trabajo ${params.otfId} no tiene trabajos facturables`
    );
  }

  if (preview.sinMapear.length > 0 && !params.permitirSinMapear) {
    throw IntegrationError.mapping(
      "OTF_SIN_MAPEAR",
      `Faltan mapeos para: ${preview.sinMapear.join(", ")}. ` +
        `Añádelos en el panel de integraciones (pestaña Mapeos) o repite con permitirSinMapear.`,
      { sinMapear: preview.sinMapear }
    );
  }

  // Se pasan los identificadores DE MOBILINK, no los códigos ya resueltos: la traducción
  // ocurre en un único sitio (el Mapping Engine dentro de SalesQuoteService). Reenviar aquí
  // el código externo rompería el modo estricto, porque ese código no existe como
  // mobilink_id y la segunda resolución fallaría.
  const lines: QuoteLineInput[] = preview.lines.map((l) => ({
    externalProductId: l.mobilinkId,
    quantity: l.quantity,
    description: l.description,
  }));

  const result = await createQuoteFromWorkOrder({
    tenantId: params.tenantId,
    workOrderId: preview.workOrderId,
    customerId: preview.customer.mobilinkId,
    reference: preview.workOrderId,
    currency: params.currency,
    lines,
  });

  return { ...result, preview };
}
