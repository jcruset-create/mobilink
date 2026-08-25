/**
 * Lectura del **informe técnico** que emite la extranet de VDO (el impreso
 * A/B/C…W de la intervención, `InfTec_*.pdf`).
 *
 * Es el otro documento que el técnico tiene a mano, y trae nueve de los campos
 * del expediente. Lo que NO trae es la casilla 22 del anexo II —si fue posible
 * transferir—, así que de aquí nunca sale el tipo de operación: lo decide el
 * técnico.
 *
 * Las etiquetas con clave `_` son sólo cortes: delimitan el valor anterior y
 * no se guardan. Sin ellas, el valor de un campo arrastraría media sección.
 */

import { cotejar, fechaAIso, type Campos, type Lectura } from "./cotejo.ts";
import type { DatosExpediente } from "./domain.ts";

const ETIQUETAS: Array<{ clave: string; etiqueta: string }> = [
  { clave: "numInforme", etiqueta: "A1. Nº de orden de la intervención:" },
  { clave: "_a2", etiqueta: "A2. Nº interno de orden:" },
  { clave: "fechaCabecera", etiqueta: "A3. Fecha:" },
  { clave: "_b", etiqueta: "B. IDENTIFICACIÓN DEL CENTRO TÉCNICO" },
  { clave: "centroNombre", etiqueta: "B4. Razón social del C.T.:" },
  { clave: "centroContrasena", etiqueta: "B5. Contraseña asignada:" },
  { clave: "_b6", etiqueta: "B6. Provincia donde está ubicado:" },
  { clave: "tecnico", etiqueta: "C11. Nombre y apellidos:" },
  { clave: "_c12", etiqueta: "C12. Identificación completa de la" },
  { clave: "matricula", etiqueta: "E22. Matrícula:" },
  { clave: "_e23", etiqueta: "E23. Fecha de primera matriculación" },
  { clave: "bastidor", etiqueta: "Bastidor:" },
  { clave: "_e24", etiqueta: "E24. Marca:" },
  { clave: "titular", etiqueta: "E25. Titular:" },
  { clave: "_modelo", etiqueta: "Modelo:" },
  { clave: "_categoria", etiqueta: "Categoría:" },
  { clave: "tacMarca", etiqueta: "I40. Nombre del fabricante:" },
  { clave: "tacModelo", etiqueta: "I41. Número de pieza de la VU:" },
  { clave: "_i42", etiqueta: "I42. Número de homologación de la VU:" },
  { clave: "tacSerie", etiqueta: "I43. Número de serie de la VU:" },
  { clave: "_i44", etiqueta: "I44. Fecha activación unidad instalada" },
];

export type LecturaInfTec = Lectura;

export function parsearInfTec(texto: string): LecturaInfTec {
  const lectura = cotejar(texto, ETIQUETAS);
  // Los cortes no cuentan como hallazgo ni como aviso: son andamiaje. Si se
  // contaran, un documento ajeno con la palabra «Modelo:» parecería medio
  // informe técnico.
  const utiles = ETIQUETAS.filter((e) => !e.clave.startsWith("_"));
  const avisos = lectura.avisos.filter((a) => utiles.some((e) => e.etiqueta === a));
  return {
    campos: Object.fromEntries(utiles.map((e) => [e.clave, lectura.campos[e.clave] ?? ""])),
    avisos,
    encontradas: utiles.length - avisos.length,
    total: utiles.length,
  };
}

/**
 * El titular llega como «(CIF) RAZÓN SOCIAL DIRECCIÓN, Nº. CP MUNICIPIO - Prov».
 *
 * Se quita el CIF del principio. Para separar la razón social de la dirección
 * se corta tras la **forma jurídica** (S.L., S.A., S.L.U., S.COOP…), que es
 * donde acaba el nombre en la extranet; un intento anterior de reconocer la
 * dirección por «calle, número» se comía media razón social, porque el nombre
 * también puede llevar comas y palabras largas sin coma.
 *
 * Sin forma jurídica —un autónomo—, se corta en la coma anterior al código
 * postal, lo que deja pegada la calle. Se asume: el sobrante se VE en el
 * formulario y el técnico lo recorta; nunca se pierde nada en silencio.
 */
const FORMA_JURIDICA = /\b(?:S\.\s?L\.\s?U\.?|S\.\s?L\.?|S\.\s?A\.\s?U\.?|S\.\s?A\.?|S\.?\s?COOP\.?|S\.\s?C\.\s?C\.\s?L\.?|S\.\s?C\.\s?P\.?|C\.\s?B\.?)(?=\s|$)/i;

export function limpiarTitular(bruto: string): string {
  const sinCif = bruto.replace(/^\([^)]*\)\s*/, "").trim();
  const forma = FORMA_JURIDICA.exec(sinCif);
  if (forma) return sinCif.slice(0, forma.index + forma[0].length).trim();
  const cp = sinCif.search(/\b\d{5}\b/);
  if (cp > 0) {
    const coma = sinCif.lastIndexOf(",", cp);
    if (coma > 0) return sinCif.slice(0, coma).trim();
  }
  return sinCif;
}

/** Traduce lo leído a los campos del expediente. Sin tipo: aquí no viene. */
export function aDatosExpedienteInfTec(campos: Campos): Partial<DatosExpediente> {
  return {
    numInforme: campos.numInforme ?? "",
    empresaCliente: limpiarTitular(campos.titular ?? ""),
    matricula: (campos.matricula ?? "").toUpperCase(),
    bastidor: campos.bastidor ?? "",
    tacMarca: campos.tacMarca ?? "",
    tacModelo: campos.tacModelo ?? "",
    tacSerie: campos.tacSerie ?? "",
    tecnico: campos.tecnico ?? "",
    fechaInforme: fechaAIso(campos.fechaCabecera ?? ""),
  };
}
