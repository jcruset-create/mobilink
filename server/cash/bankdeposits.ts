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
import { ErrorCaja, enTransaccion, siguienteNumeroDe } from "./repository.ts";
import type { Contexto } from "./service.ts";

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

function aIngreso(r: any, cierres: CierreConciliado[], esUltimo: boolean): IngresoBancario {
  return {
    id: r.id,
    numero: r.numero,
    estado: r.estado,
    registerId: r.register_id,
    fechaIngreso: fechaIso(r.fecha_ingreso),
    referencia: r.referencia,
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
    `SELECT * FROM cash_bank_deposits
      WHERE empresa_id = $1 AND register_id = $2
      ORDER BY id DESC LIMIT 100`,
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
    const disponible = remanenteAnterior + totalCierres;

    if (e.importeCentimos > disponible) {
      throw new ErrorCaja(
        "INGRESO_SUPERA_DISPONIBLE",
        `Se quieren ingresar ${formatearEuros(e.importeCentimos)} € y el efectivo bajo control son ${formatearEuros(disponible)} € (${formatearEuros(totalCierres)} € de cierres más ${formatearEuros(remanenteAnterior)} € de remanente).`,
        400
      );
    }
    const remanenteNuevo = disponible - e.importeCentimos;

    const anio = Number((e.fechaIngreso ?? new Date().toISOString()).slice(0, 4));
    const numero = await siguienteNumeroDe(client, "IB", anio);
    const ahora = Date.now();

    const { rows: creado } = await client.query(
      `INSERT INTO cash_bank_deposits
         (empresa_id, register_id, numero, estado, fecha_ingreso, referencia, observaciones,
          remanente_anterior_centimos, total_cierres_centimos, importe_centimos,
          remanente_nuevo_centimos, creado_por, creado_at_ms)
       VALUES ($1,$2,$3,'CONFIRMADO',$4,$5,$6,$7,$8,$9,$10,$11,$12)
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

    cierres.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.sessionId - b.sessionId));
    return aIngreso(creado[0], cierres, true);
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
    return aIngreso(
      actualizado[0],
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
