/**
 * Los números que se pueden cambiar sin desplegar.
 *
 * Misma forma que `recepciones/config.ts` y `therefore/config.ts`: clave/valor
 * por empresa en `orm_config`, y lectores que **nunca lanzan**. Que no se pueda
 * leer la configuración no puede impedir que se procese un escaneo: se sigue
 * con los valores por defecto, que son los del encargo.
 *
 * Aquí viven las dos cosas que el encargo pide expresamente no dejar clavadas
 * en el código: la ZONA donde mirar el número y los UMBRALES de confianza.
 */

import pool from "../db.ts";
import { ZONA_POR_DEFECTO, zonaValida, type ZonaOcr } from "./domain/deteccion.ts";
import { OR_POR_BLOC } from "./domain/blocs.ts";

export const CLAVES = {
  /** La caja donde está el número de OR, en fracciones de página. */
  zonaOcr: "ocr.zona",
  /** Desde qué confianza se archiva sin preguntar. */
  umbralAutomatico: "ocr.umbral_automatico",
  /** Desde qué confianza se archiva marcado para revisar. */
  umbralRevision: "ocr.umbral_revision",
  /** Cuántas OR trae un bloc nuevo si nadie dice otra cosa. */
  orPorBloc: "blocs.or_por_bloc",
  /** ¿Se puede pedir ayuda a la visión de IA cuando el PDF no trae texto? */
  ocrConIa: "ocr.con_ia",
} as const;

/** Los del encargo: ≥90 archiva solo, 70-89 revisión, <70 no identificado. */
export const UMBRAL_AUTOMATICO_POR_DEFECTO = 90;
export const UMBRAL_REVISION_POR_DEFECTO = 70;

export type Umbrales = { automatico: number; revision: number };

export type ConfiguracionOrManuales = {
  zona: ZonaOcr;
  umbrales: Umbrales;
  orPorBloc: number;
  ocrConIa: boolean;
};

export async function leerTextoConfig(empresaId: string, clave: string): Promise<string | null> {
  try {
    const r = await pool.query<{ valor: string | null }>(
      `SELECT valor FROM orm_config WHERE empresa_id = $1 AND clave = $2`,
      [empresaId, clave]
    );
    return r.rows[0]?.valor ?? null;
  } catch {
    return null;
  }
}

export async function guardarTextoConfig(empresaId: string, clave: string, valor: string): Promise<void> {
  await pool.query(
    `INSERT INTO orm_config (empresa_id, clave, valor, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (empresa_id, clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
    [empresaId, clave, valor]
  );
}

/**
 * Toda la configuración del módulo de una vez.
 *
 * Se lee entera en una consulta porque el procesamiento de un lote la necesita
 * completa y hacerlo página a página serían 200 consultas para leer cuatro
 * valores que no cambian a media pasada.
 */
export async function leerConfiguracion(empresaId: string): Promise<ConfiguracionOrManuales> {
  let filas: { clave: string; valor: string | null }[];
  try {
    const r = await pool.query<{ clave: string; valor: string | null }>(
      `SELECT clave, valor FROM orm_config WHERE empresa_id = $1`,
      [empresaId]
    );
    filas = r.rows;
  } catch {
    filas = [];
  }

  const mapa = new Map(filas.map((f) => [f.clave, f.valor]));

  const automatico = entero(mapa.get(CLAVES.umbralAutomatico), UMBRAL_AUTOMATICO_POR_DEFECTO, 0, 100);
  const revision = entero(mapa.get(CLAVES.umbralRevision), UMBRAL_REVISION_POR_DEFECTO, 0, 100);

  return {
    zona: leerZona(mapa.get(CLAVES.zonaOcr)),
    /*
     * Un umbral de revisión por encima del automático no tendría sentido —la
     * banda de revisión quedaría vacía y todo lo dudoso se archivaría solo—,
     * así que si alguien los deja cruzados se respeta el más prudente de los
     * dos en vez de aplicar una configuración imposible.
     */
    umbrales: { automatico: Math.max(automatico, revision), revision: Math.min(automatico, revision) },
    orPorBloc: entero(mapa.get(CLAVES.orPorBloc), OR_POR_BLOC, 1, 200),
    // Por defecto sí: sin IA, un escaneado sin texto no se puede leer de
    // ninguna manera y todo acabaría en la bandeja de no identificados.
    ocrConIa: (mapa.get(CLAVES.ocrConIa) ?? "1") !== "0",
  };
}

export async function guardarConfiguracion(
  empresaId: string,
  cambios: Partial<{ zona: ZonaOcr; umbralAutomatico: number; umbralRevision: number; orPorBloc: number; ocrConIa: boolean }>
): Promise<ConfiguracionOrManuales> {
  if (cambios.zona) await guardarTextoConfig(empresaId, CLAVES.zonaOcr, JSON.stringify(cambios.zona));
  if (cambios.umbralAutomatico !== undefined) {
    await guardarTextoConfig(empresaId, CLAVES.umbralAutomatico, String(cambios.umbralAutomatico));
  }
  if (cambios.umbralRevision !== undefined) {
    await guardarTextoConfig(empresaId, CLAVES.umbralRevision, String(cambios.umbralRevision));
  }
  if (cambios.orPorBloc !== undefined) await guardarTextoConfig(empresaId, CLAVES.orPorBloc, String(cambios.orPorBloc));
  if (cambios.ocrConIa !== undefined) await guardarTextoConfig(empresaId, CLAVES.ocrConIa, cambios.ocrConIa ? "1" : "0");
  return leerConfiguracion(empresaId);
}

function leerZona(crudo: string | null | undefined): ZonaOcr {
  if (!crudo) return ZONA_POR_DEFECTO;
  try {
    const v = JSON.parse(crudo) as ZonaOcr;
    const zona = { x: Number(v.x), y: Number(v.y), ancho: Number(v.ancho), alto: Number(v.alto) };
    return zonaValida(zona) ? zona : ZONA_POR_DEFECTO;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

function entero(crudo: string | null | undefined, porDefecto: number, min: number, max: number): number {
  const n = Number(crudo);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return porDefecto;
  return n;
}
