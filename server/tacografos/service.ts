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
import {
  ANOS_CONSERVACION_CERTIFICADOS,
  camposQueFaltan,
  diasParaDestruir,
  estadoCustodia,
  faltaParaDestruir,
  fechaLimiteDestruccion,
  type EstadoCustodia,
} from "./domain.ts";
import {
  CODIGO_FORMATO,
  DOCUMENTOS_POR_TIPO,
  FIRMAS_POR_DOCUMENTO,
  componer,
  fechaEs,
  type TipoDocumento,
} from "./documents.ts";
import { PLANTILLAS } from "./templates.ts";
import * as repo from "./repository.ts";
import { ErrorTacografos } from "./repository.ts";
import {
  guardarDocumento,
  leerDocumento,
  rutaDocumento,
  rutaFirma,
  urlFirmada,
} from "./storage.ts";

/** Día local de un instante, en `aaaa-mm-dd`. Mismo motivo que en `aIso`. */
function diaLocal(ms: number): string {
  const d = new Date(ms);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Pie de identificación del documento (UNE 66102:2025, 7.5.2). */
function pie(tipo: TipoDocumento, version: number, emitidoAtMs: number, numCentro: string): string {
  const emitido = fechaEs(diaLocal(emitidoAtMs));
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

  if (tipo === "acta_destruccion") {
    // No la decide el tipo de operación sino la destrucción: se levanta un año
    // después, y sólo si hubo archivos que destruir.
    const falta = faltaParaDestruir({
      fecha: expediente.destruccionFecha ?? "",
      metodo: expediente.destruccionMetodo,
      persona: expediente.destruccionPersona,
      hash: expediente.destruccionHash,
    });
    if (falta.length > 0) {
      throw new ErrorTacografos(
        `El acta no puede emitirse sin registrar antes la destrucción. Falta: ${falta.join(", ")}.`,
        "DESTRUCCION_NO_REGISTRADA",
        409,
        { falta }
      );
    }
  } else if (!DOCUMENTOS_POR_TIPO[expediente.tipo].includes(tipo)) {
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
  nombre: string,
  dni = ""
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

  // El nombre y el DNI se recogen aquí, con la persona delante: es el momento
  // en que se saben de verdad, y por eso dejaron de exigirse al emitir.
  await repo.actualizarPersonaFirma(empresaId, expedienteId, papel, nombre, dni);

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


// ── Custodia y destrucción de los archivos transferidos ─────────────────────

/** Hoy en `aaaa-mm-dd`, con los componentes locales. */
function hoy(): string {
  return diaLocal(Date.now());
}

export type FilaCustodia = {
  expediente: repo.Expediente;
  estado: EstadoCustodia;
  fechaLimite: string | null;
  diasRestantes: number | null;
};

/** Cola de archivos bajo custodia, lo más urgente primero. */
export async function colaCustodia(empresaId: string): Promise<FilaCustodia[]> {
  const dia = hoy();
  return (await repo.listarCustodia(empresaId)).map((expediente) => ({
    expediente,
    estado: estadoCustodia(expediente.fechaTransferencia, expediente.destruccionFecha, dia),
    fechaLimite: fechaLimiteDestruccion(expediente.fechaTransferencia),
    diasRestantes: diasParaDestruir(expediente.fechaTransferencia, dia),
  }));
}

/**
 * Anota la destrucción de los archivos de una transferencia.
 *
 * No se deja registrar antes de tiempo: destruir a los seis meses incumple el
 * plazo de conservación de un año igual que no destruir nunca incumple el de
 * destrucción, y la fecha que quedaría escrita sería la prueba de ello.
 */
export async function registrarDestruccion(
  empresaId: string,
  expedienteId: string,
  d: { fecha: string; metodo: string; persona: string; hash: string }
): Promise<repo.Expediente> {
  const falta = faltaParaDestruir(d);
  if (falta.length > 0) {
    throw new ErrorTacografos(
      `Faltan datos del acta de destrucción: ${falta.join(", ")}.`,
      "DESTRUCCION_INCOMPLETA",
      400,
      { falta }
    );
  }

  const expediente = await repo.obtenerExpediente(empresaId, expedienteId);
  if (!expediente) {
    throw new ErrorTacografos("Expediente no encontrado.", "EXPEDIENTE_NO_ENCONTRADO", 404);
  }
  const limite = fechaLimiteDestruccion(expediente.fechaTransferencia);
  if (!limite) {
    throw new ErrorTacografos(
      "Este expediente no tiene transferencia: no hay archivos que destruir.",
      "SIN_TRANSFERENCIA",
      409
    );
  }
  if (d.fecha < limite) {
    throw new ErrorTacografos(
      `Los archivos deben conservarse hasta el ${fechaEs(limite)}.`,
      "DESTRUCCION_ANTES_DE_PLAZO",
      409,
      { fechaLimite: limite }
    );
  }

  const actualizado = await repo.registrarDestruccion(empresaId, expedienteId, d);
  if (!actualizado) {
    throw new ErrorTacografos(
      "No se puede registrar la destrucción: el expediente está anulado o ya la tenía registrada.",
      "DESTRUCCION_NO_POSIBLE",
      409
    );
  }
  return actualizado;
}

// ── Comunicaciones a la administración ──────────────────────────────────────

export async function colaComunicaciones(empresaId: string): Promise<repo.Expediente[]> {
  return repo.listarPendientesComunicar(empresaId);
}

export async function registrarComunicacion(
  empresaId: string,
  userId: string,
  expedienteId: string,
  d: { fechaPresentacion: string; referencia: string; notas: string }
): Promise<repo.Comunicacion> {
  const expediente = await repo.obtenerExpediente(empresaId, expedienteId);
  if (!expediente) {
    throw new ErrorTacografos("Expediente no encontrado.", "EXPEDIENTE_NO_ENCONTRADO", 404);
  }
  if (expediente.tipo !== "intransferibilidad") {
    throw new ErrorTacografos(
      "Sólo se comunica a la administración el certificado de intransferibilidad.",
      "COMUNICACION_NO_APLICA"
    );
  }

  const comunicacion = await repo.registrarComunicacion(empresaId, userId, {
    expedienteId,
    ...d,
  });
  await repo.cambiarEstado(empresaId, expedienteId, "comunicado", ["emitido", "entregado"]);
  return comunicacion;
}

/**
 * Texto en catalán para pegar en la petición genérica de la Generalitat.
 *
 * Se compone aquí y no en la pantalla porque sale de las plantillas
 * versionadas: si el trámite cambia de redacción, cambia en un sitio.
 */
export async function textoTramite(
  empresaId: string,
  expedienteId: string
): Promise<{ assumpte: string; nomFitxer: string; exposo: string; urlTramite: string; urlOvt: string }> {
  const e = await repo.obtenerExpediente(empresaId, expedienteId);
  if (!e) {
    throw new ErrorTacografos("Expediente no encontrado.", "EXPEDIENTE_NO_ENCONTRADO", 404);
  }
  const centro = await repo.obtenerCentro(empresaId);
  const t = { ...PLANTILLAS, ...(await repo.cargarPlantillas(await repo.versionVigente())) };

  return {
    assumpte: t.cat_assumpte ?? "",
    nomFitxer: `${e.numInforme}${t.cat_fitxer ?? ""}`,
    exposo:
      (t.cat_exposo_1 ?? "") + e.tacModelo +
      (t.cat_exposo_2 ?? "") + e.tacSerie +
      (t.cat_exposo_3 ?? "") + e.matricula +
      (t.cat_exposo_4 ?? "") + e.numInforme +
      (t.cat_exposo_5 ?? "") + fechaEs(e.fechaInforme) +
      (t.cat_exposo_6 ?? ""),
    urlTramite: centro.urlTramite,
    urlOvt: centro.urlTramiteOvt,
  };
}

/**
 * Hasta cuándo hay que conservar copia de un certificado emitido: cinco años
 * desde su emisión. Es un mínimo, no una orden de destruir; el módulo lo
 * enseña, no lo aplica borrando nada.
 */
export function conservarCertificadoHasta(emitidoAtMs: number): string {
  const d = new Date(emitidoAtMs);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear() + ANOS_CONSERVACION_CERTIFICADOS}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}


// ── Anulación ───────────────────────────────────────────────────────────────

/**
 * Anula un expediente, y decide qué significa anular:
 *
 * · Si NUNCA emitió un documento —una prueba, una equivocación al guardar—, se
 *   **borra del todo**, con sus firmas: no hay nada legal de lo que dejar
 *   rastro, y dejarlo como «anulado» sólo ensucia la lista.
 * · Si emitió papel, queda como `anulado`: el documento salió por la impresora
 *   y el rastro tiene que explicarlo.
 *
 * En ambos casos el nº de informe queda libre (el índice único sólo cuenta
 * expedientes vivos): el informe real de la extranet puede registrarse con él.
 */
export async function anularExpediente(
  empresaId: string,
  expedienteId: string
): Promise<{ eliminado: boolean; expediente: repo.Expediente | null }> {
  const expediente = await repo.obtenerExpediente(empresaId, expedienteId);
  if (!expediente) {
    throw new ErrorTacografos("El expediente no existe.", "EXPEDIENTE_NO_ENCONTRADO", 404);
  }
  if (!(await repo.tieneDocumentos(empresaId, expedienteId))) {
    await repo.eliminarExpediente(empresaId, expedienteId);
    return { eliminado: true, expediente: null };
  }
  if (expediente.estado === "anulado") {
    // Ya estaba anulado y tiene documentos: se queda como rastro. Repetir la
    // orden no es un error, pero tampoco borra nada.
    return { eliminado: false, expediente };
  }
  return { eliminado: false, expediente: await repo.anularExpediente(empresaId, expedienteId) };
}
