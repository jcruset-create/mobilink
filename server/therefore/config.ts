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
 * La prioridad y la deduplicación. Los umbrales del parser de documentos se
 * añadirán con el código que los lea: una pantalla de configuración con mandos
 * que no están conectados a nada es peor que no tenerla, porque alguien los
 * mueve y se cree que ha cambiado algo.
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

export type ConfigTherefore = {
  pesos: PesosPrioridad;
  umbrales: UmbralesPrioridad;
  dedupe: {
    pesos: PesosDedupe;
    umbrales: UmbralesDedupe;
    ventanaDias: number;
  };
};

export const POR_DEFECTO: ConfigTherefore = {
  pesos: PESOS_POR_DEFECTO,
  umbrales: UMBRALES_POR_DEFECTO,
  dedupe: {
    pesos: PESOS_DEDUPE_POR_DEFECTO,
    umbrales: UMBRALES_DEDUPE_POR_DEFECTO,
    ventanaDias: VENTANA_DIAS_POR_DEFECTO,
  },
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
      [empresaId, [...Object.values(CLAVES), ...Object.values(CLAVES_DEDUPE)]]
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
