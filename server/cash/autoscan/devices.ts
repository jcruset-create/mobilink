/**
 * Dispositivos de AutoScan: quién puede dejar facturas en la bandeja.
 *
 * Un escáner del mostrador no es una persona, y hacerle pasar por el sistema
 * de usuarios sería el error que esto viene a evitar: guardar en un PC de
 * recepción el token de un empleado, que caduca, que es personal y cuya baja
 * dejaría la tienda sin escáner.
 *
 * ## Dos autenticaciones que no se mezclan
 *
 *     PERSONA                      MÁQUINA
 *     Bearer de Supabase           credencial de dispositivo
 *     → usuario, empresa, centro   → dispositivo, empresa, centro
 *     → permisos cash.*            → SOLO subir documentos suyos
 *
 * Una credencial de dispositivo **no es un usuario**: no tiene permisos de
 * interfaz, no puede mirar cajas, jornadas, cobros ni configuración. Lo único
 * que puede hacer es dejar un documento de SU empresa y SU centro.
 *
 * ## De dónde salen la empresa y el centro
 *
 * De la credencial, siempre. La credencial los heredó del código de
 * activación, y ese código lo creó una persona con permiso eligiendo el
 * centro. El agente nunca los manda, y si los mandara no se leerían: un
 * dispositivo de Sabadell no puede dejar una factura en Terrassa aunque
 * alguien reescriba la petición.
 *
 * Del secreto se guarda solo el hash, como en `duplicates.ts`. Se enseña una
 * vez, al activar, y no se puede volver a consultar.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import pool from "../../db.ts";
import { ErrorCaja } from "../errors.ts";

/**
 * Cuánto vive un código de activación: una hora.
 *
 * Se instala el agente en el momento de crearlo. Una hora es de sobra para ir
 * del despacho al mostrador, y corta para que un código apuntado en un papel
 * siga sirviendo mañana.
 */
export const VALIDEZ_CODIGO_MS = 60 * 60_000;

/**
 * A partir de cuándo un dispositivo se considera desconectado: 5 minutos.
 *
 * Vive AQUÍ y en un solo sitio. Que la pantalla y el servidor usaran umbrales
 * distintos daría dispositivos «conectados» en una vista y «sin conexión» en
 * la otra, que es el fallo que nadie sabe reproducir.
 */
export const UMBRAL_ONLINE_MS = 5 * 60_000;

const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");

/**
 * ¿Tiene esta empresa la licencia de caja al día?
 *
 * Es un puerto enchufable, como el verificador de `reauth.ts`, y por la misma
 * razón: el comprobador de verdad pregunta por `app_licencia_activa()`, una
 * función que la base de las pruebas no tiene. Sin esto, la suite entera
 * dependería de una pieza del SaaS que no es lo que se está probando.
 *
 * No hay valor por defecto a propósito. Un puerto sin registrar hace fallar la
 * activación, que es lo correcto: la alternativa —dejar pasar cuando nadie ha
 * dicho nada— convierte un despiste de montaje en una puerta abierta.
 */
export type ComprobadorDeLicencia = (empresaId: string) => Promise<boolean>;

let comprobador: ComprobadorDeLicencia | null = null;

export function registrarComprobadorDeLicencia(c: ComprobadorDeLicencia | null): void {
  comprobador = c;
}

/** Lanza si la empresa no puede usar el módulo. Usado por las dos vías de máquina. */
export async function exigirLicencia(empresaId: string): Promise<void> {
  if (!comprobador) {
    throw new ErrorCaja(
      "LICENCIA_NO_COMPROBABLE",
      "No se ha podido comprobar la licencia del módulo.",
      503
    );
  }
  if (!(await comprobador(empresaId))) {
    /*
     * 403 y no 401: la credencial del escáner es buena, lo que no vale es la
     * licencia. Que el agente pueda distinguirlo es lo que evita que borre su
     * credencial y obligue a reinstalar cuando lo único que pasa es que hay
     * una factura pendiente.
     */
    throw new ErrorCaja(
      "LICENCIA_CADUCADA",
      "El módulo de caja no tiene licencia vigente para esta empresa.",
      403
    );
  }
}

/** Un código legible por teléfono: MC-AS-8472-DFQ2. */
function generarCodigo(): string {
  // Sin I, O, 0 ni 1: en un mostrador se dictan en voz alta.
  const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const trozo = (n: number) =>
    Array.from(randomBytes(n))
      .map((b) => ALFABETO[b % ALFABETO.length])
      .join("");
  return `MC-AS-${trozo(4)}-${trozo(4)}`;
}

export type Dispositivo = {
  id: number;
  empresaId: string;
  centroId: string;
  nombre: string;
  version: string | null;
  creadoAtMs: number;
  ultimoVistoAtMs: number | null;
  revocadoAtMs: number | null;
  /** Derivado de `ultimoVistoAtMs`, nunca guardado. */
  conectado: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function aDispositivo(r: any): Dispositivo {
  const ultimo = r.ultimo_visto_at_ms == null ? null : Number(r.ultimo_visto_at_ms);
  const revocado = r.revocado_at_ms == null ? null : Number(r.revocado_at_ms);
  return {
    id: r.id,
    empresaId: r.empresa_id,
    centroId: r.centro_id,
    nombre: r.nombre,
    version: r.version ?? null,
    creadoAtMs: Number(r.creado_at_ms),
    ultimoVistoAtMs: ultimo,
    revocadoAtMs: revocado,
    /*
     * Derivado, nunca persistido. Un estado que se puede calcular y se guarda
     * acaba mintiendo el día que el proceso que lo actualiza no corre.
     */
    conectado: revocado == null && ultimo != null && Date.now() - ultimo < UMBRAL_ONLINE_MS,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Los dispositivos de una empresa, opcionalmente de un solo centro. */
export async function listarDispositivos(
  empresaId: string,
  centroId: string | null
): Promise<Dispositivo[]> {
  const { rows } = await pool.query(
    `SELECT * FROM cash_autoscan_devices
      WHERE empresa_id = $1 AND ($2::uuid IS NULL OR centro_id = $2::uuid)
      ORDER BY revocado_at_ms NULLS FIRST, nombre`,
    [empresaId, centroId]
  );
  return rows.map(aDispositivo);
}

/**
 * Crea un código de activación para un centro.
 *
 * Devuelve el código EN CLARO una sola vez. No se puede volver a consultar:
 * si se pierde, se crea otro. Guardarlo recuperable lo convertiría en una
 * credencial permanente, que es justo lo que no es.
 */
export async function crearCodigoActivacion(e: {
  empresaId: string;
  centroId: string;
  nombre: string;
  creadoPor: string | null;
}): Promise<{ codigo: string; expiraAtMs: number }> {
  const nombre = e.nombre?.trim();
  if (!nombre) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "El dispositivo necesita un nombre.", 400);
  }
  if (!e.centroId) {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "Hay que decir de qué centro es el dispositivo.",
      400
    );
  }

  const codigo = generarCodigo();
  const ahora = Date.now();
  const expira = ahora + VALIDEZ_CODIGO_MS;

  await pool.query(
    `INSERT INTO cash_autoscan_activation_codes
       (empresa_id, centro_id, codigo_hash, nombre, creado_por, creado_at_ms, expira_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e.empresaId, e.centroId, hash(codigo), nombre.slice(0, 120), e.creadoPor, ahora, expira]
  );

  return { codigo, expiraAtMs: expira };
}

/**
 * Canjea un código por la credencial permanente del dispositivo.
 *
 * Es la única vez que se ve el secreto. Y es de un solo uso de verdad: la fila
 * se bloquea y se marca dentro de la misma transacción que crea el
 * dispositivo, así que dos agentes con el mismo código no se activan los dos.
 */
export async function activarDispositivo(e: {
  codigo: string;
  version?: string | null;
}): Promise<{ deviceId: number; secret: string; empresaId: string; centroId: string; nombre: string }> {
  const codigo = String(e.codigo ?? "").trim().toUpperCase();
  if (!codigo) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Falta el código de activación.", 400);
  }

  const { enTransaccion } = await import("../repository.ts");
  return enTransaccion(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM cash_autoscan_activation_codes WHERE codigo_hash = $1 FOR UPDATE`,
      [hash(codigo)]
    );
    const fila = rows[0];

    /*
     * El mismo error para «no existe», «ya se usó» y «caducó». Quien esté
     * probando códigos no debe poder distinguir uno real gastado de uno
     * inventado; los tres se resuelven igual: pedir otro código.
     */
    if (!fila || fila.usado_at_ms != null || Number(fila.expira_at_ms) <= Date.now()) {
      throw new ErrorCaja(
        "CODIGO_NO_VALIDO",
        "Ese código de activación no vale: puede haber caducado o haberse usado ya. Pide uno nuevo.",
        401
      );
    }

    /*
     * La licencia se mira DESPUÉS de validar el código y ANTES de crear nada.
     * Al revés quedaría un dispositivo dado de alta para una empresa que no
     * puede usar el módulo, y el código —que es de un solo uso— ya gastado.
     */
    await exigirLicencia(fila.empresa_id);

    const secret = randomBytes(32).toString("base64url");
    const ahora = Date.now();

    const { rows: creado } = await client.query(
      `INSERT INTO cash_autoscan_devices
         (empresa_id, centro_id, nombre, secret_hash, version, creado_por, creado_at_ms, ultimo_visto_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING id`,
      [
        fila.empresa_id,
        fila.centro_id,
        fila.nombre,
        hash(secret),
        e.version?.slice(0, 40) ?? null,
        fila.creado_por,
        ahora,
      ]
    );

    await client.query(
      `UPDATE cash_autoscan_activation_codes
          SET usado_at_ms = $2, usado_device_id = $3 WHERE id = $1`,
      [fila.id, ahora, creado[0].id]
    );

    return {
      deviceId: creado[0].id,
      secret,
      empresaId: fila.empresa_id,
      centroId: fila.centro_id,
      nombre: fila.nombre,
    };
  });
}

declare module "express-serve-static-core" {
  interface Request {
    /**
     * El dispositivo de AutoScan que hace la petición.
     *
     * Va aparte de `authCtx` a propósito: son dos autenticaciones distintas y
     * mezclarlas —un dispositivo con permisos de usuario, o un usuario
     * subiendo por la vía de máquina— es el error que esto evita.
     */
    autoscan?: Identidad;
  }
}

/** Lo que la credencial identifica: un dispositivo vivo, con su sitio. */
export type Identidad = {
  deviceId: number;
  empresaId: string;
  centroId: string;
  nombre: string;
};

/**
 * ¿De quién es esta credencial?
 *
 * `null` cuando no vale: no existe, o el dispositivo está revocado. Las dos
 * respuestas son la misma hacia fuera — un 401 sin detalles.
 */
export async function identificarDispositivo(secret: string): Promise<Identidad | null> {
  if (!secret) return null;

  const { rows } = await pool.query(
    `SELECT id, empresa_id, centro_id, nombre, secret_hash, revocado_at_ms
       FROM cash_autoscan_devices WHERE secret_hash = $1`,
    [hash(secret)]
  );
  const d = rows[0];
  if (!d || d.revocado_at_ms != null) return null;

  /*
   * La búsqueda ya va por el hash, así que esta comparación no decide nada:
   * está para que el camino no dependa de cómo compare el índice y no se
   * pueda medir por el tiempo de respuesta.
   */
  const guardado = Buffer.from(String(d.secret_hash));
  const calculado = Buffer.from(hash(secret));
  if (guardado.length !== calculado.length || !timingSafeEqual(guardado, calculado)) return null;

  return {
    deviceId: d.id,
    empresaId: d.empresa_id,
    centroId: d.centro_id,
    nombre: d.nombre,
  };
}

/** Apunta que el dispositivo sigue vivo, y con qué versión. */
export async function latido(deviceId: number, version?: string | null): Promise<void> {
  await pool.query(
    `UPDATE cash_autoscan_devices
        SET ultimo_visto_at_ms = $2, version = COALESCE($3, version)
      WHERE id = $1`,
    [deviceId, Date.now(), version?.slice(0, 40) ?? null]
  );
}

/**
 * Revoca un dispositivo. Los demás del centro siguen funcionando.
 *
 * No se borra la fila: los documentos que dejó siguen apuntando a ella, y
 * saber de qué máquina vino una factura es justo lo que hace falta el día que
 * se investiga algo.
 */
export async function revocarDispositivo(
  empresaId: string,
  deviceId: number,
  userId: string | null
): Promise<Dispositivo> {
  const { rows } = await pool.query(
    `UPDATE cash_autoscan_devices
        SET revocado_at_ms = COALESCE(revocado_at_ms, $3), revocado_por = COALESCE(revocado_por, $4)
      WHERE id = $1 AND empresa_id = $2
      RETURNING *`,
    [deviceId, empresaId, Date.now(), userId]
  );
  if (rows.length === 0) {
    throw new ErrorCaja("DISPOSITIVO_NO_ENCONTRADO", "Ese dispositivo no existe.", 404);
  }
  return aDispositivo(rows[0]);
}
