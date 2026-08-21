/**
 * Traslados de efectivo entre cajas de la misma empresa.
 *
 * La fase 19 sabía **proponerlos** y no podía ejecutarlos, por un motivo
 * concreto: en medio del viaje el dinero no está en ninguna de las dos cajas, y
 * sin un documento que lo represente se contaría dos veces o ninguna.
 *
 * La regla que lo sostiene es la que ya rige los pedidos al banco y las
 * entregas: **los asientos se hacen cuando el dinero se mueve, no cuando se
 * planea.** Al crear el traslado sale del cajón de origen; al recibirlo entra
 * en el de destino; en medio, ninguna de las dos lo tiene.
 *
 * Y una consecuencia que conviene entender antes de tocar nada: durante el
 * viaje **el dinero no está en el stock teórico de nadie**, así que el arqueo
 * de la tarde en el taller de origen cuadra sin trucos. Es lo mismo que ya
 * pasaba con el cambio que se lleva al banco.
 */

import type { PoolClient } from "pg";
import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { ErrorCaja } from "./errors.ts";
import {
  bloquearSesionOperable,
  codigoDeSesion,
  enTransaccion,
  siguienteNumeroDe,
} from "./repository.ts";
import { inventarioDesdeLineas, totalInventario, type LineaDenominacion } from "./domain/inventory.ts";
import { registrarOperacion, type Contexto } from "./service.ts";
import { exigirJornadaPropia } from "./hierarchy.ts";
import { centroDeCaja, emitirEvento } from "./events/emitter.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Traslado = {
  id: number;
  numero: string;
  origenRegisterId: number;
  destinoRegisterId: number;
  estado: "EN_TRANSITO" | "RECIBIDO" | "CANCELADO";
  importeCentimos: number;
  recibidoCentimos: number | null;
  portador: string | null;
  enviado: LineaDenominacion[];
  recibido: LineaDenominacion[];
  creadoAtMs: number;
  cerradoAtMs: number | null;
};

async function lineas(client: PoolClient | typeof pool, ids: number[]) {
  if (ids.length === 0) return new Map<number, { enviado: LineaDenominacion[]; recibido: LineaDenominacion[] }>();
  const { rows } = await client.query(
    `SELECT transfer_id, rol, valor_centimos, cantidad FROM cash_transfer_lines
      WHERE transfer_id = ANY($1::int[]) ORDER BY valor_centimos DESC`,
    [ids]
  );
  const m = new Map<number, { enviado: LineaDenominacion[]; recibido: LineaDenominacion[] }>();
  for (const r of rows as any[]) {
    const e = m.get(r.transfer_id) ?? { enviado: [], recibido: [] };
    (r.rol === "ENVIADO" ? e.enviado : e.recibido).push({
      valor: r.valor_centimos,
      cantidad: r.cantidad,
    });
    m.set(r.transfer_id, e);
  }
  return m;
}

function aTraslado(r: any, l?: { enviado: LineaDenominacion[]; recibido: LineaDenominacion[] }): Traslado {
  return {
    id: r.id,
    numero: r.numero,
    origenRegisterId: r.origen_register_id,
    destinoRegisterId: r.destino_register_id,
    estado: r.estado,
    importeCentimos: Number(r.importe_centimos),
    recibidoCentimos: r.recibido_centimos == null ? null : Number(r.recibido_centimos),
    portador: r.portador ?? null,
    enviado: l?.enviado ?? [],
    recibido: l?.recibido ?? [],
    creadoAtMs: Number(r.creado_at_ms),
    cerradoAtMs: r.cerrado_at_ms == null ? null : Number(r.cerrado_at_ms),
  };
}

export type EntradaTraslado = {
  /** Jornada ABIERTA de la caja que envía. */
  sessionId: number;
  destinoRegisterId: number;
  piezas: LineaDenominacion[];
  portador: string;
  notas?: string;
};

/**
 * Manda dinero a otra caja. El efectivo sale YA del cajón de origen.
 *
 * Se exige `portador` porque es lo único que se pregunta cuando el dinero no
 * aparece, y porque un traslado sin responsable es un tránsito que nadie
 * reclama.
 */
export async function enviar(ctx: Contexto, e: EntradaTraslado): Promise<Traslado> {
  const portador = String(e.portador ?? "").trim();
  if (!portador) {
    throw new ErrorCaja(
      "FALTA_PORTADOR",
      "Hace falta decir quién lleva el dinero: es lo primero que se pregunta si no llega.",
      400
    );
  }
  if (!e.piezas?.some((l) => l.cantidad > 0)) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "No se ha indicado ninguna pieza que enviar.", 400);
  }

  const traslado = await enTransaccion(async (client) => {
    const sesion = await bloquearSesionOperable(client, e.sessionId);
    await exigirJornadaPropia(client, ctx, sesion);

    if (sesion.registerId === e.destinoRegisterId) {
      throw new ErrorCaja(
        "TRASLADO_A_LA_MISMA_CAJA",
        "El origen y el destino son la misma caja.",
        400
      );
    }

    // El destino tiene que ser una caja activa de la misma empresa. Sin esto,
    // el dinero podría salir hacia una caja de otra empresa y no volver.
    const { rows: destino } = await client.query(
      `SELECT id FROM cash_registers
        WHERE id = $1 AND empresa_id = $2 AND activa = true`,
      [e.destinoRegisterId, ctx.empresaId]
    );
    if (destino.length === 0) {
      throw new ErrorCaja(
        "CAJA_NO_ENCONTRADA",
        "La caja de destino no existe, no está activa o no es de tu empresa.",
        404
      );
    }

    const piezas = e.piezas.filter((l) => l.cantidad > 0);
    const total = totalInventario(inventarioDesdeLineas(piezas));

    /*
     * El dinero sale del cajón con su detalle de piezas, como cualquier otra
     * salida. Si no hubiera stock suficiente, la validación de la operación lo
     * impide aquí y no hay traslado que crear.
     */
    const operacion = await registrarOperacion(
      ctx,
      {
        sessionId: e.sessionId,
        tipo: "CASH_DELIVERY",
        importeCentimos: total,
        formasPago: [{ forma: "CASH", importe: total }],
        efectivoEntregado: piezas,
        partyNombre: portador,
        concepto: `Traslado a otra caja`,
      },
      client
    );

    const anio = Number(sesion.fecha.slice(0, 4));
    const numero = await siguienteNumeroDe(
      client,
      await codigoDeSesion(client, sesion.id),
      "TR",
      anio
    );
    const ahora = Date.now();

    const { rows } = await client.query(
      `INSERT INTO cash_transfers
         (empresa_id, numero, origen_register_id, destino_register_id, importe_centimos,
          portador, notas, session_id_salida, operation_salida_id, creado_por, creado_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        ctx.empresaId,
        numero,
        sesion.registerId,
        e.destinoRegisterId,
        total,
        portador,
        e.notas ?? null,
        e.sessionId,
        operacion.operacionId,
        ctx.userId,
        ahora,
      ]
    );
    const id = rows[0].id;

    for (const l of piezas) {
      await client.query(
        `INSERT INTO cash_transfer_lines (transfer_id, rol, valor_centimos, cantidad)
         VALUES ($1,'ENVIADO',$2,$3)`,
        [id, l.valor, l.cantidad]
      );
    }

    /*
     * Para MC Central esto es un tránsito abierto, igual que un pedido al banco
     * o una entrega: dinero que salió del cajón y todavía no ha llegado. Así la
     * posición global lo cuenta una sola vez, en tránsito, y no en las dos
     * cajas.
     */
    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, sesion.registerId),
      registerId: sesion.registerId,
      sessionId: e.sessionId,
      agregado: { tipo: "SESSION", id: e.sessionId },
      tipo: "TRANSIT_OPENED",
      ocurridoEnMs: ahora,
      actorUserId: ctx.userId,
      datos: {
        clase: "TRANSFER",
        documentoId: id,
        numero,
        importeCentimos: total,
        responsable: portador,
        destinoRegisterId: e.destinoRegisterId,
      },
    });

    return aTraslado(rows[0], { enviado: piezas, recibido: [] });
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.transfer.send",
    entidad: "cash_transfers",
    entidadId: String(traslado.id),
    detalle: {
      numero: traslado.numero,
      importeCentimos: traslado.importeCentimos,
      destino: traslado.destinoRegisterId,
      portador,
    },
    ip: ctx.ip,
  });

  return traslado;
}

export type EntradaRecepcion = {
  /** Jornada ABIERTA de la caja que recibe. */
  sessionId: number;
  /** Lo que de verdad ha llegado. Si se omite, se da por bueno lo enviado. */
  recibido?: LineaDenominacion[];
  /** Obligatorio si lo recibido no coincide con lo enviado. */
  diferenciaMotivo?: string;
};

/**
 * Recibe un traslado. El efectivo entra en el cajón de destino.
 *
 * **Si lo que llega no es lo que salió, no se bloquea**: el dinero ya está
 * donde está, y negarse a registrarlo solo esconde el problema. Se exige un
 * motivo y queda auditado con el nombre de quien lo llevaba. Es la misma
 * decisión que ya tomó el módulo con el banco y con las entregas.
 */
export async function recibir(
  ctx: Contexto,
  trasladoId: number,
  e: EntradaRecepcion
): Promise<Traslado> {
  const traslado = await enTransaccion(async (client) => {
    const { rows: previas } = await client.query(
      `SELECT * FROM cash_transfers WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [trasladoId, ctx.empresaId]
    );
    if (previas.length === 0) {
      throw new ErrorCaja("TRASLADO_NO_ENCONTRADO", "El traslado no existe.", 404);
    }
    if (previas[0].estado !== "EN_TRANSITO") {
      throw new ErrorCaja(
        "TRASLADO_NO_PENDIENTE",
        `El traslado ya está ${previas[0].estado.toLowerCase()}.`,
        409
      );
    }

    const sesion = await bloquearSesionOperable(client, e.sessionId);
    await exigirJornadaPropia(client, ctx, sesion);

    /*
     * Se recibe en la caja de destino y en ninguna otra. Sin esta comprobación,
     * el dinero podría entrar en una tercera caja y el traslado quedaría
     * diciendo que llegó a un sitio donde no está.
     */
    if (sesion.registerId !== previas[0].destino_register_id) {
      throw new ErrorCaja(
        "TRASLADO_DE_OTRA_CAJA",
        "Este traslado va dirigido a otra caja.",
        409
      );
    }

    const l = await lineas(client, [trasladoId]);
    const enviado = l.get(trasladoId)?.enviado ?? [];
    const recibido = (e.recibido ?? enviado).filter((x) => x.cantidad > 0);
    const total = totalInventario(inventarioDesdeLineas(recibido));
    const esperado = Number(previas[0].importe_centimos);

    if (total !== esperado && !String(e.diferenciaMotivo ?? "").trim()) {
      throw new ErrorCaja(
        "FALTA_MOTIVO",
        `Salieron ${esperado} céntimos y han llegado ${total}. Hace falta un motivo para registrar la diferencia.`,
        400
      );
    }

    const operacion = await registrarOperacion(
      ctx,
      {
        sessionId: e.sessionId,
        tipo: "MANUAL_IN",
        importeCentimos: total,
        formasPago: [{ forma: "CASH", importe: total }],
        efectivoRecibido: recibido,
        partyNombre: previas[0].portador,
        concepto: `Traslado recibido (${previas[0].numero})`,
      },
      client
    );

    const ahora = Date.now();
    const { rows } = await client.query(
      `UPDATE cash_transfers
          SET estado = 'RECIBIDO', recibido_centimos = $2, diferencia_motivo = $3,
              session_id_entrada = $4, operation_entrada_id = $5,
              cerrado_por = $6, cerrado_at_ms = $7
        WHERE id = $1
        RETURNING *`,
      [
        trasladoId,
        total,
        String(e.diferenciaMotivo ?? "").trim() || null,
        e.sessionId,
        operacion.operacionId,
        ctx.userId,
        ahora,
      ]
    );

    for (const x of recibido) {
      await client.query(
        `INSERT INTO cash_transfer_lines (transfer_id, rol, valor_centimos, cantidad)
         VALUES ($1,'RECIBIDO',$2,$3)
         ON CONFLICT (transfer_id, rol, valor_centimos) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
        [trasladoId, x.valor, x.cantidad]
      );
    }

    /*
     * El tránsito se cierra desde la jornada de DESTINO, que es donde ha
     * ocurrido el hecho. El evento lleva el importe realmente recibido: si
     * llegó de menos, la posición global tiene que reflejar lo que hay, no lo
     * que se mandó.
     */
    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, sesion.registerId),
      registerId: sesion.registerId,
      sessionId: e.sessionId,
      agregado: { tipo: "SESSION", id: e.sessionId },
      tipo: "TRANSIT_SETTLED",
      ocurridoEnMs: ahora,
      actorUserId: ctx.userId,
      datos: {
        clase: "TRANSFER",
        documentoId: trasladoId,
        numero: previas[0].numero,
        importeCentimos: esperado,
        liquidadoCentimos: total,
        motivo: total === esperado ? "RECIBIDO" : "RECIBIDO_CON_DIFERENCIA",
      },
    });

    const todas = await lineas(client, [trasladoId]);
    return aTraslado(rows[0], todas.get(trasladoId));
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.transfer.receive",
    entidad: "cash_transfers",
    entidadId: String(trasladoId),
    detalle: {
      numero: traslado.numero,
      esperadoCentimos: traslado.importeCentimos,
      recibidoCentimos: traslado.recibidoCentimos,
      motivo: e.diferenciaMotivo ?? null,
    },
    ip: ctx.ip,
  });

  return traslado;
}

/** Traslados de una empresa. Los pendientes primero: son los que hay que mirar. */
export async function listar(empresaId: string, registerId?: number): Promise<Traslado[]> {
  const { rows } = await pool.query(
    `SELECT * FROM cash_transfers
      WHERE empresa_id = $1
        AND ($2::int IS NULL OR origen_register_id = $2 OR destino_register_id = $2)
      ORDER BY (estado = 'EN_TRANSITO') DESC, creado_at_ms DESC
      LIMIT 100`,
    [empresaId, registerId ?? null]
  );

  const l = await lineas(pool, rows.map((r: any) => r.id));
  return rows.map((r: any) => aTraslado(r, l.get(r.id)));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
