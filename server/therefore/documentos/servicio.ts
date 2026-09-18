/**
 * Los casos de uso del análisis de documentos.
 *
 * Tres, y ninguno decide nada de lectura: adjuntar un PDF a un expediente,
 * enseñar lo analizado y pedir que se vuelva a analizar. La lectura vive en
 * `domain/documento/` y el trabajo de fondo en `analisis.ts`; esto es lo que
 * el router necesita para no tener lógica dentro.
 */

import { leerConfig } from "../config.ts";
import { albaranesDelDocumento, analizarAlbaran } from "../domain/documento/index.ts";
import { esTipoAccion, type TipoAccion } from "../domain/estados.ts";
import { cajasDelAlbaran, paginasResaltadas } from "../domain/documento/resaltado.ts";
import { ErrorTherefore } from "../errors.ts";
import * as repo from "../repository.ts";
import { guardarDocumento, hashDeFichero, leerDocumento, rutaDocumento, urlFirmada } from "../storage.ts";
import { componerZip, type EntradaZip } from "../zip.ts";
import { moverActuacion, type Contexto } from "../service.ts";
import { pintarResaltado } from "./resaltado.ts";
import { leerDocumento as leerTexto } from "./texto.ts";

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

export type PreparacionAlbaranes = {
  /** Cuántos albaranes distintos trae el documento. */
  encontrados: string[];
  /** Los que se han puesto a gestionar ahora. */
  preparados: string[];
  /** Los que ya estaban pedidos: no se duplican. */
  yaEstaban: string[];
  /** Actuaciones genéricas —«grabar», sin número— retiradas al desglosarlas. */
  retiradas: number;
};

/**
 * Pone a gestionar TODOS los albaranes que trae el documento.
 *
 * Hay correos que no listan los albaranes: dicen «grabad la factura entera».
 * Entonces la actuación nace sin número, no hay nada que analizar y la
 * pantalla se queda en blanco con un documento delante que sí los tiene. Esto
 * es el puente: se lee el PDF, se saca cada albarán y se crea una actuación
 * por cada uno, ya encolada para analizar.
 *
 * Lo que NO hace es adivinar el número de ninguno: sólo prepara los que el
 * documento escribe. Si el parser no localiza ni uno, se dice y no se crea
 * nada, porque una actuación con un albarán inventado es peor que ninguna.
 *
 * La actuación genérica de la que se sale —«grabar», sin número— se descarta
 * al terminar, con su motivo: ya no hay nada que hacer en ella, lo suyo son
 * ahora las que se acaban de crear. Dejarla pendiente obligaría a resolver a
 * mano una tarea que ya está desglosada, y un expediente no se da por
 * resuelto con actuaciones vivas dentro.
 */
export async function prepararAlbaranes(
  ctx: Contexto,
  expedienteId: string,
  tipoAccionPedido?: string
): Promise<PreparacionAlbaranes> {
  const expediente = await repo.obtenerExpediente(ctx.empresaId, expedienteId);
  if (!expediente) throw new ErrorTherefore("NO_ENCONTRADO", "El expediente no existe.", 404);
  if (expediente.estado === "RESUELTO" || expediente.estado === "CERRADO") {
    throw new ErrorTherefore(
      "EXPEDIENTE_TERMINADO",
      `El expediente ${expediente.numero} está ${expediente.estado.toLowerCase()}. Reábrelo antes de prepararle albaranes.`,
      409
    );
  }

  const adjuntos = (await repo.adjuntosDeExpediente(ctx.empresaId, expedienteId)).filter(
    (a) => a.storagePath && (a.mimeType.includes("pdf") || a.nombreArchivo.toLowerCase().endsWith(".pdf"))
  );
  const adjunto = adjuntos[adjuntos.length - 1];
  if (!adjunto?.storagePath) {
    throw new ErrorTherefore(
      "SIN_DOCUMENTO",
      "Este expediente todavía no tiene ningún PDF. Adjúntalo y vuelve a pedirlo.",
      409
    );
  }
  const bytes = await leerDocumento(adjunto.storagePath);
  if (!bytes) {
    throw new ErrorTherefore("SIN_DOCUMENTO", "El documento ya no está en el almacenamiento.", 404);
  }

  const cfg = await leerConfig(ctx.empresaId);
  const texto = leerTexto(bytes, { maxPaginas: cfg.albaran.maxPaginas });

  // Uno por número, en el orden en que salen en el papel.
  const vistos = new Set<string>();
  const delDocumento: { numero: string; normalizado: string }[] = [];
  for (const a of albaranesDelDocumento(texto)) {
    if (!a.numeroDocumento || !a.normalizado || vistos.has(a.normalizado)) continue;
    vistos.add(a.normalizado);
    delDocumento.push({ numero: a.numeroDocumento, normalizado: a.normalizado });
  }
  if (delDocumento.length === 0) {
    throw new ErrorTherefore(
      "SIN_ALBARANES",
      "En el documento no se ha localizado ningún número de albarán, así que no hay nada que preparar.",
      409
    );
  }

  const actuaciones = await repo.listarActuaciones(ctx.empresaId, expedienteId);
  const vivas = actuaciones.filter((a) => a.estado !== "DESCARTADA");
  const tipoAccion: TipoAccion = esTipoAccion(tipoAccionPedido)
    ? tipoAccionPedido
    : ((vivas.find((a) => !a.albaranSolicitado)?.tipoAccion ??
        vivas[0]?.tipoAccion ??
        "GRABAR") as TipoAccion);

  const yaEstaban: string[] = [];
  const preparados: string[] = [];

  for (const alb of delDocumento) {
    if (vivas.some((a) => a.albaranNormalizado === alb.normalizado && a.tipoAccion === tipoAccion)) {
      yaEstaban.push(alb.numero);
      continue;
    }
    /*
     * La actuación y su sitio en la cola, en la misma transacción: si se cae
     * entre una cosa y la otra queda un albarán pedido que nadie analiza.
     */
    const creada = await repo.enTransaccion(async (c) => {
      const nueva = await repo.crearActuacion(
        ctx.empresaId,
        expedienteId,
        {
          tipoAccion,
          albaranSolicitado: alb.numero,
          importeCentimos: null,
          indicadorAdicional: null,
          obligatoria: true,
          observaciones: "Preparada desde el documento.",
        },
        c
      );
      if (!nueva) return null;

      await repo.encolarAnalisis(ctx.empresaId, expedienteId, nueva.id, alb.numero, null, c);
      await repo.anotarEvento(
        ctx.empresaId,
        {
          expedienteId,
          actuacionId: nueva.id,
          tipo: "ACTUACION_ANADIDA",
          actorTipo: "usuario",
          usuarioId: ctx.userId,
          usuarioNombre: ctx.userNombre ?? null,
          datosNuevos: { tipoAccion, albaran: alb.numero, origen: "documento" },
          descripcion: `Actuación ${tipoAccion} ${alb.numero}, preparada desde el documento.`,
        },
        c
      );
      return nueva;
    });

    if (creada) preparados.push(alb.numero);
    else yaEstaban.push(alb.numero);
  }

  /*
   * Y se retiran las genéricas, al final y no al principio: si algo falla a
   * mitad, lo que queda es la tarea original intacta y no un expediente sin
   * nada que hacer.
   */
  const genericas = vivas.filter((a) => !a.albaranSolicitado && a.tipoAccion === tipoAccion);
  let retiradas = 0;
  for (const generica of genericas) {
    await moverActuacion(ctx, generica.id, "DESCARTADA", {
      motivo: `Desglosada en ${delDocumento.length} albarán(es) del documento.`,
    });
    retiradas++;
  }

  return { encontrados: delDocumento.map((a) => a.numero), preparados, yaEstaban, retiradas };
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
/** Lo que puede ir en un nombre de fichero dentro del zip. */
function nombreSeguro(v: string): string {
  return v.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "documento";
}

/**
 * Los PDF que el análisis no supo leer, en un zip con su índice.
 *
 * Para afinar el parser hace falta el papel de verdad, y el papel está en el
 * almacén, no en el repositorio. Esto lo saca de una vez: cada PDF con el
 * expediente, el albarán pedido y el estado en el nombre, y un `indice.csv`
 * con el motivo. Sólo quien puede configurar el módulo; lleva precios de
 * compra.
 */
export async function loteParaRevision(
  ctx: Contexto,
  dias: number
): Promise<{ zip: Buffer; documentos: number; omitidos: number }> {
  const filas = await repo.documentosParaRevision(ctx.empresaId, dias);
  const entradas: EntradaZip[] = [];
  const indice: string[] = ["expediente;albaran_pedido;estado;error;fichero;hash"];
  const usados = new Set<string>();
  let omitidos = 0;

  for (const f of filas) {
    const contenido = await leerDocumento(f.storagePath);
    if (!contenido) {
      omitidos++;
      continue;
    }
    const estado = f.estadoProceso === "ERROR" ? "ERROR" : (f.estadoAnalisis ?? f.estadoProceso);
    let nombre = `${nombreSeguro(f.expedienteNumero)}_${nombreSeguro(f.numeroSolicitado)}_${estado}.pdf`;
    for (let n = 2; usados.has(nombre); n++) {
      nombre = `${nombreSeguro(f.expedienteNumero)}_${nombreSeguro(f.numeroSolicitado)}_${estado}_${n}.pdf`;
    }
    usados.add(nombre);
    entradas.push({ nombre, contenido, fecha: new Date(f.createdAt) });
    const celda = (v: string | null) => (v ?? "").replace(/[;\r\n]+/g, " ").trim();
    indice.push(
      [f.expedienteNumero, f.numeroSolicitado, estado, celda(f.error), nombre, f.hashArchivo.slice(0, 12)]
        .map(celda)
        .join(";")
    );
  }

  entradas.push({ nombre: "indice.csv", contenido: Buffer.from(indice.join("\n") + "\n", "utf8") });
  return { zip: componerZip(entradas), documentos: entradas.length - 1, omitidos };
}

/**
 * El PDF del proveedor con ESTE albarán subrayado en amarillo.
 *
 * El documento se vuelve a leer aquí en vez de tirar de lo guardado, y es a
 * propósito: la base guarda el recuadro de cada línea, pero no el del bloque
 * entero, y sobre todo, un análisis de hace un mes lleva la geometría que
 * entendía el parser de hace un mes. Releer cuesta un segundo y garantiza que
 * el amarillo señala lo que el módulo entiende HOY. Eso también lo hace útil
 * para revisar: si el subrayado cae donde no debe, el parser lo leyó mal.
 */
export async function pdfResaltado(
  ctx: Contexto,
  albaranAnalizadoId: string
): Promise<{ pdf: Buffer; nombre: string; paginas: number[]; paginasGiradas: number[] }> {
  const fila = await repo.albaranAnalizadoPorId(ctx.empresaId, albaranAnalizadoId);
  if (!fila) throw new ErrorTherefore("NO_ENCONTRADO", "Ese análisis no existe.", 404);
  if (!fila.adjuntoId) {
    throw new ErrorTherefore("SIN_DOCUMENTO", "Ese análisis no tiene documento asociado.", 404);
  }

  const adjunto = await repo.adjuntoPorId(ctx.empresaId, fila.adjuntoId);
  if (!adjunto?.storagePath) {
    throw new ErrorTherefore("SIN_DOCUMENTO", "El documento ya no está disponible.", 404);
  }
  const original = await leerDocumento(adjunto.storagePath);
  if (!original) {
    throw new ErrorTherefore("SIN_DOCUMENTO", "El documento ya no está en el almacenamiento.", 404);
  }

  const cfg = await leerConfig(ctx.empresaId);
  const texto = leerTexto(original, { maxPaginas: cfg.albaran.maxPaginas });
  const analisis = analizarAlbaran(texto, fila.numeroSolicitado, {
    umbrales: cfg.albaran.umbrales,
    lineas: { toleranciaCentimos: cfg.albaran.toleranciaCentimos },
  });

  const cajas = cajasDelAlbaran(analisis.seccion);
  if (cajas.length === 0) {
    /*
     * Sin sección localizada no hay nada que subrayar, y devolver el PDF tal
     * cual sería peor que no devolverlo: parecería que el albarán no está en
     * ninguna parte del papel cuando lo que pasa es que no se ha sabido ver.
     */
    throw new ErrorTherefore(
      "SIN_RESALTADO",
      "No se ha localizado ese albarán dentro del documento, así que no hay nada que resaltar.",
      409
    );
  }

  const pintado = await pintarResaltado(original, cajas, texto);
  const expediente = await repo.obtenerExpediente(ctx.empresaId, fila.expedienteId);
  const nombre = `${nombreSeguro(expediente?.numero ?? "expediente")}_${nombreSeguro(fila.numeroSolicitado)}_resaltado.pdf`;

  return {
    pdf: pintado.pdf,
    nombre,
    paginas: paginasResaltadas(cajas),
    paginasGiradas: pintado.paginasGiradas,
  };
}

/**
 * El enlace de cualquier adjunto del expediente —el PDF que vino con el correo,
 * tenga o no análisis—, por la misma vía firmada y con la misma caducidad.
 */
export async function enlaceDelAdjunto(ctx: Contexto, adjuntoId: string): Promise<string> {
  const adjunto = await repo.adjuntoPorId(ctx.empresaId, adjuntoId);
  if (!adjunto) throw new ErrorTherefore("SIN_DOCUMENTO", "Ese adjunto no existe.", 404);
  if (!adjunto.storagePath) {
    throw new ErrorTherefore("SIN_DOCUMENTO", "El fichero de ese adjunto no se guardó.", 404);
  }
  const url = await urlFirmada(adjunto.storagePath);
  if (!url) throw new ErrorTherefore("SIN_DOCUMENTO", "No se ha podido abrir el documento.", 502);
  return url;
}

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
