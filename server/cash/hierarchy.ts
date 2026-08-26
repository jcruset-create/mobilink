/**
 * Jerarquía de la red: ZONA → TALLER → CAJA.
 *
 * Hasta la fase 1 de MC Central el módulo solo conocía dos niveles —empresa y
 * caja— y el taller era un campo de texto libre en `cash_registers.centro`.
 * Servía para escribirlo en un informe y para nada más: agrupar por taller era
 * agrupar cadenas, y «Taller Tarragona» y «taller tarragona» eran dos talleres.
 *
 * Aquí vive lo que hace falta para que esa agrupación sea un dato:
 *
 * · Las **zonas** (`app_zonas`), que agrupan talleres dentro de una empresa.
 * · La consulta de **talleres** (`app_centros`), que ya existía en la fundación
 *   SaaS y que este módulo no había mirado nunca.
 *
 * Dos decisiones que conviene no reabrir sin pensarlas:
 *
 * · **La zona es opcional.** Una empresa con un solo taller no tiene por qué
 *   inventarse una zona para poder trabajar, y obligarla solo produce zonas
 *   llamadas «General» que no significan nada.
 *
 * · **Ni las zonas ni los talleres se borran: se dan de baja.** Un taller
 *   cerrado hace tres años sigue siendo el taller del que salió un ingreso
 *   bancario de entonces. Es la misma regla que ya aplica el catálogo de formas
 *   de cobro, y por el mismo motivo.
 *
 * Vive en `server/cash/` y no en un `server/central/` porque las rutas cuelgan
 * hoy de `/api/cash/config`: el módulo que sirve la ruta es el que guarda el
 * fichero. Cuando la fase 3 monte MC Central con router propio, esto se lee
 * desde allí sin moverlo.
 */

import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { ErrorCaja } from "./errors.ts";
import type { Contexto } from "./config.ts";

export type Zona = { id: string; nombre: string; activa: boolean; centros: number };
export type Centro = { id: string; nombre: string; zonaId: string | null; activo: boolean };

/**
 * ¿Está la fundación SaaS en esta base?
 *
 * Las pruebas de integración levantan una base desechable donde solo corre
 * `initCash()`, sin `app_empresas` ni `app_centros`. Preguntar en vez de
 * suponer permite que el módulo siga arrancando ahí: sin talleres que ofrecer,
 * la pantalla enseña la lista vacía y todo lo demás funciona igual, que es
 * exactamente lo que hace hoy una instalación con la caja sin asignar.
 */
async function hayCentros(): Promise<boolean> {
  const { rows } = await pool.query(`SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`);
  return Boolean(rows[0]?.hay);
}

// ── Talleres ───────────────────────────────────────────────────────────────

/** Los talleres de la empresa. Solo lectura: se dan de alta en Administración. */
export async function listarCentros(empresaId: string): Promise<Centro[]> {
  if (!(await hayCentros())) return [];
  const { rows } = await pool.query(
    `SELECT id, nombre, zona_id, activo
       FROM app_centros
      WHERE empresa_id = $1
      ORDER BY activo DESC, nombre`,
    [empresaId]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    id: r.id,
    nombre: r.nombre,
    zonaId: r.zona_id ?? null,
    activo: r.activo,
  }));
}

/**
 * Comprueba que el taller es de esta empresa y devuelve su nombre.
 *
 * El nombre se necesita porque `cash_registers.centro` sigue guardándose: lo
 * leen los informes y es parte de la clave única del alta de cajas. Mientras
 * las dos columnas convivan, tienen que decir lo mismo — si una caja apunta al
 * taller de Reus y su texto dice «Tarragona», el informe miente y nadie se
 * entera hasta que cuadra mal un ingreso.
 */
export async function nombreDeCentro(empresaId: string, centroId: string): Promise<string> {
  if (!(await hayCentros())) {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "Esta instalación todavía no tiene talleres dados de alta.",
      400
    );
  }
  const { rows } = await pool.query(
    `SELECT nombre FROM app_centros WHERE id = $1 AND empresa_id = $2`,
    [centroId, empresaId]
  );
  if (rows.length === 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Ese taller no es de tu empresa.", 404);
  }
  return rows[0].nombre;
}

// ── Zonas ──────────────────────────────────────────────────────────────────

export async function listarZonas(empresaId: string): Promise<Zona[]> {
  const conCentros = await hayCentros();
  const { rows } = await pool.query(
    conCentros
      ? `SELECT z.id, z.nombre, z.activa,
                (SELECT COUNT(*) FROM app_centros c WHERE c.zona_id = z.id) AS centros
           FROM app_zonas z
          WHERE z.empresa_id = $1
          ORDER BY z.activa DESC, z.nombre`
      : `SELECT id, nombre, activa, 0 AS centros
           FROM app_zonas
          WHERE empresa_id = $1
          ORDER BY activa DESC, nombre`,
    [empresaId]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    id: r.id,
    nombre: r.nombre,
    activa: r.activa,
    centros: Number(r.centros),
  }));
}

export async function crearZona(ctx: Contexto, nombre: string): Promise<Zona> {
  const limpio = (nombre ?? "").trim();
  if (!limpio) throw new ErrorCaja("ENTRADA_NO_VALIDA", "La zona necesita un nombre.", 400);

  /*
   * El upsert reactiva una zona dada de baja con ese mismo nombre en vez de
   * fallar por la clave única, igual que hace el alta de cajas: es lo que
   * espera quien la vuelve a crear sin acordarse de que ya existía, y conserva
   * los talleres que siguieran apuntando a ella.
   */
  const { rows } = await pool.query(
    `INSERT INTO app_zonas (empresa_id, nombre)
     VALUES ($1, $2)
     ON CONFLICT (empresa_id, lower(nombre)) DO UPDATE SET activa = true
     RETURNING id, nombre, activa`,
    [ctx.empresaId, limpio]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.zona.create",
    entidad: "app_zonas",
    entidadId: String(rows[0].id),
    detalle: { nombre: rows[0].nombre },
    ip: ctx.ip,
  });

  return { ...rows[0], centros: 0 };
}

export async function actualizarZona(
  ctx: Contexto,
  id: string,
  cambios: { nombre?: string; activa?: boolean }
): Promise<Zona> {
  const { rows: actual } = await pool.query(
    `SELECT id, nombre, activa FROM app_zonas WHERE id = $1 AND empresa_id = $2`,
    [id, ctx.empresaId]
  );
  if (actual.length === 0) throw new ErrorCaja("ENTRADA_NO_VALIDA", "La zona no existe.", 404);

  const nombre = cambios.nombre?.trim() || actual[0].nombre;
  const activa = cambios.activa === undefined ? actual[0].activa : cambios.activa;

  const { rows } = await pool.query(
    `UPDATE app_zonas SET nombre = $2, activa = $3 WHERE id = $1
     RETURNING id, nombre, activa`,
    [id, nombre, activa]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.zona.update",
    entidad: "app_zonas",
    entidadId: String(id),
    detalle: { antes: actual[0], despues: { nombre, activa } },
    ip: ctx.ip,
  });

  const centros = (await listarZonas(ctx.empresaId)).find((z) => z.id === id)?.centros ?? 0;
  return { ...rows[0], centros };
}

/**
 * Asigna un taller a una zona, o lo deja sin zona con `zonaId = null`.
 *
 * El taller es de Administración y aquí solo se le cuelga la zona: no se
 * renombra ni se da de baja desde Mobilink Cash, que no es su dueño.
 */
export async function asignarZonaACentro(
  ctx: Contexto,
  centroId: string,
  zonaId: string | null
): Promise<void> {
  if (!(await hayCentros())) {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "Esta instalación todavía no tiene talleres dados de alta.",
      400
    );
  }
  await nombreDeCentro(ctx.empresaId, centroId);

  if (zonaId) {
    const { rows } = await pool.query(
      `SELECT id FROM app_zonas WHERE id = $1 AND empresa_id = $2`,
      [zonaId, ctx.empresaId]
    );
    if (rows.length === 0) {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", "Esa zona no es de tu empresa.", 404);
    }
  }

  await pool.query(`UPDATE app_centros SET zona_id = $2 WHERE id = $1`, [centroId, zonaId]);

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.centro.zona",
    entidad: "app_centros",
    entidadId: String(centroId),
    detalle: { zonaId },
    ip: ctx.ip,
  });
}

// ── Ámbito: hasta dónde llega un usuario ───────────────────────────────────

/**
 * ¿Puede este usuario operar esta caja?
 *
 * Con `centroId` a `null` —el caso de casi todo el mundo— no hay nada que
 * comprobar: su ámbito es la empresa entera, que es como funcionaba el módulo
 * antes de esta fase.
 *
 * Con ámbito, se compara contra el taller de la caja. Y una caja **sin taller
 * asignado queda fuera** de cualquier ámbito: si el backfill no supo dónde está,
 * nadie limitado a un taller debería poder tocarla. Lo contrario —dejarla
 * abierta a todos «porque no se sabe»— convertiría cada caja sin emparejar en
 * un agujero en el ámbito, que es justo lo que esta fase viene a cerrar.
 *
 * Se comprueba aquí y no en la pantalla porque la pantalla se puede saltar: es
 * el mismo motivo por el que la pertenencia a empresa se valida en el servicio.
 */
export async function exigirAmbitoCaja(
  ejecutor: { query: typeof pool.query },
  ctx: Contexto,
  registerId: number
): Promise<void> {
  if (!ctx.centroId) return;

  const { rows } = await ejecutor.query(
    `SELECT centro_id FROM cash_registers WHERE id = $1 AND empresa_id = $2`,
    [registerId, ctx.empresaId]
  );
  if (rows.length === 0) {
    throw new ErrorCaja("CAJA_NO_ENCONTRADA", "La caja no existe.", 404);
  }
  if (rows[0].centro_id !== ctx.centroId) {
    throw new ErrorCaja(
      "CAJA_FUERA_DE_AMBITO",
      "Esta caja es de otro taller. Solo puedes operar las cajas del tuyo.",
      403
    );
  }
}

/**
 * La jornada es tuya: misma empresa y, si tienes ámbito, tu taller.
 *
 * Las dos comprobaciones van juntas en una sola función a propósito. La de
 * empresa estaba repetida como un `if` suelto en once sitios de tres ficheros,
 * y añadir la segunda a mano en cada uno era garantizar que el duodécimo se
 * olvidara. Un ámbito que falla en una sola ruta no es un ámbito.
 */
export async function exigirJornadaPropia(
  ejecutor: { query: typeof pool.query },
  ctx: Contexto,
  sesion: { empresaId: string; registerId: number }
): Promise<void> {
  if (sesion.empresaId !== ctx.empresaId) {
    throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
  }
  await exigirAmbitoCaja(ejecutor, ctx, sesion.registerId);
}
