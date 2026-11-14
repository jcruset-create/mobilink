/**
 * El informe de intervenciones del centro técnico, leído.
 *
 * ── La forma del fichero, que no es la de una tabla ─────────────────────────
 *
 * La cabecera NO está en la primera fila. El Excel que exporta la extranet
 * trae tres filas antes de los datos:
 *
 *   1 · «Registro Intervenciones entre fechas (01-01-2022 / 04-11-2026)»
 *   2 · los bloques: «(A) Intervención», «Medición», «(E) Vehículo»…
 *   3 · las 52 etiquetas de columna: «(A3) Fecha», «(A1) ID intervención»…
 *
 * Leerlo como una tabla normal da 52 columnas llamadas `__EMPTY_n` y una
 * primera fila de datos que en realidad son los nombres. Por eso la cabecera
 * se BUSCA por su contenido en vez de darla por hecha en una fila concreta:
 * el día que la extranet añada una línea al título, esto sigue funcionando.
 *
 * ── Y las columnas se leen por su nombre, no por su posición ────────────────
 *
 * Mismo motivo. Una columna nueva en medio desplaza todas las de su derecha, y
 * un parser por posición empezaría a guardar el número de serie del sensor en
 * el campo del GNSS sin dar un solo error.
 *
 * ── Esto no habla con la base ───────────────────────────────────────────────
 *
 * Entran las filas del Excel, sale una lista tipada y una lista de problemas.
 * El cruce con los vehículos, los duplicados y los permisos son de otro
 * módulo: aquí solo se lee, se normaliza y se dice lo que no se ha entendido.
 */

import { normalizarMatricula } from "../matricula.ts";
import { normalizar as normalizarMedida } from "./medidas.ts";

/** Las etiquetas que tiene que haber para dar el fichero por bueno. */
const OBLIGATORIAS = ["(A1) ID intervención", "(A3) Fecha", "Matrícula"] as const;

/** Etiqueta del Excel → campo. Lo que no está aquí no se guarda. */
const COLUMNAS = {
  "(A3) Fecha": "fecha",
  "(A1) ID intervención": "idOrigen",
  "(A2) Orden trabajo": "ordenTrabajo",
  "(D) Tipo operación": "tipoOperacion",
  "L (vieja)": "paramLAnterior",
  "L (nueva)": "paramL",
  "W (vieja)": "paramWAnterior",
  "W (nueva)": "paramW",
  "K": "paramK",
  "Neumáticos (viejos)": "medidaAnterior",
  "Neumáticos (nuevos)": "medida",
  "Cuentakm (viejo)": "kmAnterior",
  "Cuentakm (nuevo)": "kmNuevo",
  "Resultado": "resultado",
  "B. rodillos": "bRodillos",
  "Eq. calibrado": "eqCalibrado",
  "Manómetro": "manometro",
  "Cronómetro": "cronometro",
  "Marca": "marca",
  "Modelo": "modelo",
  "Matrícula": "matricula",
  "Bastidor": "bastidor",
  "Categoría (tipo de carga)": "categoria",
  "Tipo tacógrafo": "tipoTacografo",
  "Fabricante": "fabricante",
  "Referencia": "referencia",
  "Versión software": "version",
  "Versión mapa": "versionMapa",
  "Núm. serie": "numSerie",
  "GNSS": "gnss",
  "DSRC": "dsrc",
  "Núm. serie sensor": "numSensor",
  "Núm. serie precintos instalados": "precintos",
  "Nombre": "clienteNombre",
  "(C11) Nombre técnico": "tecnico",
  "Id. tarjeta técnico": "tecnicoTarjeta",
  "Cad. tarjeta": "tecnicoTarjetaCad",
  "Versión tarjeta": "tecnicoTarjetaVer",
  "Observaciones": "observaciones",
} as const;

/**
 * Las comprobaciones van juntas en un jsonb y no en once columnas.
 *
 * Solo las llevan los tacógrafos inteligentes recientes: entre 16 y 36 filas
 * de 1.744. Once columnas vacías en el 98% de la tabla son once columnas que
 * nadie consulta.
 */
const COMPROBACIONES = {
  "Test GNSS (resultado/lat./long./desv)": "gnss",
  "Test DSRC (resultado/fecha y hora)": "dsrc",
  "Test Bluetooth (resultado)": "bluetooth",
  "Test giroscopio (resultado)": "giroscopio",
  "Test reloj (desviación)": "reloj",
  "(L) Velocidad 40-80-125 km/h.": "velocidad",
  "Limitador velocidad (Sí/No)": "limitador",
  "Distancia recorrida tacógrafo": "distanciaTacografo",
  "Distancia recorrida banco": "distanciaBanco",
  "Distancia-Error%": "distanciaError",
} as const;

export interface FilaTacografo {
  /** Fila del Excel, 1-indexada, para poder señalarla en el informe. */
  fila: number;
  idOrigen: string;
  fecha: string | null;
  tipoOperacion: string | null;
  resultado: string | null;
  ordenTrabajo: string | null;

  matriculaOrigen: string | null;
  matriculaNorm: string;
  bastidor: string | null;
  marca: string | null;
  modelo: string | null;
  categoria: string | null;
  clienteNombre: string | null;

  medidaOrigen: string | null;
  medidaNorm: string | null;
  /** true si venía medida y no se ha sabido leer: se guarda y se pregunta. */
  medidaSospechosa: boolean;
  medidaAnteriorOrigen: string | null;
  medidaAnteriorNorm: string | null;

  kmAnterior: number | null;
  kmNuevo: number | null;

  paramL: string | null;
  paramW: string | null;
  paramK: string | null;
  paramLAnterior: string | null;
  paramWAnterior: string | null;

  tipoTacografo: string | null;
  fabricante: string | null;
  referencia: string | null;
  version: string | null;
  versionMapa: string | null;
  numSerie: string | null;
  numSensor: string | null;
  gnss: string | null;
  dsrc: string | null;
  precintos: string | null;

  bRodillos: string | null;
  eqCalibrado: string | null;
  manometro: string | null;
  cronometro: string | null;

  tecnico: string | null;
  tecnicoTarjeta: string | null;
  tecnicoTarjetaCad: string | null;
  tecnicoTarjetaVer: string | null;

  observaciones: string | null;
  /** El `.tgd` que el centro cita dentro de las observaciones. */
  tgdFichero: string | null;
  comprobaciones: Record<string, string> | null;
}

export interface Problema {
  fila: number;
  motivo: string;
  /** Lo que había, recortado: sirve para entender el aviso sin abrir el Excel. */
  valor?: string;
}

export interface Lectura {
  filas: FilaTacografo[];
  problemas: Problema[];
  /** Fila del Excel donde se encontró la cabecera, 1-indexada. */
  filaCabecera: number;
  /** Etiquetas del fichero que este parser no conoce. */
  columnasDesconocidas: string[];
  /** Columnas totales del fichero y de ellas, cuántas se aprovechan. */
  columnas: number;
  columnasUsadas: number;
  nombreHoja: string;
}

export class ErrorFichero extends Error {}

const texto = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === "" ? null : s;
};

/** La etiqueta de una columna, comparable: sin acentos, sin dobles espacios. */
const clave = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Una fecha ISO, o `null`.
 *
 * El Excel trae `Date` cuando se lee con `cellDates`, pero una exportación
 * vieja puede traerla como texto `dd-mm-aaaa`. Las dos se aceptan; cualquier
 * otra cosa es un problema que se dice, no una fecha inventada.
 */
export function fechaDe(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Un número, o `null`. No se convierte el vacío en cero. */
export function numeroDe(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** El `.tgd` que el centro cita en las observaciones, si lo cita. */
export function tgdDe(observaciones: string | null): string | null {
  if (!observaciones) return null;
  const m = observaciones.match(/([A-Za-z0-9_\- ]+\.tgd)\b/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

/**
 * Dónde está la cabecera.
 *
 * Es la primera fila que contiene las tres etiquetas obligatorias. Buscarla
 * en vez de darla por hecha cuesta un recorrido de diez filas y evita que una
 * línea de más en el título rompa la importación entera.
 */
function buscarCabecera(hoja: unknown[][]): number {
  const buscadas = OBLIGATORIAS.map(clave);
  for (let i = 0; i < Math.min(hoja.length, 20); i += 1) {
    const etiquetas = (hoja[i] ?? []).map(clave);
    if (buscadas.every((b) => etiquetas.includes(b))) return i;
  }
  throw new ErrorFichero(
    `No se encuentra la cabecera del informe. Tiene que haber una fila con ${
      OBLIGATORIAS.map((o) => `«${o}»`).join(", ")}.`);
}

/**
 * Lee la hoja.
 *
 * `hoja` es lo que devuelve `XLSX.utils.sheet_to_json(ws, { header: 1 })`:
 * una matriz de filas. No se le pasa el fichero porque leer un Excel y
 * entenderlo son dos cosas, y solo la segunda se puede probar sin un binario.
 */
export function leerHoja(hoja: unknown[][], nombreHoja = "Hoja1"): Lectura {
  const iCab = buscarCabecera(hoja);
  const etiquetas = (hoja[iCab] ?? []).map((e) => String(e ?? "").trim());

  // Etiqueta normalizada → índice de columna. La primera gana: el informe
  // trae «Nombre» (cliente) y «(B4) Nombre» (taller), que no chocan, pero una
  // exportación futura podría repetir una de verdad.
  const indice = new Map<string, number>();
  etiquetas.forEach((e, i) => { const k = clave(e); if (k && !indice.has(k)) indice.set(k, i); });

  const col = (etiqueta: string): number | undefined => indice.get(clave(etiqueta));
  const conocidas = new Set([...Object.keys(COLUMNAS), ...Object.keys(COMPROBACIONES),
    "(B4) Nombre", "(B8) Dirección", "(B5) Contraseña"].map(clave));
  const columnasDesconocidas = etiquetas.filter((e) => e && !conocidas.has(clave(e)));

  const problemas: Problema[] = [];
  const filas: FilaTacografo[] = [];

  for (let i = iCab + 1; i < hoja.length; i += 1) {
    const cruda = hoja[i];
    if (!cruda || !cruda.some((v) => v !== null && v !== undefined && v !== "")) continue;
    const nFila = i + 1;
    const v = (etiqueta: string): unknown => {
      const c = col(etiqueta);
      return c === undefined ? null : cruda[c];
    };

    const idOrigen = texto(v("(A1) ID intervención"));
    if (!idOrigen) {
      problemas.push({ fila: nFila, motivo: "Sin ID de intervención: no se puede identificar" });
      continue;
    }

    const matriculaOrigen = texto(v("Matrícula"));
    const matriculaNorm = normalizarMatricula(matriculaOrigen);
    if (!matriculaNorm) {
      problemas.push({ fila: nFila, motivo: "Sin matrícula", valor: idOrigen });
      continue;
    }

    const fecha = fechaDe(v("(A3) Fecha"));
    if (!fecha) {
      problemas.push({ fila: nFila, motivo: "Sin fecha o con una que no se entiende",
                       valor: texto(v("(A3) Fecha")) ?? idOrigen });
    }

    const medidaOrigen = texto(v("Neumáticos (nuevos)"));
    const medidaNorm = normalizarMedida(medidaOrigen);
    if (medidaOrigen && !medidaNorm) {
      problemas.push({ fila: nFila, motivo: "Medida de neumático que no se sabe leer",
                       valor: medidaOrigen });
    }
    const medidaAnteriorOrigen = texto(v("Neumáticos (viejos)"));

    const comprobaciones: Record<string, string> = {};
    for (const [etiqueta, campo] of Object.entries(COMPROBACIONES)) {
      const t = texto(v(etiqueta));
      if (t !== null) comprobaciones[campo] = t;
    }

    const observaciones = texto(v("Observaciones"));

    filas.push({
      fila: nFila,
      idOrigen,
      fecha,
      tipoOperacion: texto(v("(D) Tipo operación")),
      resultado: texto(v("Resultado")),
      ordenTrabajo: texto(v("(A2) Orden trabajo")),

      matriculaOrigen,
      matriculaNorm,
      bastidor: texto(v("Bastidor"))?.toUpperCase() ?? null,
      marca: texto(v("Marca")),
      modelo: texto(v("Modelo")),
      categoria: texto(v("Categoría (tipo de carga)")),
      clienteNombre: texto(v("Nombre")),

      medidaOrigen,
      medidaNorm,
      medidaSospechosa: Boolean(medidaOrigen) && medidaNorm === null,
      medidaAnteriorOrigen,
      medidaAnteriorNorm: normalizarMedida(medidaAnteriorOrigen),

      kmAnterior: numeroDe(v("Cuentakm (viejo)")),
      kmNuevo: numeroDe(v("Cuentakm (nuevo)")),

      paramL: texto(v("L (nueva)")),
      paramW: texto(v("W (nueva)")),
      paramK: texto(v("K")),
      paramLAnterior: texto(v("L (vieja)")),
      paramWAnterior: texto(v("W (vieja)")),

      tipoTacografo: texto(v("Tipo tacógrafo")),
      fabricante: texto(v("Fabricante")),
      referencia: texto(v("Referencia")),
      version: texto(v("Versión software")),
      versionMapa: texto(v("Versión mapa")),
      numSerie: texto(v("Núm. serie")),
      numSensor: texto(v("Núm. serie sensor")),
      gnss: texto(v("GNSS")),
      dsrc: texto(v("DSRC")),
      precintos: texto(v("Núm. serie precintos instalados")),

      bRodillos: texto(v("B. rodillos")),
      eqCalibrado: texto(v("Eq. calibrado")),
      manometro: texto(v("Manómetro")),
      cronometro: texto(v("Cronómetro")),

      tecnico: texto(v("(C11) Nombre técnico")),
      tecnicoTarjeta: texto(v("Id. tarjeta técnico")),
      tecnicoTarjetaCad: fechaDe(v("Cad. tarjeta")),
      tecnicoTarjetaVer: texto(v("Versión tarjeta")),

      observaciones,
      tgdFichero: tgdDe(observaciones),
      comprobaciones: Object.keys(comprobaciones).length > 0 ? comprobaciones : null,
    });
  }

  // Un mismo ID dos veces dentro del propio fichero: se queda la primera y se
  // dice. Dejar pasar las dos haría que la segunda pisara a la primera al
  // grabar, en silencio.
  const vistos = new Set<string>();
  const unicas: FilaTacografo[] = [];
  for (const f of filas) {
    if (vistos.has(f.idOrigen)) {
      problemas.push({ fila: f.fila, motivo: "ID de intervención repetido dentro del fichero",
                       valor: f.idOrigen });
      continue;
    }
    vistos.add(f.idOrigen);
    unicas.push(f);
  }

  return {
    filas: unicas,
    problemas,
    filaCabecera: iCab + 1,
    columnasDesconocidas,
    columnas: etiquetas.filter(Boolean).length,
    columnasUsadas: [...conocidas].filter((k) => indice.has(k)).length,
    nombreHoja,
  };
}
