/**
 * MappingService — traduce identificadores de Mobilink a códigos del sistema externo (§4.3).
 *
 * El Mapping Engine del Hub (§2.5): un cliente de Mobilink no tiene por qué llamarse igual
 * que en Business Central, y un artículo tampoco. Aquí se resuelve esa correspondencia
 * antes de crear ningún documento.
 *
 * COMPORTAMIENTO ANTE UN ID SIN MAPEAR — dos modos, según `strictMappings` en la config
 * del conector:
 *
 *  - Permisivo (por defecto): se usa el identificador tal cual. Es lo que permite seguir
 *    llamando a la API con códigos de BC directamente ("10000", "1896-S"), como hasta ahora.
 *  - Estricto (`"strictMappings": true`): un id sin mapear lanza un error de tipo MAPPING,
 *    de modo que la operación va a MANUAL_REVIEW en vez de inventarse un código que quizá
 *    exista en BC y sea otra cosa. Es lo recomendado en producción con datos reales.
 *
 * El modo permisivo NO es un descuido: obligar a mapear desde el primer día bloquearía
 * integraciones que hoy funcionan. El estricto se activa cuando los mapeos ya están cargados.
 */

import { IntegrationError } from "../../domain/errors.ts";
import { findExternalCode, type MappingEntityType } from "../../infrastructure/repositories.ts";

export interface ResolveOptions {
  tenantId: string;
  /** Sistema destino, p. ej. 'business-central'. */
  system: string;
  /** Si true, un id sin mapear es un error en vez de usarse tal cual. */
  strict?: boolean;
}

export interface ResolvedId {
  /** Código a enviar al sistema externo. */
  externalCode: string;
  /** true si vino de la tabla de mapeos; false si se usó el id tal cual. */
  mapped: boolean;
}

/** Resuelve un único identificador (cliente, artículo, almacén…). */
export async function resolveExternalId(
  entityType: MappingEntityType,
  mobilinkId: string,
  opts: ResolveOptions
): Promise<ResolvedId> {
  const externalCode = await findExternalCode({
    tenantId: opts.tenantId,
    entityType,
    system: opts.system,
    mobilinkId,
  });

  if (externalCode) return { externalCode, mapped: true };

  if (opts.strict) {
    throw IntegrationError.mapping(
      "MAPPING_NOT_FOUND",
      `No hay mapeo de ${entityType} '${mobilinkId}' para ${opts.system}. ` +
        `Añádelo en el panel de integraciones antes de reprocesar la operación.`,
      { entityType, mobilinkId, system: opts.system }
    );
  }

  return { externalCode: mobilinkId, mapped: false };
}

export interface ResolvedQuoteIds {
  customer: ResolvedId;
  /** Un ResolvedId por línea, en el mismo orden que las líneas de entrada. */
  products: ResolvedId[];
  /** Resumen para el audit log: qué se ha traducido y qué ha pasado tal cual. */
  resumen: string;
}

/**
 * Resuelve de una vez el cliente y todos los artículos de un presupuesto.
 *
 * Se resuelve todo junto, antes de tocar el ERP, para que un mapeo que falta se
 * detecte ANTES de haber creado media cabecera de documento en Business Central.
 */
export async function resolveQuoteIds(params: {
  tenantId: string;
  system: string;
  strict?: boolean;
  customerId: string;
  productIds: string[];
}): Promise<ResolvedQuoteIds> {
  const opts: ResolveOptions = {
    tenantId: params.tenantId,
    system: params.system,
    strict: params.strict,
  };

  const customer = await resolveExternalId("customer", params.customerId, opts);
  const products: ResolvedId[] = [];
  for (const productId of params.productIds) {
    products.push(await resolveExternalId("product", productId, opts));
  }

  const mapeados = [customer, ...products].filter((r) => r.mapped).length;
  const total = products.length + 1;
  const resumen =
    mapeados === 0
      ? "Sin mapeos: se usan los identificadores tal cual"
      : `${mapeados}/${total} identificadores traducidos desde la tabla de mapeos`;

  return { customer, products, resumen };
}
