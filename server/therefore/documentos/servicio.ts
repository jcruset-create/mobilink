/**
 * Los casos de uso del análisis de documentos.
 *
 * Tres, y ninguno decide nada de lectura: adjuntar un PDF a un expediente,
 * enseñar lo analizado y pedir que se vuelva a analizar. La lectura vive en
 * `domain/documento/` y el trabajo de fondo en `analisis.ts`; esto es lo que
 * el router necesita para no tener lógica dentro.
 */

import { ErrorTherefore } from "../errors.ts";
import * as repo from "../repository.ts";
import { guardarDocumento, hashDeFichero, rutaDocumento, urlFirmada } from "../storage.ts";
import type { Contexto } from "../service.ts";

export type FicheroSubido = {
  nombre: string;
  mimeType: string;
  contenido: Buffer;
};

const MIMES_ACEPTADOS = ["application/pdf", "application/octet-stream"];

/**
 * Adjunta un documento a un expediente y reabre los análisis que esperaban uno.
 *
 * El fichero se guarda por su HASH, así que el mismo PDF adjunto diez veces
 * ocupa una. Y por eso adjuntarlo dos veces no es un error: es la misma
 * información llegando otra vez, que es lo normal en una cadena de
 * reclamaciones.
 */
export async function adjuntarDocumento(
  ctx: Contexto,
  expedienteId: string,
  fichero: FicheroSubido
): Promise<{ adjuntoId: string; hash: string; reencolados: number }> {
  const expediente = await repo.obtenerExpediente(ctx.empresaId, expedienteId);
  if (!expediente) throw new ErrorTherefore("NO_ENCONTRADO", "El expediente no existe.", 404);

  if (!fichero.contenido?.length) {
    throw new ErrorTherefore("DOCUMENTO_VACIO", "El fichero está vacío.", 400);
  }
  const esPdf =
    MIMES_ACEPTADOS.includes(fichero.mimeType) || fichero.nombre.toLowerCase().endsWith(".pdf");
  if (!esPdf) {
    throw new ErrorTherefore(
      "DOCUMENTO_NO_SOPORTADO",
      "De momento sólo se analizan PDF. Adjunta el documento en ese formato.",
      400
    );
  }

  const hash = hashDeFichero(fichero.contenido);
  const ruta = rutaDocumento(ctx.empresaId, hash);
  await guardarDocumento(ruta, fichero.contenido, "application/pdf");

  /*
   * Un adjunto cuelga siempre de una notificación —así llega por correo—, y
   * aquí no hay correo. Se usa la última notificación del expediente. Cuando no
   * hay ninguna, se rechaza en vez de inventar una: un adjunto sin correo del
   * que venga no tendría de dónde colgar en el histórico, y el histórico es lo
   * que explica por qué el expediente tiene los documentos que tiene.
   */
  const notificaciones = await repo.listarNotificaciones(ctx.empresaId, expedienteId);
  const notificacion = notificaciones[notificaciones.length - 1];
  if (!notificacion) {
    throw new ErrorTherefore(
      "SIN_CORREO",
      "Este expediente no tiene ningún correo al que asociar el documento.",
      409
    );
  }

  const adjunto = await repo.registrarAdjunto(ctx.empresaId, notificacion.id, expedienteId, {
    nombreArchivo: fichero.nombre,
    mimeType: "application/pdf",
    tamanoBytes: fichero.contenido.length,
    tipoDocumento: "PDF_FACTURA",
    hashArchivo: hash,
    storagePath: ruta,
  });

  // `null` = ya estaba. Se sigue adelante: lo que importa es que el documento
  // esté disponible, no quién lo trajo primero.
  const adjuntos = await repo.adjuntosDeExpediente(ctx.empresaId, expedienteId);
  const existente = adjunto ?? adjuntos.find((a) => a.hashArchivo === hash);
  if (!existente) {
    throw new ErrorTherefore("ADJUNTO_NO_GUARDADO", "No se ha podido registrar el documento.", 500);
  }

  await repo.anotarEvento(ctx.empresaId, {
    expedienteId,
    notificacionId: notificacion.id,
    tipo: "DOCUMENTO_RECIBIDO",
    actorTipo: "usuario",
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre ?? null,
    datosNuevos: { nombre: fichero.nombre, hash: hash.slice(0, 12) },
    descripcion: `Documento ${fichero.nombre} adjuntado al expediente.`,
  });

  const reencolados = await repo.reencolarDeExpediente(ctx.empresaId, expedienteId);
  return { adjuntoId: existente.id, hash, reencolados };
}

export type AlbaranConDetalle = repo.AlbaranAnalizado & {
  lineas: repo.LineaConDescuentos[];
  validaciones: repo.ValidacionFila[];
};

export type AnalisisDeExpediente = {
  albaranes: AlbaranConDetalle[];
  documentos: repo.Documento[];
};

/** Todo lo analizado de un expediente, con sus líneas y sus motivos. */
export async function analisisDe(ctx: Contexto, expedienteId: string): Promise<AnalisisDeExpediente> {
  const expediente = await repo.obtenerExpediente(ctx.empresaId, expedienteId);
  if (!expediente) throw new ErrorTherefore("NO_ENCONTRADO", "El expediente no existe.", 404);

  const albaranes = await repo.albaranesDeExpediente(ctx.empresaId, expedienteId);
  const validaciones = await repo.validacionesDeExpediente(ctx.empresaId, expedienteId);

  const conDetalle: AlbaranConDetalle[] = [];
  for (const a of albaranes) {
    conDetalle.push({
      ...a,
      lineas: await repo.lineasDeAlbaran(ctx.empresaId, a.id),
      validaciones: validaciones.filter((v) => v.albaranAnalizadoId === a.id),
    });
  }

  return { albaranes: conDetalle, documentos: await repo.documentosDeExpediente(ctx.empresaId, expedienteId) };
}

/**
 * Vuelve a analizar el albarán de una actuación.
 *
 * Crea una fila nueva y deja la anterior como histórico en vez de machacarla.
 * La comparación «antes y después» de un parser corregido es justo lo que hay
 * que poder enseñar el día que alguien pregunte por qué ahora dice otra cosa.
 */
export async function reanalizar(ctx: Contexto, actuacionId: string): Promise<repo.AlbaranAnalizado> {
  const actuacion = await repo.obtenerActuacion(ctx.empresaId, actuacionId);
  if (!actuacion) throw new ErrorTherefore("NO_ENCONTRADO", "La actuación no existe.", 404);
  if (!actuacion.albaranSolicitado) {
    throw new ErrorTherefore(
      "SIN_ALBARAN",
      "Esta actuación no pide ningún albarán, así que no hay nada que analizar.",
      409
    );
  }

  const anterior = await repo.ultimoAnalisisDeActuacion(ctx.empresaId, actuacionId);
  if (anterior?.estadoProceso === "PENDIENTE" || anterior?.estadoProceso === "PROCESANDO") {
    throw new ErrorTherefore("YA_EN_COLA", "Ese albarán ya está esperando análisis.", 409);
  }

  return repo.enTransaccion(async (c) => {
    const nueva = await repo.encolarAnalisis(
      ctx.empresaId,
      actuacion.expedienteId,
      actuacionId,
      actuacion.albaranSolicitado!,
      actuacion.importeCentimos,
      c
    );
    if (anterior) await repo.marcarSustituida(anterior.id, nueva.id, c);

    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: actuacion.expedienteId,
        actuacionId,
        albaranAnalizadoId: nueva.id,
        tipo: "ANALISIS_SOLICITADO",
        actorTipo: "usuario",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre ?? null,
        datosNuevos: { albaran: actuacion.albaranSolicitado },
        descripcion: `Se ha pedido volver a analizar el albarán ${actuacion.albaranSolicitado}.`,
      },
      c
    );
    return nueva;
  });
}

/** Enlace temporal al PDF de un análisis, para el visor. */
export async function enlaceDelDocumento(ctx: Contexto, albaranAnalizadoId: string): Promise<string> {
  const fila = await repo.albaranAnalizadoPorId(ctx.empresaId, albaranAnalizadoId);
  if (!fila?.adjuntoId) {
    throw new ErrorTherefore("SIN_DOCUMENTO", "Ese análisis no tiene documento asociado.", 404);
  }
  const adjuntos = await repo.adjuntosDeExpediente(ctx.empresaId, fila.expedienteId);
  const adjunto = adjuntos.find((a) => a.id === fila.adjuntoId);
  if (!adjunto?.storagePath) {
    throw new ErrorTherefore("SIN_DOCUMENTO", "El documento ya no está disponible.", 404);
  }
  const url = await urlFirmada(adjunto.storagePath);
  if (!url) throw new ErrorTherefore("SIN_DOCUMENTO", "No se ha podido abrir el documento.", 502);
  return url;
}
