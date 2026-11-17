/**
 * Importar al catálogo un Excel de fabricante: marcas, medidas, índices de
 * carga, códigos de velocidad y modelos. Sin duplicar y sin combinaciones:
 * las combinaciones (medida + índice + velocidad) y su vínculo con el modelo
 * nacen al dar de alta un neumático.
 *
 * Es el mismo criterio de las migraciones de furgoneta y camión
 * (tyrecontrol_catalogo_furgoneta_ic_cv.sql, tyrecontrol_catalogo_camion.sql),
 * pasado a una pantalla para no tener que pegar SQL con cada Excel:
 *
 *   · Medidas sin la «C» de comercial ni la marca XL, como el resto de la base
 *     («195/70 R15C» → «195/70R15»); las de camping conservan «CP».
 *   · Índices de carga: los números de dos o tres cifras, sencillo y gemelo.
 *   · Modelos comparados dentro de su marca sin espacios ni signos, salvo el
 *     «+», que es otro dibujo (SP346 y SP346+). «SP346 (17.5/19.5)» es el
 *     SP346; en Hankook vale el código («Vantra Transit (RA58)» → RA58), y un
 *     nombre que junta dos dibujos («Roadian CT8 / CTX») no se crea.
 *
 * Además guarda la OFERTA del fabricante (tc_cat_oferta_fabricante): cada
 * fila del Excel tal cual, modelo × medida × IC × CV. No son referencias ni
 * combinaciones del catálogo; solo sirven para que el formulario de nueva
 * referencia enseñe las medidas de ese modelo y proponga su IC y su CV.
 *
 * Es código puro: recibe las filas de la hoja ya leídas y lo que hay en el
 * catálogo, y devuelve qué falta. Quien escribe es `services/data.ts`.
 */

/** Una fila del Excel ya entendida. */
export interface FilaCatalogo {
  marca: string;
  modelo: string | null;
  medida: string;
  simple: string | null;
  doble: string | null;
  cv: string | null;
  temporada: string | null;
  eje: "direccion" | "traccion" | "remolque" | "mixto" | null;
}

type Celdas = Record<string, unknown>;

const txt = (v: unknown) => (v == null ? "" : String(v)).trim();
/** «Modelo / dibujo» → «MODELODIBUJO»: para encontrar columnas se escriban como se escriban. */
const clave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function columna(cabeceras: string[], ...candidatas: string[]): string | null {
  const buscadas = candidatas.map(clave);
  return cabeceras.find((c) => buscadas.includes(clave(c))) ?? null;
}

/** «195/70 r15C» → «195/70R15»; «225/65 R16CP» → «225/65R16CP»; «215/65 R17 XL» → «215/65R17». */
export function medidaDeCatalogo(s: string): string {
  let t = s.toUpperCase().replace(/\s+/g, "").replace(/,/g, ".");
  t = t.replace(/XL$/, "");
  if (/R\d{2}(\.\d)?C$/.test(t)) t = t.slice(0, -1);
  return t;
}

/** El nombre con que se guarda el modelo, o null si no hay que crearlo. */
export function modeloDeCatalogo(marca: string, s: string): string | null {
  let t = s.replace(/\s*\(17\.5\/19\.5\)\s*$/, "").trim();
  if (!t || / \/ /.test(t)) return null;
  if (marca.toUpperCase() === "HANKOOK") {
    // El «+» va pegado y no deja frontera de palabra detrás: se busca aparte.
    const codigo = t.match(/\b([A-Z]{2}\d{2}\+?)(?![A-Za-z0-9+])/);
    if (codigo) t = codigo[1];
    else t = t.replace(/^smart\s?flex\s+/i, "");
  }
  return t;
}

/** Para comparar modelos dentro de una marca. */
export function claveModelo(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9+]/g, "");
}

const EJES: Record<string, FilaCatalogo["eje"]> = {
  DIRECCION: "direccion", TRACCION: "traccion", REMOLQUE: "remolque", ARRASTRE: "remolque", MIXTO: "mixto",
};

/**
 * Las filas de una hoja. Entiende los cuatro formatos de Excel que se han
 * usado hasta ahora: IC en una columna («104/102») o en dos (sencillo y
 * gemelo), modelo como «Modelo», «Modelo / dibujo» o con la referencia aparte.
 * Devuelve null si la hoja no tiene medida e índice.
 */
export function leerHoja(filas: Celdas[]): FilaCatalogo[] | null {
  if (filas.length === 0) return null;
  const cab = Object.keys(filas[0]);
  const cMedida = columna(cab, "Medida");
  const cSimple = columna(cab, "IC sencillo");
  const cDoble = columna(cab, "IC gemelo");
  const cJunto = columna(cab, "IC sencillo / gemelo", "IC sencillo/gemelo", "IC completo", "IC");
  const cCv = columna(cab, "CV", "Codigo de velocidad", "Velocidad");
  if (!cMedida || !(cSimple || cJunto) || !cCv) return null;
  const cMarca = columna(cab, "Marca");
  const cModelo = columna(cab, "Modelo / dibujo", "Modelo", "Dibujo");
  const cRef = columna(cab, "Referencia");
  const cTemp = columna(cab, "Temporada");
  const cEje = columna(cab, "Eje");

  const salida: FilaCatalogo[] = [];
  for (const f of filas) {
    const medidaTxt = txt(f[cMedida]);
    if (!medidaTxt) continue;
    let simple = cSimple ? txt(f[cSimple]) : "";
    let doble = cDoble ? txt(f[cDoble]) : "";
    if (!simple && cJunto) [simple, doble = ""] = txt(f[cJunto]).split("/").map((x) => x.trim());
    const marca = cMarca ? txt(f[cMarca]) : "Hankook";
    const nombre = cModelo ? txt(f[cModelo]) : "";
    // El Excel de Hankook traía el código en «Referencia» y el nombre en «Modelo».
    const conCodigo = cRef && txt(f[cRef]) ? `${nombre} (${txt(f[cRef])})` : nombre;
    const eje = cEje ? EJES[clave(txt(f[cEje]).split(",")[0] ?? "")] ?? null : null;
    salida.push({
      marca,
      modelo: conCodigo ? modeloDeCatalogo(marca, conCodigo) : null,
      medida: medidaDeCatalogo(medidaTxt),
      simple: /^\d{2,3}$/.test(simple) ? simple : null,
      doble: /^\d{2,3}$/.test(doble) ? doble : null,
      cv: /^[A-Za-z]$/.test(txt(f[cCv])) ? txt(f[cCv]).toUpperCase() : null,
      temporada: cTemp ? txt(f[cTemp]).split(" / ")[0] || null : null,
      eje,
    });
  }
  return salida;
}

/**
 * De todas las hojas, la que dice más: la que tiene modelos y más filas.
 * Los Excel traen además hojas de resumen («Medidas globales», «Notas»).
 */
export function elegirHoja(hojas: Record<string, Celdas[]>): { nombre: string; filas: FilaCatalogo[] } | null {
  let mejor: { nombre: string; filas: FilaCatalogo[]; puntos: number } | null = null;
  for (const [nombre, filas] of Object.entries(hojas)) {
    const leidas = leerHoja(filas);
    if (!leidas || leidas.length === 0) continue;
    const conModelo = leidas.filter((f) => f.modelo).length;
    const puntos = conModelo * 10 + leidas.length;
    if (!mejor || puntos > mejor.puntos) mejor = { nombre, filas: leidas, puntos };
  }
  return mejor ? { nombre: mejor.nombre, filas: mejor.filas } : null;
}

export interface CatalogoActual {
  marcas: { id: string; nombre: string }[];
  modelos: { id?: string; marca_id: string | null; nombre: string }[];
  medidas: { valor: string; activo?: boolean }[];
  indices: { valor: string }[];
  velocidades: { valor: string }[];
  /** La oferta ya guardada, como `claveOferta`. Sin ella, toda la del Excel cuenta como nueva. */
  oferta?: string[];
}

/** Una fila de la oferta del fabricante: este modelo se fabrica en esta medida con este IC y CV. */
export interface FilaOferta {
  marca: string;
  modelo: string;
  medida: string;
  simple: string;
  doble: string;
  cv: string;
}

/** Para comparar filas de oferta: modelo por su id, medida normalizada, IC y CV. */
export const claveOferta = (modeloId: string, medida: string, simple: string, doble: string, cv: string) =>
  `${modeloId}|${medidaDeCatalogo(medida)}|${simple}|${doble}|${cv.toUpperCase()}`;

export interface PlanImportacion {
  marcas: string[];
  medidas: string[];
  indices: string[];
  velocidades: string[];
  modelos: { marca: string; nombre: string; temporada: string | null; eje: FilaCatalogo["eje"] }[];
  /** Todas las filas de oferta del Excel, sin repetir. Se escriben todas: las que ya estaban no se duplican. */
  oferta: FilaOferta[];
  /** De esas, cuántas no estaban guardadas. */
  ofertaNueva: number;
  /** Lo que ya estaba, para decir que no se repite. */
  yaEstaban: { medidas: number; indices: number; velocidades: number; modelos: number };
}

const porNumero = (a: string, b: string) => Number(a) - Number(b);
const porTexto = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

export function planificar(filas: FilaCatalogo[], hay: CatalogoActual): PlanImportacion {
  const marcasHay = new Map(hay.marcas.map((m) => [m.nombre.toUpperCase(), m.id]));
  const medidasHay = new Set(hay.medidas.map((m) => medidaDeCatalogo(m.valor)));
  const icHay = new Set(hay.indices.map((i) => i.valor.trim()));
  const cvHay = new Set(hay.velocidades.map((v) => v.valor.trim().toUpperCase()));
  const modelosHay = new Set(hay.modelos.map((m) => `${m.marca_id}|${claveModelo(m.nombre)}`));

  const medidas = new Set(filas.map((f) => f.medida));
  const ic = new Set(filas.flatMap((f) => [f.simple, f.doble]).filter((x): x is string => !!x));
  const cv = new Set(filas.map((f) => f.cv).filter((x): x is string => !!x));
  const marcas = new Map<string, string>(); // MAYÚSCULAS → como viene
  for (const f of filas) if (f.marca && !marcasHay.has(f.marca.toUpperCase())) marcas.set(f.marca.toUpperCase(), f.marca);

  const modelos = new Map<string, PlanImportacion["modelos"][number]>();
  let modelosYa = 0;
  const vistos = new Set<string>();
  for (const f of filas) {
    if (!f.modelo || !f.marca) continue;
    const k = `${f.marca.toUpperCase()}|${claveModelo(f.modelo)}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const id = marcasHay.get(f.marca.toUpperCase());
    if (id && modelosHay.has(`${id}|${claveModelo(f.modelo)}`)) { modelosYa++; continue; }
    modelos.set(k, { marca: f.marca, nombre: f.modelo, temporada: f.temporada, eje: f.eje });
  }

  // La oferta: una fila por modelo, medida, IC y CV.
  const idModelo = new Map(hay.modelos.filter((m) => m.id).map((m) => [`${m.marca_id}|${claveModelo(m.nombre)}`, m.id!]));
  const ofertaHay = new Set(hay.oferta ?? []);
  const oferta = new Map<string, FilaOferta>();
  let ofertaNueva = 0;
  for (const f of filas) {
    if (!f.modelo || !f.marca) continue;
    const o: FilaOferta = { marca: f.marca, modelo: f.modelo, medida: f.medida, simple: f.simple ?? "", doble: f.doble ?? "", cv: f.cv ?? "" };
    const k = `${f.marca.toUpperCase()}|${claveModelo(f.modelo)}|${o.medida}|${o.simple}|${o.doble}|${o.cv}`;
    if (oferta.has(k)) continue;
    oferta.set(k, o);
    const marcaId = marcasHay.get(f.marca.toUpperCase());
    const id = marcaId ? idModelo.get(`${marcaId}|${claveModelo(f.modelo)}`) : undefined;
    if (!id || !ofertaHay.has(claveOferta(id, o.medida, o.simple, o.doble, o.cv))) ofertaNueva++;
  }

  const nuevasMedidas = [...medidas].filter((m) => !medidasHay.has(m)).sort(porTexto);
  const nuevosIc = [...ic].filter((v) => !icHay.has(v)).sort(porNumero);
  const nuevasCv = [...cv].filter((v) => !cvHay.has(v)).sort();
  return {
    marcas: [...marcas.values()].sort(porTexto),
    medidas: nuevasMedidas,
    indices: nuevosIc,
    velocidades: nuevasCv,
    modelos: [...modelos.values()].sort((a, b) => porTexto(a.marca + a.nombre, b.marca + b.nombre)),
    oferta: [...oferta.values()],
    ofertaNueva,
    yaEstaban: {
      medidas: medidas.size - nuevasMedidas.length,
      indices: ic.size - nuevosIc.length,
      velocidades: cv.size - nuevasCv.length,
      modelos: modelosYa,
    },
  };
}

export const planVacio = (p: PlanImportacion) =>
  p.marcas.length + p.medidas.length + p.indices.length + p.velocidades.length + p.modelos.length + p.ofertaNueva === 0;

/**
 * Lo que el formulario de nueva referencia puede ofrecer de un modelo, según la
 * oferta del fabricante. Sin oferta para ese modelo, `conOferta` es false y el
 * formulario enseña todo, como antes.
 */
export function ofertaDelModelo(
  oferta: { modelo_id: string; medida: string; simple: string; doble: string; cv: string }[],
  modeloId: string | null | undefined,
  medida: string | null | undefined,
): { conOferta: boolean; medidas: string[]; simples: string[]; dobles: string[]; velocidades: string[]; medidaFuera: boolean } {
  const delModelo = modeloId ? oferta.filter((o) => o.modelo_id === modeloId) : [];
  const m = medida ? medidaDeCatalogo(medida) : "";
  const deMedida = delModelo.filter((o) => medidaDeCatalogo(o.medida) === m);
  const unicos = (xs: string[], orden: (a: string, b: string) => number) => [...new Set(xs.filter(Boolean))].sort(orden);
  return {
    conOferta: delModelo.length > 0,
    medidas: unicos(delModelo.map((o) => medidaDeCatalogo(o.medida)), porTexto),
    simples: unicos(deMedida.map((o) => o.simple), porNumero),
    dobles: unicos(deMedida.map((o) => o.doble), porNumero),
    velocidades: unicos(deMedida.map((o) => o.cv), (a, b) => (kmhDeCodigo(a) ?? 0) - (kmhDeCodigo(b) ?? 0)),
    medidaFuera: delModelo.length > 0 && !!m && deMedida.length === 0,
  };
}

/** Ancho, perfil y llanta de una medida, para guardarlos con ella. */
export function partesDeMedida(m: string): { ancho: number | null; perfil: number | null; diametro: number | null } {
  const a = m.match(/^(\d{3})/);
  const p = m.match(/^\d{3}\/(\d{2})/);
  const d = m.match(/R(\d{2}(?:\.\d)?)/);
  return { ancho: a ? Number(a[1]) : null, perfil: p ? Number(p[1]) : null, diametro: d ? Number(d[1]) : null };
}

// ── Kilos y km/h (tabla ETRTO / ISO 4209) ─────────────────────────────────────
// La misma que tc_kg_indice_carga / tc_kmh_codigo_velocidad en la base.

const KG: Record<number, number> = {
  60: 250, 61: 257, 62: 265, 63: 272, 64: 280, 65: 290, 66: 300, 67: 307, 68: 315, 69: 325, 70: 335, 71: 345, 72: 355,
  73: 365, 74: 375, 75: 387, 76: 400, 77: 412, 78: 425, 79: 437, 80: 450, 81: 462, 82: 475, 83: 487, 84: 500, 85: 515,
  86: 530, 87: 545, 88: 560, 89: 580, 90: 600, 91: 615, 92: 630, 93: 650, 94: 670, 95: 690, 96: 710, 97: 730, 98: 750,
  99: 775, 100: 800, 101: 825, 102: 850, 103: 875, 104: 900, 105: 925, 106: 950, 107: 975, 108: 1000, 109: 1030,
  110: 1060, 111: 1090, 112: 1120, 113: 1150, 114: 1180, 115: 1215, 116: 1250, 117: 1285, 118: 1320, 119: 1360,
  120: 1400, 121: 1450, 122: 1500, 123: 1550, 124: 1600, 125: 1650, 126: 1700, 127: 1750, 128: 1800, 129: 1850,
  130: 1900, 131: 1950, 132: 2000, 133: 2060, 134: 2120, 135: 2180, 136: 2240, 137: 2300, 138: 2360, 139: 2430,
  140: 2500, 141: 2575, 142: 2650, 143: 2725, 144: 2800, 145: 2900, 146: 3000, 147: 3075, 148: 3150, 149: 3250,
  150: 3350, 151: 3450, 152: 3550, 153: 3650, 154: 3750, 155: 3875, 156: 4000, 157: 4125, 158: 4250, 159: 4375,
  160: 4500, 161: 4625, 162: 4750, 163: 4875, 164: 5000, 165: 5150, 166: 5300, 167: 5450, 168: 5600, 169: 5800,
  170: 6000,
};
const KMH: Record<string, number> = {
  B: 50, C: 60, D: 65, E: 70, F: 80, G: 90, J: 100, K: 110, L: 120, M: 130, N: 140, P: 150, Q: 160, R: 170, S: 180,
  T: 190, U: 200, H: 210, V: 240, W: 270, Y: 300,
};
export const kgDeIndice = (v: string): number | null => KG[Number(v)] ?? null;
export const kmhDeCodigo = (v: string): number | null => KMH[v.toUpperCase()] ?? null;
