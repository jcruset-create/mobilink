/**
 * Los números que se pueden cambiar sin desplegar.
 *
 * Misma forma que `server/satisfaction/config.ts`, que es la implementación de
 * referencia del proyecto: una lista de claves con punto, unos valores por
 * defecto, y un lector que **nunca lanza**. Si `thf_config` no existiera
 * todavía —o la consulta fallara— se devuelven los valores por defecto. Que no
 * se pueda leer la configuración no puede impedir que se abra un expediente.
 *
 * La diferencia con Satisfaction es que aquí la tabla es POR EMPRESA y no
 * global: los pesos de la prioridad son la opinión de cada instalación sobre
 * qué corre más, y dos clientes no tienen por qué opinar lo mismo.
 *
 * ── Sólo lo que se usa ──────────────────────────────────────────────────────
 *
 * De momento, la prioridad. Los pesos del motor de deduplicación y los
 * umbrales del parser se añaden con el código que los lee: una pantalla de
 * configuración con mandos que no están conectados a nada es peor que no
 * tenerla, porque alguien los mueve y se cree que ha cambiado algo.
 */

import pool from "../db.ts";
import {
  PESOS_POR_DEFECTO,
  UMBRALES_POR_DEFECTO,
  type PesosPrioridad,
  type UmbralesPrioridad,
} from "./domain/prioridad.ts";

export const CLAVES = {
  pesoDiasAbierto: "prioridad.peso.dias_abierto",
  pesoReclamaciones: "prioridad.peso.reclamaciones",
  pesoUrgente: "prioridad.peso.urgente",
  pesoTareaVencida: "prioridad.peso.tarea_vencida",
  umbralBaja: "prioridad.umbral.baja",
  umbralAlta: "prioridad.umbral.alta",
  umbralCritica: "prioridad.umbral.critica",
} as const;

export type ConfigTherefore = {
  pesos: PesosPrioridad;
  umbrales: UmbralesPrioridad;
};

export const POR_DEFECTO: ConfigTherefore = {
  pesos: PESOS_POR_DEFECTO,
  umbrales: UMBRALES_POR_DEFECTO,
};

function aNumero(v: string | undefined, sinValor: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : sinValor;
}

/** La configuración de una empresa. Nunca lanza. */
export async function leerConfig(empresaId: string): Promise<ConfigTherefore> {
  let mapa: Record<string, string> = {};
  try {
    const r = await pool.query<{ clave: string; valor: string | null }>(
      `SELECT clave, valor FROM thf_config WHERE empresa_id = $1 AND clave = ANY($2)`,
      [empresaId, Object.values(CLAVES)]
    );
    for (const f of r.rows) mapa[String(f.clave)] = String(f.valor ?? "");
  } catch {
    mapa = {};
  }
  return {
    pesos: {
      diasAbierto: aNumero(mapa[CLAVES.pesoDiasAbierto], POR_DEFECTO.pesos.diasAbierto),
      reclamaciones: aNumero(mapa[CLAVES.pesoReclamaciones], POR_DEFECTO.pesos.reclamaciones),
      urgente: aNumero(mapa[CLAVES.pesoUrgente], POR_DEFECTO.pesos.urgente),
      tareaVencida: aNumero(mapa[CLAVES.pesoTareaVencida], POR_DEFECTO.pesos.tareaVencida),
    },
    umbrales: {
      baja: aNumero(mapa[CLAVES.umbralBaja], POR_DEFECTO.umbrales.baja),
      alta: aNumero(mapa[CLAVES.umbralAlta], POR_DEFECTO.umbrales.alta),
      critica: aNumero(mapa[CLAVES.umbralCritica], POR_DEFECTO.umbrales.critica),
    },
  };
}

export type CambiosConfig = {
  pesos?: Partial<PesosPrioridad>;
  umbrales?: Partial<UmbralesPrioridad>;
};

/**
 * Guarda lo que cambie y devuelve la configuración resultante.
 *
 * Lo que no venga se deja como estaba: la pantalla manda sólo el mando que se
 * ha movido, no la configuración entera, y así dos personas ajustando cosas
 * distintas a la vez no se pisan.
 */
export async function guardarConfig(
  empresaId: string,
  cambios: CambiosConfig
): Promise<ConfigTherefore> {
  const pares: [string, number][] = [];
  const poner = (clave: string, v: number | undefined) => {
    if (v !== undefined && Number.isFinite(v) && v >= 0) pares.push([clave, v]);
  };

  poner(CLAVES.pesoDiasAbierto, cambios.pesos?.diasAbierto);
  poner(CLAVES.pesoReclamaciones, cambios.pesos?.reclamaciones);
  poner(CLAVES.pesoUrgente, cambios.pesos?.urgente);
  poner(CLAVES.pesoTareaVencida, cambios.pesos?.tareaVencida);
  poner(CLAVES.umbralBaja, cambios.umbrales?.baja);
  poner(CLAVES.umbralAlta, cambios.umbrales?.alta);
  poner(CLAVES.umbralCritica, cambios.umbrales?.critica);

  for (const [clave, valor] of pares) {
    await pool.query(
      `INSERT INTO thf_config (empresa_id, clave, valor, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (empresa_id, clave)
         DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
      [empresaId, clave, String(valor)]
    );
  }

  return leerConfig(empresaId);
}
