/**
 * Completar fichas del catálogo con IA: las reglas, en puro y con pruebas.
 *
 * La IA BUSCA y COPIA; esto DECIDE si lo copiado vale:
 *  - ¿La ficha leída es de esta referencia? (marca, modelo, medida, IC)
 *  - ¿Cada valor es posible? (rangos, letras de etiqueta, EAN-13)
 *  - ¿Trae una URL que abrir? Sin URL no se propone.
 */

export type TipoFuente = "oficial" | "eprel" | "distribuidor";

export interface CampoFicha {
  clave: string;
  etiqueta: string;
  tipo: "numero" | "entero" | "letra" | "bool" | "texto" | "ean";
  min?: number;
  max?: number;
  letras?: string[];
  unidad?: string;
}

/** Los campos que se pueden completar, con su comprobación. */
export const CAMPOS: CampoFicha[] = [
  { clave: "profundidad_dibujo_mm", etiqueta: "Profundidad de nuevo", tipo: "numero", min: 5, max: 30, unidad: "mm" },
  { clave: "etiqueta_rr", etiqueta: "Etiqueta: rodadura", tipo: "letra", letras: ["A", "B", "C", "D", "E", "F", "G"] },
  { clave: "etiqueta_grip_humedo", etiqueta: "Etiqueta: mojado", tipo: "letra", letras: ["A", "B", "C", "D", "E", "F", "G"] },
  { clave: "etiqueta_ruido_db", etiqueta: "Etiqueta: ruido", tipo: "entero", min: 60, max: 85, unidad: "dB" },
  { clave: "etiqueta_ruido_clase", etiqueta: "Etiqueta: clase de ruido", tipo: "letra", letras: ["A", "B", "C"] },
  { clave: "m_s", etiqueta: "M+S", tipo: "bool" },
  { clave: "tres_pmsf", etiqueta: "3PMSF", tipo: "bool" },
  { clave: "ean", etiqueta: "EAN", tipo: "ean" },
  { clave: "peso_kg", etiqueta: "Peso", tipo: "numero", min: 20, max: 150, unidad: "kg" },
  { clave: "ply", etiqueta: "Lonas (ply)", tipo: "entero", min: 10, max: 24 },
  { clave: "diametro_exterior_mm", etiqueta: "Diámetro exterior", tipo: "numero", min: 600, max: 1400, unidad: "mm" },
  { clave: "ancho_seccion_mm", etiqueta: "Ancho de sección", tipo: "numero", min: 150, max: 520, unidad: "mm" },
  { clave: "revoluciones_km", etiqueta: "Revoluciones/km", tipo: "numero", min: 250, max: 800 },
  { clave: "carga_maxima_kg", etiqueta: "Carga máxima", tipo: "numero", min: 800, max: 8000, unidad: "kg" },
  { clave: "presion_maxima_bar", etiqueta: "Presión máxima", tipo: "numero", min: 4, max: 12, unidad: "bar" },
  { clave: "llanta_recomendada", etiqueta: "Llanta recomendada", tipo: "texto" },
  { clave: "codigo_fabricante", etiqueta: "Código de fabricante", tipo: "texto" },
];

export const CAMPO_POR_CLAVE = new Map(CAMPOS.map((c) => [c.clave, c]));

/** EAN-13 con su dígito de control. */
export function eanValido(v: string): boolean {
  if (!/^\d{13}$/.test(v)) return false;
  const d = v.split("").map(Number);
  const suma = d.slice(0, 12).reduce((a, x, i) => a + x * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (suma % 10)) % 10 === d[12];
}

export type Validacion = { ok: true; valor: string | number | boolean } | { ok: false; motivo: string };

/** ¿Es posible este valor para este campo? Devuelve el valor normalizado. */
export function validarValor(clave: string, bruto: unknown): Validacion {
  const c = CAMPO_POR_CLAVE.get(clave);
  if (!c) return { ok: false, motivo: "Campo desconocido" };
  if (bruto === null || bruto === undefined || bruto === "") return { ok: false, motivo: "Sin valor" };

  if (c.tipo === "bool") {
    if (typeof bruto === "boolean") return { ok: true, valor: bruto };
    const t = String(bruto).trim().toLowerCase();
    if (["true", "sí", "si", "yes", "1"].includes(t)) return { ok: true, valor: true };
    if (["false", "no", "0"].includes(t)) return { ok: true, valor: false };
    return { ok: false, motivo: `«${bruto}» no es sí/no` };
  }
  if (c.tipo === "letra") {
    const t = String(bruto).trim().toUpperCase();
    return c.letras!.includes(t) ? { ok: true, valor: t } : { ok: false, motivo: `«${bruto}» no es una clase válida (${c.letras!.join(", ")})` };
  }
  if (c.tipo === "ean") {
    const t = String(bruto).replace(/\s/g, "");
    return eanValido(t) ? { ok: true, valor: t } : { ok: false, motivo: `«${bruto}» no es un EAN-13 válido` };
  }
  if (c.tipo === "texto") {
    const t = String(bruto).trim();
    return t && t.length <= 60 ? { ok: true, valor: t } : { ok: false, motivo: "Texto vacío o demasiado largo" };
  }
  const n = Number(String(bruto).replace(",", ".").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return { ok: false, motivo: `«${bruto}» no es un número` };
  if (c.tipo === "entero" && !Number.isInteger(n)) return { ok: false, motivo: `«${bruto}» no es un número entero` };
  if ((c.min !== undefined && n < c.min) || (c.max !== undefined && n > c.max)) {
    return { ok: false, motivo: `${n}${c.unidad ? ` ${c.unidad}` : ""} fuera de lo posible (${c.min}–${c.max})` };
  }
  return { ok: true, valor: n };
}

const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** «295/80 R22.5» y «295/80R22.5» son la misma medida. */
export const medidaBase = (s: unknown) => String(s ?? "").toUpperCase().replace(/\s+/g, "").replace(/^(\d+\/\d+)R/, "$1R");

/** Índices de carga de una referencia: «154/150» o «160» → ["154","150"]. */
export function indicesDe(texto: string): string[] {
  // Fuera la medida (315/70R22.5, 385/55 R22.5, 11R22.5) y queda el índice.
  const sinMedida = String(texto ?? "").toUpperCase().replace(/\d{2,3}(\/\d{2})?\s?R\s?\d{2}(\.\d)?/g, " ");
  const todos = [...sinMedida.matchAll(/(?:^|[^\d])(\d{3})(?:\/(\d{3}))?[A-Z]?(?![\d])/g)];
  const m = todos[todos.length - 1];
  return m ? ([m[1], m[2]].filter(Boolean) as string[]) : [];
}

export interface FichaLeida { marca?: string | null; modelo?: string | null; medida?: string | null; indiceCarga?: string | null }
export interface RefCatalogo { marca: string; modelo: string; medida: string; referenciaCompleta: string }

/** ¿La ficha que leyó la IA es de ESTA referencia? */
export function coincideReferencia(ref: RefCatalogo, leida: FichaLeida): { ok: boolean; motivo: string } {
  const mR = norm(ref.marca), mL = norm(leida.marca);
  if (!mL || !(mL.includes(mR) || mR.includes(mL))) return { ok: false, motivo: `La ficha es de «${leida.marca ?? "?"}», no de ${ref.marca}` };
  const oR = norm(ref.modelo), oL = norm(leida.modelo);
  if (!oL || oL !== oR) return { ok: false, motivo: `La ficha es del modelo «${leida.modelo ?? "?"}», no ${ref.modelo}` };
  if (medidaBase(leida.medida) !== medidaBase(ref.medida)) return { ok: false, motivo: `La ficha es de ${leida.medida ?? "otra medida"}, no ${ref.medida}` };
  const icR = indicesDe(ref.referenciaCompleta);
  const icL = indicesDe(String(leida.indiceCarga ?? ""));
  if (icR.length && icL.length && icR[0] !== icL[0]) return { ok: false, motivo: `Índice de carga ${icL.join("/")}, no ${icR.join("/")}` };
  return { ok: true, motivo: "" };
}

/** Una URL que se puede abrir. */
export function urlValida(u: unknown): boolean {
  try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; }
}

export function tipoFuenteValido(t: unknown): t is TipoFuente {
  return t === "oficial" || t === "eprel" || t === "distribuidor";
}
