/**
 * Cobrar dos veces la misma factura: detectarlo, y dejar pasar solo lo que
 * alguien haya autorizado a conciencia.
 *
 * El escáner ya avisaba de que una factura constaba cobrada, pero el aviso era
 * un texto: quien tuviera prisa podía seguir y registrar el segundo cobro con
 * el mismo botón de siempre. Un cobro duplicado no se descubre en el momento
 * —la caja cuadra, porque el dinero entró— sino en la conciliación del mes
 * siguiente, cuando ya hay que buscar quién, cuándo y por qué.
 *
 * ## Las tres cosas que sostienen esto
 *
 * 1. **La comprobación de verdad está en el servidor y DENTRO de la
 *    transacción del cobro.** Lo que el navegador supiera hace treinta
 *    segundos no vale: entre que se pintó la pantalla y se pulsa el botón,
 *    otra persona puede haber cobrado esa factura. Y como el cobro ya bloquea
 *    su jornada con `SELECT ... FOR UPDATE`, dos peticiones simultáneas de la
 *    misma caja se ponen en fila solas: la segunda ve el cobro de la primera.
 *
 * 2. **La autorización la da OTRA persona.** No un PIN que el propio cajero
 *    conozca, sino el usuario y la clave de alguien con permiso, comprobados
 *    contra el mismo Supabase con el que se entra a la aplicación. La clave no
 *    pasa por nuestra base de datos, no se guarda y no se registra.
 *
 * 3. **La autorización vale para UN cobro y solo para ése.** Va atada a la
 *    empresa, al número de factura y al importe, caduca, y al usarse queda
 *    marcada con el cobro que la gastó. Una autorización reutilizable sería
 *    una llave maestra.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import pool from "../db.ts";
import { ErrorCaja } from "./errors.ts";
import type { Centimos } from "./domain/money.ts";
import { formatearEuros } from "./domain/money.ts";
import { identificarA } from "./reauth.ts";
import { type Permiso, permisosDeRol, rolDeCaja } from "./permissions.ts";
import { sodActivo } from "./sod.ts";

/**
 * Quién es un usuario y qué puede hacer.
 *
 * Va detrás de una interfaz por la misma razón que el verificador de claves:
 * la respuesta real sale de `app_usuarios` y `app_usuario_modulos`, que son
 * del SaaS y pueden no existir en una base del módulo, y la REGLA —de esta
 * empresa, con este permiso, y no siendo el mismo que cobra— se prueba entera
 * sin levantar nada.
 */
export interface DirectorioDeUsuarios {
  buscar(userId: string): Promise<{
    empresaId: string;
    nombre: string | null;
    permisos: readonly Permiso[];
  } | null>;
}

let directorio: DirectorioDeUsuarios | null = null;

export function registrarDirectorio(d: DirectorioDeUsuarios | null): void {
  directorio = d;
}

/** El de verdad: usuario activo del SaaS, con el rol que tenga en caja. */
export function directorioApp(): DirectorioDeUsuarios {
  return {
    async buscar(userId) {
      const { rows } = await pool.query(
        `SELECT nombre, empresa_id, es_superadmin FROM app_usuarios
          WHERE id = $1 AND activo`,
        [userId]
      );
      const u = rows[0];
      if (!u?.empresa_id) return null;
      const { rol } = await rolDeCaja(userId, Boolean(u.es_superadmin));
      return {
        empresaId: u.empresa_id,
        nombre: u.nombre ?? null,
        permisos: permisosDeRol(rol),
      };
    },
  };
}

/**
 * Cuánto vive una autorización: cinco minutos.
 *
 * Es el tiempo de terminar el cobro que se estaba haciendo, no el de irse a
 * comer. Si caduca no se ha perdido nada: el encargado vuelve a teclear.
 */
export const VALIDEZ_MS = 5 * 60_000;

/** Como se compara y como se guarda: sin espacios de sobra y en mayúsculas. */
export function normalizarReferencia(referencia: string): string {
  return referencia.trim().toUpperCase();
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export type CobroPrevio = {
  operacionId: number;
  numero: string;
  fecha: string;
  importeCentimos: Centimos;
  partyNombre: string | null;
};

/**
 * ¿Hay ya un cobro confirmado de esta factura?
 *
 * Acepta un cliente de transacción para poder preguntarlo con la jornada ya
 * bloqueada, que es el único momento en que la respuesta sirve para decidir.
 */
export async function cobroPrevioDeFactura(
  empresaId: string,
  referencia: string | null,
  client: PoolClient | typeof pool = pool,
  excluirOperacionId: number | null = null
): Promise<CobroPrevio | null> {
  const ref = referencia == null ? "" : normalizarReferencia(referencia);
  if (!ref) return null;

  const { rows } = await client.query(
    `SELECT id, numero, importe_centimos, party_nombre, created_at_ms
       FROM cash_operations
      WHERE empresa_id = $1 AND tipo = 'COLLECTION' AND estado = 'CONFIRMED'
        AND upper(trim(referencia)) = $2
        AND ($3::int IS NULL OR id <> $3::int)
      ORDER BY id DESC LIMIT 1`,
    [empresaId, ref, excluirOperacionId]
  );
  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    operacionId: r.id,
    numero: r.numero,
    fecha: new Date(Number(r.created_at_ms)).toISOString().slice(0, 10),
    importeCentimos: Number(r.importe_centimos),
    partyNombre: r.party_nombre ?? null,
  };
}

export type EntradaAutorizacion = {
  empresaId: string;
  /** Quien está cobrando: el de la sesión abierta en el mostrador. */
  solicitanteId: string | null;
  /** Usuario o correo de quien autoriza. */
  autorizador: string;
  clave: string;
  referencia: string;
  importeCentimos: Centimos;
  motivo?: string | null;
};

export type Autorizacion = {
  token: string;
  expiraAtMs: number;
  autorizadoPorNombre: string | null;
};

/**
 * Concede una autorización, o explica por qué no.
 *
 * El orden de las comprobaciones no es casual: primero se mira que el
 * duplicado exista de verdad —no se va a pedir la clave a nadie para levantar
 * una protección que no está puesta— y solo después se toca la credencial.
 */
export async function autorizarDuplicado(e: EntradaAutorizacion): Promise<Autorizacion> {
  const referencia = normalizarReferencia(e.referencia ?? "");
  if (!referencia) {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "Sin número de factura no hay nada que autorizar.",
      400
    );
  }
  if (!Number.isSafeInteger(e.importeCentimos) || e.importeCentimos <= 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "El importe a autorizar no es válido.", 400);
  }
  if (!e.autorizador?.trim() || !e.clave) {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "Hacen falta el usuario y la clave de quien autoriza.",
      400
    );
  }

  const previo = await cobroPrevioDeFactura(e.empresaId, referencia);
  if (!previo) {
    throw new ErrorCaja(
      "SIN_DUPLICADO",
      `La factura ${referencia} no consta cobrada, así que no hace falta autorizar nada.`,
      409
    );
  }

  const autorizadorId = await identificarA(e.autorizador, e.clave);
  if (!autorizadorId) {
    // Sin decir si falla el usuario o la clave, que es lo de siempre.
    throw new ErrorCaja("CLAVE_NO_VALIDA", "El usuario o la clave no son correctos.", 401);
  }

  const autorizador = await (directorio ?? directorioApp()).buscar(autorizadorId);
  /*
   * De la misma empresa, y activo. Un encargado de otro taller tiene su clave
   * buena y su permiso bueno, y no pinta nada autorizando cobros de éste.
   */
  if (!autorizador || autorizador.empresaId !== e.empresaId) {
    throw new ErrorCaja(
      "AUTORIZADOR_DE_OTRA_EMPRESA",
      "Ese usuario no pertenece a esta empresa.",
      403
    );
  }

  if (!autorizador.permisos.includes("cash.duplicate_payment.override")) {
    throw new ErrorCaja(
      "AUTORIZADOR_SIN_PERMISO",
      "Ese usuario no tiene permiso para autorizar un cobro duplicado.",
      403
    );
  }

  /*
   * Separación de funciones, la misma que rige anular y reabrir: donde está
   * encendida, quien cobra no se autoriza a sí mismo. Donde no lo está, un
   * responsable trabajando solo puede hacerlo, que es el caso del taller de
   * dos personas para el que se dejó apagada.
   */
  if (
    e.solicitanteId &&
    autorizadorId === e.solicitanteId &&
    (await sodActivo(e.empresaId))
  ) {
    throw new ErrorCaja(
      "SOD_REQUIERE_OTRA_PERSONA",
      "Con la separación de funciones activada, un cobro duplicado lo tiene que autorizar otra persona con permiso.",
      403
    );
  }

  const token = randomBytes(32).toString("base64url");
  const ahora = Date.now();
  const expira = ahora + VALIDEZ_MS;

  await pool.query(
    `INSERT INTO cash_duplicate_overrides
       (empresa_id, token_hash, referencia, importe_centimos, operacion_previa_id,
        solicitado_por, autorizado_por, motivo, creado_at_ms, expira_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      e.empresaId,
      hash(token),
      referencia,
      e.importeCentimos,
      previo.operacionId,
      e.solicitanteId,
      autorizadorId,
      e.motivo?.trim() || null,
      ahora,
      expira,
    ]
  );

  const { registrarAuditoria } = await import("../core/auditoria.ts");
  await registrarAuditoria({
    empresaId: e.empresaId,
    userId: autorizadorId,
    accion: "cash.collection.duplicate_override_granted",
    entidad: "cash_operations",
    entidadId: String(previo.operacionId),
    // Nunca la clave, y nunca el token: lo que se guarda es QUÉ se autorizó.
    detalle: {
      referencia,
      importeCentimos: e.importeCentimos,
      cobroPrevio: previo.numero,
      solicitadoPor: e.solicitanteId,
      autorizadoPor: autorizadorId,
      motivo: e.motivo?.trim() || null,
    },
  });

  return {
    token,
    expiraAtMs: expira,
    autorizadoPorNombre: autorizador.nombre ?? null,
  };
}

/**
 * Gasta la autorización que corresponde a este cobro, o falla.
 *
 * Va DENTRO de la transacción del cobro y con la fila bloqueada: si dos
 * peticiones llegan con el mismo token, solo una se lo lleva.
 */
export async function consumirAutorizacion(
  client: PoolClient,
  e: {
    empresaId: string;
    token: string;
    referencia: string;
    importeCentimos: Centimos;
    operacionId: number;
  }
): Promise<number> {
  const referencia = normalizarReferencia(e.referencia);
  const { rows } = await client.query(
    `SELECT id, referencia, importe_centimos, expira_at_ms, consumida_at_ms, autorizado_por
       FROM cash_duplicate_overrides
      WHERE empresa_id = $1 AND token_hash = $2
      FOR UPDATE`,
    [e.empresaId, hash(e.token)]
  );
  const fila = rows[0];

  /*
   * El mismo mensaje para «no existe», «ya se usó» y «caducó». Quien esté
   * probando tokens no debe poder distinguir un token real gastado de uno
   * inventado. Los tres casos se resuelven igual: pedir otra autorización.
   */
  const noSirve = () =>
    new ErrorCaja(
      "AUTORIZACION_NO_VALIDA",
      "La autorización no vale para este cobro: puede haber caducado o haberse usado ya. Pide una nueva.",
      403
    );

  if (!fila || fila.consumida_at_ms != null || Number(fila.expira_at_ms) <= Date.now()) {
    throw noSirve();
  }

  /*
   * Atada a la factura y al importe. Comparar la referencia en tiempo
   * constante es barato y quita de en medio cualquier duda sobre filtrar
   * información por el tiempo de respuesta.
   */
  const guardada = Buffer.from(String(fila.referencia));
  const pedida = Buffer.from(referencia);
  if (guardada.length !== pedida.length || !timingSafeEqual(guardada, pedida)) {
    throw noSirve();
  }
  if (Number(fila.importe_centimos) !== e.importeCentimos) {
    throw new ErrorCaja(
      "AUTORIZACION_NO_VALIDA",
      `La autorización se dio para ${formatearEuros(Number(fila.importe_centimos))} € y este cobro es de ${formatearEuros(e.importeCentimos)} €.`,
      403
    );
  }

  await client.query(
    `UPDATE cash_duplicate_overrides
        SET consumida_operation_id = $2, consumida_at_ms = $3
      WHERE id = $1`,
    [fila.id, e.operacionId, Date.now()]
  );

  return fila.autorizado_por as unknown as number;
}
