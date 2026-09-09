/**
 * La bandeja de AutoScan: facturas que han llegado y todavía no son de nadie.
 *
 * Aquí vive la diferencia que define toda la funcionalidad:
 *
 *     DOCUMENTO DE AUTOSCAN  ≠  DOCUMENTO DE UNA OPERACIÓN
 *
 * hasta que alguien cobra con él. El de la operación cuelga de un cobro y de
 * una jornada; éste no cuelga de nada, porque cuando llega puede no haber ni
 * cobro ni jornada: son las 20:40 y la caja cerró a las 20:00.
 *
 * ## Escanear no es cobrar
 *
 * AutoScan recibe, guarda, analiza y propone. La persona revisa y confirma. La
 * caja registra. Un documento no pasa a USADO por abrirlo, ni por
 * seleccionarlo, ni por rellenar el formulario con él: solo cuando existe un
 * cobro de verdad.
 *
 * ## Duplicado e idempotencia son dos preguntas distintas
 *
 * · **Duplicado** — «¿este CONTENIDO ya está en este centro?». Se responde con
 *   el sha256 y un índice único en la base de datos, no con un SELECT previo:
 *   dos agentes pueden subir el mismo PDF a la vez.
 * · **Idempotencia** — «¿esta misma PETICIÓN ya se procesó?». Se responde con
 *   la clave que manda el agente, que es la misma cuando reintenta tras
 *   quedarse sin respuesta.
 *
 * Se parecen y no son lo mismo: el primero devuelve el documento que ya
 * estaba, aunque lo subiera otra máquina otro día; el segundo devuelve el
 * resultado de la petición anterior de ESE agente. Mezclarlos daría un sistema
 * que no sabe distinguir «esto ya lo tenías» de «esto ya te lo mandé».
 */

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import pool from "../../db.ts";
import { ErrorCaja } from "../errors.ts";
import { guardarDocumento, urlFirmada } from "../storage.ts";
import type { Identidad } from "./devices.ts";

/**
 * Cuándo un documento se considera viejo: 30 días.
 *
 * NO es un estado. Es una condición que se calcula, y por eso no hace falta
 * ningún proceso nocturno que voltee filas: el día que ese proceso no corriera,
 * la pantalla mentiría. Un documento viejo sigue en su estado real y sigue
 * contando como pendiente; lo único que cambia es que se ve destacado.
 */
export const ANTIGUO_MS = 30 * 24 * 60 * 60_000;

/** Lo mismo que aceptan las subidas manuales: nada de discrepancias. */
export const TAMANO_MAXIMO = 15 * 1024 * 1024;

export type EstadoInbox =
  | "PENDIENTE"
  | "ANALIZANDO"
  | "LISTO"
  | "USADO"
  | "FALLIDO"
  | "DESCARTADO";

/** Los que siguen esperando a que alguien haga algo con ellos. */
export const ESTADOS_PENDIENTES: readonly EstadoInbox[] = [
  "PENDIENTE",
  "ANALIZANDO",
  "LISTO",
  "FALLIDO",
];

export type DocumentoInbox = {
  id: number;
  empresaId: string;
  centroId: string;
  deviceId: number;
  deviceNombre: string | null;
  sha256: string;
  nombreOriginal: string;
  mime: string;
  tamanoBytes: number;
  estado: EstadoInbox;
  error: string | null;
  intentos: number;
  scanId: number | null;
  operationId: number | null;
  recibidoAtMs: number;
  analizadoAtMs: number | null;
  usadoAtMs: number | null;
  /** Derivado de `recibidoAtMs`, nunca guardado. */
  esAntiguo: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function aDocumento(r: any): DocumentoInbox {
  const recibido = Number(r.recibido_at_ms);
  const estado = r.estado as EstadoInbox;
  return {
    id: r.id,
    empresaId: r.empresa_id,
    centroId: r.centro_id,
    deviceId: r.device_id,
    deviceNombre: r.device_nombre ?? null,
    sha256: r.sha256,
    nombreOriginal: r.nombre_original,
    mime: r.mime,
    tamanoBytes: Number(r.tamano_bytes),
    estado,
    error: r.error ?? null,
    intentos: Number(r.intentos ?? 0),
    scanId: r.scan_id ?? null,
    operationId: r.operation_id ?? null,
    recibidoAtMs: recibido,
    analizadoAtMs: r.analizado_at_ms == null ? null : Number(r.analizado_at_ms),
    usadoAtMs: r.usado_at_ms == null ? null : Number(r.usado_at_ms),
    esAntiguo:
      ESTADOS_PENDIENTES.includes(estado) && Date.now() - recibido > ANTIGUO_MS,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const huella = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

export type Recepcion = {
  documento: DocumentoInbox;
  /** true = ya estaba. No es un error: es el sistema funcionando. */
  duplicado: boolean;
};

/**
 * Recibe un documento de un dispositivo.
 *
 * El orden importa: primero se mira si ya está —para no dejar un fichero
 * huérfano en el bucket— y solo después se guarda. Si la carrera se pierde
 * igualmente contra otro agente, el índice único la resuelve y el fichero
 * recién subido se queda sin fila, que es preferible al revés.
 *
 * La empresa y el centro salen de `identidad`, nunca de la petición.
 */
export async function recibirDocumento(
  identidad: Identidad,
  e: {
    fichero: { originalname: string; mimetype: string; buffer: Buffer };
    idempotencyKey: string;
    escaneadoAtMs?: number | null;
  }
): Promise<Recepcion> {
  if (!e.fichero?.buffer?.length) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "No ha llegado ningún documento.", 400);
  }
  if (e.fichero.buffer.length > TAMANO_MAXIMO) {
    throw new ErrorCaja(
      "FICHERO_DEMASIADO_GRANDE",
      `El documento pasa de ${TAMANO_MAXIMO / (1024 * 1024)} MB.`,
      413
    );
  }
  const idem = String(e.idempotencyKey ?? "").trim();
  if (!idem) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Falta la clave de idempotencia.", 400);
  }

  /*
   * El tipo REAL, por los primeros bytes y no por la extensión. Un .exe
   * renombrado a .pdf entra por aquí igual de fácil que una factura.
   */
  const { exigirDocumentoValido } = await import("../invoice-scan/service.ts");
  const mime = exigirDocumentoValido(e.fichero);

  const sha = huella(e.fichero.buffer);

  /*
   * ¿Es un reintento de la MISMA petición? Se responde con lo de antes sin
   * tocar nada. Va primero porque es la pregunta más barata y la más
   * frecuente en una red mala.
   */
  const yaProcesada = await porIdempotencia(identidad.deviceId, idem);
  if (yaProcesada) return { documento: yaProcesada, duplicado: false };

  /* ¿Es el MISMO contenido, aunque venga de otra petición u otra máquina? */
  const yaEstaba = await porContenido(identidad.empresaId, identidad.centroId, sha);
  if (yaEstaba) return { documento: yaEstaba, duplicado: true };

  const ahora = Date.now();
  const ruta = `autoscan/${identidad.empresaId}/${identidad.centroId}/${ahora}-${sha.slice(0, 12)}`;
  await guardarDocumento(ruta, e.fichero.buffer, mime);

  const { rows } = await pool.query(
    `INSERT INTO cash_autoscan_inbox
       (empresa_id, centro_id, device_id, sha256, nombre_original, mime, tamano_bytes,
        ruta, idempotency_key, escaneado_at_ms, recibido_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      identidad.empresaId,
      identidad.centroId,
      identidad.deviceId,
      sha,
      (e.fichero.originalname || "documento").slice(0, 200),
      mime,
      e.fichero.buffer.length,
      ruta,
      idem,
      e.escaneadoAtMs ?? null,
      ahora,
    ]
  );

  /*
   * Sin fila = otro lo insertó entre la comprobación y el INSERT. Es la
   * carrera de dos agentes con el mismo PDF, y la respuesta correcta no es un
   * 500: es devolver el que ganó.
   */
  if (rows.length === 0) {
    const ganador =
      (await porIdempotencia(identidad.deviceId, idem)) ??
      (await porContenido(identidad.empresaId, identidad.centroId, sha));
    if (!ganador) {
      throw new ErrorCaja(
        "RECEPCION_FALLIDA",
        "No se ha podido registrar el documento. Vuelve a intentarlo.",
        409
      );
    }
    return { documento: ganador, duplicado: true };
  }

  return { documento: aDocumento(rows[0]), duplicado: false };
}

async function porIdempotencia(deviceId: number, clave: string): Promise<DocumentoInbox | null> {
  const { rows } = await pool.query(
    `SELECT * FROM cash_autoscan_inbox WHERE device_id = $1 AND idempotency_key = $2`,
    [deviceId, clave]
  );
  return rows[0] ? aDocumento(rows[0]) : null;
}

async function porContenido(
  empresaId: string,
  centroId: string,
  sha: string
): Promise<DocumentoInbox | null> {
  const { rows } = await pool.query(
    `SELECT * FROM cash_autoscan_inbox
      WHERE empresa_id = $1 AND centro_id = $2 AND sha256 = $3 AND estado <> 'DESCARTADO'`,
    [empresaId, centroId, sha]
  );
  return rows[0] ? aDocumento(rows[0]) : null;
}

/** Un documento concreto, con su dispositivo. Aísla por empresa. */
export async function documento(
  empresaId: string,
  id: number,
  client: PoolClient | typeof pool = pool
): Promise<DocumentoInbox | null> {
  const { rows } = await client.query(
    `SELECT i.*, d.nombre AS device_nombre
       FROM cash_autoscan_inbox i
       JOIN cash_autoscan_devices d ON d.id = i.device_id
      WHERE i.id = $1 AND i.empresa_id = $2`,
    [id, empresaId]
  );
  return rows[0] ? aDocumento(rows[0]) : null;
}

/** La bandeja de un centro. Los que se pueden usar, primero. */
export async function listar(
  empresaId: string,
  centroId: string | null,
  estados: readonly EstadoInbox[] = ESTADOS_PENDIENTES
): Promise<DocumentoInbox[]> {
  const { rows } = await pool.query(
    `SELECT i.*, d.nombre AS device_nombre
       FROM cash_autoscan_inbox i
       JOIN cash_autoscan_devices d ON d.id = i.device_id
      WHERE i.empresa_id = $1
        AND ($2::uuid IS NULL OR i.centro_id = $2::uuid)
        AND i.estado = ANY($3::text[])
      ORDER BY (i.estado = 'LISTO') DESC, i.recibido_at_ms DESC
      LIMIT 200`,
    [empresaId, centroId, [...estados]]
  );
  return rows.map(aDocumento);
}

export type ResumenBandeja = {
  /** Si el centro NO tiene dispositivos, la pantalla no enseña el bloque. */
  hayDispositivos: boolean;
  pendientes: number;
  listos: number;
  analizando: number;
  fallidos: number;
  antiguos: number;
};

/**
 * El contador, con UNA sola regla y en el servidor.
 *
 * `pendientes` cuenta PENDIENTE + ANALIZANDO + LISTO + FALLIDO. No cuenta
 * USADO ni DESCARTADO: ésos ya no esperan a nadie. La pantalla no recalcula
 * nada; si lo hiciera, tarde o temprano contaría distinto.
 */
export async function resumen(
  empresaId: string,
  centroId: string | null
): Promise<ResumenBandeja> {
  const [{ rows: disp }, { rows: cuentas }] = await Promise.all([
    pool.query(
      `SELECT 1 FROM cash_autoscan_devices
        WHERE empresa_id = $1 AND ($2::uuid IS NULL OR centro_id = $2::uuid)
          AND revocado_at_ms IS NULL LIMIT 1`,
      [empresaId, centroId]
    ),
    pool.query(
      `SELECT estado, count(*)::int AS n,
              count(*) FILTER (WHERE recibido_at_ms < $3) ::int AS viejos
         FROM cash_autoscan_inbox
        WHERE empresa_id = $1 AND ($2::uuid IS NULL OR centro_id = $2::uuid)
          AND estado = ANY($4::text[])
        GROUP BY estado`,
      [empresaId, centroId, Date.now() - ANTIGUO_MS, [...ESTADOS_PENDIENTES]]
    ),
  ]);

  const por = (estado: string) =>
    Number(cuentas.find((c) => c.estado === estado)?.n ?? 0);

  return {
    hayDispositivos: disp.length > 0,
    pendientes: cuentas.reduce((a, c) => a + Number(c.n), 0),
    listos: por("LISTO"),
    analizando: por("ANALIZANDO"),
    fallidos: por("FALLIDO"),
    antiguos: cuentas.reduce((a, c) => a + Number(c.viejos), 0),
  };
}

/** Enlace temporal para abrir el PDF desde la pantalla. */
export async function enlace(empresaId: string, id: number): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT ruta FROM cash_autoscan_inbox WHERE id = $1 AND empresa_id = $2`,
    [id, empresaId]
  );
  return rows[0] ? urlFirmada(rows[0].ruta) : null;
}

/**
 * Descarta un documento. NO lo borra.
 *
 * `DESCARTADO` es un estado de negocio, no un `DELETE`: un documento
 * financiero no desaparece porque alguien decida que no hacía falta. El
 * fichero se queda en el bucket, y el índice único deja de mirarlo, así que si
 * se vuelve a escanear el mismo PDF entra otra vez.
 */
export async function descartar(
  empresaId: string,
  id: number,
  userId: string | null,
  motivo: string | null
): Promise<DocumentoInbox> {
  const { rows } = await pool.query(
    `UPDATE cash_autoscan_inbox
        SET estado = 'DESCARTADO', descartado_por = $3, descartado_at_ms = $4,
            descartado_motivo = $5
      WHERE id = $1 AND empresa_id = $2 AND estado IN ('PENDIENTE','LISTO','FALLIDO')
      RETURNING *`,
    [id, empresaId, userId, Date.now(), motivo?.trim()?.slice(0, 300) || null]
  );
  if (rows.length === 0) {
    throw new ErrorCaja(
      "DOCUMENTO_NO_DESCARTABLE",
      "Ese documento no existe o ya no se puede descartar.",
      409
    );
  }
  return aDocumento(rows[0]);
}

/** Devuelve a la cola un documento que falló. No crea una fila nueva. */
export async function reintentar(empresaId: string, id: number): Promise<DocumentoInbox> {
  const { rows } = await pool.query(
    `UPDATE cash_autoscan_inbox
        SET estado = 'PENDIENTE', error = NULL
      WHERE id = $1 AND empresa_id = $2 AND estado = 'FALLIDO'
      RETURNING *`,
    [id, empresaId]
  );
  if (rows.length === 0) {
    throw new ErrorCaja(
      "DOCUMENTO_NO_REINTENTABLE",
      "Ese documento no existe o no está fallido.",
      409
    );
  }
  return aDocumento(rows[0]);
}
