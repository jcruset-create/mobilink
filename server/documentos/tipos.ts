/**
 * Documentos de una asistencia: qué tipos hay, quién puede verlos y qué falta.
 *
 * ── El estado administrativo se DEDUCE, no se teclea ────────────────────────
 *
 * Ésta es la decisión que gobierna el fichero. El estado administrativo sale de
 * hechos comprobables —qué documentos hay, si el coste está validado, si ya se
 * facturó—, no de un campo que alguien mantiene a mano.
 *
 * El motivo es que un campo a mano se desincroniza: alguien sube el albarán y
 * se olvida de cambiar el estado, y la asistencia se queda «pendiente albarán»
 * con el albarán dentro. Deducirlo hace imposible esa contradicción.
 *
 * Lo que sí son decisiones —validar un coste, dar por facturado— se guardan
 * como hechos con su fecha, y el estado se deduce también de ellos.
 */

/* ── Tipos de documento ──────────────────────────────────────────────────── */

export const TIPOS_DOCUMENTO = [
  "albaran",        // el que firma el cliente al terminar
  "parte",          // parte de trabajo / informe del servicio
  "factura",        // factura del proveedor o del taller
  "presupuesto",
  "fotografia",
  "autorizacion",   // autorización del cliente o de la aseguradora
  "firma",
  "otro",
] as const;

export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export function esTipoDocumento(v: unknown): v is TipoDocumento {
  return typeof v === "string" && (TIPOS_DOCUMENTO as readonly string[]).includes(v);
}

/**
 * Traduce los `kind` que ya usaba Assist en `roadside_assistance_files`.
 *
 * Se traducen en vez de renombrarlos en la base: hay años de fotos guardadas
 * con esos nombres y las pantallas actuales los leen tal cual.
 */
const DESDE_KIND_ASSIST: Record<string, TipoDocumento> = {
  firma: "firma",
  foto: "fotografia",
  fotos: "fotografia",
  matricula: "fotografia",
  averia: "fotografia",
  albaran: "albaran",
  parte: "parte",
  factura: "factura",
  autorizacion: "autorizacion",
};

export function tipoDesdeKindAssist(kind: unknown): TipoDocumento {
  return DESDE_KIND_ASSIST[String(kind ?? "").toLowerCase()] ?? "otro";
}

export const ETIQUETA_TIPO: Record<TipoDocumento, string> = {
  albaran: "Albarán",
  parte: "Parte de trabajo",
  factura: "Factura",
  presupuesto: "Presupuesto",
  fotografia: "Fotografía",
  autorizacion: "Autorización",
  firma: "Firma",
  otro: "Otro",
};

/* ── Visibilidad ─────────────────────────────────────────────────────────── */

/**
 * Quién puede ver un documento.
 *
 *   interno    — solo el sistema que lo guardó. Es el valor por defecto, y lo
 *                es a propósito: si un documento nuevo naciera compartido, un
 *                tipo que nadie ha clasificado todavía se filtraría solo.
 *   compartido — visible para la contraparte de la subcontratación.
 *   cliente    — además visible en el informe que recibe el cliente final.
 */
export const VISIBILIDADES = ["interno", "compartido", "cliente"] as const;
export type Visibilidad = (typeof VISIBILIDADES)[number];

export function esVisibilidad(v: unknown): v is Visibilidad {
  return typeof v === "string" && (VISIBILIDADES as readonly string[]).includes(v);
}

/**
 * Visibilidad por defecto de un documento recién subido, según su tipo y su
 * origen.
 *
 * ── La regla que importa ────────────────────────────────────────────────────
 *
 * La factura de un taller a Central NO se comparte con Assist. Lleva dentro lo
 * que a Central le cuesta el servicio, y con eso Assist calcula el margen de su
 * proveedor y tarifa en consecuencia la próxima vez. Es exactamente el dato que
 * la separación de expedientes viene a proteger.
 *
 * Lo que sí se comparte es lo que hace falta para operar y para justificar el
 * servicio ante el cliente final: albarán, parte y fotos.
 *
 * Una factura que emite el PROPIO sistema a su contraparte sí se comparte: es
 * lo que le va a cobrar, y ocultárselo no tendría sentido.
 */
export function visibilidadPorDefecto(
  tipo: TipoDocumento,
  origen: "propio" | "proveedor" | "contraparte" = "propio",
): Visibilidad {
  if (tipo === "factura" || tipo === "presupuesto") {
    // De un proveedor: es coste interno. Propia: es lo que se cobra.
    return origen === "proveedor" ? "interno" : "compartido";
  }
  switch (tipo) {
    case "albaran":
    case "parte":
      return "cliente";
    case "fotografia":
    case "firma":
    case "autorizacion":
      return "compartido";
    default:
      return "interno";
  }
}

/**
 * Si un documento se puede enseñar a quien pregunta.
 *
 * `quien`:
 *   propio      — el sistema dueño del documento: lo ve todo.
 *   contraparte — la otra plataforma de la subcontratación.
 *   cliente     — el informe público del cliente final.
 *
 * Se comprueba en el backend y no solo al pintar: una URL de documento que se
 * pueda adivinar deja de estar protegida en cuanto la protección vive en la
 * pantalla.
 */
export function puedeVer(
  visibilidad: unknown,
  quien: "propio" | "contraparte" | "cliente",
): boolean {
  if (quien === "propio") return true;
  if (!esVisibilidad(visibilidad)) return false;   // lo desconocido no se enseña
  if (quien === "contraparte") return visibilidad === "compartido" || visibilidad === "cliente";
  return visibilidad === "cliente";
}

/* ── Estado administrativo ───────────────────────────────────────────────── */

/**
 * El estado del expediente, que NO es el estado del servicio.
 *
 * Una asistencia puede estar operativamente FINALIZADA y administrativamente
 * PENDIENTE_ALBARAN: la grúa terminó hace tres días y el papel no ha llegado.
 * Mezclarlos en un solo campo obligaba a elegir cuál de las dos verdades
 * enseñar, y la que se perdía siempre era la administrativa.
 */
export const ESTADOS_ADMIN = [
  "SIN_DOCUMENTACION",
  "PENDIENTE_ALBARAN",
  "PENDIENTE_FACTURA",
  "DOCUMENTACION_COMPLETA",
  "COSTE_PENDIENTE",
  "COSTE_VALIDADO",
  "LISTA_PARA_FACTURAR",
  "FACTURADA",
] as const;

export type EstadoAdmin = (typeof ESTADOS_ADMIN)[number];

export const ETIQUETA_ADMIN: Record<EstadoAdmin, string> = {
  SIN_DOCUMENTACION: "Sin documentación",
  PENDIENTE_ALBARAN: "Pendiente de albarán",
  PENDIENTE_FACTURA: "Pendiente de factura",
  DOCUMENTACION_COMPLETA: "Documentación completa",
  COSTE_PENDIENTE: "Coste pendiente",
  COSTE_VALIDADO: "Coste validado",
  LISTA_PARA_FACTURAR: "Lista para facturar",
  FACTURADA: "Facturada",
};

/** Los hechos comprobables de los que sale el estado. */
export type HechosAdmin = {
  /** El servicio ha terminado. Antes de eso no se le pide papeleo a nadie. */
  servicioFinalizado: boolean;
  tiposPresentes: TipoDocumento[];
  /** Documentos que este servicio exige. Depende de si va subcontratado. */
  documentosExigidos: TipoDocumento[];
  costeValidado: boolean;
  facturada: boolean;
  /** Se factura a un tercero: entonces hace falta la factura del proveedor. */
  subcontratada: boolean;
};

/**
 * Qué documentos exige un servicio.
 *
 * Un servicio propio necesita el albarán firmado. Uno subcontratado necesita
 * además la factura de quien lo hizo: sin ella no se puede cerrar el coste, y
 * sin coste no se puede facturar con margen conocido.
 */
export function documentosExigidos(subcontratada: boolean): TipoDocumento[] {
  return subcontratada ? ["albaran", "factura"] : ["albaran"];
}

export function documentosQueFaltan(h: HechosAdmin): TipoDocumento[] {
  const presentes = new Set(h.tiposPresentes);
  return h.documentosExigidos.filter((t) => !presentes.has(t));
}

/**
 * Deduce el estado administrativo. Función pura: mismos hechos, mismo estado.
 *
 * El orden de las comprobaciones es el del recorrido real de un expediente, y
 * por eso se lee de arriba abajo: primero está o no facturada, luego si se
 * puede facturar, luego el coste, y al final qué papel falta.
 */
export function estadoAdministrativo(h: HechosAdmin): EstadoAdmin {
  if (h.facturada) return "FACTURADA";

  const faltan = documentosQueFaltan(h);

  // Con todo el papeleo y el coste validado, ya se puede facturar.
  if (faltan.length === 0 && h.costeValidado) return "LISTA_PARA_FACTURAR";

  /*
   * Antes de que el servicio termine no se reclama nada. Una asistencia en
   * curso «pendiente de albarán» llenaría la bandeja de excepciones de avisos
   * que no se pueden atender todavía, y una bandeja llena de ruido se ignora.
   */
  if (!h.servicioFinalizado) {
    return h.tiposPresentes.length === 0 ? "SIN_DOCUMENTACION" : "COSTE_PENDIENTE";
  }

  if (faltan.includes("albaran")) return "PENDIENTE_ALBARAN";
  if (faltan.includes("factura")) return "PENDIENTE_FACTURA";
  if (faltan.length > 0) return "SIN_DOCUMENTACION";

  // Papeleo completo pero el coste sin validar: es donde se atasca de verdad.
  return h.costeValidado ? "COSTE_VALIDADO" : "DOCUMENTACION_COMPLETA";
}

/**
 * Si el expediente está esperando algo de una persona.
 *
 * Es lo que alimenta la bandeja de excepciones: se trabaja por lo que está
 * atascado, no por lo que va bien.
 */
export function requiereAtencion(estado: EstadoAdmin): boolean {
  return estado === "PENDIENTE_ALBARAN"
    || estado === "PENDIENTE_FACTURA"
    || estado === "SIN_DOCUMENTACION"
    || estado === "DOCUMENTACION_COMPLETA";   // falta validar el coste
}
