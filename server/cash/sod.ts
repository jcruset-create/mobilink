/**
 * Separación de funciones (SoD) en Mobilink Cash.
 *
 * La idea, en una frase: **quien hizo algo no puede ser quien lo deshace**.
 *
 * Es la salvaguarda clásica contra el fraude de caja, y el motivo es que las
 * dos acciones que borran el rastro de un descuadre —anular una operación y
 * reabrir una jornada ya cerrada— son exactamente las que necesita alguien que
 * quiera cuadrar una caja de la que ha salido dinero. Por separado cada una es
 * legítima y hace falta; encadenadas por la misma persona y sin testigo, no.
 *
 * Lo que NO se ha hecho, y conviene decirlo: no hay un flujo de solicitud y
 * aprobación con su bandeja. Se valoró y se descartó para esta fase: un
 * mostrador con dos personas no puede quedarse esperando a que alguien apruebe
 * una anulación mientras el cliente está delante. La comprobación es inmediata
 * —la hace otra persona con permiso, en el momento— y eso cubre el riesgo sin
 * parar la caja. El flujo con bandeja tiene sentido el día que haya acciones
 * que puedan esperar de verdad.
 *
 * **Viene apagado.** Un taller de dos personas donde el mismo responsable abre
 * y cierra se quedaría sin poder anular nada, y acabaría compartiendo usuario
 * —que es peor que no tener SoD—. Se enciende cuando hay gente suficiente.
 */

import type { PoolClient } from "pg";
import pool from "../db.ts";
import { ErrorCaja } from "./errors.ts";

/** Clave en `cash_settings`. */
export const AJUSTE_SOD = "sod_activo";

export async function sodActivo(empresaId: string): Promise<boolean> {
  const { rows } = await pool.query<{ valor: string | null }>(
    `SELECT valor FROM cash_settings WHERE empresa_id = $1 AND clave = $2`,
    [empresaId, AJUSTE_SOD]
  );
  return rows[0]?.valor === "1";
}

/**
 * Exige que quien deshace no sea quien hizo.
 *
 * `autorId` es quien registró la operación o cerró la jornada; `ctx.userId`,
 * quien quiere deshacerla. Si son el mismo y SoD está encendido, se niega.
 *
 * Dos detalles que importan:
 *
 * · **Un usuario sin identificar no pasa.** Con `userId` a null no se puede
 *   afirmar que sean personas distintas, y ante la duda la respuesta correcta
 *   es que no. Es lo contrario del criterio del ámbito de taller —donde vacío
 *   significa «toda la empresa»— porque aquí el vacío no es un permiso amplio:
 *   es desconocimiento.
 *
 * · **El superadministrador tampoco.** Salta las licencias y es admin de caja
 *   sin fila, pero eso es alcance, no impunidad: si él registró el cobro,
 *   tampoco puede ser él quien lo anule sin testigo. Era el riesgo R11.
 */
export async function exigirOtraPersona(
  empresaId: string,
  ctx: { userId: string | null },
  autorId: string | null,
  que: "anular esta operación" | "reabrir esta jornada"
): Promise<void> {
  if (!(await sodActivo(empresaId))) return;

  if (!ctx.userId || !autorId) {
    throw new ErrorCaja(
      "SOD_REQUIERE_OTRA_PERSONA",
      `Con la separación de funciones activada hace falta saber quién ${que === "anular esta operación" ? "registró la operación" : "cerró la jornada"}, y aquí no consta.`,
      403
    );
  }

  if (ctx.userId === autorId) {
    throw new ErrorCaja(
      "SOD_REQUIERE_OTRA_PERSONA",
      `No puedes ${que}: la registraste tú. Con la separación de funciones activada tiene que hacerlo otra persona con permiso.`,
      403
    );
  }
}

/** Quién registró una operación. */
export async function autorDeOperacion(
  client: PoolClient,
  operationId: number
): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT created_by FROM cash_operations WHERE id = $1`,
    [operationId]
  );
  return rows[0]?.created_by ?? null;
}
