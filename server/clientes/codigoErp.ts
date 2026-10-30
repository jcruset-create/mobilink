/**
 * El número que tiene un cliente en el ERP.
 *
 * ── Para qué sirve ──────────────────────────────────────────────────────────
 *
 * Es el dato que ata la ficha de Mobilink con la del ERP. Sin él, quien
 * factura tiene que buscar el cliente a mano por el nombre —y el nombre está
 * escrito de cinco maneras—, y la sincronización no sabe a qué ficha del ERP
 * corresponde cada servicio.
 *
 * ── Dónde vive, y por qué no es una columna de `connect_clients` ────────────
 *
 * En `integration_mappings`, que es la tabla que ya enlaza entidades de
 * Mobilink con las de otros sistemas. El mismo cliente puede tener a la vez
 * número de ERP y correspondencia con TyreControl, y mañana con otro sistema
 * más; una columna por sistema en la ficha del cliente sería ir añadiendo
 * columnas cada vez.
 *
 * ── El sistema se nombra, y eso NO es un detalle ────────────────────────────
 *
 * En esa tabla conviven los enlaces de TODOS los sistemas, y el de TyreControl
 * es también de tipo «customer». Antes se leía «el mapeo más reciente de este
 * cliente, sea de donde sea»: un cliente con correspondencia de TyreControl
 * enseñaba el identificador de TC como si fuera su número de ERP. Aquí se
 * nombra el sistema en todas las consultas, de ida y de vuelta.
 */

import db from "../db.ts";

/** El tipo de entidad en `integration_mappings`. */
export const ENTIDAD = "customer";

/**
 * El sistema que es «el ERP».
 *
 * Es el único conector de ERP que hay montado (`ConnectorRegistry`), así que
 * el número que se teclea aquí es el suyo. Si algún día hay dos, esto pasa a
 * ser una elección del usuario y no una constante.
 */
export const SISTEMA_ERP = "business-central";

/** Sistemas que NO son el ERP y que no deben confundirse con él al leer. */
export const SISTEMAS_NO_ERP = ["tyrecontrol"];

/**
 * El tenant de Assist es el taller. Sin él se usa una clave fija: hoy hay un
 * solo taller y no tener tenant no puede impedir configurar el enlace. Mismo
 * criterio que `server/tyrecontrol/empresas.ts`.
 */
export function tenantDeAssist(tenantId?: string | null): string {
  return tenantId == null || tenantId === "" ? "assist" : String(tenantId);
}

/** Lo que se escribe no es lo que se teclea: sin espacios de sobra. */
export function normalizarCodigoErp(valor: unknown): string {
  return String(valor ?? "").trim();
}

export type ResultadoEnlace =
  | { ok: true; codigo: string | null }
  | { ok: false; error: string };

/**
 * Guarda —o quita— el número de ERP de un cliente.
 *
 * Vacío significa «quítalo», y es deliberado: es la única forma de deshacer un
 * número puesto por error desde la misma casilla donde se puso.
 *
 * Dos clientes no pueden compartir número: en el ERP es la clave de la ficha, y
 * dos fichas de Mobilink apuntando a la misma del ERP haría que las facturas de
 * una salieran a nombre de la otra. Se devuelve a quién lo tiene, que es lo que
 * hace falta para resolverlo.
 */
export async function guardarCodigoErp(
  clienteId: number,
  codigoBruto: unknown,
  tenantId?: string | null
): Promise<ResultadoEnlace> {
  const codigo = normalizarCodigoErp(codigoBruto);
  const tenant = tenantDeAssist(tenantId);
  const ahora = Date.now();

  if (!codigo) {
    await db.query(
      `DELETE FROM integration_mappings
        WHERE tenant_id = $1 AND entity_type = $2 AND system = $3 AND mobilink_id = $4`,
      [tenant, ENTIDAD, SISTEMA_ERP, String(clienteId)]
    );
    return { ok: true, codigo: null };
  }

  const ocupado = await db.query(
    `SELECT mobilink_id FROM integration_mappings
      WHERE tenant_id = $1 AND entity_type = $2 AND system = $3 AND external_code = $4
      LIMIT 1`,
    [tenant, ENTIDAD, SISTEMA_ERP, codigo]
  );
  const dueno = ocupado.rows[0]?.mobilink_id;
  if (dueno != null && String(dueno) !== String(clienteId)) {
    const otro = await db.query(`SELECT name FROM connect_clients WHERE id = $1`, [Number(dueno)]);
    const nombre = otro.rows[0]?.name ?? `cliente #${dueno}`;
    return { ok: false, error: `El número de cliente ERP ${codigo} ya es de ${nombre}.` };
  }

  /*
   * Se borra el anterior y se escribe el nuevo, en vez de un UPDATE: la clave
   * única de la tabla va por «external_code», no por cliente, así que cambiar
   * el número es borrar una fila y poner otra. Van en una transacción porque
   * entre las dos el cliente se queda sin número, y un fallo ahí lo dejaría
   * desenlazado sin que nadie lo pidiera.
   */
  const cliente = await db.query(`SELECT 1 FROM connect_clients WHERE id = $1`, [clienteId]);
  if (!cliente.rows[0]) return { ok: false, error: "Cliente no encontrado" };

  try {
    await db.query("BEGIN");
    await db.query(
      `DELETE FROM integration_mappings
        WHERE tenant_id = $1 AND entity_type = $2 AND system = $3 AND mobilink_id = $4`,
      [tenant, ENTIDAD, SISTEMA_ERP, String(clienteId)]
    );
    await db.query(
      `INSERT INTO integration_mappings
         (tenant_id, entity_type, system, external_code, mobilink_id, created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [tenant, ENTIDAD, SISTEMA_ERP, codigo, String(clienteId), ahora]
    );
    await db.query("COMMIT");
  } catch (e: any) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  }

  return { ok: true, codigo };
}
