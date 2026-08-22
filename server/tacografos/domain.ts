/**
 * Reglas del expediente, sin base de datos ni Express.
 *
 * Están aquí y no en el router para que se puedan probar sin levantar nada, y
 * porque son las mismas que aplica la hoja `DATOS` del libro
 * `docs/plantillas/TACOGRAFOS_documentacion.xlsx`: si un día divergen, el
 * técnico obtendrá un documento distinto según lo haya rellenado en Excel o en
 * la aplicación, que es la avería que este módulo viene a evitar.
 */

export type TipoOperacion = "transferencia" | "intransferibilidad";

export const MODALIDADES = ["en_mano", "email", "mensajeria", "correo_certificado"] as const;
export type Modalidad = (typeof MODALIDADES)[number];

/** Etiquetas de las cuatro modalidades del punto 6 del RD 125/2017. */
export const ETIQUETA_MODALIDAD: Record<Modalidad, string> = {
  en_mano: "En mano",
  email: "Email",
  mensajeria: "Mensajería",
  correo_certificado: "Correo certificado",
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

/** Campo que falta, con la etiqueta que ve el usuario. */
export type CampoQueFalta = { campo: string; etiqueta: string };

const SIEMPRE: Array<[keyof DatosExpediente, string]> = [
  ["numInforme", "Nº informe / certificado"],
  ["empresaCliente", "Empresa"],
  ["autorizaNombre", "Nombre de quien autoriza"],
  ["autorizaNif", "DNI / NIF de quien autoriza"],
  ["matricula", "Matrícula"],
  ["tacMarca", "Marca / fabricante"],
  ["tacModelo", "Modelo de la unidad"],
  ["tacSerie", "Nº de serie"],
  ["fechaInforme", "Fecha informe"],
  ["tecnico", "Técnico que interviene"],
];

const SOLO_TRANSFERENCIA: Array<[keyof DatosExpediente, string]> = [
  ["modalidadEntrega", "Modalidad de entrega"],
  ["fechaTransferencia", "Fecha de transferencia"],
];

const SOLO_INTRANSFERIBILIDAD: Array<[keyof DatosExpediente, string]> = [
  ["fechaEntrega", "Fecha entrega al cliente"],
  ["receptorNombre", "Nombre de la persona receptora"],
  ["receptorDni", "DNI de la persona receptora"],
];

function vacio(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * Qué falta para poder emitir los documentos.
 *
 * Devuelve la lista en vez de lanzar a la primera: la pantalla marca todos los
 * campos a la vez, como hace la columna de avisos de la hoja `DATOS`. Ir de uno
 * en uno obliga a guardar cuatro veces para enterarse de las cuatro cosas.
 */
export function camposQueFaltan(d: DatosExpediente): CampoQueFalta[] {
  const exigidos = [
    ...SIEMPRE,
    ...(d.tipo === "transferencia" ? SOLO_TRANSFERENCIA : SOLO_INTRANSFERIBILIDAD),
  ];
  return exigidos
    .filter(([campo]) => vacio(d[campo]))
    .map(([campo, etiqueta]) => ({ campo: String(campo), etiqueta }));
}

/** La matrícula va siempre en mayúsculas y sin espacios, como en los documentos. */
export function normalizarMatricula(v: string): string {
  return v.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Si se entrega el aparato al cliente no se achatarra, y al revés. Es una
 * función y no una columna a propósito: así no existe forma de guardar un
 * expediente que afirme las dos cosas.
 */
export function seAchatarra(entregaAparato: boolean): boolean {
  return !entregaAparato;
}

/**
 * Fecha a partir de la cual hay que destruir los archivos transferidos: un año
 * desde la transferencia (nota F del anexo II del RD 125/2017 y apartado 8.5.1
 * de la UNE 66102:2025).
 *
 * Devuelve `null` cuando no hubo transferencia — en una intransferibilidad no
 * hay archivo que custodiar, que es justo de lo que da fe el certificado.
 */
export function fechaLimiteDestruccion(fechaTransferencia: string | null): string | null {
  if (!fechaTransferencia) return null;
  const [a, m, d] = fechaTransferencia.split("-").map(Number);
  if (!a || !m || !d) return null;
  // Se construye en UTC para que el resultado no dependa de la zona horaria del
  // servidor: en Render corre en UTC y en un portátil español no.
  const limite = new Date(Date.UTC(a + 1, m - 1, d));
  return limite.toISOString().slice(0, 10);
}
