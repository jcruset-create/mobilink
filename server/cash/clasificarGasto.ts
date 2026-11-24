/**
 * Clasificar un gasto después de registrarlo.
 *
 * Al pagar, el concepto no es obligatorio —fue la decisión, para no parar el
 * mostrador—, así que quedan pagos «sin clasificar». Aquí se les pone (o se
 * les cambia) el concepto desde la pantalla de gasto. No se mueve un céntimo:
 * cambia la categoría, así que vale también en jornadas cerradas.
 *
 * ## Qué se toca
 *
 * - Un pago normal lleva el concepto en la OPERACIÓN.
 * - El pago de una liquidación de gastos no tiene concepto propio: son sus
 *   TICKETS los que lo llevan (una dieta y un peaje en el mismo pago). Se
 *   clasifica ticket a ticket, nunca la operación entera.
 *
 * ## Las mismas reglas que al pagar
 *
 * El concepto tiene que existir y estar activo (`validarClasificacionGasto`).
 * El destino que ya tuviera se conserva solo si el concepto nuevo lo admite:
 * pasar de «Dietas» (persona) a «Ferretería» (centro de coste) con Juan
 * colgando dejaría el desglose mezclando personas y centros. Se quita y se
 * dice.
 *
 * Una operación anulada, o la inversa de una anulación, no se reclasifica: el
 * histórico queda como pasó, igual que con la sección.
 */

import type { PoolClient } from "pg";
import { ErrorCaja, enTransaccion } from "./repository.ts";
import { validarClasificacionGasto, guardarReglaGasto } from "./config.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { nombreDeProveedorNormalizado } from "./domain/proveedores.ts";
import type { pendientesDeProveedor } from "./expensestats.ts";

type Contexto = { empresaId: string; userId: string | null; ip?: string };

export type ResultadoClasificacion = {
  operacionId: number;
  lineaId: number | null;
  conceptoAntes: number | null;
  conceptoId: number;
  /** El destino que tenía y no vale para el concepto nuevo. */
  destinoQuitado: boolean;
};

/** Qué tipo de destino pide el concepto: `PERSONA`, `CENTRO_COSTE` o `NINGUNO`. */
async function tipoDestinoDe(client: PoolClient, empresaId: string, conceptoId: number): Promise<string> {
  await validarClasificacionGasto(empresaId, conceptoId, null);
  const { rows } = await client.query(
    `SELECT tipo_destino FROM cash_expense_concepts WHERE id = $1 AND empresa_id = $2`,
    [conceptoId, empresaId]
  );
  return String(rows[0].tipo_destino);
}

/** El destino actual, si el concepto nuevo lo admite; si no, `null`. */
async function destinoQueSeQueda(
  client: PoolClient,
  destinoId: number | null,
  tipoDestino: string
): Promise<number | null> {
  if (destinoId == null || tipoDestino === "NINGUNO") return null;
  const { rows } = await client.query(`SELECT tipo FROM cash_expense_targets WHERE id = $1`, [destinoId]);
  return rows[0]?.tipo === tipoDestino ? destinoId : null;
}

/**
 * Clasifica un gasto dentro de una transacción ya abierta. `lineaId` = el
 * ticket de una liquidación; sin él, la operación.
 *
 * `soloSiSinClasificar`: para el «Clasificar como…» del proveedor, que nunca
 * pisa lo que alguien ya clasificó. Si entre que se consultó y se pulsó otro
 * lo ha clasificado, se salta en silencio (devuelve `null`).
 */
async function clasificarEn(
  client: PoolClient,
  ctx: Contexto,
  g: { operacionId: number; lineaId: number | null; conceptoId: number; soloSiSinClasificar?: boolean }
): Promise<ResultadoClasificacion | null> {
  const { rows: ops } = await client.query(
    `SELECT o.tipo, o.estado, o.reversa_de_id, o.expense_concept_id, o.expense_target_id,
            EXISTS (SELECT 1 FROM cash_expense_claims cl WHERE cl.operation_pago_id = o.id) AS de_liquidacion
       FROM cash_operations o
      WHERE o.id = $1 AND o.empresa_id = $2
      FOR UPDATE OF o`,
    [g.operacionId, ctx.empresaId]
  );
  const op = ops[0];
  if (!op) throw new ErrorCaja("OPERACION_NO_ENCONTRADA", "La operación no existe.", 404);
  if (op.tipo !== "PAYMENT" && op.tipo !== "MANUAL_OUT") {
    throw new ErrorCaja("NO_ES_GASTO", "Solo se clasifican pagos y salidas de caja.", 409);
  }
  if (op.estado !== "CONFIRMED" || op.reversa_de_id != null) {
    throw new ErrorCaja(
      "OPERACION_ANULADA",
      "Una operación anulada no se reclasifica: el histórico tiene que quedar como pasó.",
      409
    );
  }

  const tipoDestino = await tipoDestinoDe(client, ctx.empresaId, g.conceptoId);

  if (g.lineaId == null) {
    if (op.de_liquidacion) {
      throw new ErrorCaja(
        "CLASIFICAR_POR_TICKET",
        "Este pago es de una liquidación de gastos: se clasifica ticket a ticket.",
        409
      );
    }
    const antes: number | null = op.expense_concept_id ?? null;
    if (g.soloSiSinClasificar && antes != null) return null;
    const destino = await destinoQueSeQueda(client, op.expense_target_id ?? null, tipoDestino);
    await client.query(
      `UPDATE cash_operations SET expense_concept_id = $3, expense_target_id = $4, updated_at_ms = $5
        WHERE id = $1 AND empresa_id = $2`,
      [g.operacionId, ctx.empresaId, g.conceptoId, destino, Date.now()]
    );
    return {
      operacionId: g.operacionId,
      lineaId: null,
      conceptoAntes: antes,
      conceptoId: g.conceptoId,
      destinoQuitado: op.expense_target_id != null && destino == null,
    };
  }

  // El ticket tiene que ser de una liquidación que ESTE pago pagó: el ámbito
  // se comprueba por la operación, y sin esto un ticket ajeno pasaría por ella.
  const { rows: lineas } = await client.query(
    `SELECT l.expense_concept_id, l.expense_target_id, l.situacion
       FROM cash_expense_claim_lines l
       JOIN cash_expense_claims cl ON cl.id = l.claim_id
      WHERE l.id = $1 AND cl.operation_pago_id = $2 AND cl.empresa_id = $3
      FOR UPDATE OF l`,
    [g.lineaId, g.operacionId, ctx.empresaId]
  );
  const linea = lineas[0];
  if (!linea) throw new ErrorCaja("LINEA_NO_ENCONTRADA", "Ese ticket no es de este pago.", 404);
  if (linea.situacion !== "INCLUIDA") {
    throw new ErrorCaja("LINEA_EXCLUIDA", "Un ticket excluido no se pagó: no es gasto que clasificar.", 409);
  }
  const antes: number | null = linea.expense_concept_id ?? null;
  if (g.soloSiSinClasificar && antes != null) return null;
  /*
   * En una liquidación, el destino de «persona» es el trabajador de la
   * cabecera, no del ticket: el ticket solo guarda el suyo para un centro de
   * coste.
   */
  const destino =
    tipoDestino === "CENTRO_COSTE"
      ? await destinoQueSeQueda(client, linea.expense_target_id ?? null, tipoDestino)
      : null;
  await client.query(
    `UPDATE cash_expense_claim_lines SET expense_concept_id = $3, expense_target_id = $4, updated_at_ms = $5
      WHERE id = $1 AND empresa_id = $2`,
    [g.lineaId, ctx.empresaId, g.conceptoId, destino, Date.now()]
  );
  return {
    operacionId: g.operacionId,
    lineaId: g.lineaId,
    conceptoAntes: antes,
    conceptoId: g.conceptoId,
    destinoQuitado: linea.expense_target_id != null && destino == null,
  };
}

async function auditar(ctx: Contexto, r: ResultadoClasificacion, origen: string): Promise<void> {
  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.expense.classify",
    entidad: r.lineaId == null ? "cash_operations" : "cash_expense_claim_lines",
    entidadId: String(r.lineaId ?? r.operacionId),
    detalle: {
      origen,
      operacionId: r.operacionId,
      antes: { conceptoId: r.conceptoAntes },
      despues: { conceptoId: r.conceptoId },
      destinoQuitado: r.destinoQuitado,
    },
    ip: ctx.ip,
  });
}

/** Un gasto, desde el detalle del proveedor. Pisa lo que hubiera: es una corrección a mano. */
export async function clasificarGasto(
  ctx: Contexto,
  g: { operacionId: number; lineaId: number | null; conceptoId: number }
): Promise<ResultadoClasificacion> {
  const r = await enTransaccion((client) => clasificarEn(client, ctx, g));
  await auditar(ctx, r!, "detalle");
  return r!;
}

/** Lo más corto que se acepta como regla por nombre: «bar» casaría con medio país. */
const NOMBRE_MINIMO = 4;

/**
 * «Clasificar como…» de un proveedor: todos sus gastos SIN clasificar del
 * periodo, en una transacción. Con `recordar`, además una regla de concepto
 * para que los próximos tickets de ese establecimiento lo propongan.
 *
 * La regla es la de los tickets de gastos de trabajadores (Configuración ›
 * reglas de concepto): por NIF si se ha reconocido por NIF, por nombre si por
 * nombre. Un proveedor de la ERP no tiene regla: sus pagos no pasan por ahí.
 *
 * `pendientes` lo calcula quien llama con `pendientesDeProveedor`, y es la
 * MISMA lista sobre la que ha comprobado el ámbito de cada operación: así no
 * se clasifica nada que no se haya mirado.
 */
export async function clasificarProveedor(
  ctx: Contexto,
  pendientes: Awaited<ReturnType<typeof pendientesDeProveedor>>,
  conceptoId: number,
  recordar: boolean
): Promise<{
  clasificados: number;
  destinosQuitados: number;
  regla: { campo: string; patron: string } | null;
  reglaOmitida: string | null;
}> {
  const { proveedor, gastos } = pendientes;

  const hechos = await enTransaccion(async (client) => {
    const out: ResultadoClasificacion[] = [];
    for (const g of gastos) {
      const r = await clasificarEn(client, ctx, { ...g, conceptoId, soloSiSinClasificar: true });
      if (r) out.push(r);
    }
    return out;
  });
  for (const r of hechos) await auditar(ctx, r, "proveedor");

  let regla: { campo: string; patron: string } | null = null;
  let reglaOmitida: string | null = null;
  if (recordar && proveedor) {
    if (proveedor.via === "NIF" && proveedor.identificador) {
      regla = { campo: "NIF_EMISOR", patron: proveedor.identificador };
    } else if (proveedor.via === "NOMBRE") {
      /*
       * La regla por nombre casa por trozos («aumar» casa con «AUTOPISTAS
       * AUMAR, S.A.»), así que se guarda el nombre limpio, sin la forma
       * jurídica: con «AREAS, SAU» tal cual no casaría con «Areas SAU».
       */
      const patron = nombreDeProveedorNormalizado(proveedor.nombre);
      if (patron.length >= NOMBRE_MINIMO) regla = { campo: "NOMBRE_EMISOR", patron };
      else reglaOmitida = "El nombre es demasiado corto para reconocerlo sin equivocarse.";
    } else {
      reglaOmitida = "Los pagos de la ERP no usan reglas: el proveedor ya viene identificado.";
    }
    if (regla) {
      await guardarReglaGasto(ctx, { campo: regla.campo, patron: regla.patron, conceptoId });
    }
  }

  return {
    clasificados: hechos.length,
    destinosQuitados: hechos.filter((r) => r.destinoQuitado).length,
    regla,
    reglaOmitida,
  };
}
