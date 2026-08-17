/**
 * Acceso a datos de Mobilink Cash.
 *
 * Dos cosas que definen este fichero:
 *
 * 1. **El stock teórico se reconstruye, no se guarda.** Sale de sumar el libro
 *    mayor de piezas de la jornada. No hay ninguna columna de saldo que
 *    mantener al día, así que no puede desincronizarse: si los movimientos son
 *    correctos, el stock es correcto por construcción.
 *
 * 2. **Toda operación que toca el stock bloquea la jornada.** `bloquearSesion`
 *    hace un `SELECT … FOR UPDATE` sobre la fila de la jornada al principio de
 *    la transacción, lo que serializa las operaciones de esa caja. Es lo que
 *    impide que dos terminales gasten a la vez el último billete de 50 €: la
 *    segunda espera, y cuando entra ve el stock ya descontado y falla la
 *    validación en vez de duplicar el gasto.
 *
 *    Se bloquea la jornada entera y no cada denominación a propósito. Una caja
 *    física es un recurso único con dos o tres personas alrededor; la
 *    contención es irrelevante y el razonamiento sobre corrección es mucho más
 *    simple que con bloqueos por fila de inventario.
 */

import type { PoolClient } from "pg";
import pool from "../db.ts";
import { ErrorCaja } from "./errors.ts";
import type { Denominacion } from "./domain/denominations.ts";
import type { Centimos } from "./domain/money.ts";
import { type Inventario, type LineaDenominacion } from "./domain/inventory.ts";
import type {
  Direccion,
  FormaPago,
  MotivoMovimiento,
  MovimientoDenominacion,
  OrigenOperacion,
  TipoOperacion,
} from "./domain/operations.ts";
import { CODIGOS_EFECTIVO_POR_DEFECTO, FORMAS_PAGO_SEMILLA } from "./domain/operations.ts";

// ── Transacciones ──────────────────────────────────────────────────────────

/**
 * Ejecuta `fn` dentro de una transacción. Si algo revienta, se deshace todo:
 * nunca puede quedar una operación guardada sin sus movimientos de efectivo, ni
 * al revés.
 */
export async function enTransaccion<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── Errores de negocio ─────────────────────────────────────────────────────

/**
 * `ErrorCaja` vive en `./errors.ts` para que los ayudantes puros puedan
 * lanzarlo sin arrastrar el pool. Se reexporta aquí porque medio módulo lo
 * importa de este fichero desde el primer día.
 */
export { ErrorCaja };

// ── Denominaciones ─────────────────────────────────────────────────────────

type FilaDenominacion = {
  id: number;
  valor_centimos: number;
  tipo: "BILLETE" | "MONEDA";
  etiqueta: string;
  piezas_por_cartucho: number | null;
  activa: boolean;
  orden: number;
};

export async function cargarDenominaciones(
  client: PoolClient | typeof pool = pool,
  soloActivas = false
): Promise<Denominacion[]> {
  const { rows } = await client.query<FilaDenominacion>(
    `SELECT id, valor_centimos, tipo, etiqueta, piezas_por_cartucho, activa, orden
       FROM cash_denominations
      ${soloActivas ? "WHERE activa = true" : ""}
      ORDER BY valor_centimos DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    valor: r.valor_centimos,
    tipo: r.tipo,
    etiqueta: r.etiqueta,
    piezasPorCartucho: r.piezas_por_cartucho,
    activa: r.activa,
    orden: r.orden,
  }));
}

export type FormaPagoCatalogo = {
  codigo: string;
  nombre: string;
  afectaEfectivo: boolean;
  pideReferencia: boolean;
  activa: boolean;
  enCobros: boolean;
  enPagos: boolean;
};

/**
 * Catálogo de formas de pago de la empresa.
 *
 * Si la empresa todavía no lo tiene sembrado —caja recién estrenada, nadie ha
 * entrado aún en Configuración— se responde con la semilla en vez de con una
 * lista vacía. Un catálogo vacío haría que no se pudiera cobrar nada, que es
 * mucho peor que asumir las siete formas de siempre.
 */
export async function cargarFormasPago(
  client: PoolClient | typeof pool,
  empresaId: string
): Promise<FormaPagoCatalogo[]> {
  const { rows } = await client.query(
    `SELECT codigo, nombre, afecta_efectivo, pide_referencia, activa, en_cobros, en_pagos
       FROM cash_payment_methods
      WHERE empresa_id = $1
      ORDER BY orden, nombre`,
    [empresaId]
  );
  if (rows.length === 0) {
    return FORMAS_PAGO_SEMILLA.map((f) => ({
      codigo: f.codigo,
      nombre: f.nombre,
      afectaEfectivo: f.afectaEfectivo,
      pideReferencia: f.pideReferencia,
      activa: true,
      enCobros: f.enCobros,
      enPagos: f.enPagos,
    }));
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    codigo: r.codigo,
    nombre: r.nombre,
    afectaEfectivo: r.afecta_efectivo,
    pideReferencia: r.pide_referencia,
    activa: r.activa,
    enCobros: r.en_cobros,
    enPagos: r.en_pagos,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Los códigos que mueven el cajón físico. En la práctica, solo `CASH`. */
export function codigosEfectivoDe(catalogo: readonly FormaPagoCatalogo[]): ReadonlySet<string> {
  const codigos = catalogo.filter((f) => f.afectaEfectivo).map((f) => f.codigo);
  return codigos.length > 0 ? new Set(codigos) : CODIGOS_EFECTIVO_POR_DEFECTO;
}

/**
 * Traduce valores en céntimos a ids de denominación. Si llega un valor que no
 * está en el catálogo se rechaza: aceptarlo significaría guardar un movimiento
 * de una pieza que no existe.
 */
export function exigirIdsDenominacion(
  lineas: readonly LineaDenominacion[],
  denominaciones: readonly Denominacion[]
): Map<Centimos, number> {
  const porValor = new Map(denominaciones.map((d) => [d.valor, d.id]));
  const salida = new Map<Centimos, number>();
  for (const l of lineas) {
    const id = porValor.get(l.valor);
    if (id == null) {
      throw new ErrorCaja(
        "DENOMINACION_DESCONOCIDA",
        `No existe ninguna denominación de ${l.valor} céntimos en el catálogo.`
      );
    }
    salida.set(l.valor, id);
  }
  return salida;
}

// ── Jornadas ───────────────────────────────────────────────────────────────

export type EstadoSesion = "DRAFT" | "OPEN" | "PENDING_CLOSE" | "CLOSED" | "REOPENED" | "CANCELLED";

export type Sesion = {
  id: number;
  empresaId: string;
  registerId: number;
  fecha: string;
  estado: EstadoSesion;
  abiertaPor: string | null;
  abiertaAtMs: number | null;
  cerradaPor: string | null;
  cerradaAtMs: number | null;
  fondoInicialCentimos: Centimos;
  fondoInicialHeredado: boolean;
  sesionAnteriorId: number | null;
  contadoCentimos: Centimos | null;
  diferenciaCentimos: Centimos | null;
  denominacionesCuadran: boolean | null;
  cambioFinalCentimos: Centimos | null;
  ingresoBancarioCentimos: Centimos | null;
  notas: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function aSesion(r: any): Sesion {
  return {
    id: r.id,
    empresaId: r.empresa_id,
    registerId: r.register_id,
    // node-postgres devuelve DATE como Date en la zona del proceso; se pasa a
    // ISO corto para que la fecha de la jornada no baile con el huso horario.
    fecha: r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : String(r.fecha),
    estado: r.estado,
    abiertaPor: r.abierta_por,
    abiertaAtMs: r.abierta_at_ms == null ? null : Number(r.abierta_at_ms),
    cerradaPor: r.cerrada_por,
    cerradaAtMs: r.cerrada_at_ms == null ? null : Number(r.cerrada_at_ms),
    fondoInicialCentimos: Number(r.fondo_inicial_centimos),
    fondoInicialHeredado: r.fondo_inicial_heredado,
    sesionAnteriorId: r.sesion_anterior_id,
    contadoCentimos: r.contado_centimos == null ? null : Number(r.contado_centimos),
    diferenciaCentimos: r.diferencia_centimos == null ? null : Number(r.diferencia_centimos),
    denominacionesCuadran: r.denominaciones_cuadran,
    cambioFinalCentimos: r.cambio_final_centimos == null ? null : Number(r.cambio_final_centimos),
    ingresoBancarioCentimos:
      r.ingreso_bancario_centimos == null ? null : Number(r.ingreso_bancario_centimos),
    notas: r.notas,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const ESTADOS_OPERABLES: readonly EstadoSesion[] = ["OPEN", "REOPENED"];

export function esOperable(s: Sesion): boolean {
  return ESTADOS_OPERABLES.includes(s.estado);
}

/**
 * Bloquea la jornada para el resto de la transacción y la devuelve.
 *
 * Todo lo que mueva efectivo pasa por aquí primero. A partir de este punto
 * ninguna otra transacción puede tocar esta caja hasta el COMMIT, así que el
 * stock que se lea a continuación es el bueno.
 */
export async function bloquearSesion(client: PoolClient, sessionId: number): Promise<Sesion> {
  const { rows } = await client.query(`SELECT * FROM cash_sessions WHERE id = $1 FOR UPDATE`, [
    sessionId,
  ]);
  if (rows.length === 0) {
    throw new ErrorCaja("JORNADA_NO_ENCONTRADA", "La jornada de caja no existe.", 404);
  }
  return aSesion(rows[0]);
}

/** Igual que `bloquearSesion` pero exigiendo además que se pueda operar. */
export async function bloquearSesionOperable(client: PoolClient, sessionId: number): Promise<Sesion> {
  const s = await bloquearSesion(client, sessionId);
  if (!esOperable(s)) {
    throw new ErrorCaja(
      "JORNADA_NO_OPERABLE",
      `La jornada está en estado ${s.estado} y no admite movimientos.`,
      409
    );
  }
  return s;
}

export async function sesionAbierta(
  registerId: number,
  client: PoolClient | typeof pool = pool
): Promise<Sesion | null> {
  const { rows } = await client.query(
    `SELECT * FROM cash_sessions
      WHERE register_id = $1 AND estado IN ('OPEN','PENDING_CLOSE','REOPENED')
      ORDER BY id DESC LIMIT 1`,
    [registerId]
  );
  return rows[0] ? aSesion(rows[0]) : null;
}

export async function obtenerSesion(
  sessionId: number,
  client: PoolClient | typeof pool = pool
): Promise<Sesion | null> {
  const { rows } = await client.query(`SELECT * FROM cash_sessions WHERE id = $1`, [sessionId]);
  return rows[0] ? aSesion(rows[0]) : null;
}

/** Última jornada cerrada de la caja: de aquí sale el fondo inicial heredado. */
/**
 * La jornada cerrada de la que hereda el fondo la siguiente.
 *
 * `hasta` acota por fecha contable, y no es un adorno: al arrancar el módulo se
 * meten días atrasados, y si alguien introduce el 13 después de haber cerrado
 * el 14, el 13 tiene que heredar del 12 —no del 14, que es su futuro—. Sin el
 * tope, el fondo inicial del 13 saldría del cierre de un día que todavía no ha
 * pasado. Abriendo el día de hoy, que es el caso normal, no cambia nada.
 */
export async function ultimaSesionCerrada(
  client: PoolClient,
  registerId: number,
  hasta?: string
): Promise<Sesion | null> {
  const { rows } = await client.query(
    `SELECT * FROM cash_sessions
      WHERE register_id = $1 AND estado = 'CLOSED'
        AND ($2::date IS NULL OR fecha <= $2::date)
      ORDER BY fecha DESC, id DESC LIMIT 1`,
    [registerId, hasta ?? null]
  );
  return rows[0] ? aSesion(rows[0]) : null;
}

// ── Stock teórico ──────────────────────────────────────────────────────────

/**
 * Stock teórico de la jornada: fondo inicial + entradas − salidas, pieza a
 * pieza. Se calcula en la base de datos porque es una agregación tonta sobre un
 * índice y traerse todos los movimientos para sumarlos en Node no aporta nada.
 */
export async function stockTeorico(
  client: PoolClient | typeof pool,
  sessionId: number
): Promise<Inventario> {
  const { rows } = await client.query<{ valor_unitario_centimos: number; cantidad: string }>(
    `SELECT valor_unitario_centimos,
            SUM(CASE WHEN direccion = 'IN' THEN cantidad ELSE -cantidad END) AS cantidad
       FROM cash_denomination_movements
      WHERE session_id = $1
      GROUP BY valor_unitario_centimos
      HAVING SUM(CASE WHEN direccion = 'IN' THEN cantidad ELSE -cantidad END) <> 0`,
    [sessionId]
  );

  const inv = new Map<Centimos, number>();
  for (const r of rows) {
    const cantidad = Number(r.cantidad);
    /*
     * Un stock negativo no debería poder existir: cada salida se valida contra
     * el stock bloqueado antes de asentarse. Si aparece, es que algo escribió
     * movimientos saltándose el servicio, y es mejor que reviente aquí de forma
     * ruidosa que dejar que la caja opere sobre datos imposibles.
     */
    if (cantidad < 0) {
      throw new ErrorCaja(
        "STOCK_NEGATIVO",
        `El stock teórico de la denominación de ${r.valor_unitario_centimos} céntimos es negativo (${cantidad}). Revisa los movimientos de la jornada.`,
        500
      );
    }
    inv.set(r.valor_unitario_centimos, cantidad);
  }
  return inv;
}

// ── Movimientos ────────────────────────────────────────────────────────────

export async function insertarMovimientos(
  client: PoolClient,
  opts: {
    sessionId: number;
    operationId: number | null;
    movimientos: readonly MovimientoDenominacion[];
    denominaciones: readonly Denominacion[];
    userId: string | null;
    ahora: number;
  }
): Promise<void> {
  const todas = opts.movimientos.flatMap((m) => m.lineas);
  if (todas.length === 0) return;
  const ids = exigirIdsDenominacion(todas, opts.denominaciones);

  for (const mov of opts.movimientos) {
    for (const l of mov.lineas) {
      await client.query(
        `INSERT INTO cash_denomination_movements
           (session_id, operation_id, denomination_id, direccion, cantidad,
            valor_unitario_centimos, importe_centimos, motivo, created_by, created_at_ms, cartuchos)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          opts.sessionId,
          opts.operationId,
          ids.get(l.valor),
          mov.direccion,
          l.cantidad,
          l.valor,
          l.valor * l.cantidad,
          mov.motivo,
          opts.userId,
          opts.ahora,
          l.cartuchos ?? 0,
        ]
      );
    }
  }
}

/** Movimientos de la jornada, para el detalle del histórico. */
export async function movimientosDeSesion(
  sessionId: number,
  client: PoolClient | typeof pool = pool
): Promise<
  {
    id: number;
    operationId: number | null;
    valor: Centimos;
    cantidad: number;
    direccion: Direccion;
    motivo: MotivoMovimiento;
    importe: Centimos;
    createdAtMs: number;
  }[]
> {
  const { rows } = await client.query(
    `SELECT id, operation_id, valor_unitario_centimos, cantidad, direccion, motivo,
            importe_centimos, created_at_ms
       FROM cash_denomination_movements
      WHERE session_id = $1
      ORDER BY id`,
    [sessionId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    id: Number(r.id),
    operationId: r.operation_id,
    valor: r.valor_unitario_centimos,
    cantidad: r.cantidad,
    direccion: r.direccion,
    motivo: r.motivo,
    importe: Number(r.importe_centimos),
    createdAtMs: Number(r.created_at_ms),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ── Numeración propia ──────────────────────────────────────────────────────

const PREFIJO_POR_TIPO: Partial<Record<TipoOperacion, string>> = {
  COLLECTION: "C",
  PAYMENT: "P",
  MANUAL_IN: "E",
  MANUAL_OUT: "S",
  CASH_DELIVERY: "R",
  BANK_DEPOSIT: "B",
  ADJUSTMENT: "A",
  OPENING_FLOAT: "AP",
  CLOSING_FLOAT: "CI",
};

/**
 * Número propio de Mobilink Cash: `MC-C-2026-000042`.
 *
 * No depende de ningún número que dé la ERP, porque en modo autónomo no hay
 * ERP. Mismo mecanismo que `nextDocumentNumber()` del Integration Hub: un
 * UPSERT con RETURNING, que es atómico y no necesita bloqueo explícito.
 *
 * El contador es por tipo y año, así que la serie se reinicia cada ejercicio.
 */
export async function siguienteNumero(
  client: PoolClient,
  tipo: TipoOperacion,
  anio: number
): Promise<string> {
  return siguienteNumeroDe(client, PREFIJO_POR_TIPO[tipo] ?? "X", anio);
}

/**
 * El mismo contador para documentos que no son operaciones: los pedidos de
 * cambio al banco (`CB`) y las entregas de dinero a personas (`EN`).
 */
export async function siguienteNumeroDe(
  client: PoolClient,
  prefijo: string,
  anio: number
): Promise<string> {
  const clave = `${prefijo}:${anio}`;
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO cash_document_counters (clave, last_seq)
     VALUES ($1, 1)
     ON CONFLICT (clave) DO UPDATE SET last_seq = cash_document_counters.last_seq + 1
     RETURNING last_seq`,
    [clave]
  );
  return `MC-${prefijo}-${anio}-${String(rows[0].last_seq).padStart(6, "0")}`;
}

// ── Operaciones ────────────────────────────────────────────────────────────

export type OperacionGuardada = {
  id: number;
  numero: string;
  tipo: TipoOperacion;
  origen: OrigenOperacion;
  importeCentimos: Centimos;
  efectivoNetoCentimos: Centimos;
  estado: string;
  erpSyncStatus: string;
  partyNombre: string;
  concepto: string;
  referencia: string | null;
  externalSystem: string | null;
  externalDocumentId: string | null;
  externalDocumentReference: string | null;
  createdAtMs: number;
};

export async function insertarOperacion(
  client: PoolClient,
  o: {
    empresaId: string;
    sessionId: number;
    numero: string;
    tipo: TipoOperacion;
    origen: OrigenOperacion;
    externalSystem?: string | null;
    externalDocumentId?: string | null;
    externalDocumentReference?: string | null;
    documentoId?: number | null;
    partyNombre?: string;
    concepto?: string;
    referencia?: string | null;
    importeCentimos: Centimos;
    efectivoNetoCentimos: Centimos;
    erpSyncStatus: string;
    reversaDeId?: number | null;
    motivoReversa?: string | null;
    userId: string | null;
    ahora: number;
  }
): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO cash_operations
       (empresa_id, session_id, numero, tipo, origen, external_system, external_document_id,
        external_document_reference, documento_id, party_nombre, concepto, referencia,
        importe_centimos, efectivo_neto_centimos, estado, reversa_de_id, motivo_reversa,
        erp_sync_status, created_by, created_at_ms, confirmed_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'CONFIRMED',$15,$16,$17,$18,$19,$19,$19)
     RETURNING id`,
    [
      o.empresaId,
      o.sessionId,
      o.numero,
      o.tipo,
      o.origen,
      o.externalSystem ?? null,
      o.externalDocumentId ?? null,
      o.externalDocumentReference ?? null,
      o.documentoId ?? null,
      o.partyNombre ?? "",
      o.concepto ?? "",
      o.referencia ?? null,
      o.importeCentimos,
      o.efectivoNetoCentimos,
      o.reversaDeId ?? null,
      o.motivoReversa ?? null,
      o.erpSyncStatus,
      o.userId,
      o.ahora,
    ]
  );
  return rows[0].id;
}

export async function insertarFormasPago(
  client: PoolClient,
  operationId: number,
  formas: readonly { forma: FormaPago; importe: Centimos; referencia?: string | null }[],
  ahora: number
): Promise<void> {
  for (const f of formas) {
    await client.query(
      `INSERT INTO cash_operation_payments (operation_id, forma_pago, importe_centimos, referencia, created_at_ms)
       VALUES ($1,$2,$3,$4,$5)`,
      [operationId, f.forma, f.importe, f.referencia ?? null, ahora]
    );
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function aOperacion(r: any): OperacionGuardada {
  return {
    id: r.id,
    numero: r.numero,
    tipo: r.tipo,
    origen: r.origen,
    importeCentimos: Number(r.importe_centimos),
    efectivoNetoCentimos: Number(r.efectivo_neto_centimos),
    estado: r.estado,
    erpSyncStatus: r.erp_sync_status,
    partyNombre: r.party_nombre,
    concepto: r.concepto,
    referencia: r.referencia,
    externalSystem: r.external_system,
    externalDocumentId: r.external_document_id,
    externalDocumentReference: r.external_document_reference,
    createdAtMs: Number(r.created_at_ms),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function operacionesDeSesion(
  sessionId: number,
  client: PoolClient | typeof pool = pool
): Promise<OperacionGuardada[]> {
  const { rows } = await client.query(
    `SELECT * FROM cash_operations WHERE session_id = $1 ORDER BY id DESC`,
    [sessionId]
  );
  return rows.map(aOperacion);
}

export async function obtenerOperacion(
  client: PoolClient | typeof pool,
  operationId: number
): Promise<OperacionGuardada | null> {
  const { rows } = await client.query(`SELECT * FROM cash_operations WHERE id = $1`, [operationId]);
  return rows[0] ? aOperacion(rows[0]) : null;
}

/** Formas de pago de una operación. */
export async function formasPagoDeOperacion(
  client: PoolClient | typeof pool,
  operationId: number
): Promise<{ forma: FormaPago; importe: Centimos; referencia: string | null }[]> {
  const { rows } = await client.query(
    `SELECT forma_pago, importe_centimos, referencia FROM cash_operation_payments
      WHERE operation_id = $1 ORDER BY id`,
    [operationId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    forma: r.forma_pago,
    importe: Number(r.importe_centimos),
    referencia: r.referencia,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Movimientos de una operación, ya agrupados por dirección y motivo. Es lo que
 * hace falta para construir la reversión: los mismos movimientos del revés.
 */
export async function movimientosDeOperacion(
  client: PoolClient,
  operationId: number
): Promise<MovimientoDenominacion[]> {
  const { rows } = await client.query(
    `SELECT direccion, motivo, valor_unitario_centimos, cantidad
       FROM cash_denomination_movements
      WHERE operation_id = $1
      ORDER BY id`,
    [operationId]
  );

  const grupos = new Map<string, MovimientoDenominacion>();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const r of rows as any[]) {
    const clave = `${r.direccion}|${r.motivo}`;
    let g = grupos.get(clave);
    if (!g) {
      g = { direccion: r.direccion, motivo: r.motivo, lineas: [] };
      grupos.set(clave, g);
    }
    g.lineas.push({ valor: r.valor_unitario_centimos, cantidad: r.cantidad });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return [...grupos.values()];
}


/**
 * Stock separado por formato: monedas sueltas y tubos precintados.
 *
 * `stockTeorico` sigue devolviendo el total de piezas, que es lo que valida la
 * disponibilidad (un tubo se puede abrir, así que sus monedas cuentan). Esto de
 * aquí es lo que necesita el motor para decidir SI hay que abrirlo y para que
 * la pantalla lo pueda decir.
 */
export async function stockPorFormato(
  client: PoolClient | typeof pool,
  sessionId: number
): Promise<{ sueltas: Map<Centimos, number>; cartuchos: Map<Centimos, number> }> {
  const { rows } = await client.query<{
    valor_unitario_centimos: number;
    sueltas: string;
    tubos: string;
  }>(
    `SELECT valor_unitario_centimos,
            SUM(CASE WHEN cartuchos = 0
                     THEN (CASE WHEN direccion = 'IN' THEN cantidad ELSE -cantidad END)
                     ELSE 0 END) AS sueltas,
            SUM(CASE WHEN direccion = 'IN' THEN cartuchos ELSE -cartuchos END) AS tubos
       FROM cash_denomination_movements
      WHERE session_id = $1
      GROUP BY valor_unitario_centimos`,
    [sessionId]
  );

  const sueltas = new Map<Centimos, number>();
  const cartuchos = new Map<Centimos, number>();
  for (const r of rows) {
    const s = Number(r.sueltas);
    const t = Number(r.tubos);
    if (s > 0) sueltas.set(r.valor_unitario_centimos, s);
    if (t > 0) cartuchos.set(r.valor_unitario_centimos, t);
    if (s < 0 || t < 0) {
      throw new ErrorCaja(
        "STOCK_NEGATIVO",
        `El stock de la denominación de ${r.valor_unitario_centimos} céntimos es negativo (sueltas ${s}, cartuchos ${t}).`,
        500
      );
    }
  }
  return { sueltas, cartuchos };
}

/** Piezas por cartucho del catálogo, indexadas por valor. */
export function piezasPorCartuchoDe(denominaciones: readonly Denominacion[]): Map<Centimos, number> {
  const m = new Map<Centimos, number>();
  for (const d of denominaciones) if (d.piezasPorCartucho) m.set(d.valor, d.piezasPorCartucho);
  return m;
}
