/**
 * Tesorería de Mobilink Cash: pedidos de cambio al banco y entregas de dinero
 * a personas.
 *
 * Las dos cosas son lo mismo visto de dos maneras: **dinero que sale hoy de la
 * caja y vuelve más tarde**, entero o en parte. Ese hueco es justo lo que el
 * módulo no sabía representar, y es lo que hace que un arqueo descuadre 200 €
 * sin que nadie recuerde por qué.
 *
 * Dos decisiones que sostienen todo lo demás:
 *
 * 1. **Los asientos se hacen cuando el dinero se mueve de verdad**, no cuando
 *    se planea. Al crear el pedido salen los billetes; al recibirlo entra la
 *    calderilla. En medio, el stock teórico ya no cuenta ese dinero, así que el
 *    arqueo de la tarde cuadra sin trucos.
 *
 * 2. **Cruzan jornadas.** El banco no contesta el mismo día y el empleado
 *    vuelve en el turno siguiente. Cada asiento pertenece a la jornada en la
 *    que ocurrió, de modo que los dos arqueos cuadran por separado. Era el
 *    motivo del encargo: que un billete de 50 € no desaparezca en un cambio de
 *    turno.
 *
 * Sobre la liquidación de una entrega, que es la parte con más miga: el pago
 * que se registra es el REAL —lo que dice la factura— y no vuelve a mover
 * piezas. Las piezas salieron al entregar el dinero; volver a sacarlas al
 * liquidar sacaría 90 € de una caja de la que solo salieron 50. Lo único que
 * entra al liquidar es la vuelta.
 */

import type { PoolClient } from "pg";
import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import type { Centimos } from "./domain/money.ts";
import { formatearEuros } from "./domain/money.ts";
import {
  type LineaDenominacion,
  inventarioDesdeLineas,
  totalInventario,
} from "./domain/inventory.ts";
import { esFallo } from "./domain/result.ts";
import {
  type HistorialConsumo,
  type PropuestaPedido,
  composicionSalida,
  proponerPedidoCambio,
} from "./domain/restock.ts";
import {
  ErrorCaja,
  bloquearSesionOperable,
  cargarDenominaciones,
  enTransaccion,
  piezasPorCartuchoDe,
  siguienteNumeroDe,
  stockTeorico,
} from "./repository.ts";
import { registrarOperacion, type Contexto } from "./service.ts";

// ── Tipos ──────────────────────────────────────────────────────────────────

export type EstadoPedido = "PENDIENTE" | "RECIBIDO" | "CANCELADO";

export type LineaPedidoGuardada = LineaDenominacion & {
  cartuchos: number;
  motivo: string | null;
};

export type PedidoCambio = {
  id: number;
  numero: string;
  estado: EstadoPedido;
  registerId: number;
  importeCentimos: Centimos;
  importeRecibidoCentimos: Centimos | null;
  diferenciaMotivo: string | null;
  solicitado: LineaPedidoGuardada[];
  enviado: LineaPedidoGuardada[];
  recibido: LineaPedidoGuardada[];
  notas: string | null;
  creadoAtMs: number;
  cerradoAtMs: number | null;
};

export type EstadoEntrega = "ABIERTA" | "LIQUIDADA" | "DEVUELTA" | "CANCELADA";

export type EntregaDinero = {
  id: number;
  numero: string;
  estado: EstadoEntrega;
  registerId: number;
  persona: string;
  motivo: string;
  importeCentimos: Centimos;
  gastoCentimos: Centimos | null;
  devueltoCentimos: Centimos | null;
  diferenciaCentimos: Centimos | null;
  diferenciaMotivo: string | null;
  facturaReferencia: string | null;
  proveedor: string | null;
  entregado: LineaDenominacion[];
  notas: string | null;
  creadoAtMs: number;
  cerradoAtMs: number | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: any): number | null => (v == null ? null : Number(v));

function aPedido(r: any, lineas: any[]): PedidoCambio {
  const de = (rol: string): LineaPedidoGuardada[] =>
    lineas
      .filter((l) => l.rol === rol)
      .map((l) => ({
        valor: l.valor_centimos,
        cantidad: l.cantidad,
        cartuchos: l.cartuchos,
        motivo: l.motivo,
      }));

  return {
    id: r.id,
    numero: r.numero,
    estado: r.estado,
    registerId: r.register_id,
    importeCentimos: Number(r.importe_centimos),
    importeRecibidoCentimos: num(r.importe_recibido_centimos),
    diferenciaMotivo: r.diferencia_motivo,
    solicitado: de("SOLICITADO"),
    enviado: de("ENVIADO"),
    recibido: de("RECIBIDO"),
    notas: r.notas,
    creadoAtMs: Number(r.creado_at_ms),
    cerradoAtMs: num(r.cerrado_at_ms),
  };
}

function aEntrega(r: any, entregado: LineaDenominacion[] = []): EntregaDinero {
  return {
    id: r.id,
    numero: r.numero,
    estado: r.estado,
    registerId: r.register_id,
    persona: r.persona,
    motivo: r.motivo,
    importeCentimos: Number(r.importe_centimos),
    gastoCentimos: num(r.gasto_centimos),
    devueltoCentimos: num(r.devuelto_centimos),
    diferenciaCentimos: num(r.diferencia_centimos),
    diferenciaMotivo: r.diferencia_motivo,
    facturaReferencia: r.factura_referencia,
    proveedor: r.proveedor,
    entregado,
    notas: r.notas,
    creadoAtMs: Number(r.creado_at_ms),
    cerradoAtMs: num(r.cerrado_at_ms),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Consultas ──────────────────────────────────────────────────────────────

async function lineasDePedido(client: PoolClient | typeof pool, ids: number[]) {
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    `SELECT * FROM cash_change_order_lines WHERE change_order_id = ANY($1::int[]) ORDER BY valor_centimos DESC`,
    [ids]
  );
  return rows;
}

export async function listarPedidos(
  empresaId: string,
  registerId: number,
  incluirCerrados = true
): Promise<PedidoCambio[]> {
  const { rows } = await pool.query(
    `SELECT * FROM cash_change_orders
      WHERE empresa_id = $1 AND register_id = $2
        ${incluirCerrados ? "" : "AND estado = 'PENDIENTE'"}
      ORDER BY id DESC LIMIT 100`,
    [empresaId, registerId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const lineas = await lineasDePedido(pool, rows.map((r: any) => r.id));
  return rows.map((r: any) => aPedido(r, lineas.filter((l: any) => l.change_order_id === r.id)));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function listarEntregas(
  empresaId: string,
  registerId: number,
  incluirCerradas = true
): Promise<EntregaDinero[]> {
  const { rows } = await pool.query(
    `SELECT * FROM cash_advances
      WHERE empresa_id = $1 AND register_id = $2
        ${incluirCerradas ? "" : "AND estado = 'ABIERTA'"}
      ORDER BY id DESC LIMIT 100`,
    [empresaId, registerId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => aEntrega(r));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Lo que está fuera de la caja ahora mismo: pedidos en el banco y dinero en
 * manos de alguien.
 *
 * La pantalla de jornada y la de cierre lo enseñan para que un descuadre de
 * 250 € no sea un misterio, sino "200 € en el banco y 50 € con Juan".
 */
export async function pendientes(
  empresaId: string,
  registerId: number
): Promise<{
  pedidos: PedidoCambio[];
  entregas: EntregaDinero[];
  totalFueraCentimos: Centimos;
}> {
  const [pedidos, entregas] = await Promise.all([
    listarPedidos(empresaId, registerId, false),
    listarEntregas(empresaId, registerId, false),
  ]);
  const total =
    pedidos.reduce((a, p) => a + p.importeCentimos, 0) +
    entregas.reduce((a, e) => a + e.importeCentimos, 0);
  return { pedidos, entregas, totalFueraCentimos: total };
}

// ── Propuesta ──────────────────────────────────────────────────────────────

/**
 * Consumo por denominación de las últimas jornadas cerradas de la caja.
 *
 * Se miran las salidas de cambio (`CHANGE_GIVEN`), que es lo que de verdad se
 * agota: los pagos a proveedor sacan billetes grandes y no dicen nada sobre la
 * calderilla que hace falta reponer.
 */
export async function historialConsumo(
  registerId: number,
  jornadas = 10
): Promise<HistorialConsumo> {
  const { rows } = await pool.query(
    `WITH ultimas AS (
       SELECT id FROM cash_sessions
        WHERE register_id = $1 AND estado IN ('CLOSED','OPEN','PENDING_CLOSE','REOPENED')
        ORDER BY fecha DESC, id DESC
        LIMIT $2
     )
     SELECT m.valor_unitario_centimos AS valor, SUM(m.cantidad)::int AS piezas,
            COUNT(DISTINCT m.session_id)::int AS jornadas
       FROM cash_denomination_movements m
      WHERE m.session_id IN (SELECT id FROM ultimas)
        AND m.direccion = 'OUT'
        AND m.motivo = 'CHANGE_GIVEN'
      GROUP BY m.valor_unitario_centimos`,
    [registerId, jornadas]
  );

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const consumo = rows.map((r: any) => ({ valor: r.valor, piezas: Number(r.piezas) }));
  const cuantas = rows.reduce((a: number, r: any) => Math.max(a, Number(r.jornadas)), 0);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { jornadas: Math.max(1, cuantas), consumo };
}

export async function proponerPedido(
  sessionId: number,
  registerId: number,
  importeCentimos: Centimos
): Promise<PropuestaPedido & { salida: LineaDenominacion[]; salidaPosible: boolean }> {
  const [stock, historial, denominaciones] = await Promise.all([
    stockTeorico(pool, sessionId),
    historialConsumo(registerId),
    cargarDenominaciones(pool, true),
  ]);

  const propuesta = proponerPedidoCambio(importeCentimos, stock, historial, denominaciones);
  const salida = composicionSalida(importeCentimos, stock);

  return {
    ...propuesta,
    salida: esFallo(salida) ? [] : salida.lineas,
    salidaPosible: !esFallo(salida),
  };
}

// ── Pedidos de cambio ──────────────────────────────────────────────────────

export type EntradaPedido = {
  sessionId: number;
  importeCentimos: Centimos;
  /** Lo que se le pide al banco. Puede llevar cartuchos. */
  solicitado: { valor: Centimos; cantidad: number; cartuchos?: number; motivo?: string }[];
  /** Billetes que salen. Si se omite, se componen con los más grandes. */
  salida?: LineaDenominacion[];
  notas?: string;
};

export async function crearPedido(ctx: Contexto, e: EntradaPedido): Promise<PedidoCambio> {
  if (!Number.isSafeInteger(e.importeCentimos) || e.importeCentimos <= 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "El importe a cambiar tiene que ser mayor que cero.", 400);
  }

  const pedido = await enTransaccion(async (client) => {
    const sesion = await bloquearSesionOperable(client, e.sessionId);
    if (sesion.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }

    // Los billetes que salen: los indicados, o los más grandes que haya.
    let salida = e.salida ?? [];
    if (salida.length === 0) {
      const stock = await stockTeorico(client, e.sessionId);
      const compuesta = composicionSalida(e.importeCentimos, stock);
      if (esFallo(compuesta)) {
        throw new ErrorCaja("COMPOSICION_IMPOSIBLE", compuesta.mensaje, 400);
      }
      salida = compuesta.lineas;
    }

    const totalSalida = totalInventario(inventarioDesdeLineas(salida));
    if (totalSalida !== e.importeCentimos) {
      throw new ErrorCaja(
        "IMPORTE_NO_CUADRA",
        `Los billetes que salen suman ${formatearEuros(totalSalida)} € y el pedido es de ${formatearEuros(e.importeCentimos)} €.`,
        400
      );
    }

    // El dinero sale YA: se registra como una entrega intermedia, con su número
    // y sus asientos, igual que cualquier otra salida de caja.
    const operacion = await registrarOperacion(
      ctx,
      {
        sessionId: e.sessionId,
        tipo: "CASH_DELIVERY",
        importeCentimos: e.importeCentimos,
        formasPago: [{ forma: "CASH", importe: e.importeCentimos }],
        efectivoEntregado: salida,
        concepto: "Cambio al banco",
      },
      client
    );

    const anio = Number(sesion.fecha.slice(0, 4));
    const numero = await siguienteNumeroDe(client, "CB", anio);
    const ahora = Date.now();

    const { rows } = await client.query(
      `INSERT INTO cash_change_orders
         (empresa_id, register_id, numero, estado, importe_centimos,
          session_id_salida, operation_salida_id, notas, creado_por, creado_at_ms)
       VALUES ($1,$2,$3,'PENDIENTE',$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        ctx.empresaId,
        sesion.registerId,
        numero,
        e.importeCentimos,
        e.sessionId,
        operacion.operacionId,
        e.notas ?? null,
        ctx.userId,
        ahora,
      ]
    );
    const id = rows[0].id;

    for (const l of e.solicitado.filter((l) => l.cantidad > 0)) {
      await client.query(
        `INSERT INTO cash_change_order_lines (change_order_id, rol, valor_centimos, cantidad, cartuchos, motivo)
         VALUES ($1,'SOLICITADO',$2,$3,$4,$5)`,
        [id, l.valor, l.cantidad, l.cartuchos ?? 0, l.motivo ?? null]
      );
    }
    for (const l of salida.filter((l) => l.cantidad > 0)) {
      await client.query(
        `INSERT INTO cash_change_order_lines (change_order_id, rol, valor_centimos, cantidad, cartuchos)
         VALUES ($1,'ENVIADO',$2,$3,0)`,
        [id, l.valor, l.cantidad]
      );
    }

    const lineas = await lineasDePedido(client, [id]);
    return aPedido(rows[0], lineas);
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.change_order.create",
    entidad: "cash_change_orders",
    entidadId: String(pedido.id),
    detalle: { numero: pedido.numero, importeCentimos: pedido.importeCentimos },
    ip: ctx.ip,
  });

  return pedido;
}

export type EntradaRecepcion = {
  sessionId: number;
  /** Lo que el banco ha dado de verdad. `cartuchos` son tubos precintados. */
  recibido: { valor: Centimos; cantidad: number; cartuchos?: number }[];
  /** Obligatorio si lo recibido no suma lo que salió. */
  diferenciaMotivo?: string;
};

export async function recibirPedido(
  ctx: Contexto,
  pedidoId: number,
  e: EntradaRecepcion
): Promise<PedidoCambio> {
  const pedido = await enTransaccion(async (client) => {
    const { rows: previas } = await client.query(
      `SELECT * FROM cash_change_orders WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [pedidoId, ctx.empresaId]
    );
    if (previas.length === 0) {
      throw new ErrorCaja("PEDIDO_NO_ENCONTRADO", "El pedido de cambio no existe.", 404);
    }
    const previo = previas[0];
    if (previo.estado !== "PENDIENTE") {
      throw new ErrorCaja(
        "PEDIDO_YA_CERRADO",
        `El pedido ${previo.numero} ya está ${previo.estado.toLowerCase()}.`,
        409
      );
    }

    const sesion = await bloquearSesionOperable(client, e.sessionId);
    if (sesion.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }

    const denominaciones = await cargarDenominaciones(client);
    const porCartucho = piezasPorCartuchoDe(denominaciones);

    // Un tubo son N monedas: se convierte a piezas para el asiento, sin fundir
    // las líneas, para que el libro mayor sepa que entró precintado.
    const sueltas: LineaDenominacion[] = [];
    const tubos: LineaDenominacion[] = [];
    for (const l of e.recibido) {
      if (l.cantidad <= 0) continue;
      if (l.cartuchos && l.cartuchos > 0) tubos.push({ valor: l.valor, cantidad: l.cartuchos });
      else sueltas.push({ valor: l.valor, cantidad: l.cantidad });
    }

    const totalTubos = tubos.reduce(
      (a, t) => a + t.cantidad * (porCartucho.get(t.valor) ?? 0) * t.valor,
      0
    );
    const totalRecibido = totalInventario(inventarioDesdeLineas(sueltas)) + totalTubos;
    if (totalRecibido <= 0) {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", "Hay que contar lo que ha dado el banco.", 400);
    }

    const esperado = Number(previo.importe_centimos);
    if (totalRecibido !== esperado && !String(e.diferenciaMotivo ?? "").trim()) {
      throw new ErrorCaja(
        "DIFERENCIA_SIN_MOTIVO",
        `Salieron ${formatearEuros(esperado)} € y han vuelto ${formatearEuros(totalRecibido)} €. Explica la diferencia antes de validar.`,
        400
      );
    }

    const operacion = await registrarOperacion(
      ctx,
      {
        sessionId: e.sessionId,
        tipo: "MANUAL_IN",
        importeCentimos: totalRecibido,
        formasPago: [{ forma: "CASH", importe: totalRecibido }],
        efectivoRecibido: sueltas,
        cartuchosRecibidos: tubos,
        concepto: `Cambio recibido del banco (${previo.numero})`,
      },
      client
    );

    const { rows } = await client.query(
      `UPDATE cash_change_orders
          SET estado = 'RECIBIDO', importe_recibido_centimos = $2, diferencia_motivo = $3,
              session_id_entrada = $4, operation_entrada_id = $5,
              cerrado_por = $6, cerrado_at_ms = $7
        WHERE id = $1
        RETURNING *`,
      [
        pedidoId,
        totalRecibido,
        totalRecibido === esperado ? null : (e.diferenciaMotivo ?? "").trim(),
        e.sessionId,
        operacion.operacionId,
        ctx.userId,
        Date.now(),
      ]
    );

    for (const l of e.recibido.filter((l) => l.cantidad > 0)) {
      await client.query(
        `INSERT INTO cash_change_order_lines (change_order_id, rol, valor_centimos, cantidad, cartuchos)
         VALUES ($1,'RECIBIDO',$2,$3,$4)`,
        [pedidoId, l.valor, l.cantidad, l.cartuchos ?? 0]
      );
    }

    const lineas = await lineasDePedido(client, [pedidoId]);
    return aPedido(rows[0], lineas);
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.change_order.receive",
    entidad: "cash_change_orders",
    entidadId: String(pedido.id),
    detalle: {
      numero: pedido.numero,
      esperadoCentimos: pedido.importeCentimos,
      recibidoCentimos: pedido.importeRecibidoCentimos,
      diferenciaMotivo: pedido.diferenciaMotivo,
    },
    ip: ctx.ip,
  });

  return pedido;
}

/** Cancela un pedido pendiente y devuelve el dinero a la caja tal y como salió. */
export async function cancelarPedido(
  ctx: Contexto,
  pedidoId: number,
  sessionId: number,
  motivo: string
): Promise<PedidoCambio> {
  if (!String(motivo ?? "").trim()) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Hay que decir por qué se cancela.", 400);
  }

  const pedido = await enTransaccion(async (client) => {
    const { rows: previas } = await client.query(
      `SELECT * FROM cash_change_orders WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [pedidoId, ctx.empresaId]
    );
    if (previas.length === 0) {
      throw new ErrorCaja("PEDIDO_NO_ENCONTRADO", "El pedido de cambio no existe.", 404);
    }
    if (previas[0].estado !== "PENDIENTE") {
      throw new ErrorCaja("PEDIDO_YA_CERRADO", "El pedido ya está cerrado.", 409);
    }

    const sesion = await bloquearSesionOperable(client, sessionId);
    if (sesion.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }

    const lineas = await lineasDePedido(client, [pedidoId]);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const enviado = lineas
      .filter((l: any) => l.rol === "ENVIADO")
      .map((l: any) => ({ valor: l.valor_centimos, cantidad: l.cantidad }));
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const total = totalInventario(inventarioDesdeLineas(enviado));
    const operacion = await registrarOperacion(
      ctx,
      {
        sessionId,
        tipo: "MANUAL_IN",
        importeCentimos: total,
        formasPago: [{ forma: "CASH", importe: total }],
        efectivoRecibido: enviado,
        concepto: `Cambio no llevado al banco (${previas[0].numero})`,
      },
      client
    );

    const { rows } = await client.query(
      `UPDATE cash_change_orders
          SET estado = 'CANCELADO', diferencia_motivo = $2, session_id_entrada = $3,
              operation_entrada_id = $4, cerrado_por = $5, cerrado_at_ms = $6
        WHERE id = $1
        RETURNING *`,
      [pedidoId, motivo.trim(), sessionId, operacion.operacionId, ctx.userId, Date.now()]
    );
    return aPedido(rows[0], await lineasDePedido(client, [pedidoId]));
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.change_order.cancel",
    entidad: "cash_change_orders",
    entidadId: String(pedido.id),
    detalle: { numero: pedido.numero, motivo },
    ip: ctx.ip,
  });

  return pedido;
}

// ── Entregas de dinero ─────────────────────────────────────────────────────

export type EntradaEntrega = {
  sessionId: number;
  persona: string;
  motivo: string;
  importeCentimos: Centimos;
  /** Piezas que se le dan. Si se omite, se componen con el stock. */
  entregado?: LineaDenominacion[];
  notas?: string;
};

export async function entregarDinero(
  ctx: Contexto,
  e: EntradaEntrega
): Promise<EntregaDinero> {
  const persona = String(e.persona ?? "").trim();
  const motivo = String(e.motivo ?? "").trim();
  if (!persona) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Hay que decir a quién se le entrega el dinero.", 400);
  }
  if (!motivo) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Hay que decir para qué es la entrega.", 400);
  }
  if (!Number.isSafeInteger(e.importeCentimos) || e.importeCentimos <= 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "El importe tiene que ser mayor que cero.", 400);
  }

  const entrega = await enTransaccion(async (client) => {
    const sesion = await bloquearSesionOperable(client, e.sessionId);
    if (sesion.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }

    const entregado = e.entregado ?? [];
    if (entregado.length === 0) {
      throw new ErrorCaja(
        "FALTA_DETALLE_DENOMINACIONES",
        "Hay que indicar exactamente qué billetes y monedas se le dan.",
        400
      );
    }

    const operacion = await registrarOperacion(
      ctx,
      {
        sessionId: e.sessionId,
        tipo: "CASH_DELIVERY",
        importeCentimos: e.importeCentimos,
        formasPago: [{ forma: "CASH", importe: e.importeCentimos }],
        efectivoEntregado: entregado,
        partyNombre: persona,
        concepto: motivo,
      },
      client
    );

    const anio = Number(sesion.fecha.slice(0, 4));
    const numero = await siguienteNumeroDe(client, "EN", anio);

    const { rows } = await client.query(
      `INSERT INTO cash_advances
         (empresa_id, register_id, numero, estado, persona, motivo, importe_centimos,
          session_id_entrega, operation_entrega_id, notas, creado_por, creado_at_ms)
       VALUES ($1,$2,$3,'ABIERTA',$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        ctx.empresaId,
        sesion.registerId,
        numero,
        persona,
        motivo,
        e.importeCentimos,
        e.sessionId,
        operacion.operacionId,
        e.notas ?? null,
        ctx.userId,
        Date.now(),
      ]
    );
    return aEntrega(rows[0], entregado);
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.advance.create",
    entidad: "cash_advances",
    entidadId: String(entrega.id),
    detalle: {
      numero: entrega.numero,
      persona: entrega.persona,
      motivo: entrega.motivo,
      importeCentimos: entrega.importeCentimos,
    },
    ip: ctx.ip,
  });

  return entrega;
}

export type EntradaLiquidacion = {
  sessionId: number;
  /** Lo que dice la factura. 0 si no compró nada. */
  gastoCentimos: Centimos;
  /** Piezas que devuelve. Vacío si se lo gastó todo. */
  devuelto?: LineaDenominacion[];
  proveedor?: string;
  facturaReferencia?: string;
  concepto?: string;
  /** Obligatorio si entregado − gastado ≠ devuelto. */
  diferenciaMotivo?: string;
};

/**
 * Cierra una entrega: registra el pago real y recoge la vuelta.
 *
 * El pago que queda en el listado es el de la factura —40 € en el ejemplo del
 * encargo— y **no mueve piezas**: las piezas salieron al entregar los 50 €.
 * Lo único que entra aquí es lo que el empleado trae de vuelta.
 *
 * Si entregado − gastado ≠ devuelto, falta dinero. No se bloquea —el dinero ya
 * no está, negarse a registrarlo solo esconde el problema— pero se exige un
 * motivo y queda auditado con el nombre de quien lo recibió.
 */
export async function liquidarEntrega(
  ctx: Contexto,
  entregaId: number,
  e: EntradaLiquidacion
): Promise<EntregaDinero> {
  const entrega = await enTransaccion(async (client) => {
    const { rows: previas } = await client.query(
      `SELECT * FROM cash_advances WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [entregaId, ctx.empresaId]
    );
    if (previas.length === 0) {
      throw new ErrorCaja("ENTREGA_NO_ENCONTRADA", "La entrega no existe.", 404);
    }
    const previa = previas[0];
    if (previa.estado !== "ABIERTA") {
      throw new ErrorCaja(
        "ENTREGA_YA_CERRADA",
        `La entrega ${previa.numero} ya está ${previa.estado.toLowerCase()}.`,
        409
      );
    }

    const sesion = await bloquearSesionOperable(client, e.sessionId);
    if (sesion.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }

    const entregado = Number(previa.importe_centimos);
    const gasto = e.gastoCentimos ?? 0;
    if (!Number.isSafeInteger(gasto) || gasto < 0) {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", "El gasto tiene que ser un importe válido.", 400);
    }
    if (gasto > entregado) {
      throw new ErrorCaja(
        "GASTO_SUPERA_ENTREGA",
        `Se entregaron ${formatearEuros(entregado)} € y la factura es de ${formatearEuros(gasto)} €. Registra la diferencia como un pago aparte.`,
        400
      );
    }

    const devuelto = (e.devuelto ?? []).filter((l) => l.cantidad > 0);
    const totalDevuelto = totalInventario(inventarioDesdeLineas(devuelto));
    const diferencia = entregado - gasto - totalDevuelto;

    if (diferencia !== 0 && !String(e.diferenciaMotivo ?? "").trim()) {
      throw new ErrorCaja(
        "DIFERENCIA_SIN_MOTIVO",
        `Se entregaron ${formatearEuros(entregado)} €, la factura es de ${formatearEuros(gasto)} € y vuelven ${formatearEuros(totalDevuelto)} €: ${formatearEuros(Math.abs(diferencia))} € sin explicar. Indica el motivo antes de cerrar.`,
        400
      );
    }

    // 1. Entra la vuelta, si la hay.
    let devolucionId: number | null = null;
    if (totalDevuelto > 0) {
      const op = await registrarOperacion(
        ctx,
        {
          sessionId: e.sessionId,
          tipo: "MANUAL_IN",
          importeCentimos: totalDevuelto,
          formasPago: [{ forma: "CASH", importe: totalDevuelto }],
          efectivoRecibido: devuelto,
          partyNombre: previa.persona,
          concepto: `Vuelta de ${previa.persona} (${previa.numero})`,
        },
        client
      );
      devolucionId = op.operacionId;
    }

    // 2. El pago real. Sin piezas: ya salieron con la entrega. Se marca como
    //    liquidación para que el motor no exija el detalle de denominaciones.
    let pagoId: number | null = null;
    if (gasto > 0) {
      const op = await registrarOperacion(
        ctx,
        {
          sessionId: e.sessionId,
          tipo: "PAYMENT",
          importeCentimos: gasto,
          formasPago: [{ forma: "CASH", importe: gasto }],
          liquidaEntregaId: entregaId,
          partyNombre: e.proveedor || previa.persona,
          concepto: e.concepto || previa.motivo,
          referencia: e.facturaReferencia ?? null,
        },
        client
      );
      pagoId = op.operacionId;
    }

    const estado = gasto > 0 ? "LIQUIDADA" : "DEVUELTA";
    const { rows } = await client.query(
      `UPDATE cash_advances
          SET estado = $2, gasto_centimos = $3, devuelto_centimos = $4,
              diferencia_centimos = $5, diferencia_motivo = $6,
              factura_referencia = $7, proveedor = $8,
              session_id_liquidacion = $9, operation_devolucion_id = $10,
              operation_pago_id = $11, cerrado_por = $12, cerrado_at_ms = $13
        WHERE id = $1
        RETURNING *`,
      [
        entregaId,
        estado,
        gasto,
        totalDevuelto,
        diferencia,
        diferencia === 0 ? null : (e.diferenciaMotivo ?? "").trim(),
        e.facturaReferencia ?? null,
        e.proveedor ?? null,
        e.sessionId,
        devolucionId,
        pagoId,
        ctx.userId,
        Date.now(),
      ]
    );
    return aEntrega(rows[0]);
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.advance.settle",
    entidad: "cash_advances",
    entidadId: String(entrega.id),
    detalle: {
      numero: entrega.numero,
      persona: entrega.persona,
      entregadoCentimos: entrega.importeCentimos,
      gastoCentimos: entrega.gastoCentimos,
      devueltoCentimos: entrega.devueltoCentimos,
      diferenciaCentimos: entrega.diferenciaCentimos,
      diferenciaMotivo: entrega.diferenciaMotivo,
    },
    ip: ctx.ip,
  });

  return entrega;
}
