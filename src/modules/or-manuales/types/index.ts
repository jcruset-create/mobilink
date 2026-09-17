/**
 * Lo que viaja entre la API de OR Manuales y el panel.
 *
 * Los vocabularios y sus etiquetas NO se copian aquí: llegan en el bootstrap,
 * porque el servidor es quien manda y una copia en el panel se queda vieja el
 * día que se añade un estado. Lo único que vive aquí son los COLORES, que son
 * decisión de la pantalla y no del dominio.
 */

export type Permiso = string;

export type Indicadores = {
  blocsEntregados: number;
  blocsPendientes: number;
  blocsIncompletos: number;
  blocsCerrados: number;
  orPendientes: number;
  documentosPorRevisar: number;
  avisosAbiertos: number;
  procesosEnCurso: number;
};

export type ZonaOcr = { x: number; y: number; ancho: number; alto: number };

export type Configuracion = {
  zona: ZonaOcr;
  umbrales: { automatico: number; revision: number };
  orPorBloc: number;
  ocrConIa: boolean;
};

export type Vocabulario = {
  estadosBloc: string[];
  estadosOr: string[];
  estadosDocumento: string[];
  estadosProcesamiento: string[];
  metodosDeteccion: string[];
  tiposAviso: string[];
  estadosAviso: string[];
  canalesAviso: string[];
  etiquetas: {
    estadoBloc: Record<string, string>;
    estadoOr: Record<string, string>;
    estadoDocumento: Record<string, string>;
    estadoProcesamiento: Record<string, string>;
    metodoDeteccion: Record<string, string>;
    tipoAviso: Record<string, string>;
    estadoAviso: Record<string, string>;
  };
};

export type Bootstrap = {
  rol: string | null;
  permisos: Permiso[];
  usuario: { id: string; nombre: string };
  indicadores: Indicadores;
  config: Configuracion;
  vocabulario: Vocabulario;
};

export type Bloc = {
  id: string;
  numeroBloc: string;
  orInicial: number;
  orFinal: number;
  cantidadOr: number;
  responsableId: string | null;
  responsableNombre: string | null;
  fechaCreacion: string;
  fechaEntrega: string | null;
  fechaDevolucion: string | null;
  estado: string;
  observaciones: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type FilaBloc = Bloc & { archivadas: number; pendientes: number; enRevision: number };

export type Or = {
  id: string;
  blocId: string;
  numeroOr: number;
  estado: string;
  documentoPrincipalId: string | null;
  fechaEscaneo: string | null;
};

export type Progreso = {
  total: number;
  archivadas: number;
  pendientes: number;
  enRevision: number;
  duplicadas: number;
  conError: number;
  faltan: number[];
  porcentaje: number;
};

export type Entrega = {
  id: string;
  blocId: string;
  responsableId: string | null;
  responsableNombre: string | null;
  fechaEntrega: string;
  fechaDevolucion: string | null;
  observaciones: string | null;
  observacionesDevolucion: string | null;
  usuarioRegistroNombre: string | null;
  createdAt: string;
};

export type Evento = {
  id: string;
  blocId: string | null;
  orId: string | null;
  documentoId: string | null;
  accion: string;
  detalle: unknown;
  usuarioNombre: string | null;
  createdAt: string;
};

export type FichaBloc = {
  bloc: Bloc;
  ors: Or[];
  progreso: Progreso;
  entregas: Entrega[];
  eventos: Evento[];
};

export type Documento = {
  id: string;
  orId: string | null;
  blocId: string | null;
  procesamientoId: string | null;
  nombreArchivo: string;
  nombreOriginal: string;
  paginaOrigen: number | null;
  storageKey: string;
  tipoArchivo: string;
  tamanoBytes: number;
  hashArchivo: string;
  ocrNumeroDetectado: number | null;
  ocrConfianza: number | null;
  ocrMetodo: string | null;
  ocrTexto: string | null;
  estadoProcesamiento: string;
  errorMensaje: string | null;
  sustituyeA: string | null;
  usuarioCarga: string | null;
  usuarioCargaNombre: string | null;
  fechaCarga: string;
  numeroOr?: number | null;
  numeroBloc?: string | null;
};

export type Procesamiento = {
  id: string;
  archivoOriginal: string;
  storageKeyOriginal: string | null;
  paginas: number;
  paginasProcesadas: number;
  documentosDetectados: number;
  documentosCorrectos: number;
  documentosRevision: number;
  noIdentificados: number;
  duplicados: number;
  errores: number;
  usuarioNombre: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  estado: string;
  etapa: string | null;
  errorMensaje: string | null;
};

export type Aviso = {
  id: string;
  blocId: string | null;
  orId: string | null;
  tipo: string;
  mensaje: string;
  responsableId: string | null;
  responsableNombre: string | null;
  canal: string;
  estado: string;
  fechaCreacion: string;
  fechaNotificacion: string | null;
  fechaResolucion: string | null;
  numeroBloc?: string | null;
};

export type Propuesta = {
  numeroBloc: string;
  orInicial: number | null;
  orFinal: number | null;
  cantidadOr: number;
};

export type ResultadoArchivado = {
  documento: Documento;
  estado: string;
  numeroOr: number | null;
  blocId: string | null;
  existente: Documento | null;
};

export type ResultadoBusqueda = {
  or: Or | null;
  bloc: Bloc | null;
  documento: Documento | null;
  blocs: FilaBloc[];
};

/* ── Colores ─────────────────────────────────────────────────────────────── */

/**
 * El código de color del encargo, con los tonos que ya usa el resto del panel:
 * verde completo, azul entregado o en curso, amarillo pendiente, naranja
 * revisión, rojo error o falta, gris disponible.
 */
export const COLOR_ESTADO_BLOC: Record<string, string> = {
  DISPONIBLE: "bg-slate-600/40 text-slate-300",
  ENTREGADO: "bg-sky-500/20 text-sky-300",
  DEVUELTO: "bg-sky-500/20 text-sky-300",
  PENDIENTE_ESCANEO: "bg-amber-500/20 text-amber-200",
  INCOMPLETO: "bg-rose-500/20 text-rose-300",
  REVISAR: "bg-orange-500/20 text-orange-300",
  COMPLETO: "bg-emerald-500/20 text-emerald-300",
  CERRADO: "bg-emerald-600/30 text-emerald-200",
};

export const COLOR_ESTADO_OR: Record<string, string> = {
  PENDIENTE: "bg-amber-500/20 text-amber-200",
  ESCANEADA: "bg-emerald-500/20 text-emerald-300",
  REVISAR: "bg-orange-500/20 text-orange-300",
  DUPLICADA: "bg-orange-500/20 text-orange-300",
  ERROR: "bg-rose-500/20 text-rose-300",
};

/** La casilla de cada OR en la rejilla del bloc. Se lee de un vistazo. */
export const CASILLA_ESTADO_OR: Record<string, string> = {
  PENDIENTE: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  ESCANEADA: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  REVISAR: "border-orange-500/50 bg-orange-500/10 text-orange-300",
  DUPLICADA: "border-orange-500/50 bg-orange-500/10 text-orange-300",
  ERROR: "border-rose-500/50 bg-rose-500/10 text-rose-300",
};

export const COLOR_ESTADO_DOCUMENTO: Record<string, string> = {
  PENDIENTE: "bg-amber-500/20 text-amber-200",
  ARCHIVADO: "bg-emerald-500/20 text-emerald-300",
  REVISION: "bg-orange-500/20 text-orange-300",
  NO_IDENTIFICADO: "bg-rose-500/20 text-rose-300",
  DUPLICADO: "bg-orange-500/20 text-orange-300",
  SUSTITUIDO: "bg-slate-600/40 text-slate-300",
  ERROR: "bg-rose-500/20 text-rose-300",
  ELIMINADO: "bg-slate-600/40 text-slate-400",
};

export const COLOR_ESTADO_PROCESAMIENTO: Record<string, string> = {
  PENDIENTE: "bg-amber-500/20 text-amber-200",
  EN_CURSO: "bg-sky-500/20 text-sky-300",
  COMPLETADO: "bg-emerald-500/20 text-emerald-300",
  ERROR: "bg-rose-500/20 text-rose-300",
};

export const COLOR_ESTADO_AVISO: Record<string, string> = {
  ABIERTO: "bg-rose-500/20 text-rose-300",
  NOTIFICADO: "bg-amber-500/20 text-amber-200",
  RESUELTO: "bg-emerald-500/20 text-emerald-300",
};

/** El color de la confianza del OCR, con los umbrales que estén configurados. */
export function tonoConfianza(confianza: number | null, umbrales: { automatico: number; revision: number }): string {
  if (confianza === null) return "text-slate-500";
  if (confianza >= umbrales.automatico) return "text-emerald-400";
  if (confianza >= umbrales.revision) return "text-orange-300";
  return "text-rose-400";
}

/** El nombre de las acciones del histórico, en cristiano. */
export const ETIQUETA_ACCION: Record<string, string> = {
  BLOC_CREADO: "Bloc creado",
  BLOC_EDITADO: "Bloc editado",
  BLOC_ENTREGADO: "Bloc entregado",
  BLOC_DEVUELTO: "Bloc devuelto",
  BLOC_CERRADO: "Bloc cerrado",
  BLOC_ESTADO: "Cambio de estado",
  OR_ARCHIVADA: "OR archivada",
  ASIGNACION_MANUAL: "Asignación manual",
  OCR_CONFIRMADO: "Revisión confirmada",
  DOCUMENTO_DUPLICADO: "Documento duplicado",
  DOCUMENTO_SUSTITUIDO: "Documento sustituido",
  DOCUMENTO_ELIMINADO: "Documento eliminado",
  DOCUMENTO_REPROCESADO: "Documento reprocesado",
  PAGINA_REPETIDA: "Página ya archivada",
  LOTE_SUBIDO: "Escaneo subido",
  LOTE_PROCESADO: "Escaneo procesado",
  AVISO_NOTIFICADO: "Responsable avisado",
};
