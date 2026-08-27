/**
 * El escaneo de una factura, de punta a punta.
 *
 * Orquesta y nada más: el orden es el que manda, y cada paso vive en su
 * fichero.
 *
 *     documento → extracción (IA) → normalización → clasificación (reglas)
 *              → validación → duplicados → PROPUESTA
 *
 * Lo que NO hace, y es lo importante: no registra ningún cobro. Este servicio
 * no toca `cash_operations` ni el libro mayor de piezas. No es una promesa del
 * comentario, es que no tiene por dónde: la única tabla en la que escribe es
 * la del rastro del propio escaneo.
 */

import crypto from "node:crypto";
import pool from "../../db.ts";
import { ErrorCaja } from "../errors.ts";
import { formasPagoActivas } from "../config.ts";
import { clasificar, type ReglaFormaCobro } from "./classifier.ts";
import { extractorIA, type DocumentoAdjunto, type ExtractorFacturas } from "./extractor.ts";
import { evidenciaDeCobro, normalizar } from "./normalize.ts";
import type { Aviso, PropuestaCobro } from "./types.ts";
import { validar } from "./validate.ts";

/** Lo mismo que admite un justificante: es el mismo papel. */
const MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const TAMANO_MAXIMO = 15 * 1024 * 1024;

/**
 * Qué es el fichero DE VERDAD, mirando sus primeros bytes.
 *
 * El `Content-Type` lo pone quien sube, y un fichero puede llamarse
 * `factura.pdf`, declararse PDF y ser cualquier otra cosa. Aquí se comprueba la
 * firma, que es lo único que no depende de la buena fe de nadie.
 */
export function tipoReal(buffer: Buffer): string | null {
  if (buffer.length < 8) return null;
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  return null;
}

/**
 * Comprueba el fichero antes de mandarlo a ningún sitio.
 *
 * Devuelve el tipo real, que es el que se usa a partir de aquí: si alguien
 * sube un JPG llamándolo PDF, se trata como el JPG que es en vez de rechazarlo
 * —el mostrador escanea con lo que tiene a mano— pero lo que manda es la
 * firma, nunca la etiqueta.
 */
export function exigirDocumentoValido(fichero: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}): string {
  if (fichero.buffer.length === 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "El fichero está vacío.", 400);
  }
  if (fichero.buffer.length > TAMANO_MAXIMO) {
    throw new ErrorCaja(
      "DOCUMENTO_DEMASIADO_GRANDE",
      "El documento pasa de 15 MB. Escanéalo con menos resolución.",
      400
    );
  }
  const real = tipoReal(fichero.buffer);
  if (!real || !MIMES.has(real)) {
    throw new ErrorCaja(
      "FORMATO_NO_ADMITIDO",
      "La factura tiene que ser un PDF, un JPG o un PNG.",
      400
    );
  }
  return real;
}

/** Las reglas activas de la empresa, en el orden en que se prueban. */
export async function reglasDeEmpresa(empresaId: string): Promise<ReglaFormaCobro[]> {
  const { rows } = await pool.query(
    `SELECT id, campo, patron, forma_pago, confianza, auto_seleccionar, prioridad
       FROM cash_payment_rules
      WHERE empresa_id = $1 AND activa
      ORDER BY prioridad, id`,
    [empresaId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    id: r.id,
    campo: r.campo,
    patron: r.patron,
    formaPago: r.forma_pago,
    // NUMERIC llega como texto para no perder precisión.
    confianza: Number(r.confianza),
    autoSeleccionar: r.auto_seleccionar,
    prioridad: r.prioridad,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * ¿Está ya cobrada esta factura?
 *
 * Se busca por número de factura dentro de la empresa, que es lo que de verdad
 * identifica el documento; el importe y el cliente van en el aviso para que
 * quien lo lea sepa si es el mismo cobro o una factura rectificativa. No
 * bloquea: avisa. Hay casos legítimos —un cobro anulado y rehecho— y quien
 * está delante del cliente sabe más que la comprobación.
 */
async function buscarDuplicado(
  empresaId: string,
  referencia: string | null
): Promise<Aviso | null> {
  if (!referencia) return null;
  const { rows } = await pool.query(
    `SELECT numero, importe_centimos, party_nombre, created_at_ms
       FROM cash_operations
      WHERE empresa_id = $1 AND tipo = 'COLLECTION' AND estado = 'CONFIRMED'
        AND upper(trim(referencia)) = upper(trim($2))
      ORDER BY id DESC LIMIT 1`,
    [empresaId, referencia]
  );
  if (rows.length === 0) return null;
  const previo = rows[0];
  return {
    codigo: "POSIBLE_DUPLICADO",
    mensaje:
      `La factura ${referencia} ya está cobrada en ${previo.numero}` +
      `${previo.party_nombre ? ` (${previo.party_nombre})` : ""}. ` +
      "Comprueba antes de volver a cobrarla.",
    grave: true,
  };
}

export type EntradaEscaneo = {
  empresaId: string;
  userId: string | null;
  sessionId: number | null;
  fichero: { originalname: string; mimetype: string; buffer: Buffer };
};

/**
 * Deja constancia de un escaneo que no ha salido.
 *
 * Nunca lanza: el error que hay que enseñar es el del escaneo, no el de no
 * haber podido apuntarlo. Y no guarda el mensaje entero, solo su principio:
 * por ahí pueden venir trozos de respuesta del proveedor.
 */
async function apuntarFallo(
  entrada: EntradaEscaneo,
  documento: DocumentoAdjunto,
  duracionMs: number,
  causa: unknown
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO cash_invoice_scans
         (empresa_id, session_id, nombre, mime, tamano_bytes, sha256, motor, duracion_ms,
          error, creado_por, creado_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        entrada.empresaId,
        entrada.sessionId,
        documento.nombre,
        documento.mime,
        documento.contenido.length,
        crypto.createHash("sha256").update(documento.contenido).digest("hex"),
        "openai:responses",
        duracionMs,
        String(causa instanceof Error ? causa.message : causa).slice(0, 300),
        entrada.userId,
        Date.now(),
      ]
    );
  } catch (e) {
    console.error("Mobilink Cash: no se ha podido apuntar el escaneo fallido:", e);
  }
}

/**
 * Escanea y propone. Nunca cobra.
 *
 * `extractor` entra por parámetro para poder probar el camino entero sin
 * llamar a ningún proveedor: en las pruebas se pasa uno que devuelve la
 * extracción de una factura conocida.
 */
export async function escanearFactura(
  entrada: EntradaEscaneo,
  extractor: ExtractorFacturas = extractorIA
): Promise<PropuestaCobro & { scanId: number }> {
  const mimeReal = exigirDocumentoValido(entrada.fichero);
  const documento: DocumentoAdjunto = {
    nombre: entrada.fichero.originalname.slice(0, 200),
    mime: mimeReal,
    contenido: entrada.fichero.buffer,
  };

  const inicio = Date.now();
  let cruda;
  try {
    cruda = await extractor(documento);
  } catch (e) {
    /*
     * Un escaneo que falla también deja rastro, y es el que más falta hace:
     * cuando alguien dice «a mí no me lee las facturas», lo que hay que poder
     * mirar es esto. Se apunta y se vuelve a lanzar, que quien está delante
     * tiene que enterarse.
     */
    await apuntarFallo(entrada, documento, Date.now() - inicio, e);
    throw e;
  }
  const duracionMs = Date.now() - inicio;

  const normalizada = normalizar(cruda);

  // El catálogo y las reglas, de la empresa y de ahora: una forma dada de baja
  // ayer no puede proponerse hoy.
  const [formas, reglas] = await Promise.all([
    formasPagoActivas(entrada.empresaId),
    reglasDeEmpresa(entrada.empresaId),
  ]);
  const catalogo = new Set(formas.filter((f) => f.enCobros).map((f) => f.codigo));

  const propuestaForma = clasificar(evidenciaDeCobro(normalizada), reglas, catalogo);
  const propuesta = validar(normalizada, propuestaForma);

  const duplicado = await buscarDuplicado(entrada.empresaId, propuesta.referencia.valor);
  if (duplicado) {
    propuesta.avisos.push(duplicado);
    // Un duplicado es grave: nada se preselecciona hasta que alguien mire.
    propuesta.formaCobro = { ...propuesta.formaCobro, autoSeleccionar: false };
  }

  /*
   * El rastro de un escaneo que ha salido. Los que fallan dejan el suyo por
   * `apuntarFallo`, arriba: los dos hacen falta, y el que hay que investigar
   * meses después suele ser el que salió regular.
   *
   * Lo que no se guarda: el fichero. Ese se cuelga del cobro por la vía de
   * siempre cuando el cobro existe, y duplicarlo aquí sería tener la factura
   * de un cliente en dos sitios con dos ciclos de vida distintos.
   */
  const { rows } = await pool.query(
    `INSERT INTO cash_invoice_scans
       (empresa_id, session_id, nombre, mime, tamano_bytes, sha256, motor, duracion_ms,
        extraccion_cruda, extraccion_normalizada, forma_pago_propuesta, forma_pago_confianza,
        forma_pago_motivo, regla_id, auto_seleccionada, avisos, creado_por, creado_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      entrada.empresaId,
      entrada.sessionId,
      documento.nombre,
      documento.mime,
      documento.contenido.length,
      crypto.createHash("sha256").update(documento.contenido).digest("hex"),
      "openai:responses",
      duracionMs,
      JSON.stringify(cruda),
      JSON.stringify(normalizada),
      propuesta.formaCobro.formaPago,
      propuesta.formaCobro.confianza,
      propuesta.formaCobro.motivo,
      propuesta.formaCobro.reglaId,
      propuesta.formaCobro.autoSeleccionar,
      JSON.stringify(propuesta.avisos),
      entrada.userId,
      Date.now(),
    ]
  );

  return { ...propuesta, scanId: rows[0].id };
}

/**
 * Cierra el círculo: qué hizo la persona con lo que se le propuso.
 *
 * Se llama al confirmar el cobro, y es lo que convierte el rastro en algo
 * útil: sin esto solo se sabría qué propuso la máquina, nunca si acertó. Falla
 * en silencio a propósito —un cobro registrado no se tumba porque no se haya
 * podido apuntar una estadística—.
 */
export async function anotarConfirmacion(
  scanId: number,
  empresaId: string,
  datos: { operationId: number; formaPagoFinal: string; camposCorregidos: string[] }
): Promise<void> {
  try {
    await pool.query(
      `UPDATE cash_invoice_scans
          SET operation_id = $3, forma_pago_final = $4, campos_corregidos = $5,
              confirmado_at_ms = $6
        WHERE id = $1 AND empresa_id = $2`,
      [
        scanId,
        empresaId,
        datos.operationId,
        datos.formaPagoFinal,
        JSON.stringify(datos.camposCorregidos),
        Date.now(),
      ]
    );
  } catch (e) {
    console.error("Mobilink Cash: no se ha podido anotar el resultado del escaneo:", e);
  }
}
