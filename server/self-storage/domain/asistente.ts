/**
 * Asistente IA · reglas puras (sin base de datos, sin red, sin proveedor).
 *
 *   · Reglas OBLIGATORIAS: en el código, no se pueden quitar desde el panel.
 *   · Guardas sobre lo que el modelo dice: si suena a precio inventado, se
 *     sustituye por la remisión a la web (y se marca para revisión).
 *   · Búsqueda en la base de conocimiento (estático) por coincidencia de
 *     palabras; los datos dinámicos van SIEMPRE por herramientas.
 *   · Instrucciones para el proveedor (igual para cualquiera).
 *   · Enrutado de una llamada: IA, humano o híbrido.
 */

import { z } from "zod";

export const REGLAS_OBLIGATORIAS: readonly string[] = [
  "Nunca inventes precios, disponibilidad, tamaños disponibles, horarios, condiciones contractuales ni promociones.",
  "Nunca prometas acciones que el sistema no haya confirmado (una visita solicitada no está confirmada).",
  "Nunca modifiques, canceles ni des de baja contratos; nunca cambies precios, pagos ni datos financieros; nunca emitas devoluciones.",
  "No hagas operaciones sensibles: si te las piden, explica que no se pueden hacer por teléfono y pasa con una persona.",
  "Los DATOS DINÁMICOS (disponibilidad, cliente, contrato, centro, estado de acceso, incidencias) sólo salen de las herramientas de Mobilink, nunca de la base de conocimiento ni de tu memoria.",
  "La base de conocimiento sólo explica cómo funciona el servicio (contratación online, calculadora, visitas, modelo low cost, preguntas frecuentes).",
  "Si no tienes la información confirmada: remite a la web o pasa con una persona.",
  "El Call Center informa y ayuda; la web vende: el precio, la disponibilidad definitiva y la contratación se confirman en la web.",
  "Responde en el idioma en que te hablan (castellano o catalán) y mantenlo durante toda la llamada.",
  "No des datos personales de nadie a quien llama: como mucho, confirma si el número corresponde a un cliente y su nombre de pila.",
  "Respuestas breves, claras y amables, como en una llamada telefónica.",
];

/** Importe con moneda en lo que el asistente va a decir: no puede salir de su cabeza. */
export function contienePrecio(texto: string): boolean {
  return /(\d+([.,]\d+)?\s?(€|eur\b|euros?)|(€|eur)\s?\d)/i.test(texto);
}

export const RESPUESTA_SIN_PRECIO: Record<string, (web: string | null) => string> = {
  es: (web) => `Los precios dependen del tamaño y de la disponibilidad del momento. Puedes consultarlos actualizados y contratar online en ${web ?? "nuestra web"}.`,
  ca: (web) => `Els preus depenen de la mida i de la disponibilitat del moment. Els pots consultar actualitzats i contractar en línia a ${web ?? "la nostra web"}.`,
};

/** Respuesta segura cuando el proveedor no contesta y no se puede escalar. */
export const RESPUESTA_FALLO: Record<string, (web: string | null) => string> = {
  es: (web) => `Ahora mismo no puedo ayudarte con eso. Puedes consultar toda la información en ${web ?? "nuestra web"} o volver a llamar en unos minutos.`,
  ca: (web) => `Ara mateix no et puc ajudar amb això. Pots consultar tota la informació a ${web ?? "la nostra web"} o tornar a trucar d'aquí a uns minuts.`,
};
export const RESPUESTA_ESCALADO: Record<string, string> = {
  es: "Te paso con una persona del equipo, que ya tiene el resumen de lo que hemos hablado.",
  ca: "Et passo amb una persona de l'equip, que ja té el resum del que hem parlat.",
};
export const textoEn = <T>(m: Record<string, T>, idioma: string | null | undefined): T => m[idioma ?? "es"] ?? m.es;

// ── Decisión del proveedor ──────────────────────────────────────────────────

export const esquemaDecision = z.object({
  idioma: z.string().regex(/^[a-z]{2}$/).catch("es"),
  accion: z.enum(["responder", "herramienta", "escalar", "finalizar"]),
  respuesta: z.string().max(4000),
  herramienta: z.string().max(60),
  parametros_json: z.string().max(4000),
  motivo_escalado: z.string().max(500),
  resumen: z.string().max(2000),
});

// ── Base de conocimiento ────────────────────────────────────────────────────

const VACIAS = new Set(
  "el la los las un una unos unas de del al a y o que en es por para con mi me te se lo le su sus hay quiero puedo como cual cuál qué que el els les un una uns unes de del al i o que en és per amb em et es ho li seu seus hi vull puc com quin quina".split(" ")
);

export function palabras(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñç ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !VACIAS.has(w))
    .map((w) => (w.length > 5 ? w.slice(0, 5) : w)); // raíz tosca: «trasteros» ≈ «trastero»
}

export type EntradaConocimiento = { id: string; category: string; question: string; answer: string; language: string; priority: number; centerId: string | null };

/** Las más parecidas a la consulta (pregunta pesa el doble), desempate por prioridad. */
export function ordenarPorRelevancia<T extends EntradaConocimiento>(entradas: T[], consulta: string, limite = 8): (T & { puntuacion: number })[] {
  const q = new Set(palabras(consulta));
  return entradas
    .map((e) => {
      const enPregunta = palabras(e.question).filter((w) => q.has(w)).length;
      const enRespuesta = palabras(`${e.category} ${e.answer}`).filter((w) => q.has(w)).length;
      return { ...e, puntuacion: enPregunta * 2 + enRespuesta + (e.centerId ? 0.5 : 0) };
    })
    .filter((e) => e.puntuacion > 0)
    .sort((a, b) => b.puntuacion - a.puntuacion || b.priority - a.priority)
    .slice(0, limite);
}

// ── Instrucciones para el proveedor ─────────────────────────────────────────

export type ContextoPrompt = {
  marca: string | null;
  web: string | null;
  calculadora: string | null;
  contratacion: string | null;
  visitaVirtual: string | null;
  centro: { name: string; city: string | null } | null;
  idiomas: string[];
  reglasExtra: string[];
  conocimiento: { question: string; answer: string; category: string }[];
  herramientas: { nombre: string; descripcion: string; parametros: string; riesgo: string }[];
  escaladoHumano: boolean;
};

export function construirSistema(c: ContextoPrompt): string {
  const enlaces = [
    c.web && `Web (precios, disponibilidad definitiva y contratación): ${c.web}`,
    c.calculadora && `Calculadora de espacio: ${c.calculadora}`,
    c.contratacion && `Contratación online: ${c.contratacion}`,
    c.visitaVirtual && `Visita virtual: ${c.visitaVirtual}`,
  ].filter(Boolean);
  return [
    `Eres el asistente telefónico de ${c.marca ?? "la empresa"}${c.centro ? ` (centro ${c.centro.name}${c.centro.city ? `, ${c.centro.city}` : ""})` : ""}.`,
    `Atiendes en: ${c.idiomas.join(", ")}.`,
    "",
    "## Reglas obligatorias",
    ...REGLAS_OBLIGATORIAS.map((r) => `- ${r}`),
    ...(c.reglasExtra.length ? ["", "## Reglas de la empresa", ...c.reglasExtra.map((r) => `- ${r}`)] : []),
    "",
    "## Enlaces",
    ...(enlaces.length ? enlaces.map((e) => `- ${e}`) : ["- (no hay enlaces configurados: no inventes ninguno)"]),
    "",
    "## Conocimiento (estático; NO contiene datos dinámicos)",
    ...(c.conocimiento.length ? c.conocimiento.map((k) => `- [${k.category}] P: ${k.question}\n  R: ${k.answer}`) : ["- (nada relevante: usa obtener_base_conocimiento o remite a la web)"]),
    "",
    "## Herramientas de Mobilink (las únicas fuentes de datos dinámicos)",
    ...(c.herramientas.length ? c.herramientas.map((h) => `- ${h.nombre} [${h.riesgo}]: ${h.descripcion} Parámetros: ${h.parametros}`) : ["- (ninguna activa)"]),
    "",
    "## Cómo decides",
    "- accion=herramienta: rellena `herramienta` y `parametros_json`; deja `respuesta` vacía. Verás el resultado en el siguiente mensaje.",
    "- accion=responder: lo que se dice a quien llama, en su idioma.",
    c.escaladoHumano
      ? "- accion=escalar: si no entiendes, si piden una persona, si es una incidencia crítica, una reclamación compleja, un problema de acceso, posible fraude, algo no autorizado o fuera del conocimiento. Rellena `motivo_escalado` y despide con amabilidad."
      : "- No hay paso a persona: si no puedes ayudar, remite a la web.",
    "- accion=finalizar: cuando se despide.",
    "- `resumen`: siempre, breve y actualizado (es lo que verá la persona si se escala).",
  ].join("\n");
}

// ── Parámetros saneados para el registro ────────────────────────────────────

/** Sin teléfonos ni emails completos en el registro de herramientas. */
export function sanear(v: unknown): unknown {
  if (typeof v === "string") {
    return v
      .replace(/(\+?\d[\d\s]{5,})(\d{2})/g, (_, a: string, b: string) => `${a.replace(/\d/g, "•")}${b}`)
      .replace(/([^\s@]{1,2})[^\s@]*@([^\s@]+)/g, "$1•••@$2")
      .slice(0, 500);
  }
  if (Array.isArray(v)) return v.slice(0, 20).map(sanear);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [k, sanear(x)]));
  return v;
}

// ── Enrutado ────────────────────────────────────────────────────────────────

/**
 * Quién atiende una llamada nueva. Con la IA activa y disponible: «ai» en
 * modo ai, «hybrid» en modo híbrido (IA con humano detrás). Si la IA no está
 * activa o no hay proveedor disponible, SIEMPRE un humano.
 */
export function decidirAtencion(modo: "ai" | "human" | "hybrid", iaActiva: boolean, proveedorDisponible: boolean): "ai" | "human" | "hybrid" {
  if (!iaActiva || !proveedorDisponible || modo === "human") return "human";
  return modo;
}

/** Coste estimado si se configuran precios por millón de tokens (si no, null: no se inventa). */
export function costeEstimado(entrada: number, salida: number, precioEntradaMTok: number | null, precioSalidaMTok: number | null): number | null {
  if (precioEntradaMTok == null || precioSalidaMTok == null) return null;
  return Math.round(((entrada * precioEntradaMTok + salida * precioSalidaMTok) / 1_000_000) * 10_000) / 10_000;
}
