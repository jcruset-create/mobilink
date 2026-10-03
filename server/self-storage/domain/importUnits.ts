/**
 * Importador de trasteros desde CSV (los de Reus y los de cualquier centro).
 *
 * Puro: recibe el texto del fichero y lo que hay en la base (trasteros,
 * zonas y tipos del centro) y devuelve, fila a fila, qué se haría y por qué.
 * El servicio guarda ese resultado como vista previa (dry-run) y sólo al
 * CONFIRMAR lo aplica, volviendo a calcularlo dentro de la transacción con lo
 * que haya en la base en ese momento.
 *
 * Decisiones:
 *
 *   · El identificador comercial es número de trastero + centro. Un número que
 *     ya existe en el centro se ACTUALIZA (medidas y precio), nunca se duplica;
 *     si no cambia nada, se SALTA. Importar dos veces el mismo fichero no hace
 *     nada la segunda vez.
 *   · Un número repetido DENTRO del fichero es error en todas sus filas: no se
 *     elige una en silencio.
 *   · El estado del trastero nunca lo cambia una importación, ni el precio de
 *     un contrato (que está congelado en el contrato).
 *   · Nada de precios ni de datos de Reus en el código: todo sale del fichero.
 *   · PRECIO: `precio_base`, `cuota_iva` (IMPORTE en euros, no porcentaje) y
 *     `pvp`, con la regla base + cuota = PVP (±0,01 €). El TIPO de IVA nunca
 *     sale del fichero ni se deduce de él: es el IVA general de la empresa.
 *     La antigua columna `iva` se acepta como ALIAS DEPRECADO de `cuota_iva`
 *     (con aviso): en el CSV de Reus siempre fue la cuota.
 *
 * Formato recomendado:
 *   codigo;tipo;numero;largo_cm;ancho_cm;alto_cm;m2;m3;precio_base;cuota_iva;pvp
 * `codigo` es el identificador del trastero en el centro; `numero`, si viene
 * junto a `codigo`, es su nombre visible. Las medidas con sufijo `_cm` o `_m`
 * se leen en esa unidad, sin adivinar.
 */

import { areaM2, cuotaCuadraConIva, desviacion, leerNumero, medidaACm, resolverPrecioTrastero, volumenM3 } from "./pricing.ts";
import { ErrorSelfStorage } from "../errors.ts";

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Separador más probable mirando la cabecera (fuera de comillas). */
export function detectarSeparador(primeraLinea: string): string {
  const cuenta: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let comillas = false;
  for (const c of primeraLinea) {
    if (c === '"') comillas = !comillas;
    else if (!comillas && c in cuenta) cuenta[c]++;
  }
  const [mejor] = Object.entries(cuenta).sort((a, b) => b[1] - a[1]);
  return mejor[1] > 0 ? mejor[0] : ";";
}

/** RFC 4180 con separador configurable, comillas dobles escapadas y CRLF. */
export function leerCsv(texto: string): string[][] {
  const t = texto.replace(/^\uFEFF/, "");
  const sep = detectarSeparador(t.split(/\r?\n/, 1)[0] ?? "");
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((v) => v.trim() !== ""));
}

// ── Cabeceras ────────────────────────────────────────────────────────────────

export const CAMPOS = [
  "code",
  "zone",
  "type",
  "name",
  "length",
  "width",
  "height",
  "area",
  "volume",
  "price",
  "vat",
  "gross",
  "deposit",
] as const;
export type Campo = (typeof CAMPOS)[number];

/** Normaliza una cabecera: «Nº trastero» → «ntrastero», «m²» → «m2». */
export function normalizarCabecera(h: string): string {
  return h
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const SINONIMOS: Record<Campo, string[]> = {
  code: ["codigo", "code", "notrastero", "nodetrastero", "ntrastero", "numtrastero", "numerotrastero", "numerodetrastero", "trastero", "numero", "box", "nbox", "n", "no", "num", "nro"],
  zone: ["zona", "zone", "codigozona"],
  type: ["tipo", "type", "tipologia", "tipotrastero", "codigotipo"],
  // «numero» junto a «codigo»: el código identifica y el número se enseña.
  name: ["nombre", "name", "descripcion", "numero"],
  length: ["largo", "length", "longitud", "fondo", "largocm", "largom"],
  width: ["ancho", "width", "anchura", "anchocm", "anchom"],
  height: ["alto", "height", "altura", "altocm", "altom"],
  area: ["m2", "superficie", "area", "metroscuadrados", "superficiem2"],
  volume: ["m3", "volumen", "volume", "metroscubicos", "volumenm3"],
  price: ["preciobase", "precio", "base", "baseimponible", "price", "preciomensual", "preciosiniva"],
  // CUOTA de IVA en euros. «iva» es el alias deprecado del CSV antiguo.
  vat: ["cuotaiva", "cuota", "importeiva", "ivaimporte", "vatamount", "iva"],
  gross: ["pvp", "preciofinal", "total", "pvpmensual", "precioconiva", "precioiva"],
  deposit: ["fianza", "deposit", "deposito"],
};

export type MapaColumnas = Partial<Record<Campo, number>>;
type CampoMedida = "length" | "width" | "height";

/**
 * Cabeceras que antes eran un PORCENTAJE de IVA y ya no se aceptan: el tipo de
 * IVA no viene del fichero. Se rechazan con un mensaje claro en vez de
 * ignorarlas sin decir nada.
 */
const CABECERAS_DE_TIPO = ["tipoiva", "iva%", "porcentajeiva", "ivaporcentaje", "vatrate", "taxrate", "tax", "impuesto"];

export function mapearCabeceras(cabecera: string[]): {
  mapa: MapaColumnas;
  desconocidas: string[];
  unidades: Partial<Record<CampoMedida, "m" | "cm">>;
  aliasDeprecados: string[];
  columnasDeTipo: string[];
} {
  const mapa: MapaColumnas = {};
  const desconocidas: string[] = [];
  const unidades: Partial<Record<CampoMedida, "m" | "cm">> = {};
  const aliasDeprecados: string[] = [];
  const columnasDeTipo: string[] = [];
  cabecera.forEach((h, i) => {
    const n = normalizarCabecera(h);
    if (CABECERAS_DE_TIPO.includes(n) || /^(iva|tipo).*%$/.test(h.trim().toLowerCase().replace(/\s/g, ""))) {
      columnasDeTipo.push(h.trim());
      return;
    }
    // El primer campo libre que reconozca la cabecera («numero» es el código
    // si no hay «codigo», y el nombre si lo hay).
    const campo = (Object.keys(SINONIMOS) as Campo[]).find((c) => SINONIMOS[c].includes(n) && mapa[c] === undefined);
    if (!campo) {
      if (n) desconocidas.push(h.trim());
      return;
    }
    mapa[campo] = i;
    if (campo === "vat" && n === "iva") aliasDeprecados.push(h.trim());
    if (campo === "length" || campo === "width" || campo === "height") {
      if (n.endsWith("cm")) unidades[campo] = "cm";
      else if (["largom", "anchom", "altom"].includes(n)) unidades[campo] = "m";
    }
  });
  return { mapa, desconocidas, unidades, aliasDeprecados, columnasDeTipo };
}

// ── Filas ────────────────────────────────────────────────────────────────────

export type OpcionesImportacion = {
  /** Unidad de largo/ancho/alto. `auto`: < 20 son metros. */
  unidadMedidas?: "auto" | "m" | "cm";
  /**
   * IVA GENERAL de la empresa (porcentaje). Sólo se usa para completar la
   * cuota cuando el fichero trae únicamente base o PVP, y para avisar si una
   * cuota no corresponde a él. Nunca sale del fichero.
   */
  ivaGeneral: number;
  /** Tolerancia de m²/m³ declarados frente a los calculados (0,05 = 5 %). */
  toleranciaMedidas?: number;
};

export type DatosTrastero = {
  code: string;
  zoneCode: string | null;
  typeCode: string | null;
  name: string | null;
  width_cm: number;
  length_cm: number;
  height_cm: number;
  area_m2: number;
  volume_m3: number;
  monthly_price: number;
  /** Tipo (porcentaje): el IVA general vigente al importar. */
  tax_rate: number;
  /** Cuota de IVA en euros (base + cuota = PVP). */
  vat_amount: number;
  monthly_price_gross: number;
  deposit_amount: number | null;
};

export type FilaLeida = {
  rowNumber: number;
  /** Número de trastero normalizado ('' si falta). */
  code: string;
  raw: Record<string, string>;
  parsed: DatosTrastero | null;
  errors: string[];
  warnings: string[];
};

/** Número de trastero normalizado: sin espacios sobrantes y en mayúsculas. */
export function normalizarCodigo(c: string): string {
  return String(c ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Lee el CSV entero y valida cada fila por sí misma (sin mirar la base). */
export function leerFilas(
  texto: string,
  opciones: OpcionesImportacion
): { filas: FilaLeida[]; cabecera: string[]; mapa: MapaColumnas; desconocidas: string[]; avisos: string[] } {
  const tabla = leerCsv(texto);
  if (tabla.length < 2) {
    throw new ErrorSelfStorage("CSV_VACIO", "El fichero no tiene filas de datos (hace falta una cabecera y al menos una fila).", 422);
  }
  const [cabecera, ...datos] = tabla;
  const { mapa, desconocidas, unidades, aliasDeprecados, columnasDeTipo } = mapearCabeceras(cabecera);
  if (columnasDeTipo.length) {
    throw new ErrorSelfStorage(
      "CSV_CON_TIPO_DE_IVA",
      `El fichero trae un porcentaje de IVA (${columnasDeTipo.join(", ")}). El tipo de IVA no se importa: sale de la configuración de la empresa. Usa las columnas precio_base, cuota_iva (importe en euros) y pvp.`,
      422,
      { columnas: columnasDeTipo }
    );
  }
  const avisos: string[] = aliasDeprecados.map(
    (h) => `La columna «${h}» se ha leído como CUOTA de IVA en euros (no como porcentaje). Está deprecada: renómbrala a «cuota_iva».`
  );

  const faltan: string[] = [];
  if (mapa.code === undefined) faltan.push("número de trastero");
  if (mapa.length === undefined) faltan.push("largo");
  if (mapa.width === undefined) faltan.push("ancho");
  if (mapa.height === undefined) faltan.push("alto");
  if (mapa.price === undefined && mapa.gross === undefined) faltan.push("precio_base o pvp");
  if (faltan.length) {
    throw new ErrorSelfStorage("CSV_SIN_COLUMNAS", `Faltan columnas obligatorias: ${faltan.join(", ")}.`, 422, { cabecera, mapa });
  }

  const unidad = (c: CampoMedida) => unidades[c] ?? opciones.unidadMedidas ?? "auto";
  const tol = opciones.toleranciaMedidas ?? 0.05;

  const filas = datos.map((celdas, i): FilaLeida => {
    const raw: Record<string, string> = {};
    cabecera.forEach((h, j) => (raw[h.trim() || `col${j + 1}`] = (celdas[j] ?? "").trim()));
    const valor = (c: Campo) => (mapa[c] === undefined ? "" : (celdas[mapa[c]!] ?? "").trim());
    const errors: string[] = [];
    const warnings: string[] = [];

    const num = (c: Campo, nombre: string): number | null => {
      const n = leerNumero(valor(c));
      if (Number.isNaN(n)) {
        errors.push(`${nombre}: «${valor(c)}» no es un número.`);
        return null;
      }
      return n;
    };

    const code = normalizarCodigo(valor("code"));
    if (!code) errors.push("Falta el número de trastero.");

    const medidas = (["length", "width", "height"] as const).map((c) => {
      const nombre = { length: "Largo", width: "Ancho", height: "Alto" }[c];
      const n = num(c, nombre);
      if (n == null) {
        if (!errors.some((e) => e.startsWith(nombre))) errors.push(`${nombre}: falta.`);
        return null;
      }
      if (n <= 0) {
        errors.push(`${nombre}: tiene que ser mayor que cero.`);
        return null;
      }
      return medidaACm(n, unidad(c));
    });
    const [length_cm, width_cm, height_cm] = medidas;

    const base = mapa.price !== undefined ? num("price", "Precio base") : null;
    const cuota = mapa.vat !== undefined ? num("vat", "Cuota de IVA") : null;
    const pvp = mapa.gross !== undefined ? num("gross", "PVP") : null;
    let precio: ReturnType<typeof resolverPrecioTrastero> | null = null;
    if (!errors.some((e) => /^(Precio base|Cuota de IVA|PVP)/.test(e))) {
      try {
        precio = resolverPrecioTrastero({ base, cuota, pvp }, opciones.ivaGeneral);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (precio && cuota != null && !cuotaCuadraConIva(precio.base, precio.cuota, opciones.ivaGeneral)) {
      warnings.push(
        `La cuota de IVA (${precio.cuota.toFixed(2).replace(".", ",")} €) no corresponde al IVA general (${String(opciones.ivaGeneral).replace(".", ",")} %) sobre la base. Se importa tal cual; revísala.`
      );
    }

    let area_m2: number | null = null;
    let volume_m3: number | null = null;
    if (width_cm && length_cm && height_cm) {
      const aCalc = areaM2(width_cm, length_cm);
      const vCalc = volumenM3(width_cm, length_cm, height_cm);
      const aDecl = num("area", "m²");
      const vDecl = num("volume", "m³");
      area_m2 = aDecl ?? aCalc;
      volume_m3 = vDecl ?? vCalc;
      if (aDecl != null && desviacion(aDecl, aCalc) > tol) {
        warnings.push(`m² declarados (${aDecl}) y calculados con largo × ancho (${aCalc}) difieren más de un ${Math.round(tol * 100)} %. Se guardan los declarados.`);
      }
      if (vDecl != null && desviacion(vDecl, vCalc) > tol) {
        warnings.push(`m³ declarados (${vDecl}) y calculados (${vCalc}) difieren más de un ${Math.round(tol * 100)} %. Se guardan los declarados.`);
      }
      if (area_m2 != null && area_m2 <= 0) errors.push("m²: tiene que ser mayor que cero.");
      if (volume_m3 != null && volume_m3 <= 0) errors.push("m³: tiene que ser mayor que cero.");
    }

    const deposit = mapa.deposit !== undefined ? num("deposit", "Fianza") : null;
    if (deposit != null && deposit < 0) errors.push("Fianza: no puede ser negativa.");

    const parsed: DatosTrastero | null =
      errors.length === 0 && code && width_cm && length_cm && height_cm && precio && area_m2 && volume_m3
        ? {
            code,
            zoneCode: valor("zone") ? normalizarCodigo(valor("zone")) : null,
            typeCode: valor("type") ? normalizarCodigo(valor("type")) : null,
            name: valor("name") || null,
            width_cm,
            length_cm,
            height_cm,
            area_m2,
            volume_m3,
            monthly_price: precio.base,
            tax_rate: precio.iva,
            vat_amount: precio.cuota,
            monthly_price_gross: precio.pvp,
            deposit_amount: deposit,
          }
        : null;

    // +2: la fila 1 es la cabecera y las personas cuentan desde 1.
    return { rowNumber: i + 2, code, raw, parsed, errors, warnings };
  });

  // Números repetidos dentro del fichero: error en TODAS sus filas.
  const porCodigo = new Map<string, FilaLeida[]>();
  for (const f of filas) {
    if (!f.code) continue;
    porCodigo.set(f.code, [...(porCodigo.get(f.code) ?? []), f]);
  }
  for (const [c, grupo] of porCodigo) {
    if (grupo.length < 2) continue;
    const lineas = grupo.map((g) => g.rowNumber).join(", ");
    for (const f of grupo) {
      f.errors.push(`El trastero ${c} está repetido en el fichero (filas ${lineas}).`);
      f.parsed = null;
    }
  }

  return { filas, cabecera, mapa, desconocidas, avisos };
}

// ── Contra la base ───────────────────────────────────────────────────────────

export type TrasteroExistente = {
  id: string;
  code: string;
  zone_id: string;
  unit_type_id: string | null;
  name: string | null;
  width_cm: number;
  length_cm: number;
  height_cm: number;
  area_m2: number;
  volume_m3: number;
  monthly_price: number;
  tax_rate: number;
  vat_amount: number;
  monthly_price_gross: number;
  deposit_amount: number;
};

export type Accion = "create" | "update" | "skip" | "error";

export type FilaDecidida = FilaLeida & {
  action: Accion;
  storageUnitId: string | null;
  /** Código del tipo que se creará al aplicar (si no existe y se pidió crearlo). */
  tipoACrear?: string | null;
  /** Lo que se escribiría: valores finales con zona y tipo ya resueltos. */
  valores: (Omit<DatosTrastero, "zoneCode" | "typeCode"> & { zone_id: string; unit_type_id: string | null }) | null;
  cambios: string[];
};

export type ContextoCentro = {
  existentes: Map<string, TrasteroExistente>;
  zonasPorCodigo: Map<string, string>;
  tiposPorCodigo: Map<string, string>;
  zonaPorDefecto: string | null;
  /** Un tipo que no existe: crearlo al aplicar (con aviso) en vez de dar error. */
  crearTiposQueFalten?: boolean;
  /** El centro no tiene NINGUNA zona: los trasteros sin zona van a una «General» que se crea al aplicar. */
  crearZonaGeneral?: boolean;
};

/** Marca de «la zona General que se creará al aplicar». */
export const ZONA_GENERAL_NUEVA = "__zona_general__";

const CAMPOS_COMPARADOS = [
  "name",
  "width_cm",
  "length_cm",
  "height_cm",
  "area_m2",
  "volume_m3",
  // El tipo (`tax_rate`) no se compara: es el IVA general al importar, y
  // reimportar el mismo fichero tras cambiar el IVA general no es un cambio.
  "monthly_price",
  "vat_amount",
  "monthly_price_gross",
  "deposit_amount",
  "zone_id",
  "unit_type_id",
] as const;

/** Decide crear / actualizar / saltar para cada fila válida. */
export function decidirAcciones(filas: FilaLeida[], ctx: ContextoCentro): FilaDecidida[] {
  return filas.map((f): FilaDecidida => {
    if (!f.parsed) return { ...f, action: "error", storageUnitId: null, valores: null, cambios: [] };
    const p = f.parsed;
    const errors = [...f.errors];
    const existente = ctx.existentes.get(p.code) ?? null;
    const warnings = [...f.warnings];

    let zone_id: string | null;
    if (p.zoneCode) {
      zone_id = ctx.zonasPorCodigo.get(p.zoneCode) ?? null;
      if (!zone_id) errors.push(`La zona ${p.zoneCode} no existe en este centro. Créala antes de importar.`);
    } else {
      zone_id = existente?.zone_id ?? ctx.zonaPorDefecto;
      if (!zone_id && ctx.crearZonaGeneral) {
        zone_id = ZONA_GENERAL_NUEVA;
        warnings.push("El centro no tiene zonas: se creará la zona «General» al importar.");
      }
      if (!zone_id) errors.push("Sin zona: el fichero no trae columna «zona». Elige arriba la «Zona para los nuevos» y vuelve a validar (o añade una columna «zona»).");
    }

    let unit_type_id: string | null = existente?.unit_type_id ?? null;
    let tipoACrear: string | null = null;
    if (p.typeCode) {
      unit_type_id = ctx.tiposPorCodigo.get(p.typeCode) ?? null;
      if (!unit_type_id && ctx.crearTiposQueFalten) {
        tipoACrear = p.typeCode;
        warnings.push(`El tipo ${p.typeCode} no existe: se creará al importar (con las medidas del primer trastero de ese tipo).`);
      } else if (!unit_type_id) errors.push(`El tipo ${p.typeCode} no existe para este centro.`);
    }

    if (errors.length) return { ...f, errors, warnings, action: "error", storageUnitId: existente?.id ?? null, valores: null, cambios: [] };

    const valores = {
      code: p.code,
      width_cm: p.width_cm,
      length_cm: p.length_cm,
      height_cm: p.height_cm,
      area_m2: p.area_m2,
      volume_m3: p.volume_m3,
      monthly_price: p.monthly_price,
      tax_rate: p.tax_rate,
      vat_amount: p.vat_amount,
      monthly_price_gross: p.monthly_price_gross,
      name: p.name ?? existente?.name ?? null,
      deposit_amount: p.deposit_amount ?? existente?.deposit_amount ?? 0,
      zone_id: zone_id!,
      unit_type_id,
    };

    if (!existente) return { ...f, warnings, tipoACrear, action: "create", storageUnitId: null, valores, cambios: [] };

    const cambios = CAMPOS_COMPARADOS.filter((k) => {
      const a = existente[k as keyof TrasteroExistente];
      const b = valores[k as keyof typeof valores];
      return typeof a === "number" || typeof b === "number" ? Number(a) !== Number(b) : (a ?? null) !== (b ?? null);
    }).map(String);

    // Un tipo que se va a crear también es un cambio para un trastero existente.
    if (tipoACrear && !cambios.includes("unit_type_id")) cambios.push("unit_type_id");
    return { ...f, warnings, tipoACrear, action: cambios.length ? "update" : "skip", storageUnitId: existente.id, valores, cambios };
  });
}

export function resumen(filas: FilaDecidida[]) {
  const r = { total: filas.length, create: 0, update: 0, skip: 0, error: 0, warnings: 0 };
  for (const f of filas) {
    r[f.action]++;
    if (f.warnings.length) r.warnings++;
  }
  return r;
}
