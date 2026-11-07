/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Validación de la salida del modelo.
 *
 * ── La regla de fondo ───────────────────────────────────────────────────────
 *
 * Un identificador válido no demuestra que la frase sea correcta. Que el
 * modelo cite `IV1` solo prueba que esa intervención existe y es de este
 * vehículo, no que lo que dice de ella sea verdad. Por eso el reparto de
 * responsabilidades es este:
 *
 *   · lo comprobable lo pone el SERVIDOR  → carencias de datos,
 *     contradicciones y recortes salen de `datos.ts`, con su texto. El modelo
 *     no los reescribe.
 *   · lo redactado lo pone el MODELO       → los hechos de las cuatro
 *     secciones, cada uno con sus evidencias. Si una afirmación se queda sin
 *     evidencias al validarlas, se ELIMINA. No se degrada a hipótesis: una
 *     frase sin respaldo con la etiqueta «posible» sigue siendo una frase sin
 *     respaldo, y además suena a diagnóstico.
 *
 * Y si el modelo incumple la regla de no escribir uuids ni enlaces, ese hecho
 * se descarta entero: no se limpia la frase para salvarla.
 */
import type { DatosResumen, Ref } from "./datos.ts";
import { resolver, type Contexto, type Evidencia } from "./evidencias.ts";
import type { SalidaModelo } from "./prompt.ts";

const UUID_SUELTO = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ENLACE = /(https?:\/\/|www\.|\/tyrecontrol\/|\[[^\]]*\]\()/i;

const TOPE_HECHOS = 8;
const TOPE_TEXTO = 400;
const TOPE_TITULAR = 240;

export interface Hecho {
  texto: string;
  evidencias: Evidencia[];
}

export interface ResumenValidado {
  titular: string;
  ultimas_actuaciones: Hecho[];
  incidencias_abiertas: Hecho[];
  trabajos_pendientes: Hecho[];
  datos_que_faltan: { clave: string; texto: string }[];
  avisos: string[];
  /** Cuántos hechos se cayeron por no tener respaldo. Para el informe, no para el usuario. */
  descartados: number;
}

const limpiarTexto = (v: unknown, tope: number): string | null => {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex -- quitar caracteres de control es justo el objetivo
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // El modelo tiene prohibido escribir uuids y enlaces. Si lo hace, no se
  // arregla el texto: se tira.
  if (UUID_SUELTO.test(t) || ENLACE.test(t)) return null;
  return t.slice(0, tope);
};

function validarSeccion(
  bruto: unknown,
  refs: Map<string, Ref>,
  ctx: Contexto,
  fuera: { descartados: number },
): Hecho[] {
  if (!Array.isArray(bruto)) return [];
  const hechos: Hecho[] = [];
  for (const h of bruto.slice(0, TOPE_HECHOS)) {
    const texto = limpiarTexto((h as any)?.texto, TOPE_TEXTO);
    if (!texto) { fuera.descartados++; continue; }
    const { evidencias } = resolver((h as any)?.refs, refs, ctx);
    // Sin evidencias que resuelvan, la afirmación desaparece.
    if (evidencias.length === 0) { fuera.descartados++; continue; }
    hechos.push({ texto, evidencias });
  }
  return hechos;
}

/**
 * Valida la salida del modelo contra los datos que se le dieron.
 */
export function validar(
  salida: SalidaModelo,
  datos: DatosResumen,
  refs: Map<string, Ref>,
  ctx: Contexto,
): ResumenValidado {
  const fuera = { descartados: 0 };

  // Las carencias las decide el servidor. Del modelo solo se acepta cuáles de
  // las claves comprobadas menciona; el texto es el del servidor.
  const porClave = new Map(datos.datos_que_faltan.map((d) => [d.clave, d.texto]));
  const claves: string[] = Array.isArray(salida.datos_que_faltan)
    ? (salida.datos_que_faltan as any[])
        .map((d) => (typeof d?.clave === "string" ? d.clave : null))
        .filter((c): c is string => !!c && porClave.has(c))
    : [];
  const unicas = [...new Set(claves)];
  // Si el modelo se deja carencias, se añaden igual: son hechos comprobados
  // del servidor y callarlos daría una foto mejor de la real.
  for (const d of datos.datos_que_faltan) if (!unicas.includes(d.clave)) unicas.push(d.clave);

  return {
    titular: limpiarTexto(salida.titular, TOPE_TITULAR) ?? "",
    ultimas_actuaciones: validarSeccion(salida.ultimas_actuaciones, refs, ctx, fuera),
    incidencias_abiertas: validarSeccion(salida.incidencias_abiertas, refs, ctx, fuera),
    trabajos_pendientes: validarSeccion(salida.trabajos_pendientes, refs, ctx, fuera),
    datos_que_faltan: unicas.map((clave) => ({ clave, texto: porClave.get(clave) as string })),
    // Contradicciones y recortes, tal como los calculó el servidor.
    avisos: [...datos.contradicciones, ...datos.recortes],
    descartados: fuera.descartados,
  };
}
