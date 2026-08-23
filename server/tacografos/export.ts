/**
 * Exportación del expediente a `.xlsx`.
 *
 * Es un respaldo, no un documento: lo que vale legalmente son los PDF emitidos,
 * con su hash. Esto sirve para llevarse el expediente a una hoja de cálculo —el
 * sitio donde vivía todo esto antes— y para adjuntarlo a un correo sin exponer
 * un enlace del almacenamiento.
 *
 * Por eso incluye el rastro documental: qué se emitió, cuándo, con qué versión
 * de plantilla y con qué hash. Un expediente exportado sin eso no permitiría
 * comprobar después que el PDF que alguien guarda es el que salió de aquí.
 */

import * as XLSX from "xlsx";
import { ETIQUETA_MODALIDAD, fechaLimiteDestruccion, seAchatarra } from "./domain.ts";
import { ETIQUETA_DOCUMENTO, fechaEs, type TipoDocumento } from "./documents.ts";
import type { Centro, Documento, Expediente } from "./repository.ts";

const ETIQUETA_TIPO: Record<Expediente["tipo"], string> = {
  transferencia: "Transferencia correcta",
  intransferibilidad: "Intransferibilidad",
};

const SI_NO = (v: boolean) => (v ? "Sí" : "No");

/** Ancho de las dos columnas de la hoja de datos, en caracteres. */
const ANCHOS = [{ wch: 34 }, { wch: 46 }];

export function componerXlsx(
  expediente: Expediente,
  centro: Centro,
  documentos: Documento[]
): Buffer {
  const e = expediente;

  const datos: Array<[string, string]> = [
    ["CENTRO TÉCNICO", ""],
    ["Empresa", centro.nombre],
    ["Centro técnico", centro.centroTecnico],
    ["Contraseña / nº de centro", centro.numCentro],
    ["Dirección", [centro.direccion1, centro.direccion2, centro.ciudad].filter(Boolean).join(", ")],
    ["Responsable técnico", centro.responsableTecnico],
    ["", ""],
    ["EXPEDIENTE", ""],
    ["Nº informe / certificado", e.numInforme],
    ["Tipo de operación", ETIQUETA_TIPO[e.tipo]],
    ["Estado", e.estado],
    ["Fecha informe", fechaEs(e.fechaInforme)],
    ["Técnico que interviene", e.tecnico],
    ["", ""],
    ["CLIENTE", ""],
    ["Empresa", e.empresaCliente],
    ["Nombre de quien autoriza", e.autorizaNombre],
    ["DNI / NIF de quien autoriza", e.autorizaNif],
    ["Documento de titularidad aportado", SI_NO(e.docTitularidad)],
    ["", ""],
    ["VEHÍCULO", ""],
    ["Matrícula", e.matricula],
    ["Nº de bastidor", e.bastidor],
    ["", ""],
    ["TACÓGRAFO SUSTITUIDO", ""],
    ["Marca / fabricante", e.tacMarca],
    ["Modelo de la unidad", e.tacModelo],
    ["Nº de serie", e.tacSerie],
    ["", ""],
  ];

  if (e.tipo === "transferencia") {
    const limite = fechaLimiteDestruccion(e.fechaTransferencia);
    datos.push(
      ["TRANSFERENCIA DE DATOS", ""],
      ["Fecha de transferencia", fechaEs(e.fechaTransferencia)],
      ["Fecha de envío", fechaEs(e.fechaEnvio)],
      [
        "Modalidad de entrega",
        e.modalidadEntrega ? ETIQUETA_MODALIDAD[e.modalidadEntrega] : "",
      ],
      ["Destruir los archivos a partir de", limite ? fechaEs(limite) : ""],
      ["", ""]
    );
  } else {
    datos.push(
      ["ENTREGA DEL CERTIFICADO", ""],
      ["Fecha de entrega", fechaEs(e.fechaEntrega)],
      ["Nombre de la persona receptora", e.receptorNombre],
      ["DNI de la persona receptora", e.receptorDni],
      ["", ""],
      ["TACÓGRAFO AVERIADO", ""],
      ["Se entrega al cliente", SI_NO(e.entregaAparato)],
      ["Se achatarrará", SI_NO(seAchatarra(e.entregaAparato))],
      ["", ""]
    );
  }

  if (e.destruccionFecha) {
    datos.push(
      ["DESTRUCCIÓN DE LOS ARCHIVOS", ""],
      ["Fecha de destrucción", fechaEs(e.destruccionFecha)],
      ["Método", e.destruccionMetodo],
      ["Persona que la realizó", e.destruccionPersona],
      ["Firma digital del archivo", e.destruccionHash],
      ["", ""]
    );
  }

  const hojaDatos = XLSX.utils.aoa_to_sheet(datos);
  hojaDatos["!cols"] = ANCHOS;

  const filas: Array<Array<string | number>> = [
    ["Documento", "Emitido", "Versión plantilla", "Estado", "Motivo de anulación", "SHA-256"],
    ...documentos.map((d) => [
      ETIQUETA_DOCUMENTO[d.tipo as TipoDocumento] ?? d.tipo,
      // El instante de emisión con hora: dos documentos del mismo día se
      // distinguen por ella, y es lo que ordena el rastro.
      new Date(d.emitidoAtMs).toLocaleString("es-ES"),
      d.plantillaVersion,
      d.anulado ? "Anulado" : "Vigente",
      d.motivoAnulacion,
      d.hash,
    ]),
  ];
  const hojaDocs = XLSX.utils.aoa_to_sheet(filas);
  hojaDocs["!cols"] = [{ wch: 34 }, { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 34 }, { wch: 66 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hojaDatos, "EXPEDIENTE");
  XLSX.utils.book_append_sheet(libro, hojaDocs, "DOCUMENTOS");

  return XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Nombre del fichero que se descarga. */
export function nombreFichero(e: Expediente): string {
  const limpio = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
  return `expediente-${limpio(e.numInforme || "sin-numero")}-${limpio(e.matricula)}.xlsx`;
}
