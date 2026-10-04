/**
 * Quién puede tocar qué caja: el taller y las cajas de cada usuario.
 *
 * Dos escalones:
 *
 * · **Taller** (`app_usuario_modulos.centro_id`, ya existía). Limita a todo el
 *   mundo que lo tenga: solo ve las cajas de su taller. `null` = toda la
 *   empresa.
 * · **Cajas** (`cash_usuario_cajas`, nuevo). Dentro de su taller, qué cajas.
 *   Solo limita a quien está en el mostrador: **cajero** y **consulta**. El
 *   responsable y el admin supervisan, así que ven todas las de su taller.
 *
 * El segundo escalón va detrás de un interruptor por empresa
 * (`exigir_asignacion_caja`), apagado al desplegar. Si entrara encendido, el
 * lunes nadie tendría cajas asignadas y nadie podría abrir la suya: primero se
 * asigna y luego se enciende. Mientras está apagado todo funciona como antes.
 *
 * Un usuario tiene un solo taller, y sus cajas tienen que ser de ese taller:
 * se comprueba al asignar. Para que alguien cubra dos talleres se le deja sin
 * taller y con las cajas de los dos —eso solo lo puede decidir un admin—.
 */

import pool from "../db.ts";
import { registrarAuditoria, registrarAuditoriaEnTransaccion } from "../core/auditoria.ts";
import { ErrorCaja } from "./errors.ts";
import type { Contexto } from "./config.ts";

export const CLAVE_EXIGIR_ASIGNACION = "exigir_asignacion_caja";

/** Los roles que solo ven sus cajas asignadas. */
const ROLES_LIMITADOS_POR_CAJA = new Set(["cajero", "consulta"]);

export const limitadoPorCaja = (rol: string | null | undefined) =>
  ROLES_LIMITADOS_POR_CAJA.has(String(rol ?? ""));

/**
 * Las cajas a las que se limita este usuario, o `null` si no se limita por
 * caja (solo por taller, si lo tiene).
 *
 * Una sola consulta por petición: el interruptor y las cajas juntos. Sin
 * caché por lo mismo que `rolDeCaja`: quitarle una caja a alguien tiene que
 * surtir efecto en su siguiente clic, no dentro de un minuto.
 */
export async function limiteDeCajas(
  empresaId: string,
  userId: string,
  rol: string | null,
  esSuperadmin: boolean
): Promise<number[] | null> {
  if (esSuperadmin || !limitadoPorCaja(rol)) return null;
  const { rows } = await pool.query<{ exige: string | null; cajas: number[] | null }>(
    `SELECT (SELECT valor FROM cash_settings WHERE empresa_id = $1 AND clave = $2) AS exige,
            (SELECT array_agg(register_id ORDER BY register_id)
               FROM cash_usuario_cajas WHERE empresa_id = $1 AND user_id = $3) AS cajas`,
    [empresaId, CLAVE_EXIGIR_ASIGNACION, userId]
  );
  if (rows[0]?.exige !== "1") return null;
  return (rows[0]?.cajas ?? []).map(Number);
}

export async function exigeAsignacion(empresaId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT valor FROM cash_settings WHERE empresa_id = $1 AND clave = $2`,
    [empresaId, CLAVE_EXIGIR_ASIGNACION]
  );
  return rows[0]?.valor === "1";
}

// ── Lo que ve el admin ─────────────────────────────────────────────────────

export type AccesoUsuario = {
  userId: string;
  nombre: string;
  username: string;
  activo: boolean;
  rol: string | null;
  /** Taller. `null` = toda la empresa. */
  centroId: string | null;
  /** Cajas asignadas. Solo cuentan si `limitadoPorCaja`. */
  cajas: number[];
  /** Cajero o consulta: con el interruptor encendido, solo ve sus cajas. */
  limitadoPorCaja: boolean;
};

export type Accesos = {
  exigirAsignacion: boolean;
  usuarios: AccesoUsuario[];
  /**
   * Cajeros y consulta activos sin ninguna caja: con el interruptor encendido
   * no verían ninguna. Es lo que hay que mirar antes de encenderlo.
   */
  sinCaja: number;
};

/**
 * Los usuarios de la empresa con acceso a Mobilink Cash, con su taller y sus
 * cajas. Con `centroId`, solo los de ese taller (un admin limitado a uno).
 */
export async function listarAccesos(empresaId: string, centroId: string | null = null): Promise<Accesos> {
  const [{ rows }, exigir] = await Promise.all([
    pool.query(
      `SELECT u.id::text AS "userId", u.nombre, u.username, u.activo,
              m.rol, m.centro_id::text AS "centroId",
              COALESCE((SELECT array_agg(c.register_id ORDER BY c.register_id)
                          FROM cash_usuario_cajas c
                         WHERE c.user_id = u.id AND c.empresa_id = $1), '{}') AS cajas
         FROM app_usuario_modulos m
         JOIN app_usuarios u ON u.id = m.user_id
        WHERE m.modulo = 'cash' AND u.empresa_id = $1
          AND ($2::uuid IS NULL OR m.centro_id = $2)
        ORDER BY u.activo DESC, u.nombre`,
      [empresaId, centroId]
    ),
    exigeAsignacion(empresaId),
  ]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const usuarios: AccesoUsuario[] = rows.map((r: any) => ({
    userId: r.userId,
    nombre: r.nombre,
    username: r.username,
    activo: r.activo !== false,
    rol: r.rol ?? null,
    centroId: r.centroId ?? null,
    cajas: (r.cajas ?? []).map(Number),
    limitadoPorCaja: limitadoPorCaja(r.rol),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    exigirAsignacion: exigir,
    usuarios,
    sinCaja: usuarios.filter((u) => u.activo && u.limitadoPorCaja && u.cajas.length === 0).length,
  };
}

/**
 * Fija el taller y las cajas de un usuario. Las cajas se sustituyen enteras:
 * lo que llega es la lista nueva.
 *
 * Reglas:
 * · el usuario es de tu empresa y tiene acceso a Mobilink Cash;
 * · el taller es de tu empresa;
 * · cada caja es de tu empresa y, si el usuario tiene taller, de ese taller.
 *
 * Todo en una transacción y con auditoría: quién dio qué caja a quién es lo
 * primero que se pregunta cuando falta dinero.
 */
export async function fijarAcceso(
  ctx: Contexto,
  userId: string,
  datos: { centroId: string | null; cajas: number[] }
): Promise<AccesoUsuario> {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const { rows: usuario } = await cliente.query(
      `SELECT m.centro_id::text AS "centroId",
              COALESCE((SELECT array_agg(c.register_id ORDER BY c.register_id)
                          FROM cash_usuario_cajas c WHERE c.user_id = u.id AND c.empresa_id = $2), '{}') AS cajas
         FROM app_usuario_modulos m
         JOIN app_usuarios u ON u.id = m.user_id
        WHERE m.user_id = $1 AND m.modulo = 'cash' AND u.empresa_id = $2
        FOR UPDATE OF m`,
      [userId, ctx.empresaId]
    );
    if (usuario.length === 0) {
      throw new ErrorCaja(
        "USUARIO_NO_ENCONTRADO",
        "Ese usuario no existe o no tiene acceso a Mobilink Cash.",
        404
      );
    }
    const antes = { centroId: usuario[0].centroId ?? null, cajas: (usuario[0].cajas ?? []).map(Number) };
    // Un admin limitado a un taller solo gestiona a la gente de su taller, y
    // solo dentro de él: no puede llevarse a nadie a otro ni traérselo.
    if (ctx.centroId && (antes.centroId !== ctx.centroId || datos.centroId !== ctx.centroId)) {
      throw new ErrorCaja(
        "USUARIO_FUERA_DE_AMBITO",
        "Solo puedes asignar cajas a la gente de tu taller, y dentro de tu taller.",
        403
      );
    }

    // `app_centros` es de la fundación SaaS; sin ella (base de pruebas del
    // módulo) no hay contra qué mirar, igual que en `listarCentros`.
    const { rows: hay } = await cliente.query(`SELECT to_regclass('app_centros') IS NOT NULL AS hay`);
    if (datos.centroId && hay[0]?.hay) {
      const { rows } = await cliente.query(
        `SELECT 1 FROM app_centros WHERE id = $1 AND empresa_id = $2`,
        [datos.centroId, ctx.empresaId]
      );
      if (rows.length === 0) throw new ErrorCaja("TALLER_NO_ENCONTRADO", "El taller no existe.", 404);
    }

    const cajas = [...new Set(datos.cajas)];
    if (cajas.length > 0) {
      const { rows } = await cliente.query(
        `SELECT id, centro_id::text AS "centroId", nombre FROM cash_registers
          WHERE id = ANY($1::int[]) AND empresa_id = $2`,
        [cajas, ctx.empresaId]
      );
      if (rows.length !== cajas.length) {
        throw new ErrorCaja("CAJA_NO_ENCONTRADA", "Alguna de las cajas no existe.", 404);
      }
      const fuera = rows.filter((c: { centroId: string | null }) => datos.centroId && c.centroId !== datos.centroId);
      if (fuera.length > 0) {
        throw new ErrorCaja(
          "CAJA_DE_OTRO_TALLER",
          `${fuera.map((c: { nombre: string }) => `«${c.nombre}»`).join(", ")} no ${fuera.length === 1 ? "es" : "son"} del taller del usuario.`,
          409
        );
      }
    }

    await cliente.query(
      `UPDATE app_usuario_modulos SET centro_id = $2 WHERE user_id = $1 AND modulo = 'cash'`,
      [userId, datos.centroId]
    );
    await cliente.query(`DELETE FROM cash_usuario_cajas WHERE user_id = $1 AND empresa_id = $2`, [
      userId,
      ctx.empresaId,
    ]);
    if (cajas.length > 0) {
      await cliente.query(
        `INSERT INTO cash_usuario_cajas (empresa_id, user_id, register_id, asignado_por, asignado_at_ms)
         SELECT $1, $2, unnest($3::int[]), $4, $5`,
        [ctx.empresaId, userId, cajas, ctx.userId, Date.now()]
      );
    }
    // Dentro de la transacción: o consta quién dio la caja, o no se da.
    await registrarAuditoriaEnTransaccion(cliente, {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      accion: "cash.access.assigned",
      entidad: "app_usuario_modulos",
      entidadId: userId,
      detalle: { antes, despues: { centroId: datos.centroId, cajas: [...cajas].sort((a, b) => a - b) } },
      ip: ctx.ip,
    });
    await cliente.query("COMMIT");
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }

  const { usuarios } = await listarAccesos(ctx.empresaId, ctx.centroId ?? null);
  return usuarios.find((u) => u.userId === userId)!;
}

/**
 * Enciende o apaga «solo sus cajas» para cajeros y consulta.
 *
 * Encenderlo con cajeros sin ninguna caja se para y dice cuántos: los dejaría
 * sin poder trabajar. Se puede forzar sabiendo lo que se hace (`forzar`), por
 * ejemplo con un usuario que ya no trabaja y nadie ha dado de baja.
 */
export async function fijarExigirAsignacion(
  ctx: Contexto,
  exigir: boolean,
  forzar = false
): Promise<Accesos> {
  if (ctx.centroId) {
    throw new ErrorCaja(
      "USUARIO_FUERA_DE_AMBITO",
      "Esto es de toda la empresa: lo decide un admin sin taller asignado.",
      403
    );
  }
  if (exigir && !forzar) {
    const { sinCaja } = await listarAccesos(ctx.empresaId);
    if (sinCaja > 0) {
      throw new ErrorCaja(
        "USUARIOS_SIN_CAJA",
        `${sinCaja === 1 ? "Hay 1 usuario" : `Hay ${sinCaja} usuarios`} (cajero o consulta) sin ninguna caja asignada: al encenderlo no ${sinCaja === 1 ? "podría" : "podrían"} trabajar. Asígnales su caja antes.`,
        409,
        { sinCaja }
      );
    }
  }
  if (exigir) {
    await pool.query(
      `INSERT INTO cash_settings (empresa_id, clave, valor, updated_at_ms) VALUES ($1, $2, '1', $3)
       ON CONFLICT (empresa_id, clave) DO UPDATE SET valor = '1', updated_at_ms = EXCLUDED.updated_at_ms`,
      [ctx.empresaId, CLAVE_EXIGIR_ASIGNACION, Date.now()]
    );
  } else {
    await pool.query(`DELETE FROM cash_settings WHERE empresa_id = $1 AND clave = $2`, [
      ctx.empresaId,
      CLAVE_EXIGIR_ASIGNACION,
    ]);
  }
  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: exigir ? "cash.access.enforced" : "cash.access.relaxed",
    entidad: "cash_settings",
    entidadId: CLAVE_EXIGIR_ASIGNACION,
    detalle: { forzado: exigir && forzar },
    ip: ctx.ip,
  });
  return listarAccesos(ctx.empresaId);
}
