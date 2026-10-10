/**
 * El histórico de albaranes del taller (Excel de Genes), convertido en lo que
 * el RPC `tc_importar_historico` sabe grabar: una intervención por albarán y
 * matrícula, una operación por neumático, servicios agregados y todas las
 * líneas de origen con sus importes.
 *
 * ── Sin base de datos, a propósito ──────────────────────────────────────────
 *
 * Esto es lectura, agrupación y CONCILIACIÓN pura: entran las filas de las dos
 * hojas, sale el lote con sus incidencias. Lo que exige la base (vehículo,
 * plano, catálogo de servicios, permisos, duplicados) lo comprueba el RPC, que
 * no se fía de nada de lo que venga de aquí salvo del contenido del albarán.
 *
 * ── Conciliación: sumar por fuente, luego comparar ──────────────────────────
 *
 * Tres fuentes describen los mismos neumáticos: la ANOTACIÓN del taller
 * («MONTA 2 CUBIERTAS NUEVAS 315/80R22.5 AH51», con n en el código), el
 * ARTÍCULO de familia 01 (un neumático vendido, con precio) y la SALIDA del
 * depósito del cliente (Hoja2). Dentro de cada fuente se SUMA por grupo
 * (condición + medida + referencia compatible): dos anotaciones N2 son 4, y
 * cuadran con una salida de 4. Después se comparan los totales; si difieren,
 * es una incidencia y no se elige la cantidad mayor. Una repetición idéntica
 * (N4 + N4) solo vale si otra fuente la corrobora.
 *
 * La mano de obra de montaje se concilia UNA vez por albarán: solo los grupos
 * sin anotación la necesitan como prueba de montaje, y las mismas unidades
 * no pueden respaldar dos conjuntos distintos.
 *
 * ── Claves estables ─────────────────────────────────────────────────────────
 *
 * Nada usa el número de fila: la identidad de una línea es su contenido más
 * un ordinal entre líneas idénticas del mismo albarán. Reordenar o volver a
 * exportar da las mismas claves y la misma huella.
 */

export type Condicion = "nueva" | "usada" | "recauchutada";
export type Papel =
  | "anotacion" | "articulo" | "salida" | "entrada" | "carcasa_base" | "mano_obra_montaje"
  | "mano_obra" | "servicio" | "material" | "revision_flota" | "num_vehiculo" | "ignorada";

export interface LineaH1 {
  fecha: string | null;
  matricula: string;
  km: number | null;
  documento: string;
  codigo: string;
  descripcion: string;
  familia: string;
  categoria: string;
  marca: string;
  pct_iva: number | null;
  uds: number | null;
  pct_dto: number | null;
  precio_unidad: number | null;
  importe_linea: number | null;
  estado_documento: string;
}

export interface LineaH2 {
  articulo: string;
  descripcion: string;
  marca: string;
  categoria: string;
  fecha: string | null;        // ISO con hora si la hay
  vehiculo: string;
  carcasa: string;
  cliente: string;
  tipo: string;
  almacen: string;
  unidades: number | null;
  usuario: string;
  doc_entrada: string;
  doc_salida: string;
  obs: string;
}

// ── Lectura de las hojas ────────────────────────────────────────────────────

const txt = (v: unknown): string => (v == null ? "" : String(v)).trim();
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
function fechaISO(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function fechaHoraISO(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Busca una columna por varios nombres posibles (acentos y espacios cambian de un exportado a otro). */
function col(row: Record<string, unknown>, ...nombres: string[]): unknown {
  const claves = Object.keys(row);
  const limpio = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s.]+/g, "").toLowerCase();
  for (const n of nombres) {
    const k = claves.find((c) => limpio(c) === limpio(n));
    if (k !== undefined) return row[k];
  }
  return undefined;
}

export const CABECERAS_H1 = ["Documento", "Matrícula", "KMs", "Código", "Descripcion"];
export const CABECERAS_H2 = ["Cod. Articulo", "Matricula Carcasa", "Doc. Salida", "Unidades"];

export function pareceHoja1(row: Record<string, unknown> | undefined): boolean {
  return !!row && col(row, "Documento") !== undefined && col(row, "Matrícula", "Matricula") !== undefined && col(row, "Código", "Codigo") !== undefined;
}
export function pareceHoja2(row: Record<string, unknown> | undefined): boolean {
  return !!row && col(row, "Cod. Articulo") !== undefined && col(row, "Doc. Salida") !== undefined;
}

export function leerHoja1(rows: Record<string, unknown>[]): LineaH1[] {
  const out: LineaH1[] = [];
  for (const r of rows) {
    const documento = txt(col(r, "Documento"));
    const codigo = txt(col(r, "Código", "Codigo"));
    if (!documento && !codigo) continue;
    out.push({
      fecha: fechaISO(col(r, "Fecha")),
      matricula: txt(col(r, "Matrícula", "Matricula")),
      km: num(col(r, "KMs", "Km", "Kms")),
      documento, codigo,
      descripcion: txt(col(r, "Descripcion", "Descripción")),
      familia: txt(col(r, "Familia")),
      categoria: txt(col(r, "Categoría", "Categoria")),
      marca: txt(col(r, "Marca")),
      pct_iva: num(col(r, "% IVA", "%IVA")),
      uds: num(col(r, "Uds.", "Uds", "Unidades")),
      pct_dto: num(col(r, "% Dto", "%Dto", "% Dto.")),
      precio_unidad: num(col(r, "P. Unidad", "P.Unidad", "Precio")),
      importe_linea: num(col(r, "P. Total", "P.Total", "Importe")),
      estado_documento: txt(col(r, "Estado Documento", "Estado")),
    });
  }
  return out;
}

export function leerHoja2(rows: Record<string, unknown>[]): LineaH2[] {
  const out: LineaH2[] = [];
  for (const r of rows) {
    const articulo = txt(col(r, "Cod. Articulo", "Cod Articulo", "Artículo"));
    if (!articulo) continue;
    out.push({
      articulo,
      descripcion: txt(col(r, "Descripción", "Descripcion")),
      marca: txt(col(r, "Marca")),
      categoria: txt(col(r, "Categoría", "Categoria")),
      fecha: fechaHoraISO(col(r, "Fecha")),
      vehiculo: txt(col(r, "Vehículo", "Vehiculo", "Matrícula", "Matricula")),
      carcasa: txt(col(r, "Matricula Carcasa", "Matrícula Carcasa")),
      cliente: txt(col(r, "Cliente Original", "Cliente")),
      tipo: txt(col(r, "Tipo")),
      almacen: txt(col(r, "Almacén", "Almacen")),
      unidades: num(col(r, "Unidades")),
      usuario: txt(col(r, "Usuario")),
      doc_entrada: txt(col(r, "Doc. Entrada", "Doc Entrada")),
      doc_salida: txt(col(r, "Doc. Salida", "Doc Salida")),
      obs: txt(col(r, "Obs.", "Obs", "Observaciones")),
    });
  }
  return out;
}

// ── Normalización ───────────────────────────────────────────────────────────

/** «B2_26 / 4906» y «B2_26/4906» son el mismo albarán. */
export const normDoc = (s: string): string => s.replace(/\s+/g, "").toUpperCase();
export const normMat = (s: string): string => s.replace(/\s+/g, "").toUpperCase();
export const MATRICULA_VALIDA = /^\d{4}[A-Z]{3}$/;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Texto para claves y huellas: sin acentos, mayúsculas, espacios colapsados. */
export const normTxt = (s: string): string => sinAcentos(s).replace(/\s+/g, " ").trim().toUpperCase();
const n4 = (v: number | null | undefined): string => (v == null ? "" : (Math.round(v * 10000) / 10000).toString());

/** «295/80X22.5», «315/80R22,5» → «295/80R22.5». */
export function medidaDeTexto(s: string): string | null {
  const m = /(\d{3})\s*\/\s*(\d{2,3})\s*[XxRr]\s*(\d{2}(?:[.,]\d)?)/.exec(s);
  if (!m) return null;
  return `${m[1]}/${m[2]}R${m[3].replace(",", ".")}`;
}
/** El código «M29580225N2» lleva la medida: 295/80 R22.5. */
function medidaDeCodigo(c: string): string | null {
  if (!/^\d{8}$/.test(c)) return null;
  return `${c.slice(0, 3)}/${c.slice(3, 5)}R${c.slice(5, 7)}.${c.slice(7)}`;
}

const MARCAS = ["HANKOOK", "HANKO", "HANK", "CONTINENTAL", "CONTI", "MICHELIN", "MICH", "BRIDGESTONE", "GOODYEAR", "PIRELLI",
  "KUMHO", "SAILUN", "INSA", "DUNLOP", "FIRESTONE", "NOKIAN", "YOKOHAMA", "SEMPERIT", "BARUM", "UNIROYAL", "MATADOR", "FULDA", "KLEBER", "TOYO", "APOLLO", "GITI", "LINGLONG", "WESTLAKE"];
const MARCA_CANON: Record<string, string> = { HANKO: "Hankook", HANK: "Hankook", HANKOOK: "Hankook", CONTI: "Continental", MICH: "Michelin", MICHELIN: "Michelin", CONTINENTAL: "Continental" };
function marcaCanon(s: string): string {
  const u = s.toUpperCase().replace(/[^A-Z]/g, "");
  return MARCA_CANON[u] ?? (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
}

/** De «295/80X22.5 HANKOOK AH51 154M» → medida, marca, modelo. */
export function referenciaDeDescripcion(desc: string): { medida: string | null; marca: string | null; modelo: string | null } {
  const medida = medidaDeTexto(desc);
  let resto = sinAcentos(desc);
  if (medida) {
    const m = /(\d{3})\s*\/\s*(\d{2,3})\s*[XxRr]\s*(\d{2}(?:[.,]\d)?)/.exec(resto);
    if (m) resto = resto.slice(m.index + m[0].length);
  }
  const tokens = resto.replace(/^[\s:]+/, "").split(/\s+/).filter(Boolean);
  let marca: string | null = null;
  const modeloTokens: string[] = [];
  for (const t of tokens) {
    const u = t.toUpperCase().replace(/[.*]/g, "");
    if (!marca && MARCAS.some((b) => u.startsWith(b))) { marca = marcaCanon(u); continue; }
    modeloTokens.push(t);
  }
  const modelo = modeloTokens.join(" ").trim() || null;
  return { medida, marca, modelo };
}

/** ¿Modelos compatibles? El vacío lo es con todo; «AH51» lo es con «AH51 156L». */
export function modelosCompatibles(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const x = normTxt(a), y = normTxt(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
}
const elMasCompleto = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : (normTxt(b).length > normTxt(a).length ? b : a);

// ── Qué es cada línea ───────────────────────────────────────────────────────

export const CODIGOS_MO_MONTAJE = new Set(["9001099990017", "9001080050006", "9001050050006"]);
export const CODIGO_INSA_BASE = "0302091080012";
/** Código de origen → servicio del catálogo de TyreControl. */
export const SERVICIO_POR_CODIGO: Record<string, string> = {
  "9001099990017": "desmontar_montar_cubierta", "9001080050006": "desmontar_montar_cubierta", "9001050050006": "desmontar_montar_cubierta",
  "9001999990010": "quitar_poner_rueda",
  "9001099990004": "equilibrado", "9001050020001": "equilibrado", "9001080020002": "equilibrado", "9001089990004": "equilibrado", "9001059990004": "equilibrado",
  "9001099990014": "pinchazo",
  "9001099990005": "rayados",
  "9001099990002": "alineacion_standard", "9001089990002": "alineacion_standard",
  "9008999990001": "salida_servicio_movil",
  "9008999990009": "horas_oficial_1a", "9001990070001": "horas_oficial_1a", "9099090110002": "horas_oficial_1a",
  "9008090050001": "km_recorridos",
  "C2123": "valvulas",
  "B1198X": "alargaderas", "B9615X": "alargaderas",
};
const FAMILIAS_TACOGRAFO = new Set(["14", "26", "13"]);

export interface Anotacion { cond: Condicion; n: number; medida: string | null; modelo: string | null; marca: string | null; variable: boolean }
export function leerAnotacion(l: LineaH1): Anotacion | null {
  const m = /^M(\d{8}|VARIA)([NUR])(\d)$/.exec(l.codigo);
  if (!m) return null;
  const cond: Condicion = m[2] === "N" ? "nueva" : m[2] === "U" ? "usada" : "recauchutada";
  const variable = m[1] === "VARIA";
  const ref = referenciaDeDescripcion(l.descripcion.replace(/^MONTA\d*\s+\d+\s+CUBIERTAS?\s+(NUEVAS?|USADAS?|RECAUCHUTADAS?|RECAUCHU\.?)\s*:?/i, ""));
  return {
    cond, n: Number(m[3]), variable,
    medida: variable ? ref.medida : medidaDeCodigo(m[1]),
    modelo: ref.modelo, marca: ref.marca,
  };
}

export function papelDe(l: LineaH1): Papel {
  if (leerAnotacion(l)) return "anotacion";
  if (l.familia === "01") return "articulo";
  if (l.codigo === CODIGO_INSA_BASE) return "carcasa_base";
  if (CODIGOS_MO_MONTAJE.has(l.codigo)) return "mano_obra_montaje";
  if (SERVICIO_POR_CODIGO[l.codigo]) return "servicio";
  // Tacógrafos y demás cosas que no son de neumáticos, ANTES que la mano de
  // obra genérica: la revisión del tacógrafo también es familia 90.
  if (FAMILIAS_TACOGRAFO.has(l.familia) || /^Z15\d\d$/.test(l.codigo) || /TAC[OÓ]GRAFO|TCFO|VDO|STON(E)?RIDGE|STONRDG/i.test(l.descripcion) || l.codigo === "PLANAV" || l.codigo === "*") return "ignorada";
  if (l.familia === "90") return "mano_obra";
  if (l.codigo === "RF") return "revision_flota";
  if (/VEHICULO/i.test(l.descripcion)) return "num_vehiculo";
  return "material";
}

// ── Agrupar por albarán ─────────────────────────────────────────────────────

export interface Albaran {
  origenDoc: string;      // DOC|MAT normalizados
  documento: string;      // tal cual venía (primera grafía)
  matricula: string;      // normalizada
  lineas: LineaH1[];
  salidas: LineaH2[];
}

export function agruparAlbaranes(h1: LineaH1[], h2: LineaH2[]): { albaranes: Albaran[]; entradas: LineaH2[]; salidasSinAlbaran: LineaH2[] } {
  const mapa = new Map<string, Albaran>();
  for (const l of h1) {
    const doc = normDoc(l.documento), mat = normMat(l.matricula);
    const k = `${doc}|${mat}`;
    let a = mapa.get(k);
    if (!a) { a = { origenDoc: k, documento: l.documento.trim(), matricula: mat, lineas: [], salidas: [] }; mapa.set(k, a); }
    a.lineas.push(l);
  }
  const entradas: LineaH2[] = [];
  const salidasSinAlbaran: LineaH2[] = [];
  for (const s of h2) {
    if (s.doc_entrada && !s.doc_salida) { entradas.push(s); continue; }
    const k = `${normDoc(s.doc_salida)}|${normMat(s.vehiculo)}`;
    const a = mapa.get(k);
    if (a) a.salidas.push(s); else salidasSinAlbaran.push(s);
  }
  return { albaranes: [...mapa.values()], entradas, salidasSinAlbaran };
}

// ── Claves de línea (sin número de fila) ────────────────────────────────────

export function claveContenidoH1(l: LineaH1): string {
  return ["H1", normTxt(l.codigo), normTxt(l.descripcion), n4(l.uds), n4(l.precio_unidad), n4(l.importe_linea)].join("|");
}
export function claveContenidoH2(s: LineaH2): string {
  return ["H2", normTxt(s.articulo), normTxt(s.carcasa), n4(s.unidades)].join("|");
}
/** Ordinal entre líneas idénticas del mismo albarán, en orden canónico. */
function conOrdinal<T>(items: T[], clave: (t: T) => string): { item: T; clave: string; k: number }[] {
  const vistos = new Map<string, number>();
  return items
    .map((item) => ({ item, clave: clave(item) }))
    .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
    .map(({ item, clave: c }) => { const k = (vistos.get(c) ?? 0) + 1; vistos.set(c, k); return { item, clave: c, k }; });
}

// ── Conciliación ────────────────────────────────────────────────────────────

export interface Grupo {
  id: string;                  // uuid determinista
  cond: Condicion;
  medida: string | null;
  marca: string | null;
  modelo: string | null;
  n: number;                   // unidades acordadas
  fuentes: { anotacion: number | null; articulo: number | null; salida: number | null };
  lineaPrincipal: string;      // origen_linea de la evidencia principal
  lineas: string[];            // origen_linea de todas sus evidencias
  evidencia: "anotacion" | "salida+mano_de_obra" | "articulo+mano_de_obra";
  montaje: boolean;            // false = entrega/venta sin montaje confirmado
  carcasa_mov: string | null;
}

export interface OperacionImport {
  origen_linea: string; grupo: string; condicion: Condicion;
  marca: string | null; modelo: string | null; medida: string | null; observaciones: string;
}
export interface ServicioImport { servicio: string; cantidad: number; grupo: string }
export interface LineaImport {
  origen_linea: string; hoja: "H1" | "H2"; papel: Papel; grupo: string | null; incidencia: string | null;
  documento: string; matricula: string; fecha: string | null; hora_origen: string | null; km: number | null;
  codigo: string | null; descripcion: string | null; familia: string | null; categoria: string | null; marca: string | null;
  uds: number | null; precio_unidad: number | null; pct_dto: number | null; importe_linea: number | null; pct_iva: number | null;
  estado_documento: string | null; articulo: string | null; carcasa_mov: string | null; almacen: string | null;
  usuario_origen: string | null; tipo_mov: "salida" | "entrada" | null;
}

export type EstadoAlbaran = "importable" | "bloqueado" | "sin_contenido";

export interface AlbaranConciliado {
  origen_doc: string; documento: string; matricula: string;
  fecha: string | null; km: number | null;
  estado: EstadoAlbaran;
  bloqueante: string | null;
  incidencias: string[];       // no bloqueantes (revisión)
  grupos: Grupo[];
  operaciones: OperacionImport[];
  servicios: ServicioImport[];
  lineas: LineaImport[];
  resumen: string;
  observaciones: string;
  estado_documento: string | null;
  huella_origen: string;
  nuevas_total: number;
  nuevas_una_referencia: boolean;
}

/** uuid determinista (v5-like) a partir de un texto: el grupo de un albarán se llama igual en cada carga. */
export async function uuidDesdeTexto(texto: string): Promise<string> {
  const hex = await sha256Hex("tc-importacion-historico|" + texto);
  const h = hex.slice(0, 32).split("");
  h[12] = "5"; h[16] = ["8", "9", "a", "b"][parseInt(h[16], 16) % 4];
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** La huella de ORIGEN: el contenido normalizado del albarán, en orden canónico. */
export async function huellaOrigen(a: Albaran, fecha: string | null, km: number | null): Promise<string> {
  const l1 = conOrdinal(a.lineas, claveContenidoH1).map((x) => `${x.clave}|${n4(x.item.pct_dto)}|${n4(x.item.pct_iva)}|${normTxt(x.item.estado_documento)}`);
  const l2 = conOrdinal(a.salidas, claveContenidoH2).map((x) => `${x.clave}|${x.item.fecha ?? ""}|${normTxt(x.item.usuario)}`);
  return sha256Hex(JSON.stringify({ d: a.origenDoc, f: fecha, k: km, l1, l2 }));
}

export async function conciliarAlbaran(a: Albaran): Promise<AlbaranConciliado> {
  const incidencias: string[] = [];
  const bloq: string[] = [];
  const lineasH1 = conOrdinal(a.lineas, claveContenidoH1);
  const lineasH2 = conOrdinal(a.salidas, claveContenidoH2);
  const ol1 = (x: { clave: string; k: number }) => `${a.origenDoc}|${x.clave}|${x.k}`;
  const ol2 = (x: { clave: string; k: number }) => `${a.origenDoc}|${x.clave}|${x.k}`;

  // Matrícula, fechas, km.
  if (!a.matricula) bloq.push("Línea sin matrícula");
  else if (!MATRICULA_VALIDA.test(a.matricula)) bloq.push(`Matrícula no válida: ${a.matricula}`);
  const fechas = [...new Set(a.lineas.map((l) => l.fecha).filter(Boolean))] as string[];
  const fecha = fechas[0] ?? null;
  if (fechas.length > 1) bloq.push(`Más de una fecha en el albarán: ${fechas.join(", ")}`);
  if (!fecha) bloq.push("Albarán sin fecha");
  const fechasH2 = [...new Set(a.salidas.map((s) => (s.fecha ?? "").slice(0, 10)).filter(Boolean))];
  for (const f of fechasH2) if (fecha && f !== fecha) bloq.push(`La salida del depósito es del ${f} y el albarán del ${fecha}`);
  const kms = [...new Set(a.lineas.map((l) => l.km).filter((k): k is number => k != null && k > 0))];
  const km = kms.length === 1 ? kms[0] : null;
  if (kms.length > 1) bloq.push(`Varios kilometrajes distintos en el albarán: ${kms.join(", ")}`);

  // Las líneas, con su papel.
  const lineas: LineaImport[] = [];
  const papelPorLinea = new Map<string, Papel>();
  const anotaciones: { ol: string; a: Anotacion; l: LineaH1; idx: number }[] = [];
  const articulos: { ol: string; l: LineaH1; idx: number; consumido: boolean }[] = [];
  const insa: { ol: string; l: LineaH1 }[] = [];
  let manoObraMontaje = 0;
  const servicios = new Map<string, { cantidad: number; lineas: string[] }>();
  const numVehiculo: string[] = [];
  let revisionFlota = false;

  // Para «MVARIA» hace falta el orden ORIGINAL del fichero (la siguiente línea
  // de familia 01), no el canónico.
  const ordenOriginal = new Map<LineaH1, number>(a.lineas.map((l, i) => [l, i]));

  for (const x of lineasH1) {
    const l = x.item; const ol = ol1(x); const papel = papelDe(l);
    papelPorLinea.set(ol, papel);
    lineas.push({
      origen_linea: ol, hoja: "H1", papel, grupo: null, incidencia: null,
      documento: l.documento, matricula: a.matricula, fecha: l.fecha, hora_origen: null, km: l.km,
      codigo: l.codigo || null, descripcion: l.descripcion || null, familia: l.familia || null, categoria: l.categoria || null, marca: l.marca || null,
      uds: l.uds, precio_unidad: l.precio_unidad, pct_dto: l.pct_dto, importe_linea: l.importe_linea, pct_iva: l.pct_iva,
      estado_documento: l.estado_documento || null, articulo: null, carcasa_mov: null, almacen: null, usuario_origen: null, tipo_mov: null,
    });
    if (papel === "anotacion") {
      const an = leerAnotacion(l)!;
      if (l.uds != null && l.uds !== 1) bloq.push(`La anotación «${l.descripcion}» lleva Uds. = ${l.uds}: no se sabe si son ${an.n} o ${an.n * l.uds} neumáticos`);
      anotaciones.push({ ol, a: an, l, idx: ordenOriginal.get(l)! });
    } else if (papel === "articulo") articulos.push({ ol, l, idx: ordenOriginal.get(l)!, consumido: false });
    else if (papel === "carcasa_base") insa.push({ ol, l });
    else if (papel === "mano_obra_montaje" || papel === "servicio") {
      if (papel === "mano_obra_montaje") manoObraMontaje += l.uds ?? 0;
      const srv = SERVICIO_POR_CODIGO[l.codigo];
      const s = servicios.get(srv) ?? { cantidad: 0, lineas: [] };
      s.cantidad += l.uds ?? 0; s.lineas.push(ol); servicios.set(srv, s);
    } else if (papel === "num_vehiculo") { const m = /(\d+)/.exec(l.descripcion); if (m) numVehiculo.push(m[1]); }
    else if (papel === "revision_flota") revisionFlota = true;
  }
  const salidas = lineasH2.map((x) => ({ ol: ol2(x), s: x.item }));
  for (const { ol, s } of salidas) {
    lineas.push({
      origen_linea: ol, hoja: "H2", papel: "salida", grupo: null, incidencia: null,
      documento: s.doc_salida, matricula: a.matricula, fecha: (s.fecha ?? "").slice(0, 10) || null, hora_origen: s.fecha, km: null,
      codigo: null, descripcion: s.descripcion || null, familia: null, categoria: s.categoria || null, marca: s.marca || null,
      uds: s.unidades, precio_unidad: null, pct_dto: null, importe_linea: null, pct_iva: null,
      estado_documento: null, articulo: s.articulo, carcasa_mov: s.carcasa || null, almacen: s.almacen || null, usuario_origen: s.usuario || null, tipo_mov: "salida",
    });
  }

  // ── Grupos: condición + medida + referencia compatible ──────────────────
  interface GrupoTmp {
    cond: Condicion; medida: string | null; marca: string | null; modelo: string | null;
    anot: number; art: number; sal: number; lineas: string[]; principal: string | null; carcasa: string | null; repetida: boolean;
  }
  const grupos: GrupoTmp[] = [];
  const buscar = (cond: Condicion, medida: string | null, marca: string | null, modelo: string | null): GrupoTmp | "ambiguo" | null => {
    const cand = grupos.filter((g) => g.cond === cond && g.medida === medida
      && (!marca || !g.marca || normTxt(marca) === normTxt(g.marca)) && modelosCompatibles(modelo, g.modelo));
    if (cand.length > 1) return "ambiguo";
    return cand[0] ?? null;
  };
  const anadir = (g: GrupoTmp, marca: string | null, modelo: string | null, ol: string) => {
    g.marca = g.marca ?? marca; g.modelo = elMasCompleto(g.modelo, modelo); g.lineas.push(ol);
  };

  // 1. Anotaciones (fuente A), sumando dentro de la fuente.
  const clavesAnot = new Map<string, number>();
  for (const an of anotaciones.sort((p, q) => p.idx - q.idx)) {
    let { medida, marca, modelo } = an.a;
    let artOl: string | null = null; let artUds = 0;
    if (an.a.variable) {
      // En una NUEVA la referencia va en la siguiente línea de familia 01 (el
      // neumático vendido). Las usadas y recauchutadas no se venden: la
      // referencia, si la hay, va en la propia descripción («MONTA 1 CUBIERTA
      // USADA: 295/80R22.5 HANKOOK AH51») y si no, se queda sin medida.
      // La primera línea de artículo que la siga, a la distancia que sea (en
      // algunos albaranes van la revisión y el nº de vehículo por medio).
      const art = an.a.cond === "nueva" ? articulos.filter((r) => !r.consumido && r.idx > an.idx).sort((p, q) => p.idx - q.idx)[0] : undefined;
      if (art) {
        const ref = referenciaDeDescripcion(art.l.descripcion);
        medida = ref.medida; marca = ref.marca; modelo = ref.modelo; art.consumido = true;
        artOl = art.ol; artUds = art.l.uds ?? 0;
      } else if (an.a.cond === "nueva") {
        // Sin artículo: la goma salió del depósito del cliente. Vale si en el
        // albarán hay UNA sola referencia de salida y sus unidades cuadran.
        const refs = new Set(salidas.map((x) => x.s.articulo));
        const uds = salidas.reduce((n, x) => n + Math.abs(x.s.unidades ?? 0), 0);
        if (refs.size === 1 && uds === an.a.n) {
          const ref = referenciaDeDescripcion(salidas[0].s.descripcion);
          medida = ref.medida; marca = ref.marca; modelo = ref.modelo;
        } else {
          bloq.push(`«${an.l.descripcion}» sin la línea del neumático ni una salida del depósito que la respalde`);
        }
      }
    }
    const kk = claveContenidoH1(an.l);
    clavesAnot.set(kk, (clavesAnot.get(kk) ?? 0) + 1);
    const g = buscar(an.a.cond, medida, marca, modelo);
    if (g === "ambiguo") { bloq.push(`Varios grupos compatibles para «${an.l.descripcion}»`); continue; }
    const destino: GrupoTmp = g ?? { cond: an.a.cond, medida, marca, modelo, anot: 0, art: 0, sal: 0, lineas: [], principal: an.ol, carcasa: null, repetida: false };
    if (!g) grupos.push(destino);
    destino.anot += an.a.n; anadir(destino, marca, modelo, an.ol);
    if (artOl) { destino.art += artUds; destino.lineas.push(artOl); }
  }
  for (const [kk, veces] of clavesAnot) if (veces > 1) for (const g of grupos) if (g.lineas.some((ol) => ol.includes(`|${kk}|`))) g.repetida = true;

  // 2. Artículos sueltos (fuente B).
  for (const art of articulos.filter((r) => !r.consumido)) {
    const ref = referenciaDeDescripcion(art.l.descripcion);
    const g = buscar("nueva", ref.medida, ref.marca, ref.modelo);
    if (g === "ambiguo") { bloq.push(`Varios grupos compatibles para el artículo «${art.l.descripcion}»`); continue; }
    if (g) { g.art += art.l.uds ?? 0; anadir(g, ref.marca, ref.modelo, art.ol); }
    else grupos.push({ cond: "nueva", medida: ref.medida, marca: ref.marca, modelo: ref.modelo, anot: 0, art: art.l.uds ?? 0, sal: 0, lineas: [art.ol], principal: art.ol, carcasa: null, repetida: false });
  }

  // 3. Salidas del depósito (fuente C): siempre nuevas.
  for (const { ol, s } of salidas) {
    const ref = referenciaDeDescripcion(s.descripcion);
    const u = Math.abs(s.unidades ?? 0);
    const g = buscar("nueva", ref.medida, ref.marca, ref.modelo);
    if (g === "ambiguo") { bloq.push(`La salida «${s.descripcion}» encaja con varios grupos: no se asigna sola`); continue; }
    if (g) { g.sal += u; anadir(g, ref.marca, ref.modelo, ol); g.carcasa = g.carcasa ?? (s.carcasa || null); }
    else grupos.push({ cond: "nueva", medida: ref.medida, marca: ref.marca, modelo: ref.modelo, anot: 0, art: 0, sal: u, lineas: [ol], principal: ol, carcasa: s.carcasa || null, repetida: false });
  }

  // 4. Carcasa INSA: material del grupo recauchutado que cuadre.
  for (const { ol, l } of insa) {
    const med = medidaDeTexto(l.descripcion);
    const r = grupos.filter((g) => g.cond === "recauchutada" && g.medida === med);
    if (r.length === 1 && r[0].anot === (l.uds ?? 0)) { r[0].lineas.push(ol); papelPorLinea.set(ol, "carcasa_base"); }
    else bloq.push(`Carcasa «${l.descripcion}» ×${l.uds} sin un montaje recauchutado que cuadre`);
  }

  // 5. Comparar fuentes y decidir cantidades.
  const gruposFinales: Grupo[] = [];
  const totalUnidades = grupos.reduce((n, g) => n + Math.max(g.anot, g.art, g.sal), 0);
  const necesitanRespaldo = grupos.filter((g) => g.anot === 0);
  let respaldo: "ok" | "ninguno" | "parcial" = "ok";
  if (necesitanRespaldo.length > 0) {
    respaldo = manoObraMontaje >= totalUnidades ? "ok" : manoObraMontaje === 0 ? "ninguno" : "parcial";
    if (respaldo === "parcial") bloq.push(`Mano de obra de montaje (${manoObraMontaje}) insuficiente para ${totalUnidades} neumáticos y hay ${necesitanRespaldo.length} grupo(s) sin anotación: revisar`);
  } else if (manoObraMontaje > 0 && manoObraMontaje < totalUnidades) {
    incidencias.push(`Mano de obra de montaje (${manoObraMontaje}) menor que los neumáticos anotados (${totalUnidades})`);
  }
  for (const g of grupos) {
    const fuentes = [g.anot, g.art, g.sal].filter((n) => n > 0);
    const distintas = new Set(fuentes);
    if (distintas.size > 1) {
      bloq.push(`Descuadre en ${g.cond} ${g.medida ?? "?"}${g.modelo ? " " + g.modelo : ""}: anotado ${g.anot || "—"}, artículo ${g.art || "—"}, salida ${g.sal || "—"}`);
      continue;
    }
    if (g.repetida && fuentes.length < 2) {
      bloq.push(`Anotación repetida idéntica (${g.cond} ${g.medida ?? "?"} ×${g.anot}) sin otra fuente que la corrobore`);
      continue;
    }
    const n = fuentes[0] ?? 0;
    if (n <= 0) continue;
    const sinAnot = g.anot === 0;
    const montaje = !sinAnot || respaldo === "ok";
    if (sinAnot && respaldo === "ninguno") incidencias.push(`${g.cond} ${g.medida ?? "?"} ×${n}: ${g.sal ? "salida del depósito" : "artículo"} sin mano de obra de montaje → se conserva como entrega, sin operación`);
    const id = await uuidDesdeTexto(`${a.origenDoc}|${g.cond}|${g.medida}|${normTxt(g.marca ?? "")}|${normTxt(g.modelo ?? "")}`);
    gruposFinales.push({
      id, cond: g.cond, medida: g.medida, marca: g.marca, modelo: g.modelo, n,
      fuentes: { anotacion: g.anot || null, articulo: g.art || null, salida: g.sal || null },
      lineaPrincipal: g.principal!, lineas: g.lineas,
      evidencia: !sinAnot ? "anotacion" : g.sal ? "salida+mano_de_obra" : "articulo+mano_de_obra",
      montaje, carcasa_mov: g.carcasa,
    });
    for (const ln of lineas) if (g.lineas.includes(ln.origen_linea)) ln.grupo = id;
  }

  // 6. Operaciones por unidad.
  const operaciones: OperacionImport[] = [];
  for (const g of gruposFinales) {
    if (!g.montaje) continue;
    const obs: string[] = [];
    if (g.cond === "usada") obs.push("[USADO]");
    if (g.cond === "recauchutada") obs.push("[RECAUCHUTADO]");
    if (g.fuentes.salida) obs.push(`Salida del depósito ${a.documento}${g.carcasa_mov ? " · mov. " + g.carcasa_mov : ""} · ${g.fuentes.salida} uds`);
    if (g.evidencia !== "anotacion") obs.push("Montaje deducido de la salida/artículo y la mano de obra del albarán");
    for (let i = 1; i <= g.n; i++) {
      operaciones.push({
        origen_linea: `${g.lineaPrincipal}|u${i}/${g.n}`, grupo: g.id, condicion: g.cond,
        marca: g.marca, modelo: g.modelo, medida: g.medida, observaciones: obs.join(" · "),
      });
    }
  }

  // 7. Servicios agregados, con su grupo.
  const serviciosImport: ServicioImport[] = [];
  for (const [srv, s] of servicios) {
    if (s.cantidad <= 0) continue;
    const id = await uuidDesdeTexto(`${a.origenDoc}|servicio|${srv}`);
    serviciosImport.push({ servicio: srv, cantidad: s.cantidad, grupo: id });
    for (const ln of lineas) if (s.lineas.includes(ln.origen_linea)) ln.grupo = id;
  }

  // Km solo si hay algo que lo necesite.
  if (km == null && operaciones.length > 0) incidencias.push("Albarán sin kilometraje");

  // Resumen y observaciones.
  const partes = gruposFinales.filter((g) => g.montaje).map((g) =>
    `${g.n} ${g.cond === "nueva" ? "nueva" + (g.n > 1 ? "s" : "") : g.cond === "usada" ? "usada" + (g.n > 1 ? "s" : "") : "recauchutada" + (g.n > 1 ? "s" : "")} ${g.medida ?? ""}${g.marca ? " " + g.marca : ""}${g.modelo ? " " + g.modelo : ""}`.trim());
  const resumen = `Albarán ${a.documento}${partes.length ? " · " + partes.join(" · ") : serviciosImport.length ? " · solo servicios" : ""}`;
  const obsAlb: string[] = [];
  if (revisionFlota) obsAlb.push("Revisión de flota (sin mediciones)");
  if (numVehiculo.length) obsAlb.push(`Nº vehículo en origen: ${[...new Set(numVehiculo)].join(", ")}`);
  const estadoDoc = [...new Set(a.lineas.map((l) => l.estado_documento).filter(Boolean))].join("/") || null;

  const relevante = operaciones.length > 0 || serviciosImport.length > 0 || gruposFinales.length > 0
    || lineas.some((l) => l.papel === "material" || l.papel === "mano_obra" || l.papel === "revision_flota");
  const estado: EstadoAlbaran = bloq.length ? "bloqueado" : relevante ? "importable" : "sin_contenido";
  const nuevas = gruposFinales.filter((g) => g.montaje && g.cond === "nueva");
  const nuevasTotal = nuevas.reduce((n, g) => n + g.n, 0);

  return {
    origen_doc: a.origenDoc, documento: a.documento, matricula: a.matricula, fecha, km,
    estado, bloqueante: bloq.length ? bloq.join(" · ") : null, incidencias,
    grupos: gruposFinales, operaciones, servicios: serviciosImport, lineas,
    resumen, observaciones: obsAlb.join(" · "), estado_documento: estadoDoc,
    huella_origen: await huellaOrigen(a, fecha, km),
    nuevas_total: nuevasTotal,
    nuevas_una_referencia: nuevas.length === 1,
  };
}

/** El albarán tal y como lo espera `tc_importar_historico`. */
export function albaranParaRpc(c: AlbaranConciliado): Record<string, unknown> {
  return {
    origen_doc: c.origen_doc, documento: c.documento, matricula: c.matricula, fecha: c.fecha, km: c.km,
    huella_origen: c.huella_origen, resumen: c.resumen, observaciones: c.observaciones || null,
    estado_documento: c.estado_documento, bloqueante: c.bloqueante,
    operaciones: c.operaciones, servicios: c.servicios, lineas: c.lineas,
  };
}

/** Los albaranes importables y bloqueados, por mes (lote = mes natural). */
export function porPeriodo(albs: AlbaranConciliado[]): Map<string, AlbaranConciliado[]> {
  const m = new Map<string, AlbaranConciliado[]>();
  for (const a of albs) {
    if (a.estado === "sin_contenido") continue;
    const p = (a.fecha ?? "sin-fecha").slice(0, 7);
    const l = m.get(p) ?? []; l.push(a); m.set(p, l);
  }
  return new Map([...m.entries()].sort());
}

export interface ResumenConciliacion {
  albaranes: number; importables: number; bloqueados: number; sinContenido: number;
  operaciones: number; servicios: number; lineas: number;
  porCondicion: Record<Condicion, number>;
  entradasDeposito: number; salidasSinAlbaran: number;
}
export function resumir(albs: AlbaranConciliado[], entradas: number, salidasSinAlbaran: number): ResumenConciliacion {
  const r: ResumenConciliacion = {
    albaranes: albs.length, importables: 0, bloqueados: 0, sinContenido: 0, operaciones: 0, servicios: 0, lineas: 0,
    porCondicion: { nueva: 0, usada: 0, recauchutada: 0 }, entradasDeposito: entradas, salidasSinAlbaran,
  };
  for (const a of albs) {
    if (a.estado === "importable") r.importables++; else if (a.estado === "bloqueado") r.bloqueados++; else r.sinContenido++;
    if (a.estado !== "importable") continue;
    r.operaciones += a.operaciones.length; r.servicios += a.servicios.length; r.lineas += a.lineas.length;
    for (const o of a.operaciones) r.porCondicion[o.condicion]++;
  }
  // Invariante del resumen: cada operación tiene exactamente una condición.
  // Si alguna vez deja de cuadrar, mejor que reviente aquí que enseñar dos
  // totales incompatibles en la pantalla.
  const suma = r.porCondicion.nueva + r.porCondicion.usada + r.porCondicion.recauchutada;
  if (suma !== r.operaciones) throw new Error(`Resumen descuadrado: ${r.operaciones} operaciones y ${suma} por condición`);
  return r;
}
