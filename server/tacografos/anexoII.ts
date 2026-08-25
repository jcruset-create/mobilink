/**
 * Lectura del informe/certificado del anexo II que emite la extranet de VDO.
 *
 * El técnico ya tiene ese impreso cuando llega aquí: volver a teclear la
 * matrícula, el bastidor y el nº de serie es donde se cuelan las erratas que
 * luego aparecen en un certificado firmado. Esto los copia.
 *
 * El motor de cotejo vive en `cotejo.ts`; aquí sólo están las etiquetas de
 * este impreso y su traducción a los campos del expediente. El otro impreso de
 * la extranet —el informe técnico— tiene su lista en `infTec.ts`.
 */

import { cotejar, fechaAIso, siNo, type Campos, type Lectura } from "./cotejo.ts";
import type { DatosExpediente } from "./domain.ts";

/** Las etiquetas del impreso, tal y como aparecen. */
const ETIQUETAS: Array<{ clave: string; etiqueta: string }> = [
  { clave: "numInforme", etiqueta: "NÚMERO DE INFORME / CERTIFICADO:" },
  { clave: "fechaCabecera", etiqueta: "Fecha:" },
  { clave: "matricula", etiqueta: "Número de matrícula del vehículo:" },
  { clave: "bastidor", etiqueta: "Número de bastidor del vehículo:" },
  { clave: "fabricanteVehiculo", etiqueta: "Fabricante del vehículo:" },
  { clave: "modeloVehiculo", etiqueta: "Modelo del vehículo:" },
  { clave: "empresaCliente", etiqueta: "Nombre de la empresa de transportes:" },
  { clave: "direccionEmpresa", etiqueta: "Dirección de la empresa de transportes:" },
  { clave: "tarjetaEmpresa", etiqueta: "Detalles de la tarjeta de empresa:" },
  { clave: "centroNombre", etiqueta: "Nombre del Centro Técnico:" },
  { clave: "centroDireccion", etiqueta: "Dirección del Centro Técnico:" },
  { clave: "centroContrasena", etiqueta: "Contraseña del Centro Técnico:" },
  { clave: "centroTarjeta", etiqueta: "Detalles de la tarjeta del Centro Técnico:" },
  // Ojo: en el impreso este va sin dos puntos.
  { clave: "tecnico", etiqueta: "Nombre del técnico que interviene" },
  { clave: "tacMarca", etiqueta: "Nombre del fabricante del tacógrafo:" },
  { clave: "tacModelo", etiqueta: "Modelo de la unidad:" },
  { clave: "tacSerie", etiqueta: "Número de serie de la unidad:" },
  { clave: "fabricacionUnidad", etiqueta: "Fecha de fabricación de la unidad:" },
  { clave: "situacionCabina", etiqueta: "Situación de la unidad en la cabina:" },
  { clave: "homologacion", etiqueta: "Marca de homologación de la unidad:" },
  { clave: "visibilidadPlaca", etiqueta: "Visibilidad de la placa (Req. 169/170):" },
  { clave: "verPantalla", etiqueta: "¿Se ven los datos en pantalla?" },
  { clave: "imprimir", etiqueta: "¿Era posible imprimir los datos?" },
  { clave: "transferir", etiqueta: "¿Era posible transferir los datos?" },
  { clave: "descargaCompleta", etiqueta: "¿Se pudieron descargar todos los datos?" },
  { clave: "motivoNo", etiqueta: "En caso negativo de 23, ¿por qué?" },
  {
    clave: "fechaTransferencia",
    etiqueta: "Fecha de transferencia de los datos desde la unidad intravehicular:",
  },
  { clave: "enviados", etiqueta: "¿Han sido los datos enviados a la empresa?" },
  { clave: "fechaEnvio", etiqueta: "Fecha de envío:" },
];

export type CamposAnexoII = Campos;
export type LecturaAnexoII = Lectura;

export function parsearAnexoII(texto: string): LecturaAnexoII {
  return cotejar(texto, ETIQUETAS);
}

// Reexportados aquí porque nacieron en este fichero y los usan las pruebas.
export { fechaAIso, siNo };

/**
 * Traduce lo leído a los campos del expediente.
 *
 * Sólo los que este módulo guarda: el resto del anexo II —dirección de la
 * empresa, tarjetas, homologación— vive en la extranet y aquí no se copia.
 *
 * El tipo de operación sale de la casilla 22: es la que decide si el impreso
 * funciona como informe de transferencia o como certificado de
 * intransferibilidad.
 */
export function aDatosExpediente(campos: CamposAnexoII): Partial<DatosExpediente> {
  const transferible = siNo(campos.transferir ?? "");
  const salida: Partial<DatosExpediente> = {
    numInforme: campos.numInforme ?? "",
    empresaCliente: campos.empresaCliente ?? "",
    matricula: (campos.matricula ?? "").toUpperCase(),
    bastidor: campos.bastidor ?? "",
    tacMarca: campos.tacMarca ?? "",
    tacModelo: campos.tacModelo ?? "",
    tacSerie: campos.tacSerie ?? "",
    tecnico: campos.tecnico ?? "",
    fechaInforme: fechaAIso(campos.fechaCabecera ?? ""),
    fechaTransferencia: fechaAIso(campos.fechaTransferencia ?? ""),
    fechaEnvio: fechaAIso(campos.fechaEnvio ?? ""),
  };
  if (transferible !== null) {
    salida.tipo = transferible ? "transferencia" : "intransferibilidad";
  }
  return salida;
}
