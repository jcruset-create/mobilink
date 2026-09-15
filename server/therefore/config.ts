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
 * La prioridad, la deduplicación y —desde la fase 3b— los umbrales del análisis
 * de albaranes. Cada mando entra con el código que lo lee: una pantalla de
 * configuración con mandos que no están conectados a nada es peor que no
 * tenerla, porque alguien los mueve y se cree que ha cambiado algo.
 */

import pool from "../db.ts";
import {
  PESOS_DEDUPE_POR_DEFECTO,
  UMBRALES_DEDUPE_POR_DEFECTO,
  VENTANA_DIAS_POR_DEFECTO,
  type PesosDedupe,
  type UmbralesDedupe,
} from "./domain/dedupe.ts";
import {
  PESOS_POR_DEFECTO,
  UMBRALES_POR_DEFECTO,
  type PesosPrioridad,
  type UmbralesPrioridad,
} from "./domain/prioridad.ts";
import { UMBRALES_ALBARAN_POR_DEFECTO, type UmbralesAlbaran } from "./domain/albaran.ts";
import { TOLERANCIA_CENTIMOS_POR_DEFECTO } from "./domain/documento/lineas.ts";
import { UMBRAL_CONFIANZA_CAMPO_POR_DEFECTO } from "./domain/validaciones.ts";
import { MAX_PAGINAS_POR_DEFECTO } from "./documentos/texto.ts";

export const CLAVES = {
  pesoDiasAbierto: "prioridad.peso.dias_abierto",
  pesoReclamaciones: "prioridad.peso.reclamaciones",
  pesoUrgente: "prioridad.peso.urgente",
  pesoTareaVencida: "prioridad.peso.tarea_vencida",
  umbralBaja: "prioridad.umbral.baja",
  umbralAlta: "prioridad.umbral.alta",
  umbralCritica: "prioridad.umbral.critica",
} as const;

/**
 * Las del deduplicador van aparte porque **algunas son negativas**, y el lector
 * de las de prioridad rechaza los negativos a propósito (un peso de prioridad
 * negativo no significa nada). Mezclarlas obligaría a relajar esa comprobación
 * para todas, que es como se cuela un umbral de −1 sin que nadie lo note.
 */
export const CLAVES_DEDUPE = {
  mismaFactura: "dedupe.peso.misma_factura",
  mismoAlbaran: "dedupe.peso.mismo_albaran",
  mismoProveedor: "dedupe.peso.mismo_proveedor",
  mismoImporte: "dedupe.peso.mismo_importe",
  mismaEmpresa: "dedupe.peso.misma_empresa",
  mismoDocumento: "dedupe.peso.mismo_documento",
  mismaAccion: "dedupe.peso.misma_accion",
  mismoHilo: "dedupe.peso.mismo_hilo",
  facturaDiferente: "dedupe.peso.factura_diferente",
  proveedorDiferente: "dedupe.peso.proveedor_diferente",
  tipoIncompatible: "dedupe.peso.tipo_incompatible",
  umbralFusionar: "dedupe.umbral.fusionar",
  umbralRevisar: "dedupe.umbral.revisar",
  ventanaDias: "dedupe.ventana_dias",
} as const;

/**
 * Los umbrales del análisis de documentos.
 *
 * Todos son números y todos son positivos, así que van con el lector normal.
 * `tolerancia` es la única que merece una nota: son céntimos, y está para
 * absorber REDONDEOS, no diferencias. Subirla a 100 no hace que cuadren más
 * albaranes: hace que un euro de diferencia deje de verse.
 */
export const CLAVES_ALBARAN = {
  umbralMatch: "albaran.umbral_match",
  umbralIncierto: "albaran.umbral_incierto",
  toleranciaCentimos: "albaran.tolerancia_centimos",
  umbralConfianzaCampo: "albaran.umbral_confianza_campo",
  maxIntentos: "albaran.max_intentos",
  maxPaginas: "albaran.max_paginas",
} as const;

export type ConfigAlbaran = {
  umbrales: UmbralesAlbaran;
  toleranciaCentimos: number;
  umbralConfianzaCampo: number;
  maxIntentos: number;
  maxPaginas: number;
};

export const CONFIG_ALBARAN_POR_DEFECTO: ConfigAlbaran = {
  umbrales: UMBRALES_ALBARAN_POR_DEFECTO,
  toleranciaCentimos: TOLERANCIA_CENTIMOS_POR_DEFECTO,
  umbralConfianzaCampo: UMBRAL_CONFIANZA_CAMPO_POR_DEFECTO,
  maxIntentos: 3,
  maxPaginas: MAX_PAGINAS_POR_DEFECTO,
};

export type ConfigTherefore = {
  pesos: PesosPrioridad;
  umbrales: UmbralesPrioridad;
  dedupe: {
    pesos: PesosDedupe;
    umbrales: UmbralesDedupe;
    ventanaDias: number;
  };
  albaran: ConfigAlbaran;
};

export const POR_DEFECTO: ConfigTherefore = {
  pesos: PESOS_POR_DEFECTO,
  umbrales: UMBRALES_POR_DEFECTO,
  dedupe: {
    pesos: PESOS_DEDUPE_POR_DEFECTO,
    umbrales: UMBRALES_DEDUPE_POR_DEFECTO,
    ventanaDias: VENTANA_DIAS_POR_DEFECTO,
  },
  albaran: CONFIG_ALBARAN_POR_DEFECTO,
};

function aNumero(v: string | undefined, sinValor: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : sinValor;
}

/** Igual, pero admitiendo negativos: los castigos del deduplicador lo son. */
function aNumeroConSigno(v: string | undefined, sinValor: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : sinValor;
}

/** La configuración de una empresa. Nunca lanza. */
export async function leerConfig(empresaId: string): Promise<ConfigTherefore> {
  let mapa: Record<string, string> = {};
  try {
    const r = await pool.query<{ clave: string; valor: string | null }>(
      `SELECT clave, valor FROM thf_config WHERE empresa_id = $1 AND clave = ANY($2)`,
      [
        empresaId,
        [...Object.values(CLAVES), ...Object.values(CLAVES_DEDUPE), ...Object.values(CLAVES_ALBARAN)],
      ]
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
    dedupe: {
      pesos: {
        mismaFactura: aNumeroConSigno(mapa[CLAVES_DEDUPE.mismaFactura], PESOS_DEDUPE_POR_DEFECTO.mismaFactura),
        mismoAlbaran: aNumeroConSigno(mapa[CLAVES_DEDUPE.mismoAlbaran], PESOS_DEDUPE_POR_DEFECTO.mismoAlbaran),
        mismoProveedor: aNumeroConSigno(mapa[CLAVES_DEDUPE.mismoProveedor], PESOS_DEDUPE_POR_DEFECTO.mismoProveedor),
        mismoImporte: aNumeroConSigno(mapa[CLAVES_DEDUPE.mismoImporte], PESOS_DEDUPE_POR_DEFECTO.mismoImporte),
        mismaEmpresa: aNumeroConSigno(mapa[CLAVES_DEDUPE.mismaEmpresa], PESOS_DEDUPE_POR_DEFECTO.mismaEmpresa),
        mismoDocumento: aNumeroConSigno(mapa[CLAVES_DEDUPE.mismoDocumento], PESOS_DEDUPE_POR_DEFECTO.mismoDocumento),
        mismaAccion: aNumeroConSigno(mapa[CLAVES_DEDUPE.mismaAccion], PESOS_DEDUPE_POR_DEFECTO.mismaAccion),
        mismoHilo: aNumeroConSigno(mapa[CLAVES_DEDUPE.mismoHilo], PESOS_DEDUPE_POR_DEFECTO.mismoHilo),
        facturaDiferente: aNumeroConSigno(mapa[CLAVES_DEDUPE.facturaDiferente], PESOS_DEDUPE_POR_DEFECTO.facturaDiferente),
        proveedorDiferente: aNumeroConSigno(mapa[CLAVES_DEDUPE.proveedorDiferente], PESOS_DEDUPE_POR_DEFECTO.proveedorDiferente),
        tipoIncompatible: aNumeroConSigno(mapa[CLAVES_DEDUPE.tipoIncompatible], PESOS_DEDUPE_POR_DEFECTO.tipoIncompatible),
      },
      umbrales: {
        fusionar: aNumero(mapa[CLAVES_DEDUPE.umbralFusionar], UMBRALES_DEDUPE_POR_DEFECTO.fusionar),
        revisar: aNumero(mapa[CLAVES_DEDUPE.umbralRevisar], UMBRALES_DEDUPE_POR_DEFECTO.revisar),
      },
      // Mínimo un día: una ventana de cero días haría que NADA fuese candidato
      // y el módulo abriría un expediente por correo sin decir por qué.
      ventanaDias: Math.max(1, aNumero(mapa[CLAVES_DEDUPE.ventanaDias], VENTANA_DIAS_POR_DEFECTO)),
    },
    albaran: {
      umbrales: {
        match: aNumero(mapa[CLAVES_ALBARAN.umbralMatch], UMBRALES_ALBARAN_POR_DEFECTO.match),
        incierto: aNumero(mapa[CLAVES_ALBARAN.umbralIncierto], UMBRALES_ALBARAN_POR_DEFECTO.incierto),
      },
      toleranciaCentimos: aNumero(
        mapa[CLAVES_ALBARAN.toleranciaCentimos],
        TOLERANCIA_CENTIMOS_POR_DEFECTO
      ),
      umbralConfianzaCampo: aNumero(
        mapa[CLAVES_ALBARAN.umbralConfianzaCampo],
        UMBRAL_CONFIANZA_CAMPO_POR_DEFECTO
      ),
      // Sin al menos un intento la cola no avanzaría nunca.
      maxIntentos: Math.max(1, aNumero(mapa[CLAVES_ALBARAN.maxIntentos], CONFIG_ALBARAN_POR_DEFECTO.maxIntentos)),
      maxPaginas: Math.max(1, aNumero(mapa[CLAVES_ALBARAN.maxPaginas], MAX_PAGINAS_POR_DEFECTO)),
    },
  };
}

export type CambiosConfig = {
  pesos?: Partial<PesosPrioridad>;
  umbrales?: Partial<UmbralesPrioridad>;
  dedupe?: {
    pesos?: Partial<PesosDedupe>;
    umbrales?: Partial<UmbralesDedupe>;
    ventanaDias?: number;
  };
  albaran?: Partial<Omit<ConfigAlbaran, "umbrales">> & { umbrales?: Partial<UmbralesAlbaran> };
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

  // Los castigos del deduplicador son negativos: guardarlos con `poner` los
  // tiraría en silencio, que es la peor manera de no guardar algo.
  const ponerConSigno = (clave: string, v: number | undefined) => {
    if (v !== undefined && Number.isFinite(v)) pares.push([clave, v]);
  };
  const d = cambios.dedupe;
  ponerConSigno(CLAVES_DEDUPE.mismaFactura, d?.pesos?.mismaFactura);
  ponerConSigno(CLAVES_DEDUPE.mismoAlbaran, d?.pesos?.mismoAlbaran);
  ponerConSigno(CLAVES_DEDUPE.mismoProveedor, d?.pesos?.mismoProveedor);
  ponerConSigno(CLAVES_DEDUPE.mismoImporte, d?.pesos?.mismoImporte);
  ponerConSigno(CLAVES_DEDUPE.mismaEmpresa, d?.pesos?.mismaEmpresa);
  ponerConSigno(CLAVES_DEDUPE.mismoDocumento, d?.pesos?.mismoDocumento);
  ponerConSigno(CLAVES_DEDUPE.mismaAccion, d?.pesos?.mismaAccion);
  ponerConSigno(CLAVES_DEDUPE.mismoHilo, d?.pesos?.mismoHilo);
  ponerConSigno(CLAVES_DEDUPE.facturaDiferente, d?.pesos?.facturaDiferente);
  ponerConSigno(CLAVES_DEDUPE.proveedorDiferente, d?.pesos?.proveedorDiferente);
  ponerConSigno(CLAVES_DEDUPE.tipoIncompatible, d?.pesos?.tipoIncompatible);
  poner(CLAVES_DEDUPE.umbralFusionar, d?.umbrales?.fusionar);
  poner(CLAVES_DEDUPE.umbralRevisar, d?.umbrales?.revisar);
  poner(CLAVES_DEDUPE.ventanaDias, d?.ventanaDias);

  const alb = cambios.albaran;
  poner(CLAVES_ALBARAN.umbralMatch, alb?.umbrales?.match);
  poner(CLAVES_ALBARAN.umbralIncierto, alb?.umbrales?.incierto);
  poner(CLAVES_ALBARAN.toleranciaCentimos, alb?.toleranciaCentimos);
  poner(CLAVES_ALBARAN.umbralConfianzaCampo, alb?.umbralConfianzaCampo);
  poner(CLAVES_ALBARAN.maxIntentos, alb?.maxIntentos);
  poner(CLAVES_ALBARAN.maxPaginas, alb?.maxPaginas);

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

/* ── Claves de texto: el buzón ───────────────────────────────────────────── */

/**
 * Las del buzón son TEXTO, no números, y van aparte por eso.
 *
 * `buzon.remitentes` es la lista de direcciones desde las que manda Therefore,
 * separadas por comas. Si está vacía se acepta todo lo que llegue al buzón
 * —y se dice en el log—, porque un buzón dedicado sin filtro es preferible a
 * un filtro mal escrito que descarta en silencio los correos que sí importan.
 *
 * `buzon.activado_el` es el instante de la primera pasada: el listener no
 * mira nada anterior. Se escribe una sola vez y no se toca, para que un
 * reinicio del servidor no «reactive» el buzón y se trague meses de correo.
 */
export const CLAVES_BUZON = {
  remitentes: "buzon.remitentes",
  activadoEl: "buzon.activado_el",
} as const;

export async function leerTextoConfig(empresaId: string, clave: string): Promise<string | null> {
  try {
    const r = await pool.query<{ valor: string | null }>(
      `SELECT valor FROM thf_config WHERE empresa_id = $1 AND clave = $2`,
      [empresaId, clave]
    );
    return r.rows[0]?.valor ?? null;
  } catch {
    return null;
  }
}

export async function guardarTextoConfig(empresaId: string, clave: string, valor: string): Promise<void> {
  await pool.query(
    `INSERT INTO thf_config (empresa_id, clave, valor, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (empresa_id, clave)
       DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
    [empresaId, clave, valor]
  );
}

/** Direcciones en minúsculas y sin espacios. Una lista vacía significa «todas». */
export function partirRemitentes(valor: string | null | undefined): string[] {
  return (valor ?? "")
    .split(/[,;\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.includes("@"));
}

export async function leerRemitentes(empresaId: string): Promise<string[]> {
  return partirRemitentes(await leerTextoConfig(empresaId, CLAVES_BUZON.remitentes));
}

/**
 * La fecha de activación. Si no existe, se fija AHORA y se devuelve.
 *
 * Es el único sitio que la escribe, y sólo cuando falta: lo que ya estaba en
 * el buzón antes de este instante no se procesa nunca solo.
 */
export async function fechaDeActivacion(empresaId: string, ahora = new Date()): Promise<Date> {
  const guardada = await leerTextoConfig(empresaId, CLAVES_BUZON.activadoEl);
  if (guardada && !Number.isNaN(new Date(guardada).getTime())) return new Date(guardada);
  await guardarTextoConfig(empresaId, CLAVES_BUZON.activadoEl, ahora.toISOString());
  return ahora;
}
