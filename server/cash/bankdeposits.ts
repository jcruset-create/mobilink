/**
 * Ingresos bancarios: la conciliación entre los cierres de caja y el banco.
 *
 * El cierre de cada jornada aparta un importe "para el banco"
 * (`ingreso_bancario_centimos`), pero al banco no se va cada día: se acumulan
 * varios cierres y luego se hace un solo ingreso que los agrupa. Y el banco
 * solo admite billetes, así que antes de ir se intenta convertir las monedas
 * en billetes con la operativa normal de caja; lo que no se consigue se queda
 * en tienda como **remanente**, y ese remanente arranca el ingreso siguiente.
 *
 * La ecuación que no puede romperse, y que además es un CHECK en la tabla:
 *
 *     remanente anterior + cierres seleccionados − ingresado = remanente nuevo
 *
 * Decisiones de diseño que conviene no perder:
 *
 * · **El remanente no es una columna de saldo**: es el `remanente_nuevo` del
 *   último ingreso confirmado de la caja. No hay contador que se pueda
 *   desincronizar; si los ingresos son correctos, el remanente lo es por
 *   construcción — el mismo criterio que el stock teórico del módulo.
 *
 * · **Concurrencia**: crear o anular un ingreso bloquea la fila de la caja
 *   (`SELECT … FOR UPDATE` sobre `cash_registers`), que serializa la cadena de
 *   remanentes. Y aunque dos transacciones se colaran, el índice único parcial
 *   sobre los cierres vigentes impide a nivel de base de datos que el mismo
 *   cierre entre en dos ingresos.
 *
 * · **Solo se anula el último ingreso confirmado** de cada caja. El remanente
 *   es una cadena —cada ingreso arranca donde acabó el anterior— y anular uno
 *   del medio dejaría a todos los posteriores arrancando de un número que ya
 *   no existe. Para deshacer más atrás se anula en orden, del último hacia
 *   abajo. La anulación no borra: cambia el estado, suelta sus cierres y deja
 *   quién, cuándo y por qué.
 *
 * · **Aislamiento por caja**: pendientes, remanente e historial se calculan
 *   siempre dentro de una caja (`register_id`), que a su vez pertenece a una
 *   empresa. Nada de una caja puede mezclarse con otra.
 */

import type { PoolClient } from "pg";
import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import type { Centimos } from "./domain/money.ts";
import { formatearEuros } from "./domain/money.ts";
import {
  ErrorCaja,
  cargarDenominaciones,
  enTransaccion,
  sesionAbierta,
  siguienteNumeroDe,
  codigoDeCaja,
  stockTeorico,
} from "./repository.ts";
import { type LineaDenominacion, inventarioDesdeLineas } from "./domain/inventory.ts";
import { type Canje, mejorCanje } from "./domain/depositswap.ts";
import { deficitDeFondo, mejorReposicion } from "./domain/floattopup.ts";
import type { Contexto } from "./service.ts";
import { centroDeCaja, emitirEvento } from "./events/emitter.ts";

// ── Tipos ──────────────────────────────────────────────────────────────────

export type CierrePendiente = {
  sessionId: number;
  fecha: string;
  importeCentimos: Centimos;
  cerradaPor: string | null;
  cerradaPorNombre: string | null;
  /** Días transcurridos desde la fecha de la jornada. */
  dias: number;
};

export type CierreConciliado = { sessionId: number; fecha: string; importeCentimos: Centimos };

export type IngresoBancario = {
  id: number;
  numero: string;
  estado: "CONFIRMADO" | "ANULADO";
  registerId: number;
  fechaIngreso: string | null;
  referencia: string | null;
  /** Cuenta a la que fue el dinero. null en los ingresos anteriores al catálogo. */
  bankAccountId: number | null;
  /** Datos de esa cuenta, para pintarla sin otra consulta. */
  banco: string | null;
  iban: string | null;
  observaciones: string | null;
  remanenteAnteriorCentimos: Centimos;
  totalCierresCentimos: Centimos;
  importeCentimos: Centimos;
  remanenteNuevoCentimos: Centimos;
  cierres: CierreConciliado[];
  creadoPor: string | null;
  creadoAtMs: number;
  anuladoAtMs: number | null;
  anuladoMotivo: string | null;
  /** Solo el último confirmado de la caja se puede anular. */
  esUltimo: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const fechaIso = (v: any): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

/**
 * Rellena banco e IBAN de una fila de ingreso.
 *
 * Las consultas que devuelven el ingreso son varias —crear, completar,
 * anular— y todas tienen que traer la cuenta resuelta: la pantalla y el
 * resguardo la pintan. Sin esto, cada una tenía que acordarse de su JOIN, y la
 * que se olvidaba enseñaba «sin especificar» sobre un ingreso que sí la tenía.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
async function conCuenta(fila: any): Promise<any> {
  if (fila.banco !== undefined || fila.bank_account_id == null) return fila;
  const { rows } = await pool.query(
    `SELECT banco, iban FROM cash_bank_accounts WHERE id = $1`,
    [fila.bank_account_id]
  );
  return { ...fila, banco: rows[0]?.banco ?? null, iban: rows[0]?.iban ?? null };
}

function aIngreso(r: any, cierres: CierreConciliado[], esUltimo: boolean): IngresoBancario {
  return {
    id: r.id,
    numero: r.numero,
    estado: r.estado,
    registerId: r.register_id,
    fechaIngreso: fechaIso(r.fecha_ingreso),
    referencia: r.referencia,
    bankAccountId: r.bank_account_id ?? null,
    banco: r.banco ?? null,
    iban: r.iban ?? null,
    observaciones: r.observaciones,
    remanenteAnteriorCentimos: Number(r.remanente_anterior_centimos),
    totalCierresCentimos: Number(r.total_cierres_centimos),
    importeCentimos: Number(r.importe_centimos),
    remanenteNuevoCentimos: Number(r.remanente_nuevo_centimos),
    cierres,
    creadoPor: r.creado_por,
    creadoAtMs: Number(r.creado_at_ms),
    anuladoAtMs: r.anulado_at_ms == null ? null : Number(r.anulado_at_ms),
    anuladoMotivo: r.anulado_motivo,
    esUltimo,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Consultas ──────────────────────────────────────────────────────────────

/**
 * Remanente actual de la caja: el del último ingreso confirmado, o cero si
 * nunca se ha ingresado. Derivado, nunca almacenado aparte.
 */
export async function remanenteActual(
  client: PoolClient | typeof pool,
  registerId: number
): Promise<Centimos> {
  const { rows } = await client.query(
    `SELECT remanente_nuevo_centimos FROM cash_bank_deposits
      WHERE register_id = $1 AND estado = 'CONFIRMADO'
      ORDER BY id DESC LIMIT 1`,
    [registerId]
  );
  return rows.length ? Number(rows[0].remanente_nuevo_centimos) : 0;
}

/**
 * Cierres todavía sin conciliar: jornadas cerradas cuyo importe "para el
 * banco" no forma parte de ningún ingreso vigente.
 */
export async function cierresPendientes(
  empresaId: string,
  registerId: number
): Promise<CierrePendiente[]> {
  // El nombre de quien cerró vive en app_usuarios, que es del SaaS y puede no
  // existir en una base de pruebas del módulo: se comprueba antes de unir.
  const { rows: hayUsuarios } = await pool.query(
    `SELECT to_regclass('public.app_usuarios') IS NOT NULL AS hay`
  );
  const conNombre = Boolean(hayUsuarios[0]?.hay);

  const { rows } = await pool.query(
    `SELECT s.id, s.fecha, s.ingreso_bancario_centimos, s.cerrada_por
            ${conNombre ? ", u.nombre AS cerrada_por_nombre" : ""}
       FROM cash_sessions s
       ${conNombre ? "LEFT JOIN app_usuarios u ON u.id = s.cerrada_por" : ""}
      WHERE s.empresa_id = $1 AND s.register_id = $2
        AND s.estado = 'CLOSED'
        AND s.ingreso_bancario_centimos > 0
        AND NOT EXISTS (
          SELECT 1 FROM cash_bank_deposit_sessions l
           WHERE l.session_id = s.id AND l.vigente
        )
      ORDER BY s.fecha, s.id`,
    [empresaId, registerId]
  );

  const hoy = Date.now();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => {
    const fecha = fechaIso(r.fecha)!;
    return {
      sessionId: r.id,
      fecha,
      importeCentimos: Number(r.ingreso_bancario_centimos),
      cerradaPor: r.cerrada_por,
      cerradaPorNombre: r.cerrada_por_nombre ?? null,
      dias: Math.max(0, Math.floor((hoy - Date.parse(fecha)) / 86_400_000)),
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Historial de ingresos de la caja, con sus cierres, el más reciente primero. */
export async function listarIngresos(
  empresaId: string,
  registerId: number
): Promise<IngresoBancario[]> {
  const { rows } = await pool.query(
    `SELECT d.*, c.banco, c.iban
       FROM cash_bank_deposits d
       LEFT JOIN cash_bank_accounts c ON c.id = d.bank_account_id
      WHERE d.empresa_id = $1 AND d.register_id = $2
      ORDER BY d.id DESC LIMIT 100`,
    [empresaId, registerId]
  );
  if (rows.length === 0) return [];

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { rows: lineas } = await pool.query(
    `SELECT l.deposit_id, l.session_id, l.importe_centimos, s.fecha
       FROM cash_bank_deposit_sessions l
       JOIN cash_sessions s ON s.id = l.session_id
      WHERE l.deposit_id = ANY($1::int[])
      ORDER BY s.fecha, s.id`,
    [rows.map((r: any) => r.id)]
  );
  const ultimoConfirmado = rows.find((r: any) => r.estado === "CONFIRMADO")?.id ?? null;

  return rows.map((r: any) =>
    aIngreso(
      r,
      lineas
        .filter((l: any) => l.deposit_id === r.id)
        .map((l: any) => ({
          sessionId: l.session_id,
          fecha: fechaIso(l.fecha)!,
          importeCentimos: Number(l.importe_centimos),
        })),
      r.id === ultimoConfirmado
    )
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Todo lo que necesita la pantalla, en una llamada. */
export async function panelIngresos(empresaId: string, registerId: number) {
  const [pendientes, remanente, ingresos] = await Promise.all([
    cierresPendientes(empresaId, registerId),
    remanenteActual(pool, registerId),
    listarIngresos(empresaId, registerId),
  ]);
  return {
    pendientes,
    remanenteCentimos: remanente,
    totalPendienteCentimos: pendientes.reduce((a, c) => a + c.importeCentimos, 0),
    ingresos,
  };
}

// ── Crear un ingreso ───────────────────────────────────────────────────────

export type EntradaIngreso = {
  registerId: number;
  sessionIds: number[];
  /** Lo que de verdad se lleva al banco, en billetes. */
  importeCentimos: Centimos;
  /** Fecha real del ingreso en el banco. Sin ella, la de registro. */
  fechaIngreso?: string;
  referencia?: string;
  observaciones?: string;
  /** Cuenta a la que va. Si no se dice, la marcada por defecto. */
  bankAccountId?: number;
};

export async function crearIngreso(ctx: Contexto, e: EntradaIngreso): Promise<IngresoBancario> {
  if (!Number.isSafeInteger(e.importeCentimos) || e.importeCentimos <= 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "El importe a ingresar tiene que ser mayor que cero.", 400);
  }
  const sessionIds = [...new Set(e.sessionIds ?? [])];
  if (sessionIds.length === 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Selecciona al menos un cierre para el ingreso.", 400);
  }

  const ingreso = await enTransaccion(async (client) => {
    /*
     * El bloqueo de la caja serializa la cadena: dos ingresos a la vez para la
     * misma caja se ejecutan uno detrás de otro, y el segundo ve el remanente
     * que dejó el primero. Sin esto, ambos leerían el mismo remanente anterior
     * y la cadena contable quedaría rota aunque cada fila cuadrara.
     */
    const { rows: cajas } = await client.query(
      `SELECT id FROM cash_registers WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [e.registerId, ctx.empresaId]
    );
    if (cajas.length === 0) {
      throw new ErrorCaja("CAJA_NO_ENCONTRADA", "La caja no existe.", 404);
    }

    // Los cierres, bloqueados también: así un reabrir simultáneo espera.
    const { rows: sesiones } = await client.query(
      `SELECT id, fecha, estado, ingreso_bancario_centimos
         FROM cash_sessions
        WHERE id = ANY($1::int[]) AND empresa_id = $2 AND register_id = $3
        FOR UPDATE`,
      [sessionIds, ctx.empresaId, e.registerId]
    );
    if (sesiones.length !== sessionIds.length) {
      throw new ErrorCaja(
        "CIERRE_NO_ENCONTRADO",
        "Alguno de los cierres seleccionados no existe o no es de esta caja.",
        404
      );
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    for (const s of sesiones as any[]) {
      if (s.estado !== "CLOSED") {
        throw new ErrorCaja(
          "CIERRE_NO_CERRADO",
          `La jornada del ${fechaIso(s.fecha)} no está cerrada.`,
          409
        );
      }
      if (!(Number(s.ingreso_bancario_centimos) > 0)) {
        throw new ErrorCaja(
          "CIERRE_SIN_IMPORTE",
          `El cierre del ${fechaIso(s.fecha)} no dejó nada para el banco.`,
          409
        );
      }
    }

    const { rows: yaUsadas } = await client.query(
      `SELECT l.session_id, s.fecha
         FROM cash_bank_deposit_sessions l
         JOIN cash_sessions s ON s.id = l.session_id
        WHERE l.session_id = ANY($1::int[]) AND l.vigente`,
      [sessionIds]
    );
    if (yaUsadas.length > 0) {
      throw new ErrorCaja(
        "CIERRE_YA_CONCILIADO",
        `El cierre del ${fechaIso(yaUsadas[0].fecha)} ya forma parte de otro ingreso.`,
        409
      );
    }

    const totalCierres = (sesiones as any[]).reduce(
      (a, s) => a + Number(s.ingreso_bancario_centimos),
      0
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const remanenteAnterior = await remanenteActual(client, e.registerId);
    /*
     * Lo que se ha devuelto al cajón para reponer su fondo ya no está en la
     * bolsa: se descuenta aquí o se podría ingresar en el banco un dinero que
     * está otra vez en el mostrador.
     */
    const repuesto = await repuestoPendiente(client, ctx.empresaId, e.registerId);
    const disponible = remanenteAnterior + totalCierres - repuesto;

    if (e.importeCentimos > disponible) {
      throw new ErrorCaja(
        "INGRESO_SUPERA_DISPONIBLE",
        `Se quieren ingresar ${formatearEuros(e.importeCentimos)} € y el efectivo bajo control son ${formatearEuros(disponible)} € (${formatearEuros(totalCierres)} € de cierres más ${formatearEuros(remanenteAnterior)} € de remanente${repuesto > 0 ? `, menos ${formatearEuros(repuesto)} € devueltos al cajón para reponer su fondo` : ""}).`,
        400
      );
    }
    const remanenteNuevo = disponible - e.importeCentimos;

    /*
     * A qué cuenta va. Si no se dice, la marcada por defecto: es lo normal —una
     * empresa ingresa casi siempre en la misma— y obligar a elegirla cada vez
     * sería un estorbo diario. Puede quedar en NULL si aún no hay ninguna dada
     * de alta, y entonces se rellena después desde la pantalla.
     */
    let cuentaId: number | null = e.bankAccountId ?? null;
    if (cuentaId != null) {
      const { rows: cta } = await client.query(
        `SELECT id, activa FROM cash_bank_accounts WHERE id = $1 AND empresa_id = $2`,
        [cuentaId, ctx.empresaId]
      );
      if (cta.length === 0) {
        throw new ErrorCaja("CUENTA_NO_ENCONTRADA", "La cuenta bancaria no existe.", 404);
      }
      if (!cta[0].activa) {
        throw new ErrorCaja("CUENTA_DE_BAJA", "Esa cuenta bancaria está dada de baja.", 409);
      }
    } else {
      const { rows: pordef } = await client.query(
        `SELECT id FROM cash_bank_accounts WHERE empresa_id = $1 AND por_defecto AND activa`,
        [ctx.empresaId]
      );
      cuentaId = pordef[0]?.id ?? null;
    }

    const anio = Number((e.fechaIngreso ?? new Date().toISOString()).slice(0, 4));
    const numero = await siguienteNumeroDe(client, await codigoDeCaja(client, e.registerId), "IB", anio);
    const ahora = Date.now();

    const { rows: creado } = await client.query(
      `INSERT INTO cash_bank_deposits
         (empresa_id, register_id, numero, estado, fecha_ingreso, referencia, observaciones,
          remanente_anterior_centimos, total_cierres_centimos, importe_centimos,
          remanente_nuevo_centimos, creado_por, creado_at_ms, bank_account_id)
       VALUES ($1,$2,$3,'CONFIRMADO',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        ctx.empresaId,
        e.registerId,
        numero,
        e.fechaIngreso ?? null,
        e.referencia?.trim() || null,
        e.observaciones?.trim() || null,
        remanenteAnterior,
        totalCierres,
        e.importeCentimos,
        remanenteNuevo,
        ctx.userId,
        ahora,
        cuentaId,
      ]
    );
    const depositId = creado[0].id;

    const cierres: CierreConciliado[] = [];
    /* eslint-disable @typescript-eslint/no-explicit-any */
    for (const s of sesiones as any[]) {
      await client.query(
        `INSERT INTO cash_bank_deposit_sessions (deposit_id, session_id, importe_centimos)
         VALUES ($1,$2,$3)`,
        [depositId, s.id, Number(s.ingreso_bancario_centimos)]
      );
      cierres.push({
        sessionId: s.id,
        fecha: fechaIso(s.fecha)!,
        importeCentimos: Number(s.ingreso_bancario_centimos),
      });
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    /*
     * Los canjes vigentes quedan consumidos por este ingreso: ya han cumplido
     * su papel —convertir monedas en billetes de ESTE montón— y a partir de
     * aquí no deben tocar el montón siguiente.
     */
    await client.query(
      `UPDATE cash_deposit_swaps SET bank_deposit_id = $1
        WHERE register_id = $2 AND empresa_id = $3 AND bank_deposit_id IS NULL`,
      [depositId, e.registerId, ctx.empresaId]
    );
    // Y las reposiciones de fondo, por lo mismo: ya han descontado de ESTE
    // montón y no deben volver a descontar del siguiente.
    await client.query(
      `UPDATE cash_float_topups SET bank_deposit_id = $1
        WHERE register_id = $2 AND empresa_id = $3 AND bank_deposit_id IS NULL`,
      [depositId, e.registerId, ctx.empresaId]
    );

    cierres.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.sessionId - b.sessionId));

    /*
     * El agregado es la CAJA, no una jornada: un ingreso agrupa varios cierres
     * y no pertenece a ninguno. Forzarlo dentro de una jornada obligaría a
     * elegir cuál de los cierres agrupados manda, y cualquier respuesta sería
     * inventada. La versión sube dentro del bloqueo de la caja que esta
     * transacción ya tiene tomado.
     */
    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, e.registerId),
      registerId: e.registerId,
      agregado: { tipo: "REGISTER", id: e.registerId },
      tipo: "BANK_DEPOSIT_CREATED",
      ocurridoEnMs: Date.now(),
      actorUserId: ctx.userId,
      /*
       * El ORIGEN del ingreso viaja entero: qué jornadas lo componen, de qué
       * día es cada una y cuánto puso. Es lo que permite contestar, cuando el
       * banco apunta un abono de 3.480 €, de qué días y de qué caja salió ese
       * dinero — sin eso, un ingreso es un número suelto que no se concilia
       * con nada.
       *
       * Van también los ids sueltos en `cierres` porque es lo que ya
       * consumía la proyección desde la fase 3, y los eventos viejos que
       * siguen en la cola llevan solo eso.
       */
      datos: {
        depositId,
        numero: creado[0].numero,
        importeCentimos: Number(creado[0].importe_centimos),
        remanenteAnteriorCentimos: Number(creado[0].remanente_anterior_centimos),
        remanenteNuevoCentimos: Number(creado[0].remanente_nuevo_centimos),
        totalCierresCentimos: Number(creado[0].total_cierres_centimos),
        referencia: creado[0].referencia ?? null,
        fecha: fechaIso(creado[0].fecha_ingreso) ?? null,
        cierres: cierres.map((c) => c.sessionId),
        origen: cierres,
      },
    });

    return aIngreso(await conCuenta(creado[0]), cierres, true);
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.bank_deposit.create",
    entidad: "cash_bank_deposits",
    entidadId: String(ingreso.id),
    detalle: {
      numero: ingreso.numero,
      remanenteAnteriorCentimos: ingreso.remanenteAnteriorCentimos,
      totalCierresCentimos: ingreso.totalCierresCentimos,
      importeCentimos: ingreso.importeCentimos,
      remanenteNuevoCentimos: ingreso.remanenteNuevoCentimos,
      cierres: ingreso.cierres,
    },
    ip: ctx.ip,
  });

  return ingreso;
}

// ── Anular ─────────────────────────────────────────────────────────────────

/**
 * Completa un ingreso con los datos que da el banco al hacerlo de verdad.
 *
 * El ingreso se registra en la tienda al preparar la bolsa, pero la fecha real
 * y la referencia las da el banco DESPUÉS, cuando alguien vuelve con el
 * resguardo. Hasta ahora esos campos solo se podían poner al crear, y si no
 * se sabían aún —lo normal— quedaban en «—» para siempre.
 *
 * Solo toca fecha, referencia y observaciones. Los importes no: esos salieron
 * del libro mayor y se corrigen anulando el ingreso, no editándolo.
 */
export async function completarIngreso(
  ctx: Contexto,
  e: {
    depositId: number;
    fechaIngreso?: string | null;
    referencia?: string | null;
    observaciones?: string | null;
    /** Cuenta a la que fue. null la desvincula; omitirlo la deja como estaba. */
    bankAccountId?: number | null;
  }
): Promise<IngresoBancario> {
  const { rows: previo } = await pool.query(
    `SELECT * FROM cash_bank_deposits WHERE id = $1 AND empresa_id = $2`,
    [e.depositId, ctx.empresaId]
  );
  if (previo.length === 0) {
    throw new ErrorCaja("INGRESO_NO_ENCONTRADO", "El ingreso no existe.", 404);
  }
  if (previo[0].estado !== "CONFIRMADO") {
    throw new ErrorCaja(
      "INGRESO_ANULADO",
      "El ingreso está anulado: no tiene sentido completarle los datos del banco.",
      409
    );
  }

  // undefined = no tocar; null o vacío = borrar el dato.
  const limpio = (v: string | null | undefined) => {
    if (v === undefined) return undefined;
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  const fecha = limpio(e.fechaIngreso);
  if (fecha !== undefined && fecha !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "La fecha del ingreso tiene que ser AAAA-MM-DD.", 400);
  }
  const referencia = limpio(e.referencia);
  const observaciones = limpio(e.observaciones);

  // La cuenta se comprueba aquí y no en el UPDATE: un id de otra empresa no
  // puede acabar escrito en un ingreso ni por error ni a propósito.
  if (e.bankAccountId != null) {
    const { rows: cta } = await pool.query(
      `SELECT id, activa FROM cash_bank_accounts WHERE id = $1 AND empresa_id = $2`,
      [e.bankAccountId, ctx.empresaId]
    );
    if (cta.length === 0) {
      throw new ErrorCaja("CUENTA_NO_ENCONTRADA", "La cuenta bancaria no existe.", 404);
    }
    /*
     * Una cuenta de baja SÍ se admite al completar: el ingreso pudo hacerse
     * cuando aún estaba abierta y lo que se está haciendo es apuntar dónde fue
     * de verdad, no elegir dónde va.
     */
  }

  /*
   * En transacción, y con el aviso a Central DENTRO: es el patrón de outbox
   * transaccional del módulo. Antes esto era un UPDATE suelto sin evento, y el
   * resultado era que la caja marcaba el ingreso como confirmado mientras
   * Central seguía enseñándolo como «pendiente de confirmar» — la fecha del
   * banco no salía de la caja.
   */
  const client = await pool.connect();
  // La fila que devuelve el UPDATE, con lo justo que se lee de ella aquí. Un
  // `any[]` habría bastado para compilar, pero el fichero no usa `any` para
  // esto y no hay razón para empezar.
  let rows: { fecha_ingreso: unknown; referencia: string | null }[];
  try {
    await client.query("BEGIN");
    const actualizado = await client.query(
      `UPDATE cash_bank_deposits
          SET fecha_ingreso   = CASE WHEN $3 THEN $4::date ELSE fecha_ingreso   END,
              referencia      = CASE WHEN $5 THEN $6       ELSE referencia      END,
              observaciones   = CASE WHEN $7 THEN $8       ELSE observaciones   END,
              bank_account_id = CASE WHEN $9 THEN $10::int ELSE bank_account_id END
        WHERE id = $1 AND empresa_id = $2
        RETURNING *`,
      [
        e.depositId,
        ctx.empresaId,
        fecha !== undefined,
        fecha ?? null,
        referencia !== undefined,
        referencia ?? null,
        observaciones !== undefined,
        observaciones ?? null,
        e.bankAccountId !== undefined,
        e.bankAccountId ?? null,
      ]
    );
    rows = actualizado.rows;

    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, Number(previo[0].register_id)),
      registerId: Number(previo[0].register_id),
      agregado: { tipo: "REGISTER", id: Number(previo[0].register_id) },
      tipo: "BANK_DEPOSIT_COMPLETED",
      ocurridoEnMs: Date.now(),
      actorUserId: ctx.userId,
      datos: {
        depositId: e.depositId,
        fecha: fechaIso(rows[0]?.fecha_ingreso) ?? null,
        referencia: rows[0]?.referencia ?? null,
      },
    });

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.deposit.complete",
    entidad: "cash_bank_deposits",
    entidadId: String(e.depositId),
    detalle: {
      numero: previo[0].numero,
      antes: {
        fechaIngreso: fechaIso(previo[0].fecha_ingreso),
        referencia: previo[0].referencia,
      },
      despues: { fechaIngreso: fecha ?? fechaIso(previo[0].fecha_ingreso), referencia: referencia ?? previo[0].referencia },
    },
    ip: ctx.ip,
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { rows: lineas } = await pool.query(
    `SELECT l.session_id, l.importe_centimos, s.fecha
       FROM cash_bank_deposit_sessions l
       JOIN cash_sessions s ON s.id = l.session_id
      WHERE l.deposit_id = $1 AND l.vigente
      ORDER BY s.fecha, s.id`,
    [e.depositId]
  );
  return aIngreso(
    await conCuenta(rows[0]),
    lineas.map((l: any) => ({
      sessionId: l.session_id,
      fecha: fechaIso(l.fecha)!,
      importeCentimos: Number(l.importe_centimos),
    })),
    false
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function anularIngreso(
  ctx: Contexto,
  ingresoId: number,
  motivo: string
): Promise<IngresoBancario> {
  if (!String(motivo ?? "").trim()) {
    throw new ErrorCaja("FALTA_MOTIVO", "Anular un ingreso exige indicar el motivo.", 400);
  }

  const ingreso = await enTransaccion(async (client) => {
    const { rows: previas } = await client.query(
      `SELECT * FROM cash_bank_deposits WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [ingresoId, ctx.empresaId]
    );
    if (previas.length === 0) {
      throw new ErrorCaja("INGRESO_NO_ENCONTRADO", "El ingreso no existe.", 404);
    }
    const previo = previas[0];
    if (previo.estado !== "CONFIRMADO") {
      throw new ErrorCaja("INGRESO_YA_ANULADO", `El ingreso ${previo.numero} ya está anulado.`, 409);
    }

    // Mismo bloqueo que al crear: la cadena de remanentes se toca en serie.
    await client.query(`SELECT id FROM cash_registers WHERE id = $1 FOR UPDATE`, [
      previo.register_id,
    ]);

    /*
     * Solo el último. El remanente es una cadena: el ingreso siguiente arrancó
     * del remanente que dejó éste, y anularlo por debajo dejaría esa cadena
     * apuntando a un número que ya no existe. Para deshacer más atrás se anula
     * en orden, del último hacia abajo, y cada paso restaura exactamente.
     */
    const { rows: posteriores } = await client.query(
      `SELECT numero FROM cash_bank_deposits
        WHERE register_id = $1 AND estado = 'CONFIRMADO' AND id > $2
        ORDER BY id LIMIT 1`,
      [previo.register_id, ingresoId]
    );
    if (posteriores.length > 0) {
      throw new ErrorCaja(
        "INGRESO_NO_ES_ULTIMO",
        `Después de éste se registró el ingreso ${posteriores[0].numero}, que arrancó de su remanente. Anula primero el más reciente.`,
        409
      );
    }

    /*
     * Anular devuelve los cierres a pendientes, así que sus canjes vuelven a
     * contar: el montón que reaparece es el que había, con sus monedas ya
     * cambiadas por billetes.
     */
    await client.query(
      `UPDATE cash_deposit_swaps SET bank_deposit_id = NULL WHERE bank_deposit_id = $1`,
      [ingresoId]
    );
    await client.query(
      `UPDATE cash_float_topups SET bank_deposit_id = NULL WHERE bank_deposit_id = $1`,
      [ingresoId]
    );
    await client.query(
      `UPDATE cash_bank_deposit_sessions SET vigente = false WHERE deposit_id = $1`,
      [ingresoId]
    );
    const { rows: actualizado } = await client.query(
      `UPDATE cash_bank_deposits
          SET estado = 'ANULADO', anulado_por = $2, anulado_at_ms = $3, anulado_motivo = $4
        WHERE id = $1
        RETURNING *`,
      [ingresoId, ctx.userId, Date.now(), motivo.trim()]
    );

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { rows: lineas } = await client.query(
      `SELECT l.session_id, l.importe_centimos, s.fecha
         FROM cash_bank_deposit_sessions l
         JOIN cash_sessions s ON s.id = l.session_id
        WHERE l.deposit_id = $1
        ORDER BY s.fecha, s.id`,
      [ingresoId]
    );
    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, actualizado[0].register_id),
      registerId: actualizado[0].register_id,
      agregado: { tipo: "REGISTER", id: actualizado[0].register_id },
      tipo: "BANK_DEPOSIT_VOIDED",
      ocurridoEnMs: Date.now(),
      actorUserId: ctx.userId,
      /*
       * Los cierres viajan también aquí, y no solo en el alta: al anular
       * vuelven a estar pendientes, y quien los proyecta tiene que saber
       * CUÁLES para devolverlos a la posición global. Deducirlo preguntando a
       * la caja rompería que Central se sostenga solo con sus eventos.
       */
      datos: {
        depositId: ingresoId,
        numero: actualizado[0].numero,
        importeCentimos: Number(actualizado[0].importe_centimos),
        cierres: lineas.map((l: any) => l.session_id),
        origen: lineas.map((l: any) => ({
          sessionId: l.session_id,
          fecha: fechaIso(l.fecha),
          importeCentimos: Number(l.importe_centimos),
        })),
        motivo: motivo.trim(),
      },
    });

    return aIngreso(
      await conCuenta(actualizado[0]),
      lineas.map((l: any) => ({
        sessionId: l.session_id,
        fecha: fechaIso(l.fecha)!,
        importeCentimos: Number(l.importe_centimos),
      })),
      false
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.bank_deposit.void",
    entidad: "cash_bank_deposits",
    entidadId: String(ingreso.id),
    detalle: {
      numero: ingreso.numero,
      motivo,
      importeCentimos: ingreso.importeCentimos,
      cierresLiberados: ingreso.cierres.map((c) => c.sessionId),
    },
    ip: ctx.ip,
  });

  return ingreso;
}

// ── Canje de monedas por billetes ──────────────────────────────────────────

/**
 * Composición real del montón que espera para ir al banco.
 *
 * Los cierres pendientes guardan un total, no un desglose, pero el desglose
 * existe: son los asientos `BANK_DEPOSIT` de cada jornada. Sumarlos da las
 * piezas exactas que hay en la bolsa.
 *
 * Y encima se le aplican los canjes que ya se hayan hecho contra ese montón:
 * lo que entró en la caja sale del montón, y lo que salió de la caja entra.
 * Sin eso, el desglose seguiría diciendo que hay monedas que ya se cambiaron.
 */
export async function composicionPendiente(
  empresaId: string,
  registerId: number,
  sessionIds: readonly number[],
  client: PoolClient | typeof pool = pool,
  /*
   * Qué canjes cuentan. `null` = los que todavía no se han ingresado, que es
   * el montón de la pantalla. Un id = los de ESE ingreso, para recomponer a
   * posteriori con qué billetes se fue al banco: en cuanto el ingreso se
   * registra, sus canjes dejan de estar pendientes y el montón ya no los ve.
   */
  canjesDe: number | null = null
): Promise<{ billetes: LineaDenominacion[]; monedas: LineaDenominacion[] }> {
  const piezas = new Map<Centimos, number>();
  const acumular = (valor: Centimos, cantidad: number) => {
    const n = (piezas.get(valor) ?? 0) + cantidad;
    if (n === 0) piezas.delete(valor);
    else piezas.set(valor, n);
  };

  if (sessionIds.length > 0) {
    const { rows } = await client.query(
      `SELECT valor_unitario_centimos AS valor, SUM(cantidad)::int AS n
         FROM cash_denomination_movements
        WHERE session_id = ANY($1::int[]) AND motivo = 'BANK_DEPOSIT' AND direccion = 'OUT'
        GROUP BY valor_unitario_centimos`,
      [[...sessionIds]]
    );
    for (const r of rows) acumular(Number(r.valor), Number(r.n));
  }

  /*
   * Canjes todavía vigentes de esta caja. La dirección se invierte a
   * propósito: lo que ENTRA en la caja sale del montón, y al revés.
   */
  const { rows: canjes } = await client.query(
    `SELECT m.valor_unitario_centimos AS valor, m.direccion, SUM(m.cantidad)::int AS n
       FROM cash_deposit_swaps s
       JOIN cash_denomination_movements m ON m.operation_id = s.operation_id
      WHERE s.empresa_id = $1 AND s.register_id = $2
        AND ($3::int IS NULL AND s.bank_deposit_id IS NULL
             OR s.bank_deposit_id = $3::int)
      GROUP BY m.valor_unitario_centimos, m.direccion`,
    [empresaId, registerId, canjesDe]
  );
  for (const r of canjes) {
    acumular(Number(r.valor), r.direccion === "IN" ? -Number(r.n) : Number(r.n));
  }

  /*
   * Y las reposiciones de fondo, que SALEN del montón hacia el cajón. Al revés
   * que el canje, esto no devuelve nada: el montón se queda con menos valor,
   * que es exactamente el punto. Sin restarlo aquí, el montón diría que tiene
   * un dinero que ya está otra vez en el cajón y se podría ingresar dos veces.
   */
  const { rows: reposiciones } = await client.query(
    `SELECT m.valor_unitario_centimos AS valor, SUM(m.cantidad)::int AS n
       FROM cash_float_topups t
       JOIN cash_denomination_movements m ON m.operation_id = t.operation_id
      WHERE t.empresa_id = $1 AND t.register_id = $2
        AND m.direccion = 'IN'
        AND ($3::int IS NULL AND t.bank_deposit_id IS NULL
             OR t.bank_deposit_id = $3::int)
      GROUP BY m.valor_unitario_centimos`,
    [empresaId, registerId, canjesDe]
  );
  for (const r of reposiciones) acumular(Number(r.valor), -Number(r.n));

  const denominaciones = await cargarDenominaciones(client, false);
  const esBillete = new Map(denominaciones.map((d) => [d.valor, d.tipo === "BILLETE"]));

  const billetes: LineaDenominacion[] = [];
  const monedas: LineaDenominacion[] = [];
  for (const [valor, cantidad] of piezas) {
    if (cantidad <= 0) continue;
    (esBillete.get(valor) ? billetes : monedas).push({ valor, cantidad });
  }
  const porValor = (a: LineaDenominacion, b: LineaDenominacion) => b.valor - a.valor;
  return { billetes: billetes.sort(porValor), monedas: monedas.sort(porValor) };
}

/**
 * Con qué billetes se va al banco un ingreso YA registrado.
 *
 * Es lo que lleva el resguardo que se le da a quien hace el viaje. Se
 * reconstruye igual que el montón —sumando los movimientos de los cierres que
 * lo componen y aplicando sus canjes— pero mirando los canjes de ESTE ingreso
 * en vez de los pendientes.
 */
export async function composicionDeIngreso(
  empresaId: string,
  depositId: number
): Promise<{
  ingreso: IngresoBancario;
  billetes: LineaDenominacion[];
  monedas: LineaDenominacion[];
} | null> {
  // Con los datos de la cuenta: el resguardo los imprime, y sin el JOIN salían
  // como «sin especificar» aunque el ingreso sí tuviera cuenta apuntada.
  const { rows } = await pool.query(
    `SELECT d.*, c.banco, c.iban
       FROM cash_bank_deposits d
       LEFT JOIN cash_bank_accounts c ON c.id = d.bank_account_id
      WHERE d.id = $1 AND d.empresa_id = $2`,
    [depositId, empresaId]
  );
  if (rows.length === 0) return null;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { rows: lineas } = await pool.query(
    `SELECT l.session_id, l.importe_centimos, s.fecha
       FROM cash_bank_deposit_sessions l
       JOIN cash_sessions s ON s.id = l.session_id
      WHERE l.deposit_id = $1 AND l.vigente
      ORDER BY s.fecha, s.id`,
    [depositId]
  );
  const cierres = lineas.map((l: any) => ({
    sessionId: l.session_id,
    fecha: fechaIso(l.fecha)!,
    importeCentimos: Number(l.importe_centimos),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const piezas = await composicionPendiente(
    empresaId,
    rows[0].register_id,
    cierres.map((c) => c.sessionId),
    pool,
    depositId
  );

  return { ingreso: aIngreso(rows[0], cierres, false), ...piezas };
}

export type PropuestaCanje = {
  /** Desglose del montón tal y como está ahora. */
  pendiente: { billetes: LineaDenominacion[]; monedas: LineaDenominacion[] };
  /** Lo que se puede ingresar hoy: solo los billetes. */
  ingresableCentimos: Centimos;
  /** Lo que se quedaría en tienda si no se canjea nada. */
  enMonedasCentimos: Centimos;
  /** El canje propuesto, o null si la caja no tiene con qué. */
  canje: Canje | null;
  /** Falta una jornada abierta donde asentar el canje. */
  sinJornadaAbierta: boolean;
};

/**
 * Qué se puede ingresar, y qué canje lo mejoraría.
 *
 * El canje se asienta en la jornada ABIERTA —mueve el cajón, así que tiene que
 * estar en su libro mayor— y por eso sin jornada abierta se puede consultar
 * pero no ejecutar.
 */
export async function proponerCanje(
  empresaId: string,
  registerId: number,
  sessionIds: readonly number[]
): Promise<PropuestaCanje> {
  const pendiente = await composicionPendiente(empresaId, registerId, sessionIds);
  const abierta = await sesionAbierta(registerId);

  const billetesCaja = new Map<Centimos, number>();
  if (abierta) {
    const denominaciones = await cargarDenominaciones(pool, false);
    const billete = new Set(
      denominaciones.filter((d) => d.tipo === "BILLETE").map((d) => d.valor)
    );
    for (const [valor, n] of await stockTeorico(pool, abierta.id)) {
      if (billete.has(valor) && n > 0) billetesCaja.set(valor, n);
    }
  }

  return {
    pendiente,
    ingresableCentimos: pendiente.billetes.reduce((a, l) => a + l.valor * l.cantidad, 0),
    enMonedasCentimos: pendiente.monedas.reduce((a, l) => a + l.valor * l.cantidad, 0),
    canje: abierta
      ? mejorCanje(
          inventarioDesdeLineas(pendiente.monedas),
          inventarioDesdeLineas(pendiente.billetes),
          billetesCaja
        )
      : null,
    sinJornadaAbierta: !abierta,
  };
}

/**
 * Ejecuta el canje: la caja recibe las monedas y entrega los billetes.
 *
 * Es una operación `EXCHANGE` normal de la jornada abierta —la misma que «Dar
 * cambio»— porque eso es exactamente lo que ocurre: entra dinero al cajón y
 * sale el mismo importe en otras piezas. Lo único que se anota aparte es que el
 * canje fue contra el montón pendiente, para poder recomponerlo después.
 *
 * Se vuelve a validar aquí en vez de fiarse de la propuesta que traiga la
 * pantalla: entre que se propuso y se confirma pueden haberse gastado los
 * billetes del cajón, y quien manda es el stock del momento.
 */
export async function registrarCanje(
  ctx: Contexto,
  e: {
    registerId: number;
    sessionIds: number[];
    monedasEntregadas: LineaDenominacion[];
    billetesEntregados: LineaDenominacion[];
    billetesRecibidos: LineaDenominacion[];
  }
): Promise<{ operacionId: number; numero: string }> {
  const entra = [...e.monedasEntregadas, ...e.billetesEntregados].filter((l) => l.cantidad > 0);
  const sale = e.billetesRecibidos.filter((l) => l.cantidad > 0);

  const valor = (lineas: readonly LineaDenominacion[]) =>
    lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);

  if (valor(entra) === 0 || valor(entra) !== valor(sale)) {
    throw new ErrorCaja(
      "EFECTIVO_NO_CUADRA",
      "Un canje entrega y recibe el mismo importe: revisa la propuesta.",
      400
    );
  }

  const abierta = await sesionAbierta(e.registerId);
  if (!abierta) {
    throw new ErrorCaja(
      "JORNADA_NO_ABIERTA",
      "El canje mueve el cajón, así que hace falta una jornada abierta para asentarlo.",
      409
    );
  }

  // Que el montón tenga de verdad lo que se pretende entregar. Sin esto se
  // podría «canjear» una moneda que ya se cambió en un canje anterior.
  const monton = await composicionPendiente(ctx.empresaId, e.registerId, e.sessionIds);
  const hay = new Map<Centimos, number>();
  for (const l of [...monton.billetes, ...monton.monedas]) hay.set(l.valor, l.cantidad);
  for (const l of entra) {
    if ((hay.get(l.valor) ?? 0) < l.cantidad) {
      throw new ErrorCaja(
        "STOCK_INSUFICIENTE",
        `En el montón pendiente no hay ${l.cantidad} piezas de ${formatearEuros(l.valor)} €.`,
        400
      );
    }
  }

  const { registrarOperacion } = await import("./service.ts");
  const operacion = await registrarOperacion(ctx, {
    sessionId: abierta.id,
    tipo: "EXCHANGE",
    importeCentimos: valor(entra),
    formasPago: [{ forma: "CASH", importe: valor(entra) }],
    efectivoRecibido: entra,
    efectivoEntregado: sale,
    concepto: "Canje de monedas por billetes para el ingreso bancario",
  });

  await pool.query(
    `INSERT INTO cash_deposit_swaps (empresa_id, register_id, operation_id, created_at_ms)
     VALUES ($1,$2,$3,$4)`,
    [ctx.empresaId, e.registerId, operacion.operacionId, Date.now()]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.bank_deposit.swap",
    entidad: "cash_operations",
    entidadId: String(operacion.operacionId),
    detalle: {
      registerId: e.registerId,
      entregado: entra,
      recibido: sale,
      valorCentimos: valor(entra),
    },
    ip: ctx.ip,
  });

  return { operacionId: operacion.operacionId, numero: operacion.numero };
}

/**
 * Reenvía a MC Central los ingresos que ya existen en la caja.
 *
 * Central se alimenta solo de eventos, así que un ingreso creado —o completado
 * con su fecha— antes de que existiera el evento correspondiente, para Central
 * no existe o existe a medias. Esto no cambia NI UN DATO de la caja: vuelve a
 * contar lo que la caja ya dice.
 *
 * Los anulados van en dos pasos, alta y anulación, porque es como ocurrieron:
 * mandar solo el segundo dejaría en Central una fila que nunca se dio de alta.
 *
 * Devuelve cuántos ha reenviado, que es lo que la pantalla necesita para poder
 * decir algo distinto de «hecho».
 */
export async function reemitirIngresos(
  ctx: Contexto,
  filtros: { centroId?: string | null; registerId?: number | null } = {}
): Promise<{ reenviados: number }> {
  const cond: string[] = ["d.empresa_id = $1"];
  const params: unknown[] = [ctx.empresaId];
  if (filtros.centroId) {
    params.push(filtros.centroId);
    cond.push(`r.centro_id = $${params.length}`);
  }
  if (filtros.registerId) {
    params.push(filtros.registerId);
    cond.push(`d.register_id = $${params.length}`);
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { rows } = await pool.query<any>(
    `SELECT d.*, r.centro_id
       FROM cash_bank_deposits d
       JOIN cash_registers r ON r.id = d.register_id
      WHERE ${cond.join(" AND ")}
      ORDER BY d.id`,
    params
  );

  let reenviados = 0;
  for (const d of rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const comun = {
        empresaId: ctx.empresaId,
        centroId: (d.centro_id ?? null) as string | null,
        registerId: Number(d.register_id),
        agregado: { tipo: "REGISTER" as const, id: Number(d.register_id) },
        actorUserId: ctx.userId,
      };

      await emitirEvento(client, {
        ...comun,
        tipo: "BANK_DEPOSIT_CREATED",
        ocurridoEnMs: Number(d.creado_at_ms ?? Date.now()),
        datos: {
          depositId: Number(d.id),
          numero: d.numero ?? null,
          importeCentimos: Number(d.importe_centimos),
          totalCierresCentimos: Number(d.total_cierres_centimos ?? 0),
          remanenteAnteriorCentimos: Number(d.remanente_anterior_centimos ?? 0),
          remanenteNuevoCentimos: Number(d.remanente_nuevo_centimos ?? 0),
          referencia: d.referencia ?? null,
          fecha: fechaIso(d.fecha_ingreso),
        },
      });

      if (d.estado === "ANULADO") {
        await emitirEvento(client, {
          ...comun,
          tipo: "BANK_DEPOSIT_VOIDED",
          ocurridoEnMs: Date.now(),
          datos: {
            depositId: Number(d.id),
            importeCentimos: Number(d.importe_centimos),
            motivo: d.anulado_motivo ?? null,
          },
        });
      }

      await client.query("COMMIT");
      reenviados++;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "central.ingresos.reemitir",
    entidad: "cash_bank_deposits",
    entidadId: String(filtros.registerId ?? filtros.centroId ?? "todos"),
    detalle: { reenviados, filtros },
    ip: ctx.ip,
  });

  return { reenviados };
}

// ── Reposición del fondo desde el montón pendiente ─────────────────────────

/** Lo ya devuelto al cajón que todavía no ha consumido ningún ingreso. */
async function repuestoPendiente(
  client: PoolClient | typeof pool,
  empresaId: string,
  registerId: number
): Promise<Centimos> {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(importe_centimos),0)::bigint AS total
       FROM cash_float_topups
      WHERE empresa_id = $1 AND register_id = $2 AND bank_deposit_id IS NULL`,
    [empresaId, registerId]
  );
  return Number(rows[0].total);
}

export type DeficitFondo = {
  /** El fondo fijo configurado en la caja. 0 = sin fondo fijo. */
  fondoObjetivoCentimos: Centimos;
  /** Lo que hay ahora en el cajón: la jornada abierta, o el último cierre. */
  efectivoCentimos: Centimos;
  /** Lo que falta. 0 cuando la caja va justa o sobrada. */
  deficitCentimos: Centimos;
  /**
   * Cierres seguidos, hacia atrás, que han acabado por debajo del fondo.
   *
   * Es la antigüedad del problema, y se cuenta en CIERRES y no en días del
   * calendario: un taller que abre de lunes a viernes no lleva «tres días» de
   * déficit el lunes siguiente por haber pasado el fin de semana.
   */
  cierresConDeficit: number;
};

/**
 * Cuánto le falta a una caja para su fondo fijo.
 *
 * El efectivo se mira de la jornada ABIERTA si la hay —es lo que hay en el
 * cajón ahora mismo— y si no, del cambio que dejó el último cierre, que es lo
 * que habrá mañana al abrir. Las dos son la misma pregunta hecha en dos
 * momentos.
 */
export async function deficitDeCaja(
  empresaId: string,
  registerId: number
): Promise<DeficitFondo> {
  const { rows: cajas } = await pool.query(
    `SELECT fondo_objetivo_centimos FROM cash_registers WHERE id = $1 AND empresa_id = $2`,
    [registerId, empresaId]
  );
  const objetivo = Number(cajas[0]?.fondo_objetivo_centimos ?? 0);

  const abierta = await sesionAbierta(registerId);
  let efectivo = 0;
  if (abierta) {
    for (const [valor, n] of await stockTeorico(pool, abierta.id)) efectivo += valor * n;
  } else {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(m.valor_unitario_centimos * m.cantidad),0)::bigint AS total
         FROM cash_denomination_movements m
        WHERE m.session_id = (
                SELECT id FROM cash_sessions
                 WHERE register_id = $1 AND estado = 'CLOSED'
                 ORDER BY fecha DESC, id DESC LIMIT 1)
          AND m.motivo = 'CLOSING_FLOAT' AND m.direccion = 'OUT'`,
      [registerId]
    );
    efectivo = Number(rows[0].total);
  }

  /*
   * Cuántos cierres seguidos vienen quedándose cortos. Se recorren hacia atrás
   * y se para en el primero que llegó al fondo: lo que interesa es la racha
   * actual, no cuántas veces ha pasado en la vida de la caja.
   */
  let racha = 0;
  if (objetivo > 0) {
    const { rows: cierres } = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN m.motivo = 'CLOSING_FLOAT' AND m.direccion = 'OUT'
                                THEN m.valor_unitario_centimos * m.cantidad ELSE 0 END),0)::bigint AS cambio
         FROM cash_sessions s
         LEFT JOIN cash_denomination_movements m ON m.session_id = s.id
        WHERE s.register_id = $1 AND s.estado = 'CLOSED'
        GROUP BY s.id, s.fecha
        ORDER BY s.fecha DESC, s.id DESC
        LIMIT 30`,
      [registerId]
    );
    for (const c of cierres) {
      if (Number(c.cambio) >= objetivo) break;
      racha++;
    }
  }

  return {
    fondoObjetivoCentimos: objetivo,
    efectivoCentimos: efectivo,
    deficitCentimos: deficitDeFondo(objetivo, efectivo),
    cierresConDeficit: racha,
  };
}

export type PropuestaReposicion = DeficitFondo & {
  /** Lo que hay en el montón, para poder enseñarlo y para elegir de ahí. */
  monton: { billetes: LineaDenominacion[]; monedas: LineaDenominacion[] };
  /** Valor del montón: el techo de lo que se puede reponer. */
  montonCentimos: Centimos;
  /** Las piezas propuestas. Vacío = no se puede reponer nada todavía. */
  propuesta: LineaDenominacion[];
  propuestaCentimos: Centimos;
  /** La reposición mueve el cajón, así que necesita jornada abierta. */
  sinJornadaAbierta: boolean;
};

/**
 * Qué se puede devolver hoy al cajón, y con qué piezas.
 *
 * Nunca propone más de lo que falta ni más de lo que hay: si el montón está
 * vacío, la propuesta viene vacía y quien mire la pantalla verá que hay que
 * esperar al próximo cierre.
 */
export async function proponerReposicion(
  empresaId: string,
  registerId: number,
  sessionIds: readonly number[]
): Promise<PropuestaReposicion> {
  const [deficit, monton, abierta] = await Promise.all([
    deficitDeCaja(empresaId, registerId),
    composicionPendiente(empresaId, registerId, sessionIds),
    sesionAbierta(registerId),
  ]);

  const todas = [...monton.billetes, ...monton.monedas];
  const propuesta = mejorReposicion(
    inventarioDesdeLineas(todas),
    deficit.deficitCentimos
  );

  return {
    ...deficit,
    monton,
    montonCentimos: todas.reduce((a, l) => a + l.valor * l.cantidad, 0),
    propuesta,
    propuestaCentimos: propuesta.reduce((a, l) => a + l.valor * l.cantidad, 0),
    sinJornadaAbierta: !abierta,
  };
}

/**
 * Devuelve al cajón las piezas indicadas del montón pendiente.
 *
 * Se asienta como una entrada de efectivo de la jornada abierta —entra dinero
 * y no sale nada— y NO como un cobro. Esto no es un detalle de nomenclatura:
 * el desglose por secciones solo suma `COLLECTION`, `PAYMENT` y `MANUAL_OUT`,
 * así que un `MANUAL_IN` no se cuela en el reparto por secciones ni, por
 * tanto, en el cierre que se concilia con la ERP. Ese es exactamente el motivo
 * de que la reposición salga del montón y no de los cobros del día siguiente:
 * con los cobros, parte de la caja del Genes dejaría de ser venta.
 *
 * Se revalida todo aquí y no se hace caso a la propuesta que traiga la
 * pantalla: entre proponer y confirmar puede haberse hecho un canje, otra
 * reposición o un ingreso, y quien manda es el estado del momento.
 */
export async function registrarReposicion(
  ctx: Contexto,
  e: { registerId: number; sessionIds: number[]; lineas: LineaDenominacion[] }
): Promise<{ operacionId: number; numero: string; importeCentimos: Centimos }> {
  const lineas = e.lineas.filter((l) => l.cantidad > 0);
  const importe = lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);

  if (importe <= 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "No hay nada que reponer.", 400);
  }

  const deficit = await deficitDeCaja(ctx.empresaId, e.registerId);
  if (deficit.deficitCentimos <= 0) {
    throw new ErrorCaja(
      "SIN_DEFICIT",
      "Esta caja ya tiene su fondo completo: no hay nada que reponer.",
      409
    );
  }
  if (importe > deficit.deficitCentimos) {
    throw new ErrorCaja(
      "REPOSICION_EXCESIVA",
      `A la caja le faltan ${formatearEuros(deficit.deficitCentimos)} € y se quieren devolver ${formatearEuros(importe)} €. Reponer de más la dejaría por encima de su fondo.`,
      400
    );
  }

  const abierta = await sesionAbierta(e.registerId);
  if (!abierta) {
    throw new ErrorCaja(
      "JORNADA_NO_ABIERTA",
      "La reposición mete dinero en el cajón, así que hace falta una jornada abierta para asentarla.",
      409
    );
  }

  // Que el montón tenga de verdad esas piezas.
  const monton = await composicionPendiente(ctx.empresaId, e.registerId, e.sessionIds);
  const hay = new Map<Centimos, number>();
  for (const l of [...monton.billetes, ...monton.monedas]) hay.set(l.valor, l.cantidad);
  for (const l of lineas) {
    if ((hay.get(l.valor) ?? 0) < l.cantidad) {
      throw new ErrorCaja(
        "STOCK_INSUFICIENTE",
        `En el montón pendiente no hay ${l.cantidad} piezas de ${formatearEuros(l.valor)} €.`,
        400
      );
    }
  }

  const { registrarOperacion } = await import("./service.ts");
  const operacion = await registrarOperacion(ctx, {
    sessionId: abierta.id,
    tipo: "MANUAL_IN",
    importeCentimos: importe,
    formasPago: [{ forma: "CASH", importe }],
    efectivoRecibido: lineas,
    concepto: "Reposición del fondo con dinero pendiente de ingresar",
  });

  await pool.query(
    `INSERT INTO cash_float_topups
       (empresa_id, register_id, operation_id, importe_centimos, deficit_centimos,
        creado_por, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      ctx.empresaId,
      e.registerId,
      operacion.operacionId,
      importe,
      deficit.deficitCentimos,
      ctx.userId,
      Date.now(),
    ]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.bank_deposit.float_topup",
    entidad: "cash_operations",
    entidadId: String(operacion.operacionId),
    detalle: {
      registerId: e.registerId,
      lineas,
      importeCentimos: importe,
      deficitCentimos: deficit.deficitCentimos,
    },
    ip: ctx.ip,
  });

  return { ...operacion, importeCentimos: importe };
}
