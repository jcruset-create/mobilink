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
 * Tres detecciones, cada una con su momento:
 *
 * · MISMO_FICHERO — el sha256, al subir.
 * · MISMA_CLAVE — mismo emisor, mismo día y mismo importe: el mismo ticket
 *   escaneado dos veces, o escaneado y fotografiado, que son dos ficheros. Al
 *   leerlo, al corregirlo, y otra vez al presentar y al pagar. Salvo que los
 *   dos traigan número y sea distinto: la ida y la vuelta por el mismo peaje
 *   el mismo día cuestan lo mismo y son dos gastos.
 * · MISMO_NUMERO — el número del ticket ya consta PAGADO en la caja (un pago
 *   de proveedor, o una entrega ya liquidada). Mismos momentos.
 *
 * ## Quién es el duplicado de quién
 *
 * Solo se marca la línea POSTERIOR. Si el ticket A se subió antes que el B, se
 * le pone la evidencia a B, no a A: A es el original, y bloquearlo por culpa
 * de la copia obligaría a justificar el ticket bueno. Una línea de una
 * liquidación ya presentada, aprobada o pagada cuenta siempre como anterior:
 * esa ya está tramitándose.
 */

import type { PoolClient } from "pg";
import { cobroPrevioDeFactura } from "../duplicates.ts";
import { ErrorCaja } from "../errors.ts";
import { claveDeDuplicado, numerosDistintos } from "./domain.ts";

type Momento = "SUBIDA" | "ANALISIS" | "EDICION" | "PRESENTAR" | "PAGAR";

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


/**
 * Las dos detecciones por CONTENIDO de una línea: mismo ticket con otro
 * fichero, y mismo número ya pagado. No hace nada si la línea no está
 * incluida: lo que no se paga no puede estar pagado dos veces.
 */
export async function detectarPorContenido(
  client: PoolClient,
  empresaId: string,
  lineId: number,
  momento: Momento
): Promise<void> {
  const { rows } = await client.query(
    `SELECT l.id, l.claim_id, l.situacion, l.emisor_nif, l.emisor_nombre, l.fecha::text AS fecha,
            l.importe_centimos, l.numero_documento
       FROM cash_expense_claim_lines l WHERE l.id = $1 AND l.empresa_id = $2`,
    [lineId, empresaId]
  );
  const l = rows[0];
  if (!l || l.situacion !== "INCLUIDA") return;
  /** Con qué coincide AHORA, por tipo. Lo pendiente que ya no esté, se descarta. */
  const coinciden = { MISMA_CLAVE: [] as number[], MISMO_NUMERO: [] as number[] };

  const clave = claveDeDuplicado({
    emisorNif: l.emisor_nif,
    emisorNombre: l.emisor_nombre ?? "",
    fecha: l.fecha,
    importeCentimos: Number(l.importe_centimos),
  });
  if (clave) {
    /*
     * Candidatas por fecha e importe, que es lo que usa el índice; la clave
     * entera —NIF normalizado, o nombre sin tildes— se compara aquí, con la
     * MISMA función que la calcula. Solo las anteriores (ver cabecera).
     */
    const { rows: candidatas } = await client.query(
      `SELECT o.id, o.emisor_nif, o.emisor_nombre, o.fecha::text AS fecha, o.importe_centimos,
              o.numero_documento, c.numero
         FROM cash_expense_claim_lines o
         JOIN cash_expense_claims c ON c.id = o.claim_id
        WHERE o.empresa_id = $1 AND o.id <> $2
          AND o.fecha = $3::date AND o.importe_centimos = $4
          AND o.situacion = 'INCLUIDA' AND c.estado <> 'ANULADA'
          AND (o.id < $2 OR (c.estado IN ('PRESENTADA','APROBADA','PAGADA') AND o.claim_id <> $5))
        ORDER BY o.id`,
      [empresaId, lineId, l.fecha, Number(l.importe_centimos), l.claim_id]
    );
    for (const o of candidatas) {
      const suya = claveDeDuplicado({
        emisorNif: o.emisor_nif,
        emisorNombre: o.emisor_nombre ?? "",
        fecha: o.fecha,
        importeCentimos: Number(o.importe_centimos),
      });
      if (suya !== clave) continue;
      // La ida y la vuelta por el mismo peaje: mismo todo, distinto número.
      if (numerosDistintos(l.numero_documento, o.numero_documento)) continue;
      coinciden.MISMA_CLAVE.push(o.id);
      await apuntar(client, {
        empresaId,
        lineId,
        tipo: "MISMA_CLAVE",
        referenciaTipo: "LINEA",
        referenciaId: o.id,
        referenciaNumero: o.numero,
        momento,
      });
    }
  }

  /*
   * El número ya pagado en la caja. Con la misma consulta que usa Pagos, así
   * que un ticket pagado por «Entregas de dinero» o como factura de proveedor
   * sale aquí igual. Las inversas de una anulación no cuentan (ver
   * `cobroPrevioDeFactura`).
   */
  if (l.numero_documento) {
    const previo = await cobroPrevioDeFactura(empresaId, l.numero_documento, client, null, "PAGO");
    if (previo) {
      coinciden.MISMO_NUMERO.push(previo.operacionId);
      await apuntar(client, {
        empresaId,
        lineId,
        tipo: "MISMO_NUMERO",
        referenciaTipo: "OPERACION",
        referenciaId: previo.operacionId,
        referenciaNumero: previo.numero,
        momento,
      });
    }
  }

  /*
   * Si al corregir el ticket —otra fecha, otro importe, otro número— deja de
   * coincidir con lo que coincidía, esa sospecha ya no aplica. Solo lo
   * PENDIENTE: lo que alguien decidió se queda como lo decidió.
   */
  for (const tipo of ["MISMA_CLAVE", "MISMO_NUMERO"] as const) {
    await client.query(
      `UPDATE cash_expense_claim_duplicates
          SET resolucion = 'DESCARTADA', resuelto_at_ms = $4,
              motivo = 'Con los datos corregidos del ticket, ya no coincide.'
        WHERE line_id = $1 AND tipo = $2 AND resolucion = 'PENDIENTE'
          AND NOT (referencia_id = ANY($3::int[]))`,
      [lineId, tipo, coinciden[tipo], Date.now()]
    );
  }
}

/**
 * Lo pendiente que ya no tiene sentido pasa a DESCARTADA, con el porqué.
 *
 * La coincidencia se detectó con algo que ha dejado de contar: la otra línea
 * se excluyó, su liquidación se anuló, el justificante se retiró o el pago se
 * anuló. Mantenerla pendiente bloquearía por algo que ya no existe. Lo que
 * alguien ya decidió (ACEPTADA, EXCLUIDA) no se toca.
 */
export async function descartarLasQueYaNoAplican(client: PoolClient, lineIds: readonly number[]): Promise<void> {
  if (lineIds.length === 0) return;
  const ahora = Date.now();
  await client.query(
    `UPDATE cash_expense_claim_duplicates d
        SET resolucion = 'DESCARTADA', resuelto_at_ms = $2,
            motivo = 'Aquello con lo que coincidía ya no cuenta: se excluyó, se anuló o se retiró.'
      WHERE d.line_id = ANY($1::int[]) AND d.resolucion = 'PENDIENTE'
        AND (
          (d.referencia_tipo = 'LINEA' AND NOT EXISTS (
             SELECT 1 FROM cash_expense_claim_lines o
               JOIN cash_expense_claims c ON c.id = o.claim_id
              WHERE o.id = d.referencia_id AND o.situacion = 'INCLUIDA' AND c.estado <> 'ANULADA'))
          OR (d.referencia_tipo = 'DOCUMENTO' AND NOT EXISTS (
             SELECT 1 FROM cash_operation_documents x WHERE x.id = d.referencia_id AND NOT x.anulado))
          OR (d.referencia_tipo = 'OPERACION' AND NOT EXISTS (
             SELECT 1 FROM cash_operations x WHERE x.id = d.referencia_id AND x.estado = 'CONFIRMED'))
        )`,
    [lineIds, ahora]
  );
}

/**
 * Vuelve a mirar TODAS las líneas incluidas de una liquidación.
 *
 * Se llama antes de presentar y antes de pagar, en su PROPIA transacción: si
 * encuentra algo nuevo, tiene que quedar guardado aunque lo siguiente —que
 * sea presentar o pagar— se niegue por eso mismo. Dentro de la misma
 * transacción, el rechazo se llevaría por delante la evidencia que lo explica.
 *
 * El mundo cambia entre que se sube un ticket y se paga: alguien ha podido
 * pagar ese número por Pagos, o subir el mismo ticket en otra liquidación que
 * ya se presentó.
 */
export async function revisarLiquidacion(client: PoolClient, empresaId: string, claimId: number, momento: Momento): Promise<void> {
  const { rows } = await client.query(
    `SELECT id FROM cash_expense_claim_lines WHERE claim_id = $1 AND situacion = 'INCLUIDA' ORDER BY id`,
    [claimId]
  );
  const ids = rows.map((r: { id: number }) => r.id);
  for (const id of ids) await detectarPorContenido(client, empresaId, id, momento);
  await descartarLasQueYaNoAplican(client, ids);
}
