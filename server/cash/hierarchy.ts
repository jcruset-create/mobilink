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

/**
 * Poner una caja en su taller (o quitarla de él).
 *
 * Existe porque el backfill de la fase 1 **no adivina**: empareja por nombre
 * exacto normalizado y lo que no casa queda a `NULL`. Eso es lo correcto
 * —asignar una caja al taller equivocado envenena todos los informes
 * consolidados de después—, pero dejaba la puerta de salida sin construir: la
 * migración remitía a resolverlo «a mano desde Configuración» y esa pantalla no
 * existía. Esto es esa puerta.
 *
 * No se toca la columna de texto `centro`. Tiene un UNIQUE con
 * `(empresa_id, nombre)` detrás, así que reescribirla podría chocar con otra
 * caja; y además es la columna que la fase 1 dejó marcada para retirar. El
 * taller de verdad es `centro_id`.
 *
 * Ojo con lo que esto significa de acceso, que no es cosmético: una caja sin
 * taller queda FUERA de cualquier ámbito (ver `exigirAmbitoCaja`). Al ponerle
 * taller, la gente limitada a ese taller pasa a poder operarla. Por eso pide
 * `central.zones.configure` y queda auditado.
 */
export async function asignarCentroACaja(
  ctx: Contexto,
  registerId: number,
  centroId: string | null
): Promise<void> {
  // Un id que no es un entero positivo llegaría a la consulta como NaN y
  // reventaría con un error de PostgreSQL en vez de con uno que se entienda.
  if (!Number.isInteger(registerId) || registerId <= 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Esa caja no existe.", 400);
  }

  // El taller, si se da uno: `nombreDeCentro` revienta si no es de la empresa.
  if (centroId) await nombreDeCentro(ctx.empresaId, centroId);

  // Y la caja. Sin esta comprobación se podría reasignar la caja de otra
  // empresa mandando su id a pelo: la pantalla no defiende nada, el servicio sí.
  const { rows } = await pool.query(
    `SELECT id FROM cash_registers WHERE id = $1 AND empresa_id = $2`,
    [registerId, ctx.empresaId]
  );
  if (rows.length === 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Esa caja no es de tu empresa.", 404);
  }

  await pool.query(
    `UPDATE cash_registers SET centro_id = $2, updated_at_ms = $3 WHERE id = $1`,
    [registerId, centroId, Date.now()]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.caja.taller",
    entidad: "cash_registers",
    entidadId: String(registerId),
    detalle: { centroId },
    ip: ctx.ip,
  });
}

// ── Ámbito: hasta dónde llega un usuario ───────────────────────────────────

/**
 * ¿Puede este usuario operar esta caja?
 *
 * Con `centroId` a `null` —el caso de casi todo el mundo— el ámbito es la
 * empresa entera, y lo único que se comprueba es que la caja sea de la empresa.
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
  await exigirAcceso(ejecutor, ctx, { caja: registerId });
}

/**
 * Lo que cuelga de una caja y se pide por su número: la caja misma, una
 * jornada, un ingreso, una operación, un documento, un pedido de cambio, una
 * entrega de dinero o un canje con el cajón. Y de AutoScan, que es de un
 * taller y no de una caja, la bandeja y el escáner.
 */
export type TipoRecurso =
  | "caja"
  | "jornada"
  | "ingreso"
  | "operacion"
  | "documento"
  | "pedido"
  | "entrega"
  | "canje"
  | "bandeja"
  | "escaner";
export type Recurso = { [K in TipoRecurso]: { [P in K]: number } }[TipoRecurso];

/*
 * De quién es cada cosa: su empresa y el taller de su caja, en una sola
 * consulta. Los documentos cuelgan de una jornada o de un ingreso, nunca de
 * los dos (`cash_opdoc_un_ancla`).
 */
const DUENO: Record<TipoRecurso, { sql: string; codigo: string; mensaje: string }> = {
  caja: {
    sql: `SELECT r.id AS register_id, r.empresa_id, r.centro_id
            FROM cash_registers r WHERE r.id = $1`,
    codigo: "CAJA_NO_ENCONTRADA",
    mensaje: "La caja no existe.",
  },
  jornada: {
    sql: `SELECT s.register_id, s.empresa_id, r.centro_id
            FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id
           WHERE s.id = $1`,
    codigo: "JORNADA_NO_ENCONTRADA",
    mensaje: "La jornada no existe.",
  },
  ingreso: {
    sql: `SELECT b.register_id, b.empresa_id, r.centro_id
            FROM cash_bank_deposits b JOIN cash_registers r ON r.id = b.register_id
           WHERE b.id = $1`,
    codigo: "INGRESO_NO_ENCONTRADO",
    mensaje: "El ingreso no existe.",
  },
  operacion: {
    sql: `SELECT s.register_id, o.empresa_id, r.centro_id
            FROM cash_operations o
            JOIN cash_sessions s ON s.id = o.session_id
            JOIN cash_registers r ON r.id = s.register_id
           WHERE o.id = $1`,
    codigo: "OPERACION_NO_ENCONTRADA",
    mensaje: "La operación no existe.",
  },
  documento: {
    sql: `SELECT r.id AS register_id, d.empresa_id, r.centro_id
            FROM cash_operation_documents d
            LEFT JOIN cash_sessions s ON s.id = d.session_id
            LEFT JOIN cash_bank_deposits b ON b.id = d.deposit_id
            JOIN cash_registers r ON r.id = COALESCE(s.register_id, b.register_id)
           WHERE d.id = $1`,
    codigo: "DOCUMENTO_NO_ENCONTRADO",
    mensaje: "El documento no existe.",
  },
  pedido: {
    sql: `SELECT p.register_id, p.empresa_id, r.centro_id
            FROM cash_change_orders p JOIN cash_registers r ON r.id = p.register_id
           WHERE p.id = $1`,
    codigo: "PEDIDO_NO_ENCONTRADO",
    mensaje: "El pedido de cambio no existe.",
  },
  entrega: {
    sql: `SELECT a.register_id, a.empresa_id, r.centro_id
            FROM cash_advances a JOIN cash_registers r ON r.id = a.register_id
           WHERE a.id = $1`,
    codigo: "ENTREGA_NO_ENCONTRADA",
    mensaje: "La entrega no existe.",
  },
  canje: {
    sql: `SELECT c.register_id, c.empresa_id, r.centro_id
            FROM cash_deposit_swaps c JOIN cash_registers r ON r.id = c.register_id
           WHERE c.id = $1`,
    codigo: "CANJE_NO_ENCONTRADO",
    mensaje: "El canje no existe.",
  },
  /* AutoScan no es de una caja sino de un taller: la bandeja y el escáner. */
  bandeja: {
    sql: `SELECT empresa_id, centro_id FROM cash_autoscan_inbox WHERE id = $1`,
    codigo: "DOCUMENTO_NO_ENCONTRADO",
    mensaje: "Ese documento no existe.",
  },
  escaner: {
    sql: `SELECT empresa_id, centro_id FROM cash_autoscan_devices WHERE id = $1`,
    codigo: "DISPOSITIVO_NO_ENCONTRADO",
    mensaje: "El escáner no existe.",
  },
};

/**
 * ¿Puede este usuario ver o tocar esto?
 *
 * Dos comprobaciones, siempre las dos:
 *
 * · **La empresa.** Lo de otra empresa responde «no existe» (404), no «no
 *   puedes» (403): los números son correlativos, y un 403 confirmaría que el
 *   número que alguien está probando existe.
 * · **El taller**, si el usuario está limitado a uno. Ver arriba: una caja sin
 *   taller queda fuera de cualquier ámbito.
 *
 * Es la puerta de todo lo que se pide por número. Una ruta que lea o escriba
 * algo de una caja y no pase por aquí es un agujero: con la jornada 1234 de la
 * URL cambiada por la 1235 se leería la caja de otro.
 */
export async function exigirAcceso(
  ejecutor: { query: typeof pool.query },
  ctx: Contexto,
  recurso: Recurso
): Promise<void> {
  const [tipo, id] = Object.entries(recurso)[0] as [TipoRecurso, number];
  const d = DUENO[tipo];
  const { rows } = await ejecutor.query(d.sql, [id]);
  if (rows.length === 0 || rows[0].empresa_id !== ctx.empresaId) {
    throw new ErrorCaja(d.codigo, d.mensaje, 404);
  }
  if (ctx.centroId && rows[0].centro_id !== ctx.centroId) {
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
