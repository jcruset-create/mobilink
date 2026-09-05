/**
 * De la bandeja de AutoScan al justificante de un cobro.
 *
 * Es el momento en que un documento deja de ser «una factura que llegó» y pasa
 * a ser «el justificante de este cobro». Antes de eso no era de nadie; después
 * cuelga de una operación y de una jornada, como cualquier otro.
 *
 * ## Un documento físico, un blob
 *
 * El fichero **no se copia**. La fila de `cash_operation_documents` apunta a la
 * MISMA ruta del bucket que la de la bandeja. Duplicarlo daría dos originales
 * de la misma factura con dos ciclos de vida, que es justo lo que el módulo
 * evita desde el principio.
 *
 * Consecuencia que hay que tener presente: **el objeto del bucket ya no es de
 * una sola fila**. Por eso en esta fase no se borra nada del almacenamiento —
 * ni al descartar ni al usar. Una política de retención futura tendrá que
 * mirar las referencias antes de borrar, y ese día conviene que exista este
 * comentario.
 *
 * ## Consistencia
 *
 * Las dos escrituras —crear el justificante y marcar la bandeja— van en la
 * MISMA transacción, así que no puede quedar un documento marcado como usado
 * sin justificante, ni al revés. El fichero ya estaba subido desde que llegó,
 * así que aquí no se toca el almacenamiento y no hay nada que coordinar entre
 * PostgreSQL y Supabase.
 *
 * El cobro se registra ANTES y aparte, igual que en la subida manual: si esto
 * fallara, el dinero ya está contado y solo queda volver a adjuntar.
 */

import pool from "../../db.ts";
import { ErrorCaja } from "../errors.ts";
import { enTransaccion } from "../repository.ts";
import { registrarAuditoriaEnTransaccion } from "../../core/auditoria.ts";
import type { Contexto } from "../service.ts";

export type Promocion = {
  documentoId: number;
  inboxId: number;
  operationId: number;
};

/**
 * Cuelga un documento de la bandeja de una operación ya registrada.
 *
 * Falla —sin dejar rastro— si el documento no es de esta empresa, si no está
 * `LISTO`, o si ya se usó. Lo último se comprueba **aquí y no solo en la
 * pantalla**: que el botón esté escondido no impide que alguien llame a la API.
 */
export async function promover(
  ctx: Contexto,
  e: { inboxId: number; operationId: number }
): Promise<Promocion> {
  return enTransaccion(async (client) => {
    /*
     * La fila se bloquea antes de mirarla. Dos peticiones a la vez para el
     * mismo documento se ponen en fila, y la segunda ve que ya está USADO.
     */
    const { rows: docs } = await client.query(
      `SELECT * FROM cash_autoscan_inbox
        WHERE id = $1 AND empresa_id = $2
        FOR UPDATE`,
      [e.inboxId, ctx.empresaId]
    );
    const doc = docs[0];
    if (!doc) {
      throw new ErrorCaja("DOCUMENTO_NO_ENCONTRADO", "Ese documento de AutoScan no existe.", 404);
    }
    if (doc.estado === "USADO") {
      throw new ErrorCaja(
        "DOCUMENTO_YA_USADO",
        `Ese documento ya se usó en otro cobro. Un documento de AutoScan solo justifica un cobro.`,
        409
      );
    }
    if (doc.estado !== "LISTO") {
      throw new ErrorCaja(
        "DOCUMENTO_NO_UTILIZABLE",
        `Ese documento está en estado ${doc.estado} y todavía no se puede usar en un cobro.`,
        409
      );
    }

    const { rows: ops } = await client.query(
      `SELECT id, session_id FROM cash_operations WHERE id = $1 AND empresa_id = $2`,
      [e.operationId, ctx.empresaId]
    );
    if (ops.length === 0) {
      throw new ErrorCaja("OPERACION_NO_ENCONTRADA", "La operación no existe.", 404);
    }

    const ahora = Date.now();

    /*
     * La MISMA ruta. Nada de subir otra copia: es el mismo papel.
     */
    const { rows: creado } = await client.query(
      `INSERT INTO cash_operation_documents
         (empresa_id, operation_id, session_id, nombre, mime, tamano_bytes, ruta,
          sha256, version, subido_por, subido_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10)
       RETURNING id`,
      [
        ctx.empresaId,
        e.operationId,
        ops[0].session_id,
        doc.nombre_original,
        doc.mime,
        doc.tamano_bytes,
        doc.ruta,
        doc.sha256,
        ctx.userId,
        ahora,
      ]
    );

    await client.query(
      `UPDATE cash_autoscan_inbox
          SET estado = 'USADO', operation_id = $2, usado_por = $3, usado_at_ms = $4
        WHERE id = $1`,
      [e.inboxId, e.operationId, ctx.userId, ahora]
    );

    await registrarAuditoriaEnTransaccion(client, {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      accion: "cash.autoscan.document_used",
      entidad: "cash_autoscan_inbox",
      entidadId: String(e.inboxId),
      detalle: {
        operationId: e.operationId,
        documentoId: creado[0].id,
        deviceId: doc.device_id,
        // La huella sí; el contenido no.
        sha256: doc.sha256,
      },
      ip: ctx.ip,
    });

    return { documentoId: creado[0].id, inboxId: e.inboxId, operationId: e.operationId };
  });
}
