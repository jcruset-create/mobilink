/**
 * Casos de uso de Mobilink Cash.
 *
 * Aquí es donde se cumple la promesa del módulo: **una operación de caja y sus
 * movimientos de piezas se guardan juntos o no se guarda nada**. Todo lo que
 * mueve efectivo sigue la misma secuencia:
 *
 *     BEGIN
 *       bloquear la jornada        ← serializa esta caja
 *       leer el stock teórico      ← ya nadie lo puede cambiar
 *       validar con el motor       ← la palabra definitiva sobre disponibilidad
 *       insertar operación
 *       insertar formas de pago
 *       insertar movimientos de denominaciones
 *       insertar evento de outbox  ← misma transacción, por eso no se pierde
 *     COMMIT
 *
 * La validación del navegador es comodidad; la que cuenta es ésta, con la fila
 * bloqueada. Dos terminales que intenten gastar el último billete de 50 € no
 * pueden colarse los dos: el segundo espera al COMMIT del primero, vuelve a
 * leer el stock y falla con STOCK_INSUFICIENTE.
 *
 * El origen de la operación (MANUAL o ERP) no cambia NADA de este flujo. Es el
 * mismo motor: lo único que aporta la ERP es de dónde salen el importe y el
 * nombre del cliente, y que al final haya algo que comunicar.
 */

import type { PoolClient } from "pg";
import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import type { Centimos } from "./domain/money.ts";
import { formatearEuros } from "./domain/money.ts";
import {
  type Inventario,
  type LineaDenominacion,
  inventarioDesdeLineas,
  lineasDesdeInventario,
  totalInventario,
  totalPiezas,
} from "./domain/inventory.ts";
import {
  type FormaPago,
  type OperacionNormalizada,
  type OrigenOperacion,
  type TipoOperacion,
  importeEnEfectivo,
  validarOperacion,
} from "./domain/operations.ts";
import { calcularCambio, validarCambioManual, type ResultadoCambio } from "./domain/change.ts";
import {
  aperturasNecesarias,
  calcularCambioConCartuchos,
  type AperturaCartucho,
} from "./domain/cartridges.ts";
import { esFallo } from "./domain/result.ts";
import { compararArqueo, proponerCambioFinal, repartirCierre, type ResultadoArqueo } from "./domain/arqueo.ts";
import {
  ErrorCaja,
  type Sesion,
  bloquearSesion,
  bloquearSesionOperable,
  cargarDenominaciones,
  enTransaccion,
  formasPagoDeOperacion,
  insertarFormasPago,
  piezasPorCartuchoDe,
  stockPorFormato,
  insertarMovimientos,
  insertarOperacion,
  movimientosDeOperacion,
  obtenerOperacion,
  obtenerSesion,
  operacionesDeSesion,
  sesionAbierta,
  siguienteNumero,
  stockTeorico,
  ultimaSesionCerrada,
} from "./repository.ts";
import { conectorPara } from "./erp/registry.ts";

export type Contexto = {
  empresaId: string;
  userId: string | null;
  ip?: string;
};

// ── Apertura de jornada ────────────────────────────────────────────────────

export type EntradaApertura = {
  registerId: number;
  /**
   * Composición del fondo inicial cuando NO se hereda (primera jornada de la
   * caja, o corrección manual). Si se omite y hay cierre anterior, se hereda.
   */
  fondoManual?: LineaDenominacion[];
  /** Tubos precintados del fondo inicial: `cantidad` son tubos, no monedas. */
  fondoCartuchos?: LineaDenominacion[];
  motivoFondoManual?: string;
  fecha?: string;
  notas?: string;
};

/**
 * Abre una jornada.
 *
 * Lo importante: el fondo inicial no es un importe, es una COMPOSICIÓN. Se
 * recupera la del cambio final de la última jornada cerrada, pieza a pieza.
 * Copiar solo los 300 € y no saber que eran 2 de 50 + 5 de 20 + … dejaría la
 * caja del día siguiente sin poder dar cambio y sin forma de detectarlo.
 */
export async function abrirJornada(ctx: Contexto, e: EntradaApertura): Promise<{ sesion: Sesion; stock: LineaDenominacion[] }> {
  const resultado = await enTransaccion(async (client) => {
    const abierta = await sesionAbierta(e.registerId, client);
    if (abierta) {
      throw new ErrorCaja(
        "JORNADA_YA_ABIERTA",
        `La caja ya tiene la jornada ${abierta.id} abierta. Ciérrala antes de abrir otra.`,
        409
      );
    }

    const { rows: cajas } = await client.query(
      `SELECT id FROM cash_registers WHERE id = $1 AND empresa_id = $2 AND activa = true`,
      [e.registerId, ctx.empresaId]
    );
    if (cajas.length === 0) {
      throw new ErrorCaja("CAJA_NO_ENCONTRADA", "La caja no existe o no está activa.", 404);
    }

    const anterior = await ultimaSesionCerrada(client, e.registerId);
    const denominaciones = await cargarDenominaciones(client);
    const ahora = Date.now();
    const fecha = e.fecha ?? new Date(ahora).toISOString().slice(0, 10);

    // Composición heredada: las piezas que el cierre anterior dejó en caja.
    let composicion: LineaDenominacion[] = [];
    let cartuchos: LineaDenominacion[] = [];
    let heredado = false;

    if (anterior) {
      const { rows } = await client.query(
        `SELECT valor_unitario_centimos,
                SUM(CASE WHEN cartuchos = 0 THEN cantidad ELSE 0 END) AS sueltas,
                SUM(cartuchos) AS tubos
           FROM cash_denomination_movements
          WHERE session_id = $1 AND motivo = 'CLOSING_FLOAT' AND direccion = 'OUT'
          GROUP BY valor_unitario_centimos`,
        [anterior.id]
      );
      composicion = rows
        .map((r: { valor_unitario_centimos: number; sueltas: string }) => ({
          valor: r.valor_unitario_centimos,
          cantidad: Number(r.sueltas),
        }))
        .filter((l) => l.cantidad > 0);
      // Un tubo que quedó precintado ayer sigue precintado hoy.
      cartuchos = rows
        .map((r: { valor_unitario_centimos: number; tubos: string }) => ({
          valor: r.valor_unitario_centimos,
          cantidad: Number(r.tubos),
        }))
        .filter((l) => l.cantidad > 0);
      heredado = composicion.length > 0 || cartuchos.length > 0;
    }

    if (!heredado) {
      // Sin cierre anterior (o con cambio final vacío) se introduce a mano.
      composicion = (e.fondoManual ?? []).filter((l) => l.cantidad > 0);
      cartuchos = (e.fondoCartuchos ?? []).filter((l) => l.cantidad > 0);
    } else if ((e.fondoManual && e.fondoManual.length > 0) || (e.fondoCartuchos && e.fondoCartuchos.length > 0)) {
      // Se ha heredado PERO alguien lo corrige: es exactamente el caso que el
      // encargo pide auditar, porque cambia el punto de partida del día.
      composicion = (e.fondoManual ?? []).filter((l) => l.cantidad > 0);
      cartuchos = (e.fondoCartuchos ?? []).filter((l) => l.cantidad > 0);
      heredado = false;
    }

    const porCartucho = piezasPorCartuchoDe(denominaciones);
    // Las líneas de tubos se guardan como piezas (tubos × piezas del tubo) con
    // su contador de cartuchos: así el total de piezas no necesita casos aparte.
    const lineasCartucho = cartuchos.map((c) => {
      const n = porCartucho.get(c.valor) ?? 0;
      if (n <= 0) {
        throw new ErrorCaja(
          "CARTUCHO_NO_CONFIGURADO",
          `La denominación de ${c.valor} céntimos no tiene cartuchos configurados.`,
          400
        );
      }
      return { valor: c.valor, cantidad: c.cantidad * n, cartuchos: c.cantidad };
    });

    const inventarioInicial = inventarioDesdeLineas([...composicion, ...lineasCartucho]);
    const fondo = totalInventario(inventarioInicial);

    const { rows: creada } = await client.query(
      `INSERT INTO cash_sessions
         (empresa_id, register_id, fecha, estado, abierta_por, abierta_at_ms,
          fondo_inicial_centimos, fondo_inicial_heredado, sesion_anterior_id, notas,
          created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,'OPEN',$4,$5,$6,$7,$8,$9,$5,$5)
       RETURNING id`,
      [
        ctx.empresaId,
        e.registerId,
        fecha,
        ctx.userId,
        ahora,
        fondo,
        heredado,
        anterior?.id ?? null,
        e.notas ?? null,
      ]
    );
    const sessionId = creada[0].id as number;

    if (composicion.length > 0 || lineasCartucho.length > 0) {
      // El fondo inicial también es una operación con sus piezas: así el libro
      // mayor cuadra desde el primer asiento y el stock se reconstruye entero
      // sumando movimientos, sin ningún caso especial.
      const numero = await siguienteNumero(client, "OPENING_FLOAT", Number(fecha.slice(0, 4)));
      const opId = await insertarOperacion(client, {
        empresaId: ctx.empresaId,
        sessionId,
        numero,
        tipo: "OPENING_FLOAT",
        origen: "MANUAL",
        concepto: heredado ? "Cambio heredado del cierre anterior" : "Fondo inicial introducido a mano",
        importeCentimos: fondo,
        efectivoNetoCentimos: fondo,
        erpSyncStatus: "NOT_APPLICABLE",
        userId: ctx.userId,
        ahora,
      });
      await insertarMovimientos(client, {
        sessionId,
        operationId: opId,
        movimientos: [
          { direccion: "IN", motivo: "OPENING_FLOAT", lineas: [...composicion, ...lineasCartucho] },
        ],
        denominaciones,
        userId: ctx.userId,
        ahora,
      });
    }

    const sesion = (await obtenerSesion(sessionId, client))!;
    return { sesion, stock: lineasDesdeInventario(inventarioInicial), heredado, fondo };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.session.open",
    entidad: "cash_sessions",
    entidadId: String(resultado.sesion.id),
    detalle: {
      registerId: e.registerId,
      fondoCentimos: resultado.fondo,
      heredado: resultado.heredado,
      motivoFondoManual: e.motivoFondoManual ?? null,
      composicion: resultado.stock,
    },
    ip: ctx.ip,
  });

  return { sesion: resultado.sesion, stock: resultado.stock };
}

// ── Consulta de stock y propuesta de cambio ────────────────────────────────

export async function stockDeJornada(sessionId: number): Promise<{
  lineas: LineaDenominacion[];
  sueltas: LineaDenominacion[];
  cartuchos: LineaDenominacion[];
  totalCentimos: Centimos;
  piezas: number;
}> {
  const [inv, porFormato] = await Promise.all([
    stockTeorico(pool, sessionId),
    stockPorFormato(pool, sessionId),
  ]);
  return {
    lineas: lineasDesdeInventario(inv),
    sueltas: lineasDesdeInventario(porFormato.sueltas),
    cartuchos: lineasDesdeInventario(porFormato.cartuchos),
    totalCentimos: totalInventario(inv),
    piezas: totalPiezas(inv),
  };
}

/**
 * Propone cómo devolver un cambio con el stock actual.
 *
 * Es una consulta, no reserva nada: entre la propuesta y la confirmación el
 * stock puede cambiar, y por eso la confirmación vuelve a validar con la
 * jornada bloqueada.
 */
export async function proponerCambio(sessionId: number, importe: Centimos) {
  const [stock, denominaciones] = await Promise.all([
    stockPorFormato(pool, sessionId),
    cargarDenominaciones(pool),
  ]);
  return calcularCambioConCartuchos(importe, stock, piezasPorCartuchoDe(denominaciones));
}

// ── Operaciones que mueven efectivo ────────────────────────────────────────

export type EntradaOperacion = {
  sessionId: number;
  tipo: TipoOperacion;
  origen?: OrigenOperacion;
  importeCentimos: Centimos;
  formasPago: { forma: FormaPago; importe: Centimos; referencia?: string | null }[];
  efectivoRecibido?: LineaDenominacion[];
  efectivoEntregado?: LineaDenominacion[];
  partyNombre?: string;
  concepto?: string;
  referencia?: string | null;
  /** Documento de la ERP, si la operación viene de una. */
  documentoId?: number | null;
  externalSystem?: string | null;
  externalDocumentId?: string | null;
  externalDocumentReference?: string | null;
};

export type ResultadoOperacion = {
  operacionId: number;
  numero: string;
  efectivoNetoCentimos: Centimos;
  stock: LineaDenominacion[];
  totalStockCentimos: Centimos;
  erpSyncStatus: string;
  /** Cartuchos que ha habido que abrir para poder entregar. */
  aperturas: AperturaCartucho[];
};

/**
 * Registra una operación de caja completa.
 *
 * Único punto de entrada para cobros, pagos, ingresos, salidas, entregas,
 * ingresos bancarios y ajustes. Todos comparten motor, transacción y auditoría;
 * lo que cambia entre ellos es el tipo, y el tipo lo interpreta el dominio.
 */
export async function registrarOperacion(
  ctx: Contexto,
  e: EntradaOperacion
): Promise<ResultadoOperacion> {
  const origen = e.origen ?? "MANUAL";

  const resultado = await enTransaccion(async (client) => {
    const sesion = await bloquearSesionOperable(client, e.sessionId);
    if (sesion.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }

    // Stock leído con la jornada ya bloqueada: es el bueno hasta el COMMIT.
    const stock = await stockTeorico(client, e.sessionId);
    const denominaciones = await cargarDenominaciones(client);

    const normalizada: OperacionNormalizada = {
      tipo: e.tipo,
      origen,
      importe: e.importeCentimos,
      formasPago: e.formasPago,
      efectivoRecibido: e.efectivoRecibido,
      efectivoEntregado: e.efectivoEntregado,
    };

    const validacion = validarOperacion(normalizada, stock);
    if (esFallo(validacion)) {
      throw new ErrorCaja(validacion.codigo, validacion.mensaje, 400);
    }

    const ahora = Date.now();
    const anio = Number(sesion.fecha.slice(0, 4));
    const numero = await siguienteNumero(client, e.tipo, anio);

    // ¿Hay que avisar a la ERP? Solo si la operación viene de un documento
    // externo y hay integración activa. En modo autónomo esto es NOT_APPLICABLE
    // y no se crea ningún evento: no hay nada que sincronizar.
    const { conector } = await conectorPara(ctx.empresaId);
    const sincronizable =
      Boolean(e.externalDocumentId) &&
      Boolean(conector) &&
      (e.tipo === "COLLECTION" || e.tipo === "PAYMENT");
    const erpSyncStatus = sincronizable ? "PENDING" : "NOT_APPLICABLE";

    const operacionId = await insertarOperacion(client, {
      empresaId: ctx.empresaId,
      sessionId: e.sessionId,
      numero,
      tipo: e.tipo,
      origen,
      externalSystem: e.externalSystem ?? null,
      externalDocumentId: e.externalDocumentId ?? null,
      externalDocumentReference: e.externalDocumentReference ?? null,
      documentoId: e.documentoId ?? null,
      partyNombre: e.partyNombre ?? "",
      concepto: e.concepto ?? "",
      referencia: e.referencia ?? null,
      importeCentimos: e.importeCentimos,
      efectivoNetoCentimos: validacion.efectivoNeto,
      erpSyncStatus,
      userId: ctx.userId,
      ahora,
    });

    await insertarFormasPago(client, operacionId, e.formasPago, ahora);

    /*
     * Cartuchos. Si lo que sale de caja no cabe en las monedas sueltas, hay que
     * abrir tubos. Se asienta ANTES de la salida y con su propio motivo: sale
     * el tubo y entran sus monedas sueltas, valor neto cero. Así el libro mayor
     * refleja que el precinto se rompió —que es irreversible— y el operador ve
     * en el histórico por qué de pronto había 25 monedas más.
     */
    const aperturas = await abrirCartuchosSiHaceFalta(client, {
      sessionId: e.sessionId,
      operationId: operacionId,
      salidas: validacion.movimientos.filter((m) => m.direccion === "OUT"),
      denominaciones,
      userId: ctx.userId,
      ahora,
    });

    await insertarMovimientos(client, {
      sessionId: e.sessionId,
      operationId: operacionId,
      movimientos: validacion.movimientos,
      denominaciones,
      userId: ctx.userId,
      ahora,
    });

    if (sincronizable) {
      await encolarEventoErp(client, {
        empresaId: ctx.empresaId,
        operationId: operacionId,
        connectorKey: conector!.info.key,
        evento: e.tipo === "COLLECTION" ? "COLLECTION_COMPLETED" : "PAYMENT_COMPLETED",
        idempotencyKey: numero,
        payload: {
          externalSystem: e.externalSystem,
          externalDocumentId: e.externalDocumentId,
          operacionNumero: numero,
          importeCentimos: e.importeCentimos,
          fechaIso: new Date(ahora).toISOString(),
          formasPago: e.formasPago.map((f) => ({
            forma: f.forma,
            importeCentimos: f.importe,
            referencia: f.referencia ?? null,
          })),
        },
        ahora,
      });
    }

    // Actualiza el pendiente del documento local. La ERP sigue siendo la fuente
    // autoritativa; esto es la copia operativa, y si luego la ERP dice otra cosa
    // se verá en el panel de integración en vez de corregirse en silencio.
    if (e.documentoId) {
      await client.query(
        `UPDATE cash_external_documents
            SET pendiente_centimos = GREATEST(0, pendiente_centimos - $2),
                estado = CASE
                  WHEN pendiente_centimos - $2 <= 0 THEN 'PAID'
                  ELSE 'PARTIALLY_PAID' END,
                updated_at_ms = $3
          WHERE id = $1`,
        [e.documentoId, e.importeCentimos, ahora]
      );
    }

    const stockFinal = await stockTeorico(client, e.sessionId);

    return {
      operacionId,
      numero,
      efectivoNetoCentimos: validacion.efectivoNeto,
      stock: lineasDesdeInventario(stockFinal),
      totalStockCentimos: totalInventario(stockFinal),
      erpSyncStatus,
      aperturas,
    };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: `cash.operation.${e.tipo.toLowerCase()}`,
    entidad: "cash_operations",
    entidadId: String(resultado.operacionId),
    detalle: {
      numero: resultado.numero,
      origen,
      importeCentimos: e.importeCentimos,
      efectivoCentimos: importeEnEfectivo(e.formasPago),
      formasPago: e.formasPago,
      recibido: e.efectivoRecibido ?? [],
      entregado: e.efectivoEntregado ?? [],
      externalDocumentId: e.externalDocumentId ?? null,
    },
    ip: ctx.ip,
  });

  return resultado;
}

/**
 * Cobro con cambio calculado por el sistema o indicado a mano.
 *
 * Envoltorio cómodo sobre `registrarOperacion` que resuelve el cambio con el
 * stock bloqueado, para que la interfaz no tenga que hacer dos viajes ni fiarse
 * de la propuesta que vio hace treinta segundos.
 */
export type EntradaCobro = Omit<EntradaOperacion, "tipo" | "efectivoEntregado"> & {
  /** Si se omite, el sistema calcula el cambio con el stock del momento. */
  cambioManual?: LineaDenominacion[];
};

export async function registrarCobro(ctx: Contexto, e: EntradaCobro): Promise<ResultadoOperacion> {
  const efectivo = importeEnEfectivo(e.formasPago);
  const recibido = totalInventario(inventarioDesdeLineas(e.efectivoRecibido ?? []));
  const cambioRequerido = recibido - efectivo;

  if (efectivo > 0 && cambioRequerido < 0) {
    throw new ErrorCaja(
      "EFECTIVO_INSUFICIENTE",
      `El cliente entrega ${formatearEuros(recibido)} € y la parte en efectivo es de ${formatearEuros(efectivo)} €.`,
      400
    );
  }

  let cambio: LineaDenominacion[] = [];

  if (cambioRequerido > 0) {
    if (e.cambioManual && e.cambioManual.length > 0) {
      cambio = e.cambioManual;
    } else {
      // Se resuelve contra el stock actual MÁS lo que entrega el cliente:
      // devolver uno de los billetes que acaba de dar es perfectamente legítimo
      // y no hacerlo dejaría cambios imposibles que en la práctica sí lo son.
      const stock = await stockTeorico(pool, e.sessionId);
      const disponible = new Map(stock);
      for (const l of e.efectivoRecibido ?? []) {
        disponible.set(l.valor, (disponible.get(l.valor) ?? 0) + l.cantidad);
      }
      const propuesta = calcularCambio(cambioRequerido, disponible);
      if (esFallo(propuesta)) {
        throw new ErrorCaja(
          propuesta.motivo,
          propuesta.mensaje,
          propuesta.motivo === "NO_SOLUTION" ? 409 : 400
        );
      }
      cambio = propuesta.lineas;
    }
  }

  return registrarOperacion(ctx, { ...e, tipo: "COLLECTION", efectivoEntregado: cambio });
}

// ── Arqueo ─────────────────────────────────────────────────────────────────

export type EntradaArqueo = {
  sessionId: number;
  /** Piezas sueltas contadas por denominación. */
  contado: LineaDenominacion[];
  /** Cartuchos contados aparte; se convierten a piezas con el catálogo. */
  cartuchos?: { valor: Centimos; cantidad: number }[];
  tipo?: "INTERMEDIATE" | "CLOSING";
  notas?: string;
};

export type ResultadoArqueoGuardado = ResultadoArqueo & { arqueoId: number };

/**
 * Guarda un arqueo y devuelve el doble cuadre.
 *
 * No cierra la jornada: se puede arquear tantas veces como haga falta. El
 * cierre es un paso aparte y usa el último arqueo.
 */
export async function guardarArqueo(
  ctx: Contexto,
  e: EntradaArqueo
): Promise<ResultadoArqueoGuardado> {
  const resultado = await enTransaccion(async (client) => {
    const sesion = await bloquearSesion(client, e.sessionId);
    if (sesion.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }
    if (sesion.estado === "CLOSED" || sesion.estado === "CANCELLED") {
      throw new ErrorCaja("JORNADA_CERRADA", "La jornada ya está cerrada.", 409);
    }

    const denominaciones = await cargarDenominaciones(client);
    const porValor = new Map(denominaciones.map((d) => [d.valor, d]));

    /*
     * Los cartuchos se cuentan aparte y se GUARDAN aparte: `cantidad_contada`
     * son monedas sueltas y `cartuchos_contados` son tubos precintados. La
     * comparación con el teórico sí se hace en piezas —un tubo se puede abrir,
     * así que sus monedas cuentan— pero el formato no se pierde, y por eso un
     * tubo que se cuenta cerrado al cerrar sigue cerrado mañana.
     */
    const lineas: LineaDenominacion[] = [...e.contado];
    for (const c of e.cartuchos ?? []) {
      const d = porValor.get(c.valor);
      if (!d || d.piezasPorCartucho == null) {
        throw new ErrorCaja(
          "CARTUCHO_NO_CONFIGURADO",
          `La denominación de ${c.valor} céntimos no tiene cartuchos configurados.`,
          400
        );
      }
      lineas.push({ valor: c.valor, cantidad: c.cantidad * d.piezasPorCartucho });
    }

    // Sueltas contadas, para guardarlas sin mezclar con las de los tubos.
    const sueltasContadas = new Map<Centimos, number>();
    for (const l of e.contado) {
      if (l.cantidad > 0) sueltasContadas.set(l.valor, (sueltasContadas.get(l.valor) ?? 0) + l.cantidad);
    }

    const contado = inventarioDesdeLineas(lineas);
    const teorico = await stockTeorico(client, e.sessionId);
    const comparacion = compararArqueo(teorico, contado);
    const ahora = Date.now();

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO cash_counts
         (session_id, tipo, teorico_centimos, contado_centimos, diferencia_centimos,
          denominaciones_cuadran, piezas_teoricas, piezas_contadas, notas, created_by, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        e.sessionId,
        e.tipo ?? "CLOSING",
        comparacion.totalTeorico,
        comparacion.totalContado,
        comparacion.diferencia,
        comparacion.cuadranDenominaciones,
        comparacion.piezasTeoricas,
        comparacion.piezasContadas,
        e.notas ?? null,
        ctx.userId,
        ahora,
      ]
    );
    const arqueoId = rows[0].id;

    for (const l of comparacion.lineas) {
      const d = porValor.get(l.valor);
      if (!d) continue;
      const cartuchos = (e.cartuchos ?? []).find((c) => c.valor === l.valor)?.cantidad ?? 0;
      await client.query(
        `INSERT INTO cash_count_lines
           (count_id, denomination_id, valor_unitario_centimos, cantidad_teorica,
            cantidad_contada, cartuchos_contados, diferencia)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (count_id, denomination_id) DO UPDATE
           SET cantidad_contada = EXCLUDED.cantidad_contada,
               cartuchos_contados = EXCLUDED.cartuchos_contados,
               diferencia = EXCLUDED.diferencia`,
        [arqueoId, d.id, l.valor, l.teorico, sueltasContadas.get(l.valor) ?? 0, cartuchos, l.diferencia]
      );
    }

    return { ...comparacion, arqueoId };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.count.create",
    entidad: "cash_counts",
    entidadId: String(resultado.arqueoId),
    detalle: {
      sessionId: e.sessionId,
      teoricoCentimos: resultado.totalTeorico,
      contadoCentimos: resultado.totalContado,
      diferenciaCentimos: resultado.diferencia,
      denominacionesCuadran: resultado.cuadranDenominaciones,
      descuadres: resultado.descuadres,
    },
    ip: ctx.ip,
  });

  return resultado;
}

// ── Cierre ─────────────────────────────────────────────────────────────────

export type EntradaCierre = {
  sessionId: number;
  /** Monedas sueltas que se quedan en caja para mañana. */
  cambioFinal: LineaDenominacion[];
  /** Tubos precintados que se quedan: `cantidad` son tubos, no monedas. */
  cambioFinalCartuchos?: LineaDenominacion[];
  /** Arqueo que respalda el cierre. Si no se pasa, se usa el último guardado. */
  arqueoId?: number;
  notas?: string;
};

export type ResultadoCierre = {
  sesion: Sesion;
  cambioFinal: LineaDenominacion[];
  cambioFinalCartuchos: LineaDenominacion[];
  ingresoBancario: LineaDenominacion[];
  ingresoBancarioCartuchos: LineaDenominacion[];
  totalCambioCentimos: Centimos;
  totalIngresoCentimos: Centimos;
  diferenciaCentimos: Centimos;
  denominacionesCuadran: boolean;
};

/**
 * Cierra la jornada: registra el cambio que se queda, manda el resto al banco y
 * bloquea la caja.
 *
 * El reparto se valida pieza a pieza: el mismo billete no puede estar a la vez
 * en el cambio de mañana y en el ingreso bancario. Por eso el ingreso no se
 * pide, se calcula restando lo que se queda de lo que se ha contado.
 *
 * Tanto el cambio final como el ingreso salen de la caja como movimientos OUT
 * reales, así que el stock teórico de la jornada acaba en cero: todo lo que
 * entró ha salido, o al cajón de mañana o al banco. Eso es lo que hace que el
 * libro mayor cuadre solo.
 */
export async function cerrarJornada(ctx: Contexto, e: EntradaCierre): Promise<ResultadoCierre> {
  const resultado = await enTransaccion(async (client) => {
    const sesion = await bloquearSesion(client, e.sessionId);
    if (sesion.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }
    if (sesion.estado === "CLOSED") {
      throw new ErrorCaja("JORNADA_CERRADA", "La jornada ya está cerrada.", 409);
    }
    if (sesion.estado === "CANCELLED") {
      throw new ErrorCaja("JORNADA_ANULADA", "La jornada está anulada.", 409);
    }

    const { rows: arqueos } = await client.query(
      e.arqueoId
        ? `SELECT * FROM cash_counts WHERE id = $2 AND session_id = $1`
        : `SELECT * FROM cash_counts WHERE session_id = $1 ORDER BY id DESC LIMIT 1`,
      e.arqueoId ? [e.sessionId, e.arqueoId] : [e.sessionId]
    );
    if (arqueos.length === 0) {
      throw new ErrorCaja(
        "FALTA_ARQUEO",
        "Hay que hacer el arqueo antes de cerrar la jornada.",
        409
      );
    }
    const arqueo = arqueos[0];

    // Se reparte lo CONTADO, no lo teórico: si hay descuadre, el dinero que
    // existe de verdad es el contado, y es el que se reparte entre caja y banco.
    const { rows: lineasArqueo } = await client.query(
      `SELECT valor_unitario_centimos, cantidad_contada, cartuchos_contados
         FROM cash_count_lines WHERE count_id = $1`,
      [arqueo.id]
    );

    const denominacionesCierre = await cargarDenominaciones(client);
    const porCartuchoCierre = piezasPorCartuchoDe(denominacionesCierre);

    // Lo contado, en dos dimensiones: monedas sueltas y tubos precintados.
    const contadoSueltas = inventarioDesdeLineas(
      lineasArqueo
        .map((r: { valor_unitario_centimos: number; cantidad_contada: number }) => ({
          valor: r.valor_unitario_centimos,
          cantidad: r.cantidad_contada,
        }))
        .filter((l: LineaDenominacion) => l.cantidad > 0)
    );
    const contadoTubos = inventarioDesdeLineas(
      lineasArqueo
        .map((r: { valor_unitario_centimos: number; cartuchos_contados: number }) => ({
          valor: r.valor_unitario_centimos,
          cantidad: r.cartuchos_contados,
        }))
        .filter((l: LineaDenominacion) => l.cantidad > 0)
    );

    // Para el cuadre con el teórico se cuenta en piezas: un tubo se puede
    // abrir, así que sus monedas son dinero disponible igual que las sueltas.
    const contado = inventarioDesdeLineas([
      ...lineasDesdeInventario(contadoSueltas),
      ...lineasDesdeInventario(contadoTubos).map((l) => ({
        valor: l.valor,
        cantidad: l.cantidad * (porCartuchoCierre.get(l.valor) ?? 0),
      })),
    ]);

    /*
     * El reparto va en las DOS dimensiones. Un tubo precintado que se queda en
     * caja tiene que seguir precintado mañana: si se repartiera solo en piezas,
     * amanecería como monedas sueltas y se habría perdido el formato sin que
     * nadie tocara nada.
     */
    const cambioTubos = inventarioDesdeLineas(e.cambioFinalCartuchos ?? []);
    const repartoSueltas = repartirCierre(contadoSueltas, e.cambioFinal);
    if (esFallo(repartoSueltas)) {
      throw new ErrorCaja(repartoSueltas.codigo, repartoSueltas.mensaje, 400, repartoSueltas.detalle);
    }
    const repartoTubos = repartirCierre(contadoTubos, lineasDesdeInventario(cambioTubos));
    if (esFallo(repartoTubos)) {
      throw new ErrorCaja(
        "CAMBIO_NO_DISPONIBLE",
        "El cambio final incluye cartuchos que no se han contado en el arqueo.",
        400,
        repartoTubos.detalle
      );
    }

    const denominaciones = await cargarDenominaciones(client);
    const porCartucho = piezasPorCartuchoDe(denominaciones);

    /** Convierte tubos a líneas de asiento (piezas + contador de tubos). */
    const aLineasTubo = (tubos: readonly LineaDenominacion[]) =>
      tubos
        .filter((t) => t.cantidad > 0)
        .map((t) => ({
          valor: t.valor,
          cantidad: t.cantidad * (porCartucho.get(t.valor) ?? 0),
          cartuchos: t.cantidad,
        }));

    const valorDeTubos = (tubos: readonly LineaDenominacion[]) =>
      tubos.reduce((a, t) => a + t.valor * t.cantidad * (porCartucho.get(t.valor) ?? 0), 0);

    const cambioFinalTubos = lineasDesdeInventario(cambioTubos);
    const reparto = {
      ingresoBancario: repartoSueltas.ingresoBancario,
      ingresoTubos: repartoTubos.ingresoBancario,
      totalCambio: repartoSueltas.totalCambio + valorDeTubos(cambioFinalTubos),
      totalIngreso: repartoSueltas.totalIngreso + valorDeTubos(repartoTubos.ingresoBancario),
    };
    const ahora = Date.now();
    const anio = Number(sesion.fecha.slice(0, 4));

    /*
     * El stock teórico y lo contado pueden no coincidir. Antes de sacar el
     * cambio final y el ingreso hay que dejar el teórico igual al contado, o la
     * validación de disponibilidad rechazaría sacar piezas que físicamente
     * están ahí (o dejaría en el libro piezas que no aparecieron).
     *
     * Ese cuadre es un ajuste, y como tal se asienta con su operación propia y
     * su auditoría: la diferencia no se disuelve, queda escrita.
     */
    const teorico = await stockTeorico(client, e.sessionId);
    const comparacion = compararArqueo(teorico, contado);

    if (comparacion.descuadres.length > 0) {
      const entradas = comparacion.descuadres
        .filter((d) => d.diferencia > 0)
        .map((d) => ({ valor: d.valor, cantidad: d.diferencia }));
      const salidas = comparacion.descuadres
        .filter((d) => d.diferencia < 0)
        .map((d) => ({ valor: d.valor, cantidad: -d.diferencia }));

      const numeroAjuste = await siguienteNumero(client, "ADJUSTMENT", anio);
      const opAjuste = await insertarOperacion(client, {
        empresaId: ctx.empresaId,
        sessionId: e.sessionId,
        numero: numeroAjuste,
        tipo: "ADJUSTMENT",
        origen: "MANUAL",
        concepto: "Ajuste por diferencia de arqueo al cerrar",
        importeCentimos: Math.abs(comparacion.diferencia) || 1,
        efectivoNetoCentimos: comparacion.diferencia,
        erpSyncStatus: "NOT_APPLICABLE",
        userId: ctx.userId,
        ahora,
      });

      const movimientos = [];
      if (entradas.length > 0) movimientos.push({ direccion: "IN" as const, motivo: "ADJUSTMENT" as const, lineas: entradas });
      if (salidas.length > 0) movimientos.push({ direccion: "OUT" as const, motivo: "ADJUSTMENT" as const, lineas: salidas });

      await insertarMovimientos(client, {
        sessionId: e.sessionId,
        operationId: opAjuste,
        movimientos,
        denominaciones,
        userId: ctx.userId,
        ahora,
      });
    }

    // Cambio final: sale de la jornada de hoy y mañana entra como fondo.
    if (reparto.totalCambio > 0) {
      const numero = await siguienteNumero(client, "CLOSING_FLOAT", anio);
      const opId = await insertarOperacion(client, {
        empresaId: ctx.empresaId,
        sessionId: e.sessionId,
        numero,
        tipo: "CLOSING_FLOAT",
        origen: "MANUAL",
        concepto: "Cambio que queda en caja para el día siguiente",
        importeCentimos: reparto.totalCambio,
        efectivoNetoCentimos: -reparto.totalCambio,
        erpSyncStatus: "NOT_APPLICABLE",
        userId: ctx.userId,
        ahora,
      });
      await insertarMovimientos(client, {
        sessionId: e.sessionId,
        operationId: opId,
        movimientos: [
          {
            direccion: "OUT",
            motivo: "CLOSING_FLOAT",
            lineas: [...e.cambioFinal, ...aLineasTubo(cambioFinalTubos)],
          },
        ],
        denominaciones,
        userId: ctx.userId,
        ahora,
      });
    }

    // Ingreso bancario: todo lo que no se queda como cambio.
    if (reparto.totalIngreso > 0) {
      const numero = await siguienteNumero(client, "BANK_DEPOSIT", anio);
      const opId = await insertarOperacion(client, {
        empresaId: ctx.empresaId,
        sessionId: e.sessionId,
        numero,
        tipo: "BANK_DEPOSIT",
        origen: "MANUAL",
        concepto: "Ingreso bancario del cierre",
        importeCentimos: reparto.totalIngreso,
        efectivoNetoCentimos: -reparto.totalIngreso,
        erpSyncStatus: "NOT_APPLICABLE",
        userId: ctx.userId,
        ahora,
      });
      await insertarMovimientos(client, {
        sessionId: e.sessionId,
        operationId: opId,
        movimientos: [
          {
            direccion: "OUT",
            motivo: "BANK_DEPOSIT",
            lineas: [...reparto.ingresoBancario, ...aLineasTubo(reparto.ingresoTubos)],
          },
        ],
        denominaciones,
        userId: ctx.userId,
        ahora,
      });
    }

    await client.query(
      `UPDATE cash_sessions
          SET estado = 'CLOSED', cerrada_por = $2, cerrada_at_ms = $3,
              contado_centimos = $4, diferencia_centimos = $5, denominaciones_cuadran = $6,
              cambio_final_centimos = $7, ingreso_bancario_centimos = $8,
              notas = COALESCE($9, notas), updated_at_ms = $3
        WHERE id = $1`,
      [
        e.sessionId,
        ctx.userId,
        ahora,
        comparacion.totalContado,
        comparacion.diferencia,
        comparacion.cuadranDenominaciones,
        reparto.totalCambio,
        reparto.totalIngreso,
        e.notas ?? null,
      ]
    );

    const sesionFinal = (await obtenerSesion(e.sessionId, client))!;
    return {
      sesion: sesionFinal,
      cambioFinal: [...e.cambioFinal].sort((a, b) => b.valor - a.valor),
      cambioFinalCartuchos: cambioFinalTubos,
      ingresoBancario: reparto.ingresoBancario,
      ingresoBancarioCartuchos: reparto.ingresoTubos,
      totalCambioCentimos: reparto.totalCambio,
      totalIngresoCentimos: reparto.totalIngreso,
      diferenciaCentimos: comparacion.diferencia,
      denominacionesCuadran: comparacion.cuadranDenominaciones,
    };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.session.close",
    entidad: "cash_sessions",
    entidadId: String(e.sessionId),
    detalle: {
      cambioFinal: resultado.cambioFinal,
      ingresoBancario: resultado.ingresoBancario,
      totalCambioCentimos: resultado.totalCambioCentimos,
      totalIngresoCentimos: resultado.totalIngresoCentimos,
      diferenciaCentimos: resultado.diferenciaCentimos,
      denominacionesCuadran: resultado.denominacionesCuadran,
    },
    ip: ctx.ip,
  });

  return resultado;
}

/**
 * Propuesta de composición del cambio final a partir del último arqueo.
 *
 * Los tubos precintados se quedan en caja mientras quepan en el objetivo: son
 * cambio listo para mañana y abrirlos es irreversible, así que mandarlos al
 * banco sería tirar por la borda justo lo que hace falta en el mostrador. El
 * resto se completa con monedas sueltas, empezando por el menudo.
 */
export async function proponerCierre(
  sessionId: number,
  objetivoCentimos: Centimos
): Promise<{
  cambioFinal: LineaDenominacion[];
  cambioFinalCartuchos: LineaDenominacion[];
  ingresoBancario: LineaDenominacion[];
  ingresoBancarioCartuchos: LineaDenominacion[];
}> {
  // Solo el arqueo MÁS RECIENTE. Antes se sumaban las líneas de todos, así que
  // con dos arqueos en la misma jornada el contado salía duplicado.
  const { rows: ultimo } = await pool.query<{ id: number }>(
    `SELECT id FROM cash_counts WHERE session_id = $1 ORDER BY id DESC LIMIT 1`,
    [sessionId]
  );
  if (ultimo.length === 0) {
    throw new ErrorCaja("FALTA_ARQUEO", "Hay que hacer el arqueo antes de preparar el cierre.", 409);
  }

  const { rows } = await pool.query(
    `SELECT valor_unitario_centimos, cantidad_contada, cartuchos_contados
       FROM cash_count_lines WHERE count_id = $1`,
    [ultimo[0].id]
  );

  const denominaciones = await cargarDenominaciones(pool);
  const porCartucho = piezasPorCartuchoDe(denominaciones);

  const sueltas = inventarioDesdeLineas(
    rows
      .map((r: { valor_unitario_centimos: number; cantidad_contada: number }) => ({
        valor: r.valor_unitario_centimos,
        cantidad: r.cantidad_contada,
      }))
      .filter((l: LineaDenominacion) => l.cantidad > 0)
  );
  const tubos = rows
    .map((r: { valor_unitario_centimos: number; cartuchos_contados: number }) => ({
      valor: r.valor_unitario_centimos,
      cantidad: r.cartuchos_contados,
    }))
    .filter((l: LineaDenominacion) => l.cantidad > 0)
    .sort((a: LineaDenominacion, b: LineaDenominacion) => a.valor - b.valor);

  // Tubos que se quedan: los de menor valor primero, mientras quepan.
  const cambioFinalCartuchos: LineaDenominacion[] = [];
  let restante = objetivoCentimos;
  for (const t of tubos) {
    const valorTubo = t.valor * (porCartucho.get(t.valor) ?? 0);
    if (valorTubo <= 0) continue;
    const caben = Math.min(t.cantidad, Math.floor(restante / valorTubo));
    if (caben > 0) {
      cambioFinalCartuchos.push({ valor: t.valor, cantidad: caben });
      restante -= valorTubo * caben;
    }
  }

  const cambioFinal = proponerCambioFinal(sueltas, restante);

  const repartoSueltas = repartirCierre(sueltas, cambioFinal);
  const repartoTubos = repartirCierre(
    inventarioDesdeLineas(tubos),
    cambioFinalCartuchos
  );

  return {
    cambioFinal,
    cambioFinalCartuchos,
    ingresoBancario: repartoSueltas.ok ? repartoSueltas.ingresoBancario : [],
    ingresoBancarioCartuchos: repartoTubos.ok ? repartoTubos.ingresoBancario : [],
  };
}

// ── Reapertura y reversión ─────────────────────────────────────────────────

export async function reabrirJornada(ctx: Contexto, sessionId: number, motivo: string): Promise<Sesion> {
  if (!motivo?.trim()) {
    throw new ErrorCaja("FALTA_MOTIVO", "Reabrir una jornada exige indicar el motivo.", 400);
  }

  const sesion = await enTransaccion(async (client) => {
    const s = await bloquearSesion(client, sessionId);
    if (s.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }
    if (s.estado !== "CLOSED") {
      throw new ErrorCaja("JORNADA_NO_CERRADA", "Solo se puede reabrir una jornada cerrada.", 409);
    }

    const abierta = await sesionAbierta(s.registerId, client);
    if (abierta) {
      throw new ErrorCaja(
        "JORNADA_YA_ABIERTA",
        "Esa caja tiene otra jornada abierta; ciérrala antes de reabrir ésta.",
        409
      );
    }

    await client.query(
      `UPDATE cash_sessions SET estado = 'REOPENED', updated_at_ms = $2 WHERE id = $1`,
      [sessionId, Date.now()]
    );
    return (await obtenerSesion(sessionId, client))!;
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.session.reopen",
    entidad: "cash_sessions",
    entidadId: String(sessionId),
    detalle: { motivo },
    ip: ctx.ip,
  });

  return sesion;
}

/**
 * Anula una operación por reversión.
 *
 * Nunca se borra un movimiento que ya afectó al stock: se asienta la operación
 * inversa. La original se marca REVERSED y las dos quedan en el histórico
 * enlazadas, que es lo que permite explicar después qué pasó.
 */
export async function anularOperacion(
  ctx: Contexto,
  operationId: number,
  motivo: string
): Promise<{ operacionId: number; numero: string }> {
  if (!motivo?.trim()) {
    throw new ErrorCaja("FALTA_MOTIVO", "Anular una operación exige indicar el motivo.", 400);
  }

  const resultado = await enTransaccion(async (client) => {
    const original = await obtenerOperacion(client, operationId);
    if (!original) throw new ErrorCaja("OPERACION_NO_ENCONTRADA", "La operación no existe.", 404);
    if (original.estado !== "CONFIRMED") {
      throw new ErrorCaja(
        "OPERACION_NO_ANULABLE",
        `La operación está en estado ${original.estado}.`,
        409
      );
    }

    const { rows } = await client.query(`SELECT session_id FROM cash_operations WHERE id = $1`, [
      operationId,
    ]);
    const sessionId = rows[0].session_id as number;
    const sesion = await bloquearSesionOperable(client, sessionId);
    if (sesion.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }

    // Los mismos movimientos del revés.
    const originales = await movimientosDeOperacion(client, operationId);
    const inversos = originales.map((m) => ({
      direccion: (m.direccion === "IN" ? "OUT" : "IN") as "IN" | "OUT",
      motivo: m.motivo,
      lineas: m.lineas,
    }));

    // Devolver lo que entró exige que siga estando: si el billete de 100 € ya se
    // ha usado para dar un cambio, la reversión no puede hacerse a ciegas.
    const stock = await stockTeorico(client, sessionId);
    for (const mov of inversos.filter((m) => m.direccion === "OUT")) {
      for (const l of mov.lineas) {
        const disponible = stock.get(l.valor) ?? 0;
        if (l.cantidad > disponible) {
          throw new ErrorCaja(
            "STOCK_INSUFICIENTE",
            `Para anular hay que devolver ${l.cantidad} piezas de ${l.valor} céntimos y en caja quedan ${disponible}.`,
            409
          );
        }
      }
    }

    const denominaciones = await cargarDenominaciones(client);
    const ahora = Date.now();
    const anio = Number(sesion.fecha.slice(0, 4));
    const numero = await siguienteNumero(client, original.tipo, anio);

    const nuevaId = await insertarOperacion(client, {
      empresaId: ctx.empresaId,
      sessionId,
      numero,
      tipo: original.tipo,
      origen: original.origen,
      externalSystem: original.externalSystem,
      externalDocumentId: original.externalDocumentId,
      externalDocumentReference: original.externalDocumentReference,
      partyNombre: original.partyNombre,
      concepto: `Reversión de ${original.numero}`,
      referencia: original.referencia,
      importeCentimos: original.importeCentimos,
      efectivoNetoCentimos: -original.efectivoNetoCentimos,
      erpSyncStatus: original.erpSyncStatus === "SYNCED" ? "PENDING" : "NOT_APPLICABLE",
      reversaDeId: operationId,
      motivoReversa: motivo,
      userId: ctx.userId,
      ahora,
    });

    const formas = await formasPagoDeOperacion(client, operationId);
    await insertarFormasPago(client, nuevaId, formas, ahora);

    await insertarMovimientos(client, {
      sessionId,
      operationId: nuevaId,
      movimientos: inversos,
      denominaciones,
      userId: ctx.userId,
      ahora,
    });

    await client.query(
      `UPDATE cash_operations SET estado = 'REVERSED', updated_at_ms = $2 WHERE id = $1`,
      [operationId, ahora]
    );

    // Si el cobro ya llegó a la ERP, hay que avisarla también de la anulación.
    if (original.erpSyncStatus === "SYNCED" && original.externalDocumentId) {
      const { conector } = await conectorPara(ctx.empresaId);
      if (conector) {
        await encolarEventoErp(client, {
          empresaId: ctx.empresaId,
          operationId: nuevaId,
          connectorKey: conector.info.key,
          evento: original.tipo === "COLLECTION" ? "COLLECTION_REVERSED" : "PAYMENT_REVERSED",
          idempotencyKey: numero,
          payload: {
            externalSystem: original.externalSystem,
            externalDocumentId: original.externalDocumentId,
            operacionNumero: original.numero,
            motivo,
          },
          ahora,
        });
      }
    }

    return { operacionId: nuevaId, numero };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.operation.reverse",
    entidad: "cash_operations",
    entidadId: String(operationId),
    detalle: { motivo, reversaId: resultado.operacionId, reversaNumero: resultado.numero },
    ip: ctx.ip,
  });

  return resultado;
}

// ── Outbox ─────────────────────────────────────────────────────────────────

/**
 * Encola un evento para la ERP DENTRO de la transacción de la operación.
 *
 * Éste es el detalle que evita el fallo grave: si el evento se mandara a la ERP
 * en caliente y la ERP contestara 503, o bien se pierde el aviso o bien hay que
 * deshacer un cobro cuyo dinero ya está físicamente en el cajón. Guardándolo
 * aquí, el cobro es firme y el aviso es un pendiente que el worker resolverá.
 *
 * `ON CONFLICT DO NOTHING` sobre la clave de idempotencia: reintentar la misma
 * operación no encola el evento dos veces.
 */
async function encolarEventoErp(
  client: PoolClient,
  e: {
    empresaId: string;
    operationId: number;
    connectorKey: string;
    evento: string;
    idempotencyKey: string;
    payload: unknown;
    ahora: number;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO cash_erp_outbox
       (empresa_id, operation_id, connector_key, evento, idempotency_key, payload,
        estado, intentos, proximo_intento_ms, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,'PENDING',0,$7,$7)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [e.empresaId, e.operationId, e.connectorKey, e.evento, e.idempotencyKey, JSON.stringify(e.payload), e.ahora]
  );
}

// ── Resumen de jornada (dashboard) ─────────────────────────────────────────

export type ResumenJornada = {
  sesion: Sesion;
  /** Piezas totales por valor, tubos incluidos: es el dinero disponible. */
  stock: LineaDenominacion[];
  /** De esas piezas, cuántas están sueltas. */
  stockSueltas: LineaDenominacion[];
  /** Tubos precintados por valor de la moneda. */
  stockCartuchos: LineaDenominacion[];
  totalStockCentimos: Centimos;
  piezas: number;
  porFormaPago: { forma: string; importeCentimos: Centimos }[];
  cobros: { erpCentimos: Centimos; manualCentimos: Centimos; totalCentimos: Centimos };
  pagos: { erpCentimos: Centimos; manualCentimos: Centimos; totalCentimos: Centimos };
  salidasCentimos: Centimos;
  entregasCentimos: Centimos;
  operaciones: number;
  pendientesErp: number;
};

export async function resumenJornada(sessionId: number): Promise<ResumenJornada> {
  const sesion = await obtenerSesion(sessionId);
  if (!sesion) throw new ErrorCaja("JORNADA_NO_ENCONTRADA", "La jornada no existe.", 404);

  const [inv, porFormato] = await Promise.all([
    stockTeorico(pool, sessionId),
    stockPorFormato(pool, sessionId),
  ]);

  // Los totales por forma de pago salen de las operaciones vivas: una anulada y
  // su reversión se compensan solas porque la reversión no se cuenta y la
  // original deja de estar CONFIRMED.
  const { rows: formas } = await pool.query(
    `SELECT p.forma_pago, SUM(p.importe_centimos) AS importe
       FROM cash_operation_payments p
       JOIN cash_operations o ON o.id = p.operation_id
      WHERE o.session_id = $1 AND o.estado = 'CONFIRMED'
        AND o.tipo IN ('COLLECTION','PAYMENT')
      GROUP BY p.forma_pago`,
    [sessionId]
  );

  const { rows: porTipo } = await pool.query(
    `SELECT tipo, origen, SUM(importe_centimos) AS importe, COUNT(*) AS n
       FROM cash_operations
      WHERE session_id = $1 AND estado = 'CONFIRMED'
      GROUP BY tipo, origen`,
    [sessionId]
  );

  const suma = (tipo: string, origen?: string): Centimos =>
    porTipo
      .filter((r: { tipo: string; origen: string }) => r.tipo === tipo && (!origen || r.origen === origen))
      .reduce((a: number, r: { importe: string }) => a + Number(r.importe), 0);

  const { rows: pendientes } = await pool.query(
    `SELECT COUNT(*) AS n FROM cash_operations
      WHERE session_id = $1 AND erp_sync_status IN ('PENDING','ERROR','RETRY_PENDING')`,
    [sessionId]
  );

  const { rows: totalOps } = await pool.query(
    `SELECT COUNT(*) AS n FROM cash_operations WHERE session_id = $1 AND estado = 'CONFIRMED'`,
    [sessionId]
  );

  return {
    sesion,
    stock: lineasDesdeInventario(inv),
    stockSueltas: lineasDesdeInventario(porFormato.sueltas),
    stockCartuchos: lineasDesdeInventario(porFormato.cartuchos),
    totalStockCentimos: totalInventario(inv),
    piezas: totalPiezas(inv),
    porFormaPago: formas.map((r: { forma_pago: string; importe: string }) => ({
      forma: r.forma_pago,
      importeCentimos: Number(r.importe),
    })),
    cobros: {
      erpCentimos: suma("COLLECTION", "ERP"),
      manualCentimos: suma("COLLECTION", "MANUAL"),
      totalCentimos: suma("COLLECTION"),
    },
    pagos: {
      erpCentimos: suma("PAYMENT", "ERP"),
      manualCentimos: suma("PAYMENT", "MANUAL"),
      totalCentimos: suma("PAYMENT"),
    },
    salidasCentimos: suma("MANUAL_OUT"),
    entregasCentimos: suma("CASH_DELIVERY"),
    operaciones: Number(totalOps[0].n),
    pendientesErp: Number(pendientes[0].n),
  };
}

/** Detalle completo de una jornada, para el histórico. */
export async function detalleJornada(sessionId: number) {
  const resumen = await resumenJornada(sessionId);
  const operaciones = await operacionesDeSesion(sessionId);

  const { rows: arqueos } = await pool.query(
    `SELECT * FROM cash_counts WHERE session_id = $1 ORDER BY id DESC`,
    [sessionId]
  );

  return { ...resumen, operaciones, arqueos };
}

export { validarCambioManual };


/**
 * Abre los cartuchos que hagan falta para poder entregar unas salidas.
 *
 * Devuelve las aperturas realizadas, para que la interfaz pueda decírselo al
 * operador: sin ese aviso, la pantalla le pide cuatro monedas de 1 € y él solo
 * ve una suelta en el cajón.
 *
 * Un tubo abierto no se vuelve a cerrar, así que esto no tiene inversa: la
 * anulación de la operación devuelve las monedas, pero sueltas.
 */
async function abrirCartuchosSiHaceFalta(
  client: PoolClient,
  e: {
    sessionId: number;
    operationId: number;
    salidas: readonly { lineas: readonly LineaDenominacion[] }[];
    denominaciones: readonly import("./domain/denominations.ts").Denominacion[];
    userId: string | null;
    ahora: number;
  }
): Promise<AperturaCartucho[]> {
  const entrega = e.salidas.flatMap((m) => m.lineas);
  if (entrega.length === 0) return [];

  const porCartucho = piezasPorCartuchoDe(e.denominaciones);
  if (porCartucho.size === 0) return [];

  const stock = await stockPorFormato(client, e.sessionId);
  const r = aperturasNecesarias(entrega, stock, porCartucho);

  if (esFallo(r)) {
    throw new ErrorCaja(
      "STOCK_INSUFICIENTE",
      `No hay suficientes piezas de ${r.valor} céntimos: se necesitan ${r.pedido} y hay ${r.disponible} contando los cartuchos.`,
      400
    );
  }
  if (r.aperturas.length === 0) return [];

  await insertarMovimientos(client, {
    sessionId: e.sessionId,
    operationId: e.operationId,
    movimientos: [
      // Sale el tubo precintado…
      {
        direccion: "OUT",
        motivo: "CARTRIDGE_OPENED",
        lineas: r.aperturas.map((a) => ({
          valor: a.valor,
          cantidad: a.piezas,
          cartuchos: a.cartuchos,
        })),
      },
      // …y entran sus monedas, ya sueltas. Valor neto cero.
      {
        direccion: "IN",
        motivo: "CARTRIDGE_OPENED",
        lineas: r.aperturas.map((a) => ({ valor: a.valor, cantidad: a.piezas })),
      },
    ],
    denominaciones: e.denominaciones,
    userId: e.userId,
    ahora: e.ahora,
  });

  return r.aperturas;
}
