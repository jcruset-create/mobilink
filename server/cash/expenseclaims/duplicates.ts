/**
 * Duplicados de un ticket: detectarlos, guardarlos todos y resolverlos.
 *
 * Cada coincidencia es una FILA de `cash_expense_claim_duplicates`, no una
 * columna de la línea. Un mismo ticket puede parecerse a varias cosas a la vez
 * —el mismo fichero en otra liquidación y ese mismo fichero colgado ya de un
 * pago de la caja— y cada coincidencia se decide por separado y deja escrito
 * quién decidió qué y por qué.
 *
 * Detectar NO bloquea la subida: un falso positivo no puede impedir subir un
 * ticket. Lo que bloquea es PRESENTAR con alguna coincidencia sin decidir.
 *
 * Esta fase detecta el mismo fichero (sha256). Las otras dos —el mismo ticket
 * con dos escaneos distintos, y el mismo número ya pagado— usan esta misma
 * tabla y llegan después.
 */

import type { PoolClient } from "pg";
import { ErrorCaja } from "../errors.ts";

type Momento = "SUBIDA" | "ANALISIS" | "PRESENTAR" | "PAGAR";

async function apuntar(
  client: PoolClient,
  e: {
    empresaId: string;
    lineId: number;
    tipo: "MISMO_FICHERO" | "MISMA_CLAVE" | "MISMO_NUMERO";
    referenciaTipo: "LINEA" | "DOCUMENTO" | "OPERACION";
    referenciaId: number;
    referenciaNumero: string | null;
    momento: Momento;
  }
): Promise<void> {
  /*
   * `DO NOTHING`: si la misma coincidencia ya se apuntó —y a lo mejor ya se
   * resolvió—, volver a detectarla no la reabre. Lo decidido, decidido está.
   */
  await client.query(
    `INSERT INTO cash_expense_claim_duplicates
       (empresa_id, line_id, tipo, referencia_tipo, referencia_id, referencia_numero,
        detectado_en, detectado_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (line_id, tipo, referencia_tipo, referencia_id) DO NOTHING`,
    [
      e.empresaId,
      e.lineId,
      e.tipo,
      e.referenciaTipo,
      e.referenciaId,
      e.referenciaNumero,
      e.momento,
      Date.now(),
    ]
  );
}

/**
 * El mismo fichero, byte a byte, en otro sitio.
 *
 * Se mira contra dos cosas:
 *
 * · otras líneas de liquidaciones no anuladas, que no estén excluidas;
 * · justificantes de la caja no anulados — incluido el caso que más importa:
 *   el ticket que ya se liquidó por «Entregas de dinero» y ahora vuelve dentro
 *   de una liquidación.
 */
export async function detectarMismoFichero(
  client: PoolClient,
  empresaId: string,
  linea: { id: number; claimId: number; sha256: string },
  momento: Momento
): Promise<void> {
  const { rows: lineas } = await client.query(
    `SELECT l.id, c.numero
       FROM cash_expense_claim_lines l
       JOIN cash_expense_claims c ON c.id = l.claim_id
      WHERE l.empresa_id = $1 AND l.sha256 = $2 AND l.id <> $3
        AND l.situacion = 'INCLUIDA' AND c.estado <> 'ANULADA'
      ORDER BY l.id`,
    [empresaId, linea.sha256, linea.id]
  );
  for (const r of lineas) {
    await apuntar(client, {
      empresaId,
      lineId: linea.id,
      tipo: "MISMO_FICHERO",
      referenciaTipo: "LINEA",
      referenciaId: r.id,
      referenciaNumero: r.numero,
      momento,
    });
  }

  const { rows: documentos } = await client.query(
    `SELECT d.id, o.numero
       FROM cash_operation_documents d
       LEFT JOIN cash_operations o ON o.id = d.operation_id
      WHERE d.empresa_id = $1 AND d.sha256 = $2 AND NOT d.anulado
      ORDER BY d.id`,
    [empresaId, linea.sha256]
  );
  for (const r of documentos) {
    await apuntar(client, {
      empresaId,
      lineId: linea.id,
      tipo: "MISMO_FICHERO",
      referenciaTipo: "DOCUMENTO",
      referenciaId: r.id,
      referenciaNumero: r.numero ?? "Jornada",
      momento,
    });
  }
}

/**
 * Al excluir una línea, lo que tenía pendiente queda resuelto como EXCLUIDA:
 * ya no se va a pagar, así que no hay nada que decidir.
 */
export async function resolverPorExclusion(
  client: PoolClient,
  lineId: number,
  userId: string | null,
  motivo: string
): Promise<void> {
  await client.query(
    `UPDATE cash_expense_claim_duplicates
        SET resolucion = 'EXCLUIDA', resuelto_por = $2, resuelto_at_ms = $3, motivo = $4
      WHERE line_id = $1 AND resolucion = 'PENDIENTE'`,
    [lineId, userId, Date.now(), motivo]
  );
}

/**
 * Al volver a incluirla, lo que se resolvió POR la exclusión vuelve a estar
 * pendiente: si se va a pagar otra vez, alguien tiene que volver a decidir si
 * está repetida. Lo que se ACEPTÓ expresamente no se toca.
 */
export async function reabrirPorInclusion(client: PoolClient, lineId: number): Promise<void> {
  await client.query(
    `UPDATE cash_expense_claim_duplicates
        SET resolucion = 'PENDIENTE', resuelto_por = NULL, resuelto_at_ms = NULL, motivo = NULL
      WHERE line_id = $1 AND resolucion = 'EXCLUIDA'`,
    [lineId]
  );
}

/** La coincidencia, comprobando que es de esa línea y de esa empresa. */
export async function cargarEvidencia(
  client: PoolClient,
  empresaId: string,
  claimId: number,
  evidenciaId: number
): Promise<{ id: number; lineId: number; resolucion: string; referenciaNumero: string | null; tipo: string }> {
  const { rows } = await client.query(
    `SELECT d.id, d.line_id, d.resolucion, d.referencia_numero, d.tipo
       FROM cash_expense_claim_duplicates d
       JOIN cash_expense_claim_lines l ON l.id = d.line_id
      WHERE d.id = $1 AND d.empresa_id = $2 AND l.claim_id = $3
      FOR UPDATE OF d`,
    [evidenciaId, empresaId, claimId]
  );
  if (!rows[0]) throw new ErrorCaja("DUPLICADO_NO_ENCONTRADO", "Esa coincidencia no existe.", 404);
  return {
    id: rows[0].id,
    lineId: rows[0].line_id,
    resolucion: rows[0].resolucion,
    referenciaNumero: rows[0].referencia_numero,
    tipo: rows[0].tipo,
  };
}
