/**
 * Configuración de Mobilink Cash: cajas físicas y catálogo de denominaciones.
 *
 * Va aparte del router porque tiene reglas propias, y el router no debe tener
 * ninguna. Las dos que importan son de protección, y las dos evitan dejar el
 * módulo en un estado del que no se puede salir:
 *
 *  · No se modifica ni se da de baja una caja con la jornada abierta. Quedaría
 *    dinero contado en una caja que ya no aparece, y nadie podría cerrarla.
 *  · No se desactiva una denominación que todavía tiene piezas en una caja
 *    abierta. Desaparecería de las pantallas con monedas dentro: el arqueo no
 *    podría contarla ni el cierre sacarla.
 */

import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import type { Denominacion } from "./domain/denominations.ts";
import { ErrorCaja, sesionAbierta } from "./repository.ts";

export type Contexto = { empresaId: string; userId: string | null; ip?: string };

export type CajaConfig = {
  id: number;
  centro: string;
  nombre: string;
  activa: boolean;
  jornadas: number;
  jornadaAbierta: number | null;
};

// ── Cajas ──────────────────────────────────────────────────────────────────

/** Todas las cajas de la empresa, incluidas las dadas de baja. */
export async function listarCajas(empresaId: string): Promise<CajaConfig[]> {
  const { rows } = await pool.query(
    `SELECT c.id, c.centro, c.nombre, c.activa,
            (SELECT COUNT(*) FROM cash_sessions s WHERE s.register_id = c.id) AS jornadas,
            (SELECT s.id FROM cash_sessions s
              WHERE s.register_id = c.id AND s.estado IN ('OPEN','PENDING_CLOSE','REOPENED')
              LIMIT 1) AS jornada_abierta
       FROM cash_registers c
      WHERE c.empresa_id = $1
      ORDER BY c.activa DESC, c.centro, c.nombre`,
    [empresaId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    id: r.id,
    centro: r.centro,
    nombre: r.nombre,
    activa: r.activa,
    jornadas: Number(r.jornadas),
    jornadaAbierta: r.jornada_abierta,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function crearCaja(
  ctx: Contexto,
  datos: { nombre: string; centro?: string }
): Promise<{ id: number; centro: string; nombre: string; activa: boolean }> {
  const nombre = datos.nombre?.trim();
  if (!nombre) throw new ErrorCaja("ENTRADA_NO_VALIDA", "La caja necesita un nombre.", 400);

  const ahora = Date.now();
  // El upsert reactiva una caja que se había dado de baja con ese mismo nombre
  // en vez de fallar por la clave única: es lo que espera quien la vuelve a
  // crear sin acordarse de que ya existía.
  const { rows } = await pool.query(
    `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (empresa_id, centro, nombre) DO UPDATE SET activa = true, updated_at_ms = $4
     RETURNING id, centro, nombre, activa`,
    [ctx.empresaId, (datos.centro ?? "").trim(), nombre, ahora]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.register.create",
    entidad: "cash_registers",
    entidadId: String(rows[0].id),
    detalle: { nombre: rows[0].nombre, centro: rows[0].centro },
    ip: ctx.ip,
  });

  return rows[0];
}

export async function actualizarCaja(
  ctx: Contexto,
  id: number,
  cambios: { nombre?: string; centro?: string; activa?: boolean }
): Promise<{ id: number; centro: string; nombre: string; activa: boolean }> {
  const { rows: actual } = await pool.query(
    `SELECT * FROM cash_registers WHERE id = $1 AND empresa_id = $2`,
    [id, ctx.empresaId]
  );
  if (actual.length === 0) throw new ErrorCaja("CAJA_NO_ENCONTRADA", "La caja no existe.", 404);

  const tocaIdentidad =
    cambios.activa === false || cambios.nombre !== undefined || cambios.centro !== undefined;

  if (tocaIdentidad && (await sesionAbierta(id))) {
    throw new ErrorCaja(
      "JORNADA_ABIERTA",
      "Esta caja tiene una jornada abierta. Ciérrala antes de modificarla o darla de baja.",
      409
    );
  }

  const nombre = cambios.nombre?.trim() || actual[0].nombre;
  const centro = cambios.centro === undefined ? actual[0].centro : cambios.centro.trim();
  const activa = cambios.activa === undefined ? actual[0].activa : cambios.activa;

  const { rows } = await pool.query(
    `UPDATE cash_registers
        SET nombre = $2, centro = $3, activa = $4, updated_at_ms = $5
      WHERE id = $1
      RETURNING id, centro, nombre, activa`,
    [id, nombre, centro, activa, Date.now()]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.register.update",
    entidad: "cash_registers",
    entidadId: String(id),
    detalle: {
      antes: { nombre: actual[0].nombre, centro: actual[0].centro, activa: actual[0].activa },
      despues: { nombre, centro, activa },
    },
    ip: ctx.ip,
  });

  return rows[0];
}

// ── Denominaciones ─────────────────────────────────────────────────────────

/**
 * Cambia el catálogo.
 *
 * El VALOR no se toca nunca, y por eso no es ni un parámetro: es la clave
 * natural de todo el módulo y lo que da sentido a los movimientos ya asentados.
 * Cambiar que "esta fila vale 20 €" reescribiría el pasado.
 */
export async function actualizarDenominacion(
  ctx: Contexto,
  id: number,
  cambios: { activa?: boolean; piezasPorCartucho?: number | null }
): Promise<Denominacion> {
  const { rows: actual } = await pool.query(`SELECT * FROM cash_denominations WHERE id = $1`, [id]);
  if (actual.length === 0) {
    throw new ErrorCaja("DENOMINACION_NO_ENCONTRADA", "La denominación no existe.", 404);
  }

  const activa = cambios.activa === undefined ? actual[0].activa : cambios.activa;
  const piezasPorCartucho =
    cambios.piezasPorCartucho === undefined ? actual[0].piezas_por_cartucho : cambios.piezasPorCartucho;

  if (piezasPorCartucho !== null && (!Number.isSafeInteger(piezasPorCartucho) || piezasPorCartucho <= 0)) {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "Las piezas por cartucho tienen que ser un número entero mayor que cero, o vacío.",
      400
    );
  }

  if (!activa && actual[0].activa && (await tienePiezasEnCajaAbierta(id))) {
    throw new ErrorCaja(
      "DENOMINACION_EN_USO",
      "Esa denominación todavía tiene piezas en una caja abierta. Sácalas o cierra la jornada antes de desactivarla.",
      409
    );
  }

  const { rows } = await pool.query(
    `UPDATE cash_denominations
        SET activa = $2, piezas_por_cartucho = $3, updated_at_ms = $4
      WHERE id = $1
      RETURNING id, valor_centimos, tipo, etiqueta, piezas_por_cartucho, activa, orden`,
    [id, activa, piezasPorCartucho, Date.now()]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.denomination.update",
    entidad: "cash_denominations",
    entidadId: String(id),
    detalle: {
      valorCentimos: actual[0].valor_centimos,
      antes: { activa: actual[0].activa, piezasPorCartucho: actual[0].piezas_por_cartucho },
      despues: { activa, piezasPorCartucho },
    },
    ip: ctx.ip,
  });

  const d = rows[0];
  return {
    id: d.id,
    valor: d.valor_centimos,
    tipo: d.tipo,
    etiqueta: d.etiqueta,
    piezasPorCartucho: d.piezas_por_cartucho,
    activa: d.activa,
    orden: d.orden,
  };
}

/** ¿Queda alguna pieza de esta denominación en una jornada todavía abierta? */
export async function tienePiezasEnCajaAbierta(denominationId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1
       FROM cash_denomination_movements m
       JOIN cash_sessions s ON s.id = m.session_id
      WHERE m.denomination_id = $1
        AND s.estado IN ('OPEN','PENDING_CLOSE','REOPENED')
      GROUP BY m.denomination_id
     HAVING SUM(CASE WHEN m.direccion = 'IN' THEN m.cantidad ELSE -m.cantidad END) <> 0
      LIMIT 1`,
    [denominationId]
  );
  return rows.length > 0;
}
