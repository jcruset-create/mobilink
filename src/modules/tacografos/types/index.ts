/** Tipos del módulo Tacógrafos, en el mismo idioma que la API. */

export type TipoOperacion = "transferencia" | "intransferibilidad";

export type Modalidad = "en_mano" | "email" | "mensajeria" | "correo_certificado";

/** Las cuatro opciones del punto 6 del RD 125/2017, en orden. */
export const MODALIDADES: Array<{ valor: Modalidad; etiqueta: string }> = [
  { valor: "en_mano", etiqueta: "En mano" },
  { valor: "email", etiqueta: "Email" },
  { valor: "mensajeria", etiqueta: "Mensajería" },
  { valor: "correo_certificado", etiqueta: "Correo certificado" },
];

export type Centro = {
  nombre: string;
  centroTecnico: string;
  numCentro: string;
  direccion1: string;
  direccion2: string;
  ciudad: string;
  ciudadFirma: string;
  email: string;
  destinatarioAdmin: string;
  responsableTecnico: string;
  urlTramite: string;
  urlTramiteOvt: string;
};

export type DatosExpediente = {
  numInforme: string;
  tipo: TipoOperacion;
  empresaCliente: string;
  autorizaNombre: string;
  autorizaNif: string;
  docTitularidad: boolean;
  matricula: string;
  bastidor: string;
  tacMarca: string;
  tacModelo: string;
  tacSerie: string;
  fechaInforme: string | null;
  fechaEntrega: string | null;
  fechaTransferencia: string | null;
  fechaEnvio: string | null;
  tecnico: string;
  modalidadEntrega: Modalidad | null;
  receptorNombre: string;
  receptorDni: string;
  entregaAparato: boolean;
  intervencionId: string | null;
};

export type CampoQueFalta = { campo: string; etiqueta: string };

export type Expediente = DatosExpediente & {
  id: string;
  estado: string;
  destruccionFecha: string | null;
  destruccionMetodo: string;
  destruccionPersona: string;
  destruccionHash: string;
  createdAtMs: number;
  updatedAtMs: number;
  /** Calculados por el servidor: no se guardan, se derivan. */
  seAchatarra: boolean;
  fechaLimiteDestruccion: string | null;
  camposQueFaltan: CampoQueFalta[];
};

export type Bootstrap = {
  rol: string | null;
  permisos: string[];
  centro: Centro;
  /** Si este centro puede traer datos de una intervención de taller. */
  autorrelleno: boolean;
};

/** Intervención de taller de la que se puede copiar el expediente. */
export type Sugerencia = {
  intervencionId: string;
  numero: string | null;
  fecha: string | null;
  matricula: string;
  bastidor: string;
  empresaCliente: string;
  tecnico: string;
};

/** Expediente vacío, con los valores por defecto de la hoja `DATOS`. */
export function expedienteVacio(): DatosExpediente {
  return {
    numInforme: "",
    tipo: "intransferibilidad",
    empresaCliente: "",
    autorizaNombre: "",
    autorizaNif: "",
    docTitularidad: false,
    matricula: "",
    bastidor: "",
    tacMarca: "",
    tacModelo: "",
    tacSerie: "",
    fechaInforme: null,
    fechaEntrega: null,
    fechaTransferencia: null,
    fechaEnvio: null,
    tecnico: "",
    modalidadEntrega: null,
    receptorNombre: "",
    receptorDni: "",
    entregaAparato: false,
    intervencionId: null,
  };
}

export type TipoDocumento =
  | "justificante"
  | "acuse_cliente"
  | "comunicacion_admin"
  | "acta_destruccion";

export type Documento = {
  id: string;
  expedienteId: string;
  tipo: TipoDocumento;
  plantillaVersion: number;
  ruta: string;
  /** SHA-256 del PDF: es lo que demuestra que el papel es el que se emitió. */
  hash: string;
  tamanoBytes: number;
  anulado: boolean;
  motivoAnulacion: string;
  emitidoAtMs: number;
  url: string | null;
};

/** Qué puede emitirse para un expediente, según su tipo de operación. */
export type Emitible = { tipo: TipoDocumento; etiqueta: string };

export type PapelFirma = "autoriza" | "receptor" | "tecnico" | "responsable";

export type Firma = {
  id: string;
  expedienteId: string;
  papel: PapelFirma;
  ruta: string;
  nombre: string;
  firmadoAtMs: number;
  url: string | null;
};

/** Qué firma lleva cada documento. Igual que en el servidor. */
export const FIRMAS_POR_DOCUMENTO: Record<TipoDocumento, PapelFirma[]> = {
  justificante: ["autoriza", "tecnico"],
  acuse_cliente: ["receptor"],
  comunicacion_admin: ["responsable"],
  acta_destruccion: ["responsable"],
};

export const ETIQUETA_FIRMA: Record<PapelFirma, string> = {
  autoriza: "Persona que autoriza la descarga",
  receptor: "Persona que recibe el certificado",
  tecnico: "Técnico que interviene",
  responsable: "Responsable técnico",
};

export type EstadoCustodia =
  | "sin_transferencia"
  | "en_custodia"
  | "pendiente_destruir"
  | "destruido";

export type FilaCustodia = {
  expediente: Expediente;
  estado: EstadoCustodia;
  fechaLimite: string | null;
  diasRestantes: number | null;
};

export type Comunicacion = {
  id: string;
  expedienteId: string;
  fechaPresentacion: string | null;
  referencia: string;
  notas: string;
  registradoAtMs: number;
};

export type TextoTramite = {
  assumpte: string;
  nomFitxer: string;
  exposo: string;
  urlTramite: string;
  urlOvt: string;
};

/** Lo que ha entendido el importador del informe de la extranet. */
export type Importacion = {
  origen: "pdf_texto" | "ocr";
  /** Cuál de los dos impresos de la extranet se ha reconocido. */
  impreso: "anexo_ii" | "informe_tecnico";
  datos: Partial<DatosExpediente>;
  campos: Record<string, string>;
  avisos: string[];
  encontradas: number;
  total: number;
};
