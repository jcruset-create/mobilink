/**
 * Lectura del informe/certificado del anexo II que emite la extranet de VDO.
 *
 * El técnico ya tiene ese impreso cuando llega aquí: volver a teclear la
 * matrícula, el bastidor y el nº de serie es donde se cuelan las erratas que
 * luego aparecen en un certificado firmado. Esto los copia.
 *
 * Es un analizador de **texto**, sin PDF ni red, para que se pueda probar con
 * un fixture y para que el día que cambie el formato del impreso se vea aquí y
 * en un solo sitio.
 *
 * Criterio de diseño: **nunca adivina**. Un campo que no encuentra se queda
 * vacío y se anota en `avisos`; lo que lee se le enseña al técnico para que lo
 * confirme antes de guardar. En documentación legal, un dato mal leído en
 * silencio es peor que teclearlo.
 */

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

/** Quita acentos y colapsa espacios, para que el cotejo no dependa del OCR. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Versión normalizada del texto **con un mapa de vuelta al original**.
 *
 * Hace falta porque el cotejo se hace sin acentos y con los espacios
 * colapsados, pero el valor hay que recortarlo del original —con sus tildes—.
 * La primera versión daba por hecho que normalizar no cambiaba la longitud y
 * recortaba con los índices de la normalizada: falso en cuanto hay un salto de
 * línea doble o una ligadura, y entonces el recorte sale desplazado unos
 * caracteres («o: 8843KWW» en vez de «8843KWW»). Lo cazó la suite completa,
 * donde el texto llegaba con otro espaciado.
 *
 * `mapa[i]` es el índice en el original del carácter normalizado `i`. El
 * último elemento es el centinela: la longitud del original.
 */
function indexar(texto: string): { norm: string; mapa: number[] } {
  let norm = "";
  const mapa: number[] = [];
  let veniaEspacio = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (/\s/.test(c)) {
      // Una tirada de espacios, tabuladores y saltos vale por un espacio.
      if (!veniaEspacio) {
        norm += " ";
        mapa.push(i);
        veniaEspacio = true;
      }
      continue;
    }
    veniaEspacio = false;
    // Un carácter puede normalizarse a cero (una tilde suelta) o a varios: se
    // apuntan todos al mismo sitio del original.
    for (const b of normalizar(c)) {
      norm += b;
      mapa.push(i);
    }
  }
  mapa.push(texto.length);
  return { norm, mapa };
}

export type CamposAnexoII = Record<string, string>;

export type LecturaAnexoII = {
  campos: CamposAnexoII;
  /** Etiquetas que no se han encontrado en el documento. */
  avisos: string[];
  /** Cuántas de las etiquetas esperadas se han localizado. */
  encontradas: number;
  total: number;
};

/**
 * Localiza cada etiqueta y se queda con lo que hay entre ella y la siguiente.
 *
 * Se busca cada etiqueta por separado, no en orden: el impreso va a dos
 * columnas y el texto que sale del PDF las entrelaza, así que dar por hecho el
 * orden de lectura es justo lo que falla.
 */
export function parsearAnexoII(texto: string): LecturaAnexoII {
  const original = texto.replace(/\r/g, "");
  const { norm, mapa } = indexar(original);

  const campos: CamposAnexoII = {};
  const avisos: string[] = [];
  let encontradas = 0;

  const posiciones = ETIQUETAS.map(({ clave, etiqueta }) => {
    const buscada = normalizar(etiqueta);
    return { clave, etiqueta, i: norm.indexOf(buscada), largo: buscada.length };
  });

  for (const p of posiciones) {
    if (p.i < 0) {
      campos[p.clave] = "";
      avisos.push(p.etiqueta);
      continue;
    }
    encontradas++;
    // La siguiente etiqueta que aparezca después de ésta corta el valor.
    const siguiente = posiciones
      .filter((o) => o.i > p.i)
      .reduce((min, o) => (min < 0 || o.i < min ? o.i : min), -1);

    const desde = mapa[p.i + p.largo] ?? original.length;
    const hasta = siguiente > 0 ? (mapa[siguiente] ?? original.length) : original.length;
    campos[p.clave] = limpiarValor(original.slice(desde, hasta));
  }

  return { campos, avisos, encontradas, total: ETIQUETAS.length };
}

/**
 * Deja el valor en una línea.
 *
 * El recorte arrastra la numeración de la etiqueta siguiente («8843KWW\n2.»),
 * los dos puntos sueltos y los rótulos de sección del impreso; todo eso se
 * quita aquí y no en el cotejo, para que el cotejo siga siendo una búsqueda
 * simple de texto.
 */
function limpiarValor(bruto: string): string {
  return bruto
    .replace(/^[:\s]+/, "")
    .replace(/\n\s*\d{1,2}[.)]?\s*$/, "")
    .replace(/(DATOS DE LA UNIDAD|DATOS DEL CENTRO|DETALLES DE LA TRANSFERENCIA|DECLARACIÓN|DATOS DEL VEHÍCULO)[\s\S]*$/i, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s*\d{1,2}[.)]\s*$/, "")
    .trim();
}

/** `dd-mm-aaaa`, `dd/mm/aaaa` o `aaaa-mm-dd`, con hora opcional, a `aaaa-mm-dd`. */
export function fechaAIso(valor: string): string | null {
  const s = valor.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (!m) return null;
  const dos = (n: string) => n.padStart(2, "0");
  return `${m[3]}-${dos(m[2])}-${dos(m[1])}`;
}

/** `SÍ`/`NO` del impreso a booleano. Devuelve null si no dice ninguna de las dos. */
export function siNo(valor: string): boolean | null {
  const v = normalizar(valor);
  if (/^s[ií]?\b/.test(v)) return true;
  if (/^no\b/.test(v)) return false;
  return null;
}

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
