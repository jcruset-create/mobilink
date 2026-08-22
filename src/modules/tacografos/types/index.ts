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
