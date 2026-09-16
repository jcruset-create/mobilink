/**
 * El vocabulario del módulo OR Manuales, en un solo sitio.
 *
 * Misma forma que `recepciones/domain/estados.ts` y `therefore/domain/...`:
 * listas `as const` y sus etiquetas, que el servidor manda en el bootstrap para
 * que el panel no tenga una copia que se quede vieja.
 *
 * Aquí no se importa `db.ts`: esto es dominio puro y tiene que poder probarse
 * sin base de datos.
 */

/* ── El bloc físico ───────────────────────────────────────────────────────── */

/**
 * · DISPONIBLE        el bloc existe y está en el cajón; nadie lo tiene.
 * · ENTREGADO         alguien se lo ha llevado al taller.
 * · DEVUELTO          ha vuelto, y todavía no se ha escaneado nada de él.
 * · PENDIENTE_ESCANEO ha vuelto y falta escanear páginas.
 * · INCOMPLETO        faltan OR por archivar (con o sin devolución).
 * · REVISAR           tiene documentos archivados que alguien debe mirar.
 * · COMPLETO          las 25 OR tienen documento y ninguno está en revisión.
 * · CERRADO           alguien lo ha dado por bueno. Es el único estado que
 *                     pone una persona a mano; el resto los calcula el módulo.
 */
export const ESTADOS_BLOC = [
  "DISPONIBLE",
  "ENTREGADO",
  "DEVUELTO",
  "PENDIENTE_ESCANEO",
  "INCOMPLETO",
  "REVISAR",
  "COMPLETO",
  "CERRADO",
] as const;

export type EstadoBloc = (typeof ESTADOS_BLOC)[number];

export const ETIQUETA_ESTADO_BLOC: Record<EstadoBloc, string> = {
  DISPONIBLE: "Disponible",
  ENTREGADO: "Entregado",
  DEVUELTO: "Devuelto",
  PENDIENTE_ESCANEO: "Pendiente de escaneo",
  INCOMPLETO: "Incompleto",
  REVISAR: "Revisar",
  COMPLETO: "Completo",
  CERRADO: "Cerrado",
};

/**
 * Los estados que calcula el módulo después de archivar. Los demás
 * —DISPONIBLE, ENTREGADO, DEVUELTO, CERRADO— los pone una persona con una
 * acción explícita y el recálculo NO los pisa: ver `estadoCalculado`.
 */
export const ESTADOS_BLOC_CALCULADOS: readonly EstadoBloc[] = [
  "PENDIENTE_ESCANEO",
  "INCOMPLETO",
  "REVISAR",
  "COMPLETO",
];

/* ── Cada OR individual ───────────────────────────────────────────────────── */

/**
 * · PENDIENTE  no tiene documento todavía.
 * · ESCANEADA  tiene su documento archivado y bueno.
 * · REVISAR    tiene documento, pero se archivó con poca confianza o a mano
 *              sobre un dudoso: alguien debe confirmarlo.
 * · DUPLICADA  llegó un segundo documento para la misma OR y se guardó aparte.
 * · ERROR      el último intento de archivar falló (fichero corrupto, etc.).
 */
export const ESTADOS_OR = ["PENDIENTE", "ESCANEADA", "REVISAR", "DUPLICADA", "ERROR"] as const;

export type EstadoOr = (typeof ESTADOS_OR)[number];

export const ETIQUETA_ESTADO_OR: Record<EstadoOr, string> = {
  PENDIENTE: "Pendiente",
  ESCANEADA: "Escaneada",
  REVISAR: "Revisar",
  DUPLICADA: "Duplicada",
  ERROR: "Error",
};

/* ── El documento escaneado ───────────────────────────────────────────────── */

/**
 * · PENDIENTE      recién subido, todavía no analizado.
 * · ARCHIVADO      colgado de su OR. El estado normal de un documento bueno.
 * · REVISION       identificado con confianza media: hay que confirmarlo.
 * · NO_IDENTIFICADO no se ha podido leer el número, o no cae en ningún bloc.
 * · DUPLICADO      la OR ya tenía documento y éste se guardó como copia.
 * · SUSTITUIDO     era el documento de una OR y otro lo reemplazó.
 * · ERROR          el procesamiento de esta página falló.
 * · ELIMINADO      borrado lógico: el fichero sigue, la relación no.
 */
export const ESTADOS_DOCUMENTO = [
  "PENDIENTE",
  "ARCHIVADO",
  "REVISION",
  "NO_IDENTIFICADO",
  "DUPLICADO",
  "SUSTITUIDO",
  "ERROR",
  "ELIMINADO",
] as const;

export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

export const ETIQUETA_ESTADO_DOCUMENTO: Record<EstadoDocumento, string> = {
  PENDIENTE: "Pendiente",
  ARCHIVADO: "Archivado",
  REVISION: "En revisión",
  NO_IDENTIFICADO: "No identificado",
  DUPLICADO: "Duplicado",
  SUSTITUIDO: "Sustituido",
  ERROR: "Error",
  ELIMINADO: "Eliminado",
};

/** Los que salen en la bandeja «Documentos pendientes». */
export const ESTADOS_DOCUMENTO_PENDIENTE: readonly EstadoDocumento[] = [
  "PENDIENTE",
  "REVISION",
  "NO_IDENTIFICADO",
  "DUPLICADO",
  "ERROR",
];

/* ── El lote que se sube ──────────────────────────────────────────────────── */

export const ESTADOS_PROCESAMIENTO = ["PENDIENTE", "EN_CURSO", "COMPLETADO", "ERROR"] as const;

export type EstadoProcesamiento = (typeof ESTADOS_PROCESAMIENTO)[number];

export const ETIQUETA_ESTADO_PROCESAMIENTO: Record<EstadoProcesamiento, string> = {
  PENDIENTE: "En cola",
  EN_CURSO: "Procesando",
  COMPLETADO: "Completado",
  ERROR: "Con errores",
};

/* ── Cómo se leyó el número ───────────────────────────────────────────────── */

/**
 * El orden es el de la cascada de detección, de más fiable a menos. Se guarda
 * en el documento porque «lo leyó un código de barras» y «lo dedujo un modelo
 * de una imagen borrosa» no merecen la misma confianza cuando alguien revisa.
 *
 * CODIGO_BARRAS y QR no están implementados —las OR de papel de hoy no llevan
 * ninguno— pero el vocabulario ya los admite para no tener que migrar filas el
 * día que se impriman blocs con código.
 */
export const METODOS_DETECCION = [
  "CODIGO_BARRAS",
  "QR",
  "TEXTO_ZONA",
  "TEXTO_PAGINA",
  "OCR_ZONA",
  "OCR_PAGINA",
  "MANUAL",
  "NINGUNO",
] as const;

export type MetodoDeteccion = (typeof METODOS_DETECCION)[number];

export const ETIQUETA_METODO_DETECCION: Record<MetodoDeteccion, string> = {
  CODIGO_BARRAS: "Código de barras",
  QR: "Código QR",
  TEXTO_ZONA: "Texto del PDF (zona)",
  TEXTO_PAGINA: "Texto del PDF (página)",
  OCR_ZONA: "OCR de la zona",
  OCR_PAGINA: "OCR de la página",
  MANUAL: "Asignación manual",
  NINGUNO: "Sin detectar",
};

/* ── Avisos ───────────────────────────────────────────────────────────────── */

export const TIPOS_AVISO = ["BLOC_INCOMPLETO", "DOCUMENTO_PENDIENTE", "OR_DUPLICADA"] as const;

export type TipoAviso = (typeof TIPOS_AVISO)[number];

export const ETIQUETA_TIPO_AVISO: Record<TipoAviso, string> = {
  BLOC_INCOMPLETO: "Bloc incompleto",
  DOCUMENTO_PENDIENTE: "Documento sin identificar",
  OR_DUPLICADA: "OR duplicada",
};

export const ESTADOS_AVISO = ["ABIERTO", "NOTIFICADO", "RESUELTO"] as const;

export type EstadoAviso = (typeof ESTADOS_AVISO)[number];

export const ETIQUETA_ESTADO_AVISO: Record<EstadoAviso, string> = {
  ABIERTO: "Abierto",
  NOTIFICADO: "Avisado",
  RESUELTO: "Resuelto",
};

/**
 * Canales por los que se puede avisar al responsable.
 *
 * Hoy sólo existe INTERNO —una fila en `orm_avisos` que se ve en la pantalla
 * de Avisos—, y es a propósito: el encargo pide no estrenar integraciones
 * externas. El vocabulario ya contempla los demás para que añadir WhatsApp sea
 * escribir el emisor, no migrar la tabla.
 */
export const CANALES_AVISO = ["INTERNO", "EMAIL", "WHATSAPP", "SMS", "PUSH"] as const;

export type CanalAviso = (typeof CANALES_AVISO)[number];
