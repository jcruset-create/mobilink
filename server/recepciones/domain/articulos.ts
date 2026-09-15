/**
 * La descripción del proveedor, leída para enseñarla bien y para sugerir un
 * artículo de Mobilink.
 *
 * Código puro. Soledad describe un neumático así:
 *
 *     245/70X17.5 HANKOOK AH35 136M
 *
 * De ahí se saca la medida (con la X convertida a R y la coma a punto, igual
 * que hace `shared/medidas.ts`), la marca, el modelo y el índice. Lo que no se
 * reconoce se deja en `resto` y NO se inventa: una descripción que no encaja
 * en el molde se enseña tal cual, que para recepcionar es suficiente.
 *
 * `descripcionNormalizada` es la clave del mapeo proveedor → artículo: la
 * misma descripción con distinta puntuación tiene que dar la misma clave para
 * que el mapeo confirmado una vez valga para siempre.
 */

import { medidaCanonica } from "../../../shared/medidas.ts";

export type ArticuloLeido = {
  /** «245/70R17.5», o null si no se ha visto una medida. */
  medida: string | null;
  marca: string | null;
  modelo: string | null;
  /** «136M», «156/150L»… */
  indice: string | null;
  /** Lo que no se ha sabido colocar, en orden. */
  resto: string[];
  /** «HANKOOK AH35 245/70 R17.5 136M», para la pantalla y el sello. */
  bonito: string;
};

const MEDIDA = /^(\d{2,3})\/(\d{2,3})\s*[XxRr]\s*(\d{1,2}(?:[.,]\d)?)$/;
const MEDIDA_SIN_PERFIL = /^(\d{2,3})\s*[XxRr]\s*(\d{1,2}(?:[.,]\d)?)$/;
const INDICE = /^\d{2,3}(?:\/\d{2,3})?[A-Z]$/;

/** Marcas que se reconocen sin dudar. Lo que no esté aquí puede seguir siendo marca: ver abajo. */
const MARCAS = [
  "HANKOOK", "MICHELIN", "CONTINENTAL", "BRIDGESTONE", "GOODYEAR", "DUNLOP", "PIRELLI",
  "SAILUN", "FIRESTONE", "KUMHO", "YOKOHAMA", "NOKIAN", "FULDA", "BARUM", "SEMPERIT",
  "UNIROYAL", "MATADOR", "KORMORAN", "TAURUS", "APOLLO", "GITI", "AEOLUS", "WESTLAKE",
  "DOUBLE COIN", "LINGLONG", "TRIANGLE", "FALKEN", "TOYO", "NEXEN", "GENERAL", "BFGOODRICH",
];

export function leerDescripcion(descripcion: unknown): ArticuloLeido {
  const texto = String(descripcion ?? "").replace(/\s+/g, " ").trim();
  const vacio: ArticuloLeido = { medida: null, marca: null, modelo: null, indice: null, resto: [], bonito: texto };
  if (!texto) return vacio;

  /*
   * «245/70 R17.5» viene a veces con un espacio antes de la R: se vuelve a
   * pegar ANTES de partir por espacios, o la medida se leería en dos trozos.
   */
  const partes = texto
    .toUpperCase()
    .replace(/(\d{2,3}(?:\/\d{2,3})?)\s*[XR]\s*(\d{1,2}(?:[.,]\d)?)/g, "$1R$2")
    .split(" ");
  let medida: string | null = null;
  let marca: string | null = null;
  let modelo: string | null = null;
  let indice: string | null = null;
  const resto: string[] = [];

  for (let i = 0; i < partes.length; i += 1) {
    const p = partes[i];
    if (!medida) {
      const m = p.match(MEDIDA);
      if (m) {
        medida = medidaCanonica(`${m[1]}/${m[2]}R${m[3]}`);
        continue;
      }
      const m2 = p.match(MEDIDA_SIN_PERFIL);
      if (m2) {
        medida = medidaCanonica(`${m2[1]}R${m2[2]}`);
        continue;
      }
    }
    if (!marca) {
      // Marcas de dos palabras («DOUBLE COIN») se miran antes que las de una.
      const dos = i + 1 < partes.length ? `${p} ${partes[i + 1]}` : "";
      if (dos && MARCAS.includes(dos)) {
        marca = dos;
        i += 1;
        continue;
      }
      if (MARCAS.includes(p)) {
        marca = p;
        continue;
      }
    }
    if (!indice && INDICE.test(p)) {
      indice = p;
      continue;
    }
    if (marca && !modelo) {
      modelo = p;
      continue;
    }
    resto.push(p);
  }

  /*
   * Sin marca reconocida: si hay medida y quedan al menos dos palabras que no
   * son índice, la primera es la marca y la segunda el modelo. Es lo que
   * escribe cualquier proveedor de neumáticos, y una marca nueva no puede
   * dejar la descripción sin leer.
   */
  if (!marca && medida && resto.length >= 2) {
    marca = resto.shift() ?? null;
    modelo = resto.shift() ?? null;
  }

  const medidaBonita = medida ? medida.replace("R", " R") : null;
  const bonito = [marca, modelo, medidaBonita, indice, ...resto].filter(Boolean).join(" ") || texto;
  return { medida, marca, modelo, indice, resto, bonito };
}

/**
 * La clave del mapeo: mayúsculas, sin puntuación, con la medida canónica. Dos
 * descripciones que sólo se distinguen en espacios o en «X» frente a «R» dan
 * la misma clave.
 */
export function descripcionNormalizada(descripcion: unknown): string {
  const leido = leerDescripcion(descripcion);
  const base = [leido.marca, leido.modelo, leido.medida, leido.indice, ...leido.resto]
    .filter(Boolean)
    .join(" ");
  return (base || String(descripcion ?? ""))
    .toUpperCase()
    .replace(/[^A-Z0-9/. ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
