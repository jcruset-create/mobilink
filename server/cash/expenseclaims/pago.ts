/**
 * Pagar una liquidación aprobada: el ÚNICO punto donde una liquidación toca
 * la caja.
 *
 * Hasta aquí la liquidación era un papel: se preparó, se revisó y se aprobó
 * sin abrir el cajón. Ahora sale el dinero, y sale por el camino de siempre,
 * `registrarOperacion`, que es quien sabe validar las piezas, la forma de
 * pago, la jornada y el taller. Aquí no se repite ninguna de esas reglas.
 *
 * ## Un pago por el total
 *
 * Aunque la liquidación sea Dietas 66,40 + Peajes 15,88, el cajón ve UNA
 * salida de 82,28 € con UNA composición de piezas. Partirla en dos pagos
 * obligaría a componer dos juegos de billetes para un solo billete de 100. El
 * desglose por concepto sigue en las líneas, y la estadística de gasto lo lee
 * de ahí (`expensestats.ts`).
 *
 * ## Dos llaves contra el pago doble
 *
 * · La fila se bloquea (`FOR UPDATE`): dos peticiones a la vez se ponen en fila
 *   y la segunda ve la liquidación ya pagada.
 * · La clave de idempotencia: el navegador la genera al abrir el pago y la
 *   repite si reintenta. Si la respuesta se perdió por el camino y vuelve a
 *   llegar la MISMA clave, se devuelve el pago que ya existe en vez de un
 *   error que haría creer que no se pagó. Con OTRA clave, sí es un error: es
 *   alguien intentando pagar otra vez lo que ya está pagado.
 */

import type { PoolClient } from "pg";
import { registrarAuditoriaEnTransaccion } from "../../core/auditoria.ts";
import { formatearEuros } from "../domain/money.ts";
import type { LineaDenominacion } from "../domain/inventory.ts";
import { seccionPorDefecto, validarClasificacionGasto } from "../config.ts";
import { ErrorCaja } from "../errors.ts";
import { centroDeCaja } from "../events/emitter.ts";
import { enTransaccion } from "../repository.ts";
import { type Contexto, registrarOperacion } from "../service.ts";
import { destinoDerivado, totalesPorConcepto, transicion } from "./domain.ts";
import { type Liquidacion, cargarLiquidacion, lineasDe, paraReglas } from "./repository.ts";

export type EntradaPago = {
  sessionId: number;
  /** Lo que la pantalla enseñaba. Si no coincide con lo aprobado, no se paga. */
  importeCentimos: number;
  formasPago: { forma: string; importe: number; referencia?: string | null }[];
  efectivoEntregado?: LineaDenominacion[];
  efectivoRecibido?: LineaDenominacion[];
  idempotencyKey: string;
};

export type ResultadoPago = {
  liquidacion: Liquidacion;
  pago: { operacionId: number; numero: string };
  /** true = era un reintento con la misma clave y no se ha pagado nada nuevo. */
  repetido: boolean;
};

export async function pagarLiquidacion(ctx: Contexto, id: number, e: EntradaPago): Promise<ResultadoPago> {
  const clave = String(e.idempotencyKey ?? "").trim();
  if (clave.length < 8 || clave.length > 100) {
    throw new ErrorCaja(
      "IDEMPOTENCY_KEY_REQUERIDA",
      "Falta la clave de la petición de pago. Vuelve a abrir la ventana de pago.",
      400
    );
  }

  return enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, id, true);

    if (l.estado === "PAGADA") {
      if (l.operationPagoId && l.pagoNumero && (await claveDe(client, id)) === clave) {
        return { liquidacion: l, pago: { operacionId: l.operationPagoId, numero: l.pagoNumero }, repetido: true };
      }
      throw new ErrorCaja(
        "LIQUIDACION_YA_PAGADA",
        `${l.numero} ya está pagada${l.pagoNumero ? ` en ${l.pagoNumero}` : ""}.`,
        409
      );
    }
    if (!transicion(l.estado, "PAGAR")) {
      throw new ErrorCaja(
        "TRANSICION_NO_VALIDA",
        `${l.numero} está ${l.estado.toLowerCase()}: solo se paga una liquidación aprobada.`,
        409
      );
    }

    /*
     * Se paga lo APROBADO, no lo que la pantalla creyera. Las líneas están
     * congeladas desde que se presentó, así que no debería poder cambiar; si
     * cambia, algo raro ha pasado y lo correcto es no sacar dinero.
     */
    if (e.importeCentimos !== l.totalCentimos) {
      throw new ErrorCaja(
        "IMPORTE_NO_COINCIDE",
        `La liquidación aprobada es de ${formatearEuros(l.totalCentimos)} € y se intentaba pagar ${formatearEuros(e.importeCentimos)} €. Recarga la pantalla.`,
        409
      );
    }

    const lineas = await lineasDe(client, id);
    const incluidas = lineas.filter((x) => x.situacion === "INCLUIDA");
    const totales = totalesPorConcepto(lineas.map(paraReglas));
    if (totales.totalCentimos !== l.totalCentimos) {
      throw new ErrorCaja(
        "IMPORTE_NO_COINCIDE",
        `Los tickets suman ${formatearEuros(totales.totalCentimos)} € y se aprobaron ${formatearEuros(l.totalCentimos)} €. No se paga hasta aclararlo.`,
        409
      );
    }

    /*
     * La clasificación de cada ticket, con las MISMAS reglas que un pago
     * normal y con el catálogo de ahora: un concepto desactivado entre la
     * aprobación y el pago se detecta aquí, dentro de la transacción.
     */
    for (const x of incluidas) {
      if (x.expenseConceptId == null || !x.conceptoTipoDestino) {
        throw new ErrorCaja(
          "LINEA_SIN_CONCEPTO",
          `Un ticket de ${l.numero} se ha quedado sin concepto de gasto. Rechaza la liquidación y corrígelo.`,
          409
        );
      }
      await validarClasificacionGasto(
        ctx.empresaId,
        x.expenseConceptId,
        destinoDerivado(x.conceptoTipoDestino, l.expenseTargetId, x.expenseTargetId)
      );
    }

    const desglose = totales.porConcepto.map((t) => `${t.nombre} ${formatearEuros(t.importeCentimos)}`).join(" · ");
    const operacion = await registrarOperacion(
      ctx,
      {
        sessionId: e.sessionId,
        tipo: "PAYMENT",
        importeCentimos: l.totalCentimos,
        formasPago: e.formasPago,
        efectivoEntregado: e.efectivoEntregado ?? [],
        efectivoRecibido: e.efectivoRecibido ?? [],
        partyNombre: l.empleadoNombre,
        concepto: `Liquidación ${l.numero} (${desglose})`.slice(0, 300),
        referencia: l.numero,
        /*
         * Sin concepto ni destino en la operación: la liquidación mezcla
         * varios y una operación solo admite uno. El desglose vive en las
         * líneas, y la estadística lo lee de ahí.
         */
        expenseConceptId: null,
        expenseTargetId: null,
        sectionId: await seccionPorDefecto(ctx.empresaId),
      },
      client
    );

    /*
     * Los tickets pasan a ser justificantes del pago, SIN copiar el fichero:
     * la fila nueva apunta a la misma ruta, como hace AutoScan. Así el informe
     * de cierre del día los lleva detrás y el histórico los enseña. El objeto
     * del bucket deja de ser de una sola fila; una política de retención
     * tendrá que mirar las dos antes de borrar nada.
     */
    const { rows: sesion } = await client.query(
      `SELECT s.id, s.register_id FROM cash_sessions s WHERE s.id = $1`,
      [e.sessionId]
    );
    const ahora = Date.now();
    await client.query(
      `INSERT INTO cash_operation_documents
         (empresa_id, operation_id, session_id, nombre, mime, tamano_bytes, ruta,
          sha256, version, subido_por, subido_at_ms)
       SELECT l.empresa_id, $2, $3, l.nombre, l.mime, l.tamano_bytes, l.ruta,
              l.sha256, 1, $4, $5
         FROM cash_expense_claim_lines l
        WHERE l.claim_id = $1 AND l.situacion = 'INCLUIDA'
        ORDER BY l.orden, l.id`,
      [id, operacion.operacionId, e.sessionId, ctx.userId, ahora]
    );

    await client.query(
      `UPDATE cash_expense_claims
          SET estado = 'PAGADA', operation_pago_id = $2, session_id_pago = $3, centro_id_pago = $4,
              pago_idempotency_key = $5, pagada_por = $6, pagada_at_ms = $7,
              version = version + 1, updated_at_ms = $7
        WHERE id = $1`,
      [
        id,
        operacion.operacionId,
        e.sessionId,
        await centroDeCaja(client, sesion[0].register_id),
        clave,
        ctx.userId,
        ahora,
      ]
    );

    // Es un hecho de dinero: la auditoría va DENTRO de la transacción.
    await registrarAuditoriaEnTransaccion(client, {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      accion: "cash.expense_claim.pay",
      entidad: "cash_expense_claims",
      entidadId: String(id),
      detalle: {
        numero: l.numero,
        pago: operacion.numero,
        operacionId: operacion.operacionId,
        totalCentimos: l.totalCentimos,
        porConcepto: totales.porConcepto,
        tickets: incluidas.length,
        formasPago: e.formasPago,
      },
      ip: ctx.ip,
    });

    return {
      liquidacion: await cargarLiquidacion(client, ctx, id),
      pago: { operacionId: operacion.operacionId, numero: operacion.numero },
      repetido: false,
    };
  });
}

async function claveDe(client: PoolClient, id: number): Promise<string | null> {
  const { rows } = await client.query(`SELECT pago_idempotency_key FROM cash_expense_claims WHERE id = $1`, [id]);
  return rows[0]?.pago_idempotency_key ?? null;
}

/**
 * Se ha anulado en la caja el pago de una liquidación: la liquidación vuelve
 * a APROBADA.
 *
 * Lo llama `anularOperacion`, dentro de SU transacción. Sin esto quedaría una
 * liquidación «pagada» con el dinero otra vez en el cajón, y la siguiente
 * persona que la mirara no la volvería a pagar.
 *
 * · Los justificantes promovidos se ANULAN, no se borran: el pago anulado
 *   sigue en el histórico y se sabe qué papeles tuvo.
 * · Las coincidencias de duplicado que otras liquidaciones tuvieran con esos
 *   justificantes dejan de tener sentido: pasan a DESCARTADA si nadie las
 *   había decidido todavía.
 *
 * Devuelve la liquidación afectada, o `null` si la operación no pagaba
 * ninguna —que es el caso de casi todas—.
 */
export async function deshacerPagoDeLiquidacion(
  client: PoolClient,
  ctx: Contexto,
  operationId: number,
  motivo: string
): Promise<{ id: number; numero: string } | null> {
  const { rows } = await client.query(
    `SELECT id, numero, estado FROM cash_expense_claims
      WHERE operation_pago_id = $1 AND empresa_id = $2
      FOR UPDATE`,
    [operationId, ctx.empresaId]
  );
  const l = rows[0];
  if (!l) return null;
  if (!transicion(l.estado, "DESHACER_PAGO")) {
    // No debería pasar: una liquidación enlazada a un pago está PAGADA.
    throw new ErrorCaja(
      "TRANSICION_NO_VALIDA",
      `La liquidación ${l.numero} está ${String(l.estado).toLowerCase()} y no se puede deshacer su pago.`,
      409
    );
  }

  const ahora = Date.now();
  const { rows: docs } = await client.query(
    `UPDATE cash_operation_documents
        SET anulado = true, anulado_por = $2, anulado_at_ms = $3,
            anulado_motivo = $4
      WHERE operation_id = $1 AND NOT anulado
      RETURNING id`,
    [operationId, ctx.userId, ahora, `Pago anulado: ${motivo}`.slice(0, 500)]
  );
  if (docs.length > 0) {
    await client.query(
      `UPDATE cash_expense_claim_duplicates
          SET resolucion = 'DESCARTADA', resuelto_at_ms = $2,
              motivo = 'El justificante con el que coincidía se anuló al anular su pago.'
        WHERE referencia_tipo = 'DOCUMENTO' AND referencia_id = ANY($1::int[])
          AND resolucion = 'PENDIENTE'`,
      [docs.map((d: { id: number }) => d.id), ahora]
    );
  }

  await client.query(
    `UPDATE cash_expense_claims
        SET estado = 'APROBADA', operation_pago_id = NULL, session_id_pago = NULL,
            centro_id_pago = NULL, pago_idempotency_key = NULL,
            pagada_por = NULL, pagada_at_ms = NULL,
            version = version + 1, updated_at_ms = $2
      WHERE id = $1`,
    [l.id, ahora]
  );

  await registrarAuditoriaEnTransaccion(client, {
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.expense_claim.payment_reversed",
    entidad: "cash_expense_claims",
    entidadId: String(l.id),
    detalle: { numero: l.numero, operacionId: operationId, motivo, justificantesAnulados: docs.length },
    ip: ctx.ip,
  });
  return { id: l.id, numero: l.numero };
}
