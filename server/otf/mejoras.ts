/**
 * Las reglas de las mejoras de OTF que no son SQL: orden de los trabajos en la
 * base, la lista de comprobación de cada plantilla, el material usado y a
 * quién se avisa. Puras, para probarlas sin base de datos.
 */

// ── Orden de los trabajos en la base ────────────────────────────────────────

/**
 * La plaza de un trabajo, sacada de las observaciones de la oficina
 * («remolque en plaza 27», «Pl. 3», «plaza nº 12»). null si no la dicen.
 */
export function plazaDe(observaciones: unknown): number | null {
  const m = String(observaciones ?? "").match(/\bpl(?:aza|\.)?\s*(?:n[º°o.]?\s*)?(\d{1,4})\b/i);
  return m ? Number(m[1]) : null;
}

const ORDEN_ESTADO: Record<string, number> = { en_proceso: 0, pendiente: 1, finalizado: 2, no_realizado: 3 };

/**
 * Para recorrer la base sin dar vueltas: primero lo que está a medias, luego
 * lo pendiente por número de plaza (los que no la dicen, al final y en el
 * orden en que se crearon), y lo hecho abajo.
 */
export function ordenarTrabajosEnBase<T extends { id: number; status?: string | null; observaciones?: unknown }>(
  trabajos: T[]
): T[] {
  return [...trabajos].sort((a, b) => {
    const ea = ORDEN_ESTADO[a.status ?? "pendiente"] ?? 1;
    const eb = ORDEN_ESTADO[b.status ?? "pendiente"] ?? 1;
    if (ea !== eb) return ea - eb;
    const pa = plazaDe(a.observaciones) ?? Number.POSITIVE_INFINITY;
    const pb = plazaDe(b.observaciones) ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return a.id - b.id;
  });
}

// ── Lista de comprobación por plantilla ─────────────────────────────────────

/** Los puntos de una plantilla: uno por línea, sin vacíos ni repetidos. */
export function limpiarChecklist(entrada: unknown): string[] {
  const lineas = Array.isArray(entrada)
    ? entrada.map((x) => String(x ?? ""))
    : String(entrada ?? "").split(/\r?\n/);
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const l of lineas) {
    const t = l.trim().slice(0, 120);
    if (!t || vistos.has(t.toLowerCase())) continue;
    vistos.add(t.toLowerCase());
    out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

export type PuntoChecklist = { texto: string; hecho: boolean; valor: string | null };

/**
 * Lo que manda la tablet al finalizar, limpio: solo los puntos de la
 * plantilla (en su orden), con «hecho» y un valor opcional («8,5 bar»).
 */
export function resultadoChecklist(puntos: string[], enviado: unknown): PuntoChecklist[] {
  const lista = Array.isArray(enviado) ? enviado : [];
  return puntos.map((texto) => {
    const r = lista.find((x: any) => x && String(x.texto ?? "").trim() === texto) as any;
    const valor = r?.valor != null ? String(r.valor).trim().slice(0, 60) : "";
    return { texto, hecho: r?.hecho === true, valor: valor || null };
  });
}

// ── Material usado ──────────────────────────────────────────────────────────

export type Material = {
  tipo: "neumatico" | "otro";
  descripcion: string;
  marca: string | null;
  estado: "nuevo" | "usado" | null;
  cantidad: number;
};

export class ErrorMaterial extends Error {}

/** Un neumático o pieza montada, validado. */
export function limpiarMaterial(b: any): Material {
  const tipo = b?.tipo === "otro" ? "otro" : "neumatico";
  const descripcion = String(b?.descripcion ?? b?.medida ?? "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 80);
  if (!descripcion) throw new ErrorMaterial(tipo === "neumatico" ? "Indica la medida" : "Indica qué material");
  const cantidad = Math.round(Number(b?.cantidad ?? 1));
  if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > 50) throw new ErrorMaterial("Cantidad entre 1 y 50");
  const marca = String(b?.marca ?? "").trim().slice(0, 60) || null;
  const estado = b?.estado === "usado" ? "usado" : b?.estado === "nuevo" ? "nuevo" : tipo === "neumatico" ? "nuevo" : null;
  return { tipo, descripcion, marca, estado, cantidad };
}

/**
 * El código de Mobilink de un material, para mapearlo con el artículo del ERP
 * como las plantillas de trabajo: «NEUMATICO 385/65R22.5 NUEVO».
 */
export function codigoMaterial(m: Pick<Material, "tipo" | "descripcion" | "estado">): string {
  const base = m.tipo === "neumatico" ? `NEUMATICO ${m.descripcion}` : `MATERIAL ${m.descripcion}`;
  return m.estado ? `${base} ${m.estado.toUpperCase()}` : base;
}

export function textoMaterial(m: Pick<Material, "descripcion" | "marca" | "estado" | "cantidad">): string {
  return `${m.cantidad} × ${m.descripcion}${m.marca ? ` ${m.marca}` : ""}${m.estado ? ` (${m.estado})` : ""}`;
}

// ── Aviso al responsable y correo del informe ───────────────────────────────

/** Un correo con forma de correo, o null. */
export function emailValido(v: unknown): string | null {
  const t = String(v ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

/** Un teléfono con al menos 9 cifras, o null. */
export function telefonoValido(v: unknown): string | null {
  const t = String(v ?? "").trim();
  return t.replace(/\D/g, "").length >= 9 ? t : null;
}

// ── Tiempo de cada trabajo en el informe ────────────────────────────────────

/**
 * Inicio, fin y duración de un trabajo. Si no se pulsó «Empezar», el inicio
 * es la primera foto; si se cerró sin hora de fin, la última actualización.
 */
export function tiemposTrabajo(t: {
  status?: string | null;
  iniciadoAtMs?: number | null;
  finalizadoAtMs?: number | null;
  updatedAtMs?: number | null;
  fotos?: { createdAtMs?: number | null }[];
}): { inicioMs: number | null; finMs: number | null; segundos: number | null } {
  const fotos = (t.fotos ?? []).map((f) => Number(f.createdAtMs)).filter((x) => Number.isFinite(x) && x > 0);
  const inicioMs = t.iniciadoAtMs ?? (fotos.length ? Math.min(...fotos) : null);
  const cerrado = t.status === "finalizado" || t.status === "no_realizado";
  const finMs = t.finalizadoAtMs ?? (cerrado ? t.updatedAtMs ?? null : null);
  const segundos = inicioMs != null && finMs != null && finMs >= inicioMs ? Math.round((finMs - inicioMs) / 1000) : null;
  return { inicioMs, finMs, segundos };
}

/** «10:29», hora de Madrid. */
export function horaEs(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
}

/** «30 min», «1 h 05 min». */
export function duracionCorta(seg: number | null | undefined): string {
  if (seg == null) return "—";
  const m = Math.max(0, Math.round(seg / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Cómo se llama cada tipo de foto en el informe y en el panel. */
export const ETIQUETA_FOTO: Record<string, string> = {
  matricula: "Matrícula",
  averia: "Avería",
  inicial: "Antes",
  final: "Trabajo hecho",
  no_realizado: "No realizado",
};
