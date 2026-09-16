/**
 * El procesamiento de un lote de escaneos, de punta a punta.
 *
 * El flujo del encargo, en orden:
 *
 *   UPLOAD → VALIDACIÓN → ¿MULTIPÁGINA? → SEPARAR → OCR → Nº OR → CONFIANZA
 *   → VALIDAR OR → LOCALIZAR BLOC → ¿DUPLICADO? → ARCHIVAR → ACTUALIZAR OR
 *   → RECALCULAR BLOC → AVISAR SI FALTA ALGO → RESULTADO
 *
 * ── Por qué no bloquea la petición ──────────────────────────────────────────
 *
 * Un PDF de 200 páginas con OCR tarda minutos. Si el `POST` esperara, el
 * navegador cortaría la conexión y quien está en el mostrador no sabría si su
 * escaneo se ha procesado o no. Así que la subida guarda el fichero, crea la
 * fila de `orm_procesamientos` y contesta **202** con su id; el panel pregunta
 * por ese id y va enseñando el avance.
 *
 * ── Y por qué no hay cola ni worker aparte ──────────────────────────────────
 *
 * Porque este proyecto no tiene ninguna, y estrenar Redis o BullMQ para un
 * módulo sería añadir una pieza de infraestructura que hay que desplegar,
 * vigilar y pagar. Se hace como Therefore, Recepciones y el resto: la tarea
 * arranca en el propio proceso y un `setInterval` recoge lo que se quedó a
 * medias —un despliegue a mitad de lote, por ejemplo—. El estado vive en la
 * tabla, no en memoria, que es lo que hace que eso funcione.
 *
 * ── Una página mala no tira el lote ─────────────────────────────────────────
 *
 * Cada página se procesa en su propio `try`. La que falle suma un error y se
 * queda en la bandeja; las otras 199 se archivan igual. Es requisito explícito
 * del encargo y además es lo único razonable: repetir un lote entero por una
 * hoja torcida es lo que hace que la gente deje de usar la herramienta.
 */

import { ErrorOrManuales } from "./errors.ts";
import * as repo from "./repository.ts";
import * as servicio from "./service.ts";
import { leerConfiguracion } from "./config.ts";
import { decidir } from "./domain/deteccion.ts";
import { analizarPagina, separarPaginas, validarFichero } from "./ocr.ts";
import { extensionDe, guardarDocumento, hashDeFichero, rutaDocumento } from "./storage.ts";

export type ArchivoSubido = { nombre: string; mime: string; contenido: Buffer };

/**
 * Guarda el fichero, deja el proceso listo y lo arranca sin esperarlo.
 *
 * La validación sí es síncrona: si el PDF está protegido o el fichero no es lo
 * que dice ser, hay que contestar 4xx a esa misma petición. Enterarse cinco
 * minutos después, en una fila de procesamiento con error, sería peor.
 */
export async function encolarProceso(
  ctx: servicio.Contexto,
  archivo: ArchivoSubido
): Promise<repo.Procesamiento> {
  const mime = validarFichero(archivo.nombre, archivo.mime, archivo.contenido);

  // Se cuentan las páginas ya: es lo que da la barra de progreso, y además
  // destapa aquí un PDF ilegible en vez de dentro del proceso de fondo.
  const paginas = await separarPaginas(archivo.contenido, mime);

  const hash = hashDeFichero(archivo.contenido);
  const ruta = rutaDocumento(ctx.empresaId, hash, "originales", extensionDe(mime));
  await guardarDocumento(ruta, archivo.contenido, mime);

  const proceso = await repo.insertarProcesamiento({
    empresaId: ctx.empresaId,
    archivoOriginal: archivo.nombre,
    storageKeyOriginal: ruta,
    hashOriginal: hash,
    mime,
    paginas: paginas.length,
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre,
  });

  await repo.registrarEvento({
    empresaId: ctx.empresaId,
    accion: "LOTE_SUBIDO",
    detalle: { proceso: proceso.id, archivo: archivo.nombre, paginas: paginas.length },
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre,
  });

  /*
   * A correr sin esperarlo. El `catch` no puede faltar: una promesa rechazada
   * sin capturar tumba el proceso de Node entero, y esto corre fuera de
   * cualquier petición, así que no hay nadie más que la recoja.
   */
  void ejecutar(ctx, proceso.id, paginas, archivo.nombre, mime).catch((e) =>
    console.error("[OR Manuales] el procesamiento ha fallado:", e)
  );

  return proceso;
}

/* ── El trabajo ──────────────────────────────────────────────────────────── */

type PaginaSeparada = Awaited<ReturnType<typeof separarPaginas>>[number];

async function ejecutar(
  ctx: servicio.Contexto,
  procesoId: string,
  paginas: PaginaSeparada[],
  nombreOriginal: string,
  mimeOriginal: string
): Promise<void> {
  const config = await leerConfiguracion(ctx.empresaId);

  await repo.actualizarProcesamiento(ctx.empresaId, procesoId, {
    estado: "EN_CURSO",
    etapa: "Separando páginas",
    paginas: paginas.length,
  });

  /*
   * Los rangos de los blocs se leen UNA vez y se consultan en memoria. El
   * detector pregunta «¿este número cae en algún bloc?» por cada candidato de
   * cada página: con 200 páginas y varios números por hoja serían miles de
   * consultas para responder siempre lo mismo. Un bloc dado de alta a mitad de
   * lote no entra en esta foto, y da igual: su hoja queda sin identificar y se
   * reprocesa con un clic.
   */
  const blocs = await repo.listarBlocs(ctx.empresaId, {});
  const rangos = blocs.filter((b) => b.estado !== "CERRADO").map((b) => [b.orInicial, b.orFinal] as const);
  const dentroDeAlgunBloc = (n: number) => rangos.some(([desde, hasta]) => n >= desde && n <= hasta);

  const cuenta = {
    documentosDetectados: 0,
    documentosCorrectos: 0,
    documentosRevision: 0,
    noIdentificados: 0,
    duplicados: 0,
    errores: 0,
  };

  for (const pagina of paginas) {
    await repo.actualizarProcesamiento(ctx.empresaId, procesoId, {
      etapa: `Procesando página ${pagina.numero} de ${paginas.length}`,
    });

    try {
      const resultado = await procesarPagina(ctx, {
        procesoId,
        pagina,
        nombreOriginal,
        mimeOriginal,
        totalPaginas: paginas.length,
        config,
        dentroDeAlgunBloc,
      });
      cuenta.documentosDetectados += 1;
      if (resultado === "ARCHIVADO") cuenta.documentosCorrectos += 1;
      else if (resultado === "REVISION") cuenta.documentosRevision += 1;
      else if (resultado === "DUPLICADO") cuenta.duplicados += 1;
      else cuenta.noIdentificados += 1;
    } catch (e) {
      cuenta.errores += 1;
      console.error(`[OR Manuales] error en la página ${pagina.numero} de «${nombreOriginal}»:`, e);
      // Que la página falle no puede impedir que quede constancia de ella.
      await anotarPaginaConError(ctx, procesoId, pagina, nombreOriginal, e).catch(() => {});
    }

    await repo.actualizarProcesamiento(ctx.empresaId, procesoId, {
      paginasProcesadas: pagina.numero,
      ...cuenta,
    });
  }

  await repo.actualizarProcesamiento(ctx.empresaId, procesoId, {
    estado: cuenta.errores > 0 && cuenta.documentosCorrectos === 0 ? "ERROR" : "COMPLETADO",
    etapa: null,
    fechaFin: new Date().toISOString(),
    paginasProcesadas: paginas.length,
    ...cuenta,
  });

  await repo.registrarEvento({
    empresaId: ctx.empresaId,
    accion: "LOTE_PROCESADO",
    detalle: { proceso: procesoId, archivo: nombreOriginal, ...cuenta },
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre,
  });
}

type ResultadoPagina = "ARCHIVADO" | "REVISION" | "DUPLICADO" | "NO_IDENTIFICADO";

async function procesarPagina(
  ctx: servicio.Contexto,
  args: {
    procesoId: string;
    pagina: PaginaSeparada;
    nombreOriginal: string;
    mimeOriginal: string;
    totalPaginas: number;
    config: Awaited<ReturnType<typeof leerConfiguracion>>;
    dentroDeAlgunBloc: (n: number) => boolean;
  }
): Promise<ResultadoPagina> {
  const { pagina, config } = args;

  const hash = hashDeFichero(pagina.contenido);

  /*
   * ¿Esta hoja exacta ya estaba? Se mira ANTES de guardar nada: volver a subir
   * el mismo lote por si acaso es lo más normal del mundo, y sin esto cada
   * repetición dejaría un duplicado que alguien tendría que descartar a mano.
   * El hash es del contenido, así que sólo salta si es literalmente el mismo
   * fichero, no una hoja parecida.
   */
  const yaEstaba = await repo.documentoConHash(ctx.empresaId, hash);
  if (yaEstaba && yaEstaba.estadoProcesamiento === "ARCHIVADO") {
    await repo.registrarEvento({
      empresaId: ctx.empresaId,
      blocId: yaEstaba.blocId,
      orId: yaEstaba.orId,
      documentoId: yaEstaba.id,
      accion: "PAGINA_REPETIDA",
      detalle: { proceso: args.procesoId, pagina: pagina.numero, archivo: args.nombreOriginal },
      usuarioId: ctx.userId,
      usuarioNombre: ctx.userNombre,
    });
    return "DUPLICADO";
  }

  const ruta = rutaDocumento(ctx.empresaId, hash, "paginas", extensionDe(pagina.mime));
  const { tamanoBytes } = await guardarDocumento(ruta, pagina.contenido, pagina.mime);

  const analisis = await analizarPagina(pagina.contenido, pagina.mime, {
    zona: config.zona,
    dentroDeAlgunBloc: args.dentroDeAlgunBloc,
    ocrConIa: config.ocrConIa,
  });

  const decision = decidir(analisis.candidato, config.umbrales);
  const candidato = analisis.candidato;

  // El nombre provisional dice de dónde salió la hoja; al archivarla pasa a
  // `OR_1043.pdf`, que es el nombre con el que se busca y se descarga.
  const nombreProvisional =
    args.totalPaginas > 1 ? `${args.nombreOriginal} · pág. ${pagina.numero}` : args.nombreOriginal;

  const documento = await repo.insertarDocumento({
    empresaId: ctx.empresaId,
    orId: null,
    blocId: null,
    procesamientoId: args.procesoId,
    nombreArchivo: nombreProvisional,
    nombreOriginal: args.nombreOriginal,
    paginaOrigen: pagina.numero,
    storageKey: ruta,
    tipoArchivo: pagina.mime,
    tamanoBytes,
    hashArchivo: hash,
    ocrNumeroDetectado: candidato?.numero ?? null,
    ocrConfianza: candidato?.confianza ?? null,
    ocrMetodo: candidato?.metodo ?? "NINGUNO",
    ocrTexto: analisis.texto || null,
    estadoProcesamiento: "PENDIENTE",
    usuarioCarga: ctx.userId,
    usuarioCargaNombre: ctx.userNombre,
  });

  if (decision === "NO_IDENTIFICADO" || !candidato) {
    await servicio.dejarPendiente(ctx, documento.id, {
      numeroDetectado: candidato?.numero ?? null,
      confianza: candidato?.confianza ?? null,
      metodo: candidato?.metodo ?? "NINGUNO",
      texto: analisis.texto || null,
    });
    return "NO_IDENTIFICADO";
  }

  const archivado = await servicio.archivarDocumento(ctx, documento.id, candidato.numero, {
    marcarRevision: decision === "REVISAR",
    metodo: candidato.metodo,
    confianza: candidato.confianza,
  });

  if (archivado.estado === "DUPLICADO") return "DUPLICADO";
  return archivado.estado === "REVISION" ? "REVISION" : "ARCHIVADO";
}

/**
 * Deja constancia de la página que no se pudo procesar.
 *
 * Sin esto, una página que reviente desaparecería sin dejar rastro: el
 * contador diría «1 error» y nadie sabría cuál fue ni podría reintentarla.
 */
async function anotarPaginaConError(
  ctx: servicio.Contexto,
  procesoId: string,
  pagina: PaginaSeparada,
  nombreOriginal: string,
  error: unknown
): Promise<void> {
  const mensaje = error instanceof ErrorOrManuales || error instanceof Error ? error.message : "Error desconocido";
  const hash = hashDeFichero(pagina.contenido);
  const ruta = rutaDocumento(ctx.empresaId, hash, "paginas", extensionDe(pagina.mime));
  // El fichero puede haberse guardado ya o no; guardarlo otra vez es barato y
  // deja la hoja recuperable, que es de lo que se trata.
  await guardarDocumento(ruta, pagina.contenido, pagina.mime).catch(() => {});

  await repo.insertarDocumento({
    empresaId: ctx.empresaId,
    orId: null,
    blocId: null,
    procesamientoId: procesoId,
    nombreArchivo: `${nombreOriginal} · pág. ${pagina.numero}`,
    nombreOriginal,
    paginaOrigen: pagina.numero,
    storageKey: ruta,
    tipoArchivo: pagina.mime,
    tamanoBytes: pagina.contenido.length,
    hashArchivo: hash,
    ocrNumeroDetectado: null,
    ocrConfianza: null,
    ocrMetodo: "NINGUNO",
    ocrTexto: null,
    estadoProcesamiento: "ERROR",
    errorMensaje: mensaje,
    usuarioCarga: ctx.userId,
    usuarioCargaNombre: ctx.userNombre,
  });
}

/* ── Reprocesar una hoja suelta ──────────────────────────────────────────── */

/**
 * Vuelve a leer un documento que ya está guardado.
 *
 * Sirve para dos casos reales: se ha dado de alta el bloc que faltaba, o se ha
 * cambiado la zona de OCR. En los dos, la hoja es la misma y lo que ha
 * cambiado es el contexto, así que no hay que volver a subir nada.
 */
export async function reprocesarDocumento(ctx: servicio.Contexto, documentoId: string): Promise<repo.Documento> {
  const documento = await repo.documentoPorId(ctx.empresaId, documentoId);
  if (!documento) throw new ErrorOrManuales("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);
  if (documento.estadoProcesamiento === "ELIMINADO") {
    throw new ErrorOrManuales("DOCUMENTO_ELIMINADO", "Ese documento está eliminado.", 409);
  }

  const { leerDocumento } = await import("./storage.ts");
  const contenido = await leerDocumento(documento.storageKey);
  if (!contenido) {
    throw new ErrorOrManuales("DOCUMENTO_ILEGIBLE", "El fichero ya no está en el almacenamiento.", 404);
  }

  const config = await leerConfiguracion(ctx.empresaId);
  const blocs = await repo.listarBlocs(ctx.empresaId, {});
  const rangos = blocs.filter((b) => b.estado !== "CERRADO").map((b) => [b.orInicial, b.orFinal] as const);

  const analisis = await analizarPagina(contenido, documento.tipoArchivo, {
    zona: config.zona,
    dentroDeAlgunBloc: (n) => rangos.some(([desde, hasta]) => n >= desde && n <= hasta),
    ocrConIa: config.ocrConIa,
  });

  const decision = decidir(analisis.candidato, config.umbrales);
  const candidato = analisis.candidato;

  await repo.registrarEvento({
    empresaId: ctx.empresaId,
    documentoId,
    accion: "DOCUMENTO_REPROCESADO",
    detalle: { numero: candidato?.numero ?? null, confianza: candidato?.confianza ?? null, decision },
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre,
  });

  if (decision === "NO_IDENTIFICADO" || !candidato) {
    return servicio.dejarPendiente(ctx, documentoId, {
      numeroDetectado: candidato?.numero ?? null,
      confianza: candidato?.confianza ?? null,
      metodo: candidato?.metodo ?? "NINGUNO",
      texto: analisis.texto || null,
    });
  }

  const r = await servicio.archivarDocumento(ctx, documentoId, candidato.numero, {
    marcarRevision: decision === "REVISAR",
    metodo: candidato.metodo,
    confianza: candidato.confianza,
  });
  return r.documento;
}

/* ── El repesca ──────────────────────────────────────────────────────────── */

const CADA_MS = 5 * 60 * 1000;
/** Un lote parado más de esto es un lote que murió con su proceso. */
const ABANDONADO_MIN = 30;

let temporizador: ReturnType<typeof setInterval> | null = null;
let corriendo = false;

/**
 * Marca como fallidos los lotes que se quedaron a medias.
 *
 * NO los reanuda: las páginas ya archivadas están archivadas, y volver a
 * empezar duplicaría trabajo. Lo que hace es sacarlos de «procesando» para que
 * quien los subió vea que aquello se cortó y pueda volver a subir lo que falte,
 * en vez de esperar indefinidamente a una barra de progreso muerta.
 */
export function startOrManualesWorker(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    void repescar();
  }, CADA_MS);
  temporizador.unref?.();
  console.log(`Módulo OR Manuales: vigilancia de lotes activa (cada ${CADA_MS / 60000} min)`);
}

export function stopOrManualesWorker(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}

async function repescar(): Promise<void> {
  if (corriendo) return;
  corriendo = true;
  try {
    const db = (await import("../db.ts")).default;
    const { rowCount } = await db.query(
      `UPDATE orm_procesamientos
          SET estado = 'ERROR',
              etapa = NULL,
              fecha_fin = now(),
              error_mensaje = COALESCE(error_mensaje, 'El procesamiento se interrumpió (reinicio del servidor). Vuelve a subir las páginas que falten.'),
              updated_at = now()
        WHERE estado IN ('PENDIENTE','EN_CURSO')
          AND updated_at < now() - INTERVAL '${ABANDONADO_MIN} minutes'`
    );
    if (rowCount) console.warn(`[OR Manuales] ${rowCount} procesamiento(s) abandonado(s) marcados como error.`);
  } catch (e) {
    console.error("[OR Manuales] fallo en la vigilancia de lotes:", (e as Error)?.message ?? e);
  } finally {
    corriendo = false;
  }
}
