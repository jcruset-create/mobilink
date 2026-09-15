/**
 * Los tipos del módulo Therefore en el panel, y las etiquetas y colores con
 * los que se pintan.
 *
 * El vocabulario (tipos, estados, prioridades, acciones) lo manda el servidor
 * en el `bootstrap`: aquí sólo están las ETIQUETAS y los colores. Así, añadir
 * una acción nueva en el servidor no obliga a desplegar el panel para poder
 * filtrarla; como mucho saldrá con su nombre técnico hasta que se le ponga
 * etiqueta.
 */

export type TipoExpediente = "INCIDENCIA_ALBARAN" | "APROBACION_FACTURA" | "OTRO";
export type EstadoExpediente =
  | "NUEVO"
  | "PENDIENTE"
  | "EN_PROCESO"
  | "BLOQUEADO"
  | "RESUELTO"
  | "CERRADO";
export type Prioridad = "BAJA" | "NORMAL" | "ALTA" | "CRITICA";
export type EstadoActuacion =
  | "PENDIENTE"
  | "EN_PROCESO"
  | "BLOQUEADA"
  | "RESUELTA"
  | "DESCARTADA";
export type TipoAccion =
  | "GRABAR"
  | "MODIFICAR"
  | "REVISAR"
  | "GESTIONAR"
  | "ANULAR"
  | "APROBAR"
  | "OTRO";

export type Expediente = {
  id: string;
  numero: string;
  empresaCodigo: string;
  empresaNombre: string;
  tipo: TipoExpediente;
  estado: EstadoExpediente;
  prioridad: Prioridad;
  prioridadScore: number;
  prioridadManual: Prioridad | null;
  requiereRevision: boolean;
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  cuentaContable: string | null;
  facturaNumero: string | null;
  facturaFecha: string | null;
  importeCentimos: number | null;
  moneda: string;
  casoReferencia: string | null;
  fechaPrimeraNotificacion: string;
  fechaUltimaNotificacion: string;
  numeroNotificaciones: number;
  numeroReclamaciones: number;
  urgente: boolean;
  tareaVencida: boolean;
  asignadoUsuarioId: string | null;
  fechaInicioGestion: string | null;
  fechaResolucion: string | null;
  resueltoPorUsuarioId: string | null;
  fechaCierre: string | null;
  observaciones: string;
  createdAt: string;
  updatedAt: string;
};

export type Actuacion = {
  id: string;
  expedienteId: string;
  tipoAccion: TipoAccion;
  /** «MODIFICAR FECHA», «Costes (modificar)». `null` si no hubo matiz. */
  accionTexto: string | null;
  albaranSolicitado: string | null;
  albaranNormalizado: string | null;
  importeCentimos: number | null;
  indicadorAdicional: string | null;
  estado: EstadoActuacion;
  obligatoria: boolean;
  resultado: string | null;
  erpReferencia: string | null;
  confianza: number;
  iniciadaAt: string | null;
  resueltaAt: string | null;
  observaciones: string;
  createdAt: string;
};

export type Evento = {
  id: number;
  expedienteId: string | null;
  actuacionId: string | null;
  tipo: string;
  actorTipo: "sistema" | "usuario";
  usuarioId: string | null;
  usuarioNombre: string | null;
  datosAnteriores: Record<string, unknown> | null;
  datosNuevos: Record<string, unknown> | null;
  descripcion: string;
  occurredAt: string;
};

export type FilaBandeja = Expediente & {
  actuaciones: Actuacion[];
  diasAbierto: number;
};

export type Ficha = {
  expediente: Expediente;
  actuaciones: Actuacion[];
  eventos: Evento[];
};

export type Contadores = {
  pendientes: number;
  urgentes: number;
  reclamados: number;
  en_proceso: number;
  revisar: number;
  resueltos: number;
  todos: number;
};

export type Bootstrap = {
  rol: string | null;
  permisos: string[];
  contadores: Contadores;
  vocabulario: {
    tipos: TipoExpediente[];
    estados: EstadoExpediente[];
    prioridades: Prioridad[];
    acciones: TipoAccion[];
  };
  erp: { disponible: boolean };
};

export type Config = {
  /** Días que un RESUELTO espera antes de cerrarse solo. */
  diasAutocierre: number;
  pesos: { diasAbierto: number; reclamaciones: number; urgente: number; tareaVencida: number };
  umbrales: { baja: number; alta: number; critica: number };
  dedupe: {
    pesos: {
      mismaFactura: number;
      mismoAlbaran: number;
      mismoProveedor: number;
      mismoImporte: number;
      mismaEmpresa: number;
      mismoDocumento: number;
      mismaAccion: number;
      mismoHilo: number;
      facturaDiferente: number;
      proveedorDiferente: number;
      tipoIncompatible: number;
    };
    umbrales: { fusionar: number; revisar: number };
    ventanaDias: number;
  };
  albaran: {
    umbrales: { match: number; incierto: number };
    /** Céntimos. Absorbe redondeos, NO diferencias. */
    toleranciaCentimos: number;
    umbralConfianzaCampo: number;
    maxIntentos: number;
    maxPaginas: number;
  };
};

/* ── Análisis de albaranes ───────────────────────────────────────────────── */

export type ResultadoMatch = "MATCH" | "UNCERTAIN" | "NO_MATCH";
export type EstadoAnalisis = "OK" | "REVISAR" | "ERROR";
export type EstadoProcesoAnalisis = "PENDIENTE" | "PROCESANDO" | "COMPLETADO" | "ERROR";

export type DescuentoLinea = { orden: number; porcentaje: number; raw: string };

export type ConfianzaLinea = {
  referencia: number;
  descripcion: number;
  cantidad: number;
  precio: number;
  importe: number;
  descuentos: number;
};

export type LineaAlbaran = {
  id: string;
  numeroLinea: number;
  referencia: string | null;
  descripcion: string | null;
  cantidad: number | null;
  precioUnitarioCentimos: number | null;
  importeCentimos: number | null;
  descuentos: DescuentoLinea[];
  descuentosRaw: string;
  confianza: ConfianzaLinea;
  /** `null` = faltan datos para comprobarlo, que no es lo mismo que fallar. */
  cuadraAritmetica: boolean | null;
  rawText: string;
  pagina: number | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
};

export type TipoValidacion =
  | "DOCUMENTO"
  | "ALBARAN_MATCH"
  | "SEPARACION_ALBARANES"
  | "LINEAS"
  | "DESCUENTOS"
  | "CAMPOS_CRITICOS"
  | "IMPORTE"
  | "CORREO_VS_DOCUMENTO";

export type ValidacionAnalisis = {
  id: string;
  tipo: TipoValidacion;
  estado: EstadoAnalisis;
  mensaje: string;
  valorEsperado: string | null;
  valorObtenido: string | null;
  metadata: Record<string, unknown>;
};

export type ConceptoAdicional = {
  etiqueta: string;
  importeCentimos: number | null;
  raw: string;
  pagina: number;
};

export type AlbaranAnalizado = {
  id: string;
  expedienteId: string;
  actuacionId: string;
  adjuntoId: string | null;
  documentoId: string | null;
  numeroSolicitado: string;
  numeroDocumento: string | null;
  numeroNormalizado: string | null;
  confianzaMatch: number | null;
  resultadoMatch: ResultadoMatch | null;
  fecha: string | null;
  matricula: string | null;
  bastidor: string | null;
  observaciones: string | null;
  importeIncidenciaCentimos: number | null;
  importeLineasCentimos: number | null;
  diferenciaCentimos: number | null;
  estadoAnalisis: EstadoAnalisis | null;
  estadoProceso: EstadoProcesoAnalisis;
  intentos: number;
  error: string | null;
  paginaInicio: number | null;
  paginaFin: number | null;
  parserUsado: string | null;
  origen: string | null;
  metadata: {
    modoTabla?: "CABECERA" | "POSICIONAL" | null;
    conceptosAdicionales?: ConceptoAdicional[];
    otros?: Record<string, string>;
    parecidos?: string[];
    seccionesVecinas?: { anterior: string | null; siguiente: string | null } | null;
    sustituidaPor?: string;
  };
  createdAt: string | null;
  lineas: LineaAlbaran[];
  validaciones: ValidacionAnalisis[];
};

export type DocumentoAnalizado = {
  id: string;
  hashArchivo: string;
  tipoDocumento: string;
  numeroDocumento: string | null;
  fechaDocumento: string | null;
  proveedorNombre: string | null;
  proveedorNif: string | null;
  baseCentimos: number | null;
  ivaCentimos: number | null;
  totalCentimos: number | null;
  origen: string | null;
  parserUsado: string | null;
  validacion: "SIN_COMPARAR" | "VALIDADO" | "DISCREPANCIA";
};

export type AnalisisDeExpediente = {
  albaranes: AlbaranAnalizado[];
  documentos: DocumentoAnalizado[];
};

export const ETIQUETA_VALIDACION: Record<TipoValidacion, string> = {
  DOCUMENTO: "Documento",
  ALBARAN_MATCH: "Coincidencia del albarán",
  SEPARACION_ALBARANES: "Separación de albaranes",
  LINEAS: "Líneas",
  DESCUENTOS: "Descuentos",
  CAMPOS_CRITICOS: "Campos dudosos",
  IMPORTE: "Importe",
  CORREO_VS_DOCUMENTO: "Correo contra documento",
};

/* ── Correos y decisiones ────────────────────────────────────────────────── */

export type TipoNotificacion =
  | "SOLICITUD"
  | "RECORDATORIO"
  | "RECLAMACION"
  | "TAREA_VENCIDA"
  | "CAMBIO_INSTRUCCION"
  | "APROBACION"
  | "OTRO";

export type Notificacion = {
  id: string;
  expedienteId: string | null;
  messageId: string;
  fechaEmail: string;
  remitente: string;
  destinatario: string;
  asunto: string;
  textoOriginal: string;
  tipoNotificacion: TipoNotificacion;
  urgenteDetectado: boolean;
  personaSolicitante: string | null;
  estadoProceso: "PROCESADA" | "PENDIENTE_DECISION" | "ERROR_PARSER" | "IGNORADA";
  createdAt: string;
};

export type Adjunto = {
  id: string;
  notificacionId: string;
  expedienteId: string | null;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number | null;
  tipoDocumento: string;
  hashArchivo: string;
  parsed: boolean;
};

export type TipoDecision =
  | "POSIBLE_DUPLICADO"
  | "CAMBIO_INSTRUCCION"
  | "RECLAMACION_SOBRE_RESUELTO"
  | "REQUIERE_REVISION"
  | "ERROR_PARSER";

/**
 * El desglose de por qué se sospechó que dos correos eran lo mismo.
 *
 * Se enseña entero en la pantalla de revisión: quien decide necesita ver el
 * motivo, no un número. «60 puntos» no ayuda a nadie; «misma factura 0000555111,
 * albarán 501234 ya en INC-452, factura distinta» sí.
 */
export type MotivoPuntuacion = { clave: string; puntos: number; texto: string };

export type CandidatoDecision = {
  id: string;
  numero: string;
  estado: EstadoExpediente;
  score: number;
  motivos: MotivoPuntuacion[];
};

export type Decision = {
  id: string;
  tipo: TipoDecision;
  notificacionId: string | null;
  expedienteId: string | null;
  actuacionId: string | null;
  candidatos: CandidatoDecision[];
  detalle: Record<string, unknown> | null;
  estado: "PENDIENTE" | "DECIDIDA";
  decision: string | null;
  motivo: string | null;
  decididaPorNombre: string | null;
  decididaAt: string | null;
  createdAt: string;
};

/* ── Etiquetas ───────────────────────────────────────────────────────────── */

export const ETIQUETA_TIPO: Record<string, string> = {
  INCIDENCIA_ALBARAN: "Incidencia",
  APROBACION_FACTURA: "Aprobación",
  OTRO: "Otro",
};

export const ETIQUETA_ESTADO: Record<string, string> = {
  NUEVO: "Nuevo",
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  BLOQUEADO: "Bloqueado",
  RESUELTO: "Resuelto",
  CERRADO: "Cerrado",
};

export const ETIQUETA_ESTADO_ACTUACION: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  BLOQUEADA: "Bloqueada",
  RESUELTA: "Resuelta",
  DESCARTADA: "Descartada",
};

export const ETIQUETA_PRIORIDAD: Record<string, string> = {
  BAJA: "Baja",
  NORMAL: "Normal",
  ALTA: "Alta",
  CRITICA: "Crítica",
};

/*
 * Colores del panel: ámbar lo que espera, sky lo que está en marcha, esmeralda
 * lo terminado, rosa lo urgente o lo que va mal, slate lo inactivo. Es la misma
 * convención que Administración y TyreControl, para que un color no signifique
 * una cosa en un módulo y otra en el de al lado.
 */
export const COLOR_ESTADO: Record<string, string> = {
  NUEVO: "bg-sky-500/20 text-sky-300",
  PENDIENTE: "bg-amber-500/20 text-amber-300",
  EN_PROCESO: "bg-indigo-500/20 text-indigo-300",
  BLOQUEADO: "bg-rose-500/20 text-rose-300",
  RESUELTO: "bg-emerald-500/20 text-emerald-300",
  CERRADO: "bg-slate-700 text-slate-400",
};

export const COLOR_ESTADO_ACTUACION: Record<string, string> = {
  PENDIENTE: "bg-amber-500/20 text-amber-300",
  EN_PROCESO: "bg-indigo-500/20 text-indigo-300",
  BLOQUEADA: "bg-rose-500/20 text-rose-300",
  RESUELTA: "bg-emerald-500/20 text-emerald-300",
  DESCARTADA: "bg-slate-700 text-slate-400",
};

export const COLOR_PRIORIDAD: Record<string, string> = {
  BAJA: "bg-slate-700 text-slate-400",
  NORMAL: "bg-sky-500/20 text-sky-300",
  ALTA: "bg-amber-500/20 text-amber-300",
  CRITICA: "bg-rose-500/20 text-rose-300",
};

export const ETIQUETA_DECISION: Record<string, string> = {
  POSIBLE_DUPLICADO: "¿Es el mismo asunto?",
  CAMBIO_INSTRUCCION: "Han cambiado la instrucción",
  RECLAMACION_SOBRE_RESUELTO: "Reclaman algo ya resuelto",
  REQUIERE_REVISION: "Hay que mirarlo",
  ERROR_PARSER: "No se ha podido leer",
};

export const ETIQUETA_NOTIFICACION: Record<string, string> = {
  SOLICITUD: "Solicitud",
  RECORDATORIO: "Recordatorio",
  RECLAMACION: "Reclamación",
  TAREA_VENCIDA: "Tarea vencida",
  CAMBIO_INSTRUCCION: "Cambio de instrucción",
  APROBACION: "Aprobación",
  OTRO: "Otro",
};

export const COLOR_NOTIFICACION: Record<string, string> = {
  SOLICITUD: "bg-sky-500/20 text-sky-300",
  RECORDATORIO: "bg-amber-500/20 text-amber-300",
  RECLAMACION: "bg-rose-500/20 text-rose-300",
  TAREA_VENCIDA: "bg-rose-500/20 text-rose-300",
  CAMBIO_INSTRUCCION: "bg-indigo-500/20 text-indigo-300",
  APROBACION: "bg-emerald-500/20 text-emerald-300",
  OTRO: "bg-slate-700 text-slate-400",
};

/**
 * Qué se puede responder a cada clase de duda, y con qué palabras.
 *
 * El servidor manda su propia lista en `GET /decisiones`; ésta es la de las
 * etiquetas, que es lo que el servidor no tiene por qué saber. Si llegara un
 * tipo nuevo, la pantalla enseñaría los códigos en crudo en vez de quedarse sin
 * botones, que es lo que dejaría una decisión atascada para siempre.
 */
export const OPCIONES_DECISION: Record<string, { valor: string; texto: string }[]> = {
  POSIBLE_DUPLICADO: [
    { valor: "FUSIONAR", texto: "Es el mismo" },
    { valor: "CREAR_NUEVO", texto: "Es otro asunto" },
  ],
  RECLAMACION_SOBRE_RESUELTO: [
    { valor: "REABRIR", texto: "Reabrir" },
    { valor: "CONFIRMAR_RESUELTO", texto: "Sigue resuelto" },
    { valor: "CREAR_RELACIONADO", texto: "Abrir uno nuevo" },
  ],
  CAMBIO_INSTRUCCION: [
    { valor: "ACEPTAR", texto: "Aceptar la nueva" },
    { valor: "MANTENER", texto: "Mantener la anterior" },
    { valor: "BLOQUEAR", texto: "Dejar bloqueado" },
  ],
  REQUIERE_REVISION: [{ valor: "REVISADO", texto: "Revisado" }],
  ERROR_PARSER: [{ valor: "IGNORAR", texto: "Ignorar" }],
};

/** El punto de color de la primera columna de la bandeja. */
export const PUNTO_PRIORIDAD: Record<string, string> = {
  BAJA: "bg-slate-500",
  NORMAL: "bg-sky-400",
  ALTA: "bg-amber-400",
  CRITICA: "bg-rose-500",
};
