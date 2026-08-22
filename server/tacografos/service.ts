/**
 * Emisión de documentos.
 *
 * Es el único sitio que decide si un documento puede emitirse. El router valida
 * forma; aquí están las reglas que hacen que el papel valga: que el expediente
 * esté completo, que el documento corresponda al tipo de operación y que no
 * haya otro vigente del mismo tipo.
 *
 * Un documento emitido es **inmutable**. Corregir un dato no lo reescribe: se
 * anula con motivo y se emite otro. Por eso se guarda el SHA-256 del PDF y la
 * versión de plantilla con la que se compuso — con eso se puede demostrar años
 * después que el papel que enseña el cliente es el que salió de aquí.
 */

import { createHash } from "node:crypto";
import { camposQueFaltan } from "./domain.ts";
import {
  CODIGO_FORMATO,
  DOCUMENTOS_POR_TIPO,
  FIRMAS_POR_DOCUMENTO,
  componer,
  fechaEs,
  type TipoDocumento,
} from "./documents.ts";
import * as repo from "./repository.ts";
import { ErrorTacografos } from "./repository.ts";
import {
  guardarDocumento,
  leerDocumento,
  rutaDocumento,
  rutaFirma,
  urlFirmada,
} from "./storage.ts";

/** Pie de identificación del documento (UNE 66102:2025, 7.5.2). */
function pie(tipo: TipoDocumento, version: number, emitidoAtMs: number, numCentro: string): string {
  const emitido = fechaEs(new Date(emitidoAtMs).toISOString().slice(0, 10));
  const centro = numCentro ? ` · Centro ${numCentro}` : "";
  return `Formato ${CODIGO_FORMATO[tipo]} · Plantillas v${version} · Emitido ${emitido}${centro} · UNE 66102:2025`;
}

export async function emitirDocumento(
  empresaId: string,
  userId: string,
  expedienteId: string,
  tipo: TipoDocumento
): Promise<repo.Documento> {
  const expediente = await repo.obtenerExpediente(empresaId, expedienteId);
  if (!expediente) {
    throw new ErrorTacografos("Expediente no encontrado.", "EXPEDIENTE_NO_ENCONTRADO", 404);
  }
  if (expediente.estado === "anulado") {
    throw new ErrorTacografos(
      "El expediente está anulado: no pueden emitirse documentos.",
      "EXPEDIENTE_ANULADO"
    );
  }

  if (!DOCUMENTOS_POR_TIPO[expediente.tipo].includes(tipo)) {
    throw new ErrorTacografos(
      "Ese documento no corresponde al tipo de operación del expediente.",
      "DOCUMENTO_NO_APLICA"
    );
  }

  // Un documento incompleto es peor que no tenerlo: se firma igual y no vale.
  const faltan = camposQueFaltan(expediente);
  if (faltan.length > 0) {
    throw new ErrorTacografos(
      `Faltan datos obligatorios: ${faltan.map((f) => f.etiqueta).join(", ")}.`,
      "EXPEDIENTE_INCOMPLETO",
      400,
      { camposQueFaltan: faltan }
    );
  }

  const centro = await repo.obtenerCentro(empresaId);
  const version = await repo.versionVigente();
  const plantillas = await repo.cargarPlantillas(version);
  const emitidoAtMs = Date.now();

  // Sólo se cargan las rúbricas que este documento va a usar: bajarse la del
  // responsable técnico para emitir un justificante sería tráfico tirado.
  const firmas = await repo.listarFirmas(empresaId, expedienteId);
  const rubricasPng: Partial<Record<repo.PapelFirma, Buffer>> = {};
  for (const papel of FIRMAS_POR_DOCUMENTO[tipo]) {
    const firma = firmas.find((f) => f.papel === papel);
    if (!firma) continue;
    const bytes = await leerDocumento(firma.ruta);
    if (bytes) rubricasPng[papel] = bytes;
  }

  const pdf = await componer(tipo, {
    expediente,
    centro,
    plantillas,
    pie: pie(tipo, version, emitidoAtMs, centro.numCentro),
    rubricasPng,
  });

  const hash = createHash("sha256").update(pdf).digest("hex");
  const ruta = rutaDocumento(empresaId, expedienteId, tipo, emitidoAtMs);
  const tamanoBytes = await guardarDocumento(ruta, pdf);

  const documento = await repo.crearDocumento(empresaId, userId, {
    expedienteId,
    tipo,
    plantillaVersion: version,
    ruta,
    hash,
    tamanoBytes,
    emitidoAtMs,
  });

  // Emitir saca al expediente del borrador. No se toca si ya está más adelante
  // (entregado o comunicado): reemitir un documento no deshace una entrega.
  await repo.cambiarEstado(empresaId, expedienteId, "emitido", ["borrador"]);

  return documento;
}

// ── Firmas ──────────────────────────────────────────────────────────────────

/** Cabecera de un PNG: los ocho bytes que lo identifican. */
const CABECERA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Tope de la imagen de una firma. Una rúbrica de canvas ronda los 10-30 KB. */
const MAX_FIRMA_BYTES = 512 * 1024;

/**
 * Guarda la rúbrica de un papel.
 *
 * Sólo mientras el expediente no tiene emitido el documento que la lleva: una
 * vez emitido, la firma vive dentro del PDF y cambiarla aquí no cambiaría nada
 * —sería peor, porque daría la impresión de que sí—.
 */
export async function firmar(
  empresaId: string,
  userId: string,
  expedienteId: string,
  papel: repo.PapelFirma,
  pngBase64: string,
  nombre: string
): Promise<repo.Firma> {
  const expediente = await repo.obtenerExpediente(empresaId, expedienteId);
  if (!expediente) {
    throw new ErrorTacografos("Expediente no encontrado.", "EXPEDIENTE_NO_ENCONTRADO", 404);
  }

  const png = Buffer.from(pngBase64.replace(/^data:image\/png;base64,/, ""), "base64");
  if (!png.subarray(0, 8).equals(CABECERA_PNG)) {
    throw new ErrorTacografos("La firma debe ser una imagen PNG.", "FIRMA_NO_PNG");
  }
  if (png.length > MAX_FIRMA_BYTES) {
    throw new ErrorTacografos("La imagen de la firma es demasiado grande.", "FIRMA_DEMASIADO_GRANDE");
  }

  // Si el documento que lleva esta firma ya se emitió, firmar otra vez no haría
  // nada visible. Se dice, en vez de aceptarlo en silencio.
  const documentos = await repo.listarDocumentos(empresaId, expedienteId);
  const bloqueado = documentos.some(
    (d) => !d.anulado && FIRMAS_POR_DOCUMENTO[d.tipo as TipoDocumento]?.includes(papel)
  );
  if (bloqueado) {
    throw new ErrorTacografos(
      "El documento que lleva esta firma ya está emitido. Anúlalo para volver a firmar.",
      "FIRMA_BLOQUEADA",
      409
    );
  }

  const firmadoAtMs = Date.now();
  const ruta = rutaFirma(empresaId, expedienteId, papel, firmadoAtMs);
  await guardarDocumento(ruta, png, "image/png");

  return repo.guardarFirma(empresaId, userId, {
    expedienteId,
    papel,
    ruta,
    nombre,
    firmadoAtMs,
  });
}

// ── Entrega ─────────────────────────────────────────────────────────────────

/**
 * Registra la entrega del certificado al cliente.
 *
 * Exige que haya algo emitido: dar por entregado un expediente del que no ha
 * salido ningún papel es justo el apunte que no cuadra en una auditoría.
 */
export async function registrarEntrega(
  empresaId: string,
  expedienteId: string,
  d: { fechaEntrega: string; receptorNombre: string; receptorDni: string }
): Promise<repo.Expediente> {
  const expediente = await repo.registrarEntrega(empresaId, expedienteId, d);
  if (!expediente) {
    throw new ErrorTacografos(
      "No se puede registrar la entrega: el expediente no existe o todavía no tiene ningún documento emitido.",
      "ENTREGA_NO_POSIBLE",
      409
    );
  }
  return expediente;
}

export type DocumentoConEnlace = repo.Documento & { url: string | null };

/**
 * Documentos del expediente con un enlace temporal para abrirlos.
 *
 * El enlace se firma al pedir la lista y caduca: así una URL copiada de la
 * barra del navegador y reenviada por WhatsApp deja de abrir el NIF de nadie a
 * los quince minutos.
 */
export async function documentosDelExpediente(
  empresaId: string,
  expedienteId: string
): Promise<DocumentoConEnlace[]> {
  const documentos = await repo.listarDocumentos(empresaId, expedienteId);
  return Promise.all(
    documentos.map(async (d) => ({
      ...d,
      url: d.anulado ? null : await urlFirmada(d.ruta),
    }))
  );
}
