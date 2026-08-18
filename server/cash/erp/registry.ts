/**
 * Registro de conectores de ERP.
 *
 * Mismo papel que `ConnectorRegistry` del Integration Hub: resuelve una clave
 * de configuración a una implementación. Aquí lo importante es lo que pasa
 * cuando NO hay nada configurado, que es el caso por defecto: se devuelve null
 * y Mobilink Cash funciona igual. Abrir caja, cobrar a mano, arquear y cerrar
 * no dependen de que exista ninguna ERP.
 *
 * La configuración se busca primero por centro y luego por empresa, para que en
 * el futuro un centro pueda tener ERP y otro trabajar a mano sin cambiar nada
 * del código.
 */

import pool from "../../db.ts";
import type { ICashErpConnector } from "./connector.ts";
import { MockCashErpConnector } from "./mock.ts";

export type EstadoIntegracion = "NO_CONFIGURADA" | "CONECTADA" | "ERROR" | "DESACTIVADA";

export type ConfiguracionErp = {
  id: number;
  empresaId: string;
  centro: string | null;
  connectorKey: string;
  activo: boolean;
  permiteCobroParcial: boolean;
  lastSyncAtMs: number | null;
  lastStatus: string | null;
  lastError: string | null;
};

type Fabrica = () => ICashErpConnector;

/**
 * Conectores disponibles en esta instalación.
 *
 * Se registran por clave. Añadir Business Central, Sage u Odoo consiste en
 * escribir la clase que cumpla `ICashErpConnector` y apuntarla aquí; nada más
 * del módulo cambia.
 */
const FABRICAS = new Map<string, Fabrica>();

/** Instancias ya creadas: un conector suele mantener sesión o token. */
const instancias = new Map<string, ICashErpConnector>();

export function registrarConector(key: string, fabrica: Fabrica): void {
  FABRICAS.set(key, fabrica);
}

export function conectoresDisponibles(): string[] {
  return [...FABRICAS.keys()];
}

/** La ERP simulada siempre está registrada: es la que permite trabajar sin ERP real. */
registrarConector("mock", () => new MockCashErpConnector());

export function obtenerConectorPorClave(key: string): ICashErpConnector | null {
  const yaCreado = instancias.get(key);
  if (yaCreado) return yaCreado;

  const fabrica = FABRICAS.get(key);
  if (!fabrica) return null;

  const c = fabrica();
  instancias.set(key, c);
  return c;
}

/** Solo para las pruebas: sustituye la instancia viva de un conector. */
export function _sustituirInstancia(key: string, conector: ICashErpConnector | null): void {
  if (conector) instancias.set(key, conector);
  else instancias.delete(key);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function aConfiguracion(r: any): ConfiguracionErp {
  return {
    id: r.id,
    empresaId: r.empresa_id,
    centro: r.centro,
    connectorKey: r.connector_key,
    activo: r.activo,
    permiteCobroParcial: r.permite_cobro_parcial,
    lastSyncAtMs: r.last_sync_at_ms == null ? null : Number(r.last_sync_at_ms),
    lastStatus: r.last_status,
    lastError: r.last_error,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Configuración vigente para una empresa y, si se indica, un centro concreto.
 * La del centro gana sobre la general de la empresa.
 */
export async function configuracionErp(
  empresaId: string,
  centro?: string | null
): Promise<ConfiguracionErp | null> {
  // La del centro gana sobre la general ('' = toda la empresa), de ahí el
  // ORDER BY: primero la específica, y si no la hay, la general.
  const { rows } = await pool.query(
    `SELECT * FROM cash_erp_configs
      WHERE empresa_id = $1 AND centro IN ($2, '')
      ORDER BY (centro = '') ASC
      LIMIT 1`,
    [empresaId, centro ?? ""]
  );
  return rows[0] ? aConfiguracion(rows[0]) : null;
}

/**
 * Conector con el que operar, o null si no hay ERP.
 *
 * Null NO es un error: es el modo autónomo, que es el modo por defecto.
 */
export async function conectorPara(
  empresaId: string,
  centro?: string | null
): Promise<{ conector: ICashErpConnector | null; config: ConfiguracionErp | null }> {
  const config = await configuracionErp(empresaId, centro);
  if (!config || !config.activo) return { conector: null, config };
  return { conector: obtenerConectorPorClave(config.connectorKey), config };
}

/** Resumen para el panel de integración. */
export async function estadoIntegracion(
  empresaId: string,
  centro?: string | null
): Promise<{
  estado: EstadoIntegracion;
  config: ConfiguracionErp | null;
  connectorKey: string | null;
  displayName: string | null;
  capacidades: string[];
}> {
  const { conector, config } = await conectorPara(empresaId, centro);

  if (!config) {
    return { estado: "NO_CONFIGURADA", config: null, connectorKey: null, displayName: null, capacidades: [] };
  }
  if (!config.activo) {
    return {
      estado: "DESACTIVADA",
      config,
      connectorKey: config.connectorKey,
      displayName: null,
      capacidades: [],
    };
  }
  if (!conector) {
    return {
      estado: "ERROR",
      config,
      connectorKey: config.connectorKey,
      displayName: null,
      capacidades: [],
    };
  }

  return {
    estado: config.lastStatus === "error" ? "ERROR" : "CONECTADA",
    config,
    connectorKey: conector.info.key,
    displayName: conector.info.displayName,
    capacidades: conector.info.capacidades,
  };
}
