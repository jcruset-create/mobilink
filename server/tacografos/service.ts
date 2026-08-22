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
  componer,
  fechaEs,
  type TipoDocumento,
} from "./documents.ts";
import * as repo from "./repository.ts";
import { ErrorTacografos } from "./repository.ts";
import { guardarDocumento, rutaDocumento, urlFirmada } from "./storage.ts";

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

  const pdf = await componer(tipo, {
    expediente,
    centro,
    plantillas,
    pie: pie(tipo, version, emitidoAtMs, centro.numCentro),
  });

  const hash = createHash("sha256").update(pdf).digest("hex");
  const ruta = rutaDocumento(empresaId, expedienteId, tipo, emitidoAtMs);
  const tamanoBytes = await guardarDocumento(ruta, pdf);

  return repo.crearDocumento(empresaId, userId, {
    expedienteId,
    tipo,
    plantillaVersion: version,
    ruta,
    hash,
    tamanoBytes,
    emitidoAtMs,
  });
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
