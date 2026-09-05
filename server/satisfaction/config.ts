/**
 * Configuración de Satisfaction: global y por cliente.
 *
 * ── Por qué una tabla propia y no columnas en `connect_clients` ─────────────
 *
 * `connect_clients` ya lleva media docena de columnas de facturación añadidas a
 * golpe de ALTER, así que meter tres más habría seguido el precedente. Se ha
 * elegido lo otro por tres motivos concretos:
 *
 *  1. **Hace falta un tercer valor.** «Hereda de la global» no es lo mismo que
 *     «desactivado», y una columna `BOOLEAN NOT NULL DEFAULT true` no lo puede
 *     decir. Cambiar la global tiene que arrastrar a todos los clientes que no
 *     han dicho nada, y con un booleano sin nulos eso se pierde.
 *  2. **`connect_clients` es de Central.** Assist la usa prestada. Colgarle la
 *     configuración de una funcionalidad de Assist obliga a Central a cargar
 *     con ella, y el día que Central reutilice Satisfaction —que es el plan—
 *     tendría su propia entidad de cliente y las columnas no le servirían.
 *  3. **El módulo se puede quitar entero.** Sus tablas se borran y no queda
 *     nada suelto en tablas de otros.
 *
 * ── La global va en `workshop_config` ───────────────────────────────────────
 *
 * Ésa sí: es la tabla clave/valor que el proyecto ya usa para los ajustes del
 * taller, y estrenar otra para seis claves no aporta nada.
 */

import db from "../db.ts";
import { CADUCIDAD_POR_DEFECTO_MS, type Sistema } from "./dominio.ts";

/* ── Claves ──────────────────────────────────────────────────────────────── */

export const CLAVES = {
  activo: "satisfaction.enabled",
  conductor: "satisfaction.driverSurveyEnabled",
  cliente: "satisfaction.customerSurveyEnabled",
  caducidadHoras: "satisfaction.expiryHours",
  retrasoMinutos: "satisfaction.sendDelayMinutes",
  recordatorio: "satisfaction.reminderEnabled",
} as const;

export type ConfigSatisfaction = {
  activo: boolean;
  conductor: boolean;
  cliente: boolean;
  caducidadHoras: number;
  retrasoMinutos: number;
  recordatorio: boolean;
};

/**
 * Lo que vale si nadie ha configurado nada.
 *
 * **Apagado.** Es lo único aceptable: si la tabla está vacía —porque el
 * despliegue es nuevo, porque alguien borró una fila— nadie debe empezar a
 * recibir WhatsApp por sorpresa. Encenderlo es una decisión, no un descuido.
 */
export const POR_DEFECTO: ConfigSatisfaction = {
  activo: false,
  conductor: false,
  cliente: false,
  caducidadHoras: CADUCIDAD_POR_DEFECTO_MS / 3_600_000,
  retrasoMinutos: 60,
  recordatorio: false,
};

function aBooleano(v: string | undefined, sinValor: boolean): boolean {
  if (v == null || v === "") return sinValor;
  return v.toLowerCase() === "true" || v === "1";
}

function aNumero(v: string | undefined, sinValor: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : sinValor;
}

/**
 * La configuración global.
 *
 * Nunca lanza: si `workshop_config` no existe todavía —o la consulta falla— se
 * devuelven los valores por defecto, que están apagados. Que no se pueda leer
 * la configuración no puede tumbar el cierre de una asistencia.
 */
export async function configGlobal(): Promise<ConfigSatisfaction> {
  let mapa: Record<string, string> = {};
  try {
    const r = await db.query(
      `SELECT key, value FROM workshop_config WHERE key = ANY($1)`,
      [Object.values(CLAVES)],
    );
    for (const f of r.rows) mapa[String(f.key)] = String(f.value ?? "");
  } catch {
    mapa = {};
  }
  return {
    activo: aBooleano(mapa[CLAVES.activo], POR_DEFECTO.activo),
    conductor: aBooleano(mapa[CLAVES.conductor], POR_DEFECTO.conductor),
    cliente: aBooleano(mapa[CLAVES.cliente], POR_DEFECTO.cliente),
    caducidadHoras: aNumero(mapa[CLAVES.caducidadHoras], POR_DEFECTO.caducidadHoras),
    retrasoMinutos: aNumero(mapa[CLAVES.retrasoMinutos], POR_DEFECTO.retrasoMinutos),
    recordatorio: aBooleano(mapa[CLAVES.recordatorio], POR_DEFECTO.recordatorio),
  };
}

export async function guardarConfigGlobal(cambios: Partial<ConfigSatisfaction>): Promise<void> {
  const pares: [string, string][] = [];
  const poner = (k: string, v: unknown) => { if (v !== undefined) pares.push([k, String(v)]); };
  poner(CLAVES.activo, cambios.activo);
  poner(CLAVES.conductor, cambios.conductor);
  poner(CLAVES.cliente, cambios.cliente);
  poner(CLAVES.caducidadHoras, cambios.caducidadHoras);
  poner(CLAVES.retrasoMinutos, cambios.retrasoMinutos);
  poner(CLAVES.recordatorio, cambios.recordatorio);
  for (const [k, v] of pares) {
    await db.query(
      `INSERT INTO workshop_config (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k, v],
    );
  }
}

/* ── Override por cliente ────────────────────────────────────────────────── */

export async function initSatisfactionConfig(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS satisfaction_client_config (
      id BIGSERIAL PRIMARY KEY,
      "sourceSystem" TEXT NOT NULL,
      "tenantId" TEXT,
      "clientId" TEXT NOT NULL,

      /*
       * Los tres admiten NULL, y ése es el punto: NULL significa «hereda».
       * Sin él no se podría distinguir de «desactivado a propósito», y
       * cambiar la global dejaría de arrastrar a quien no ha dicho nada.
       */
      activo BOOLEAN,
      conductor BOOLEAN,
      cliente BOOLEAN,

      notas TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,

      UNIQUE ("sourceSystem", "tenantId", "clientId")
    );

    CREATE INDEX IF NOT EXISTS idx_satisfaction_client_config
      ON satisfaction_client_config ("sourceSystem", "clientId");
  `);
}

export type OverrideCliente = {
  activo: boolean | null;
  conductor: boolean | null;
  cliente: boolean | null;
};

const SIN_OVERRIDE: OverrideCliente = { activo: null, conductor: null, cliente: null };

export async function overrideDeCliente(p: {
  sourceSystem: Sistema;
  tenantId: string | null;
  clientId: string | number | null | undefined;
}): Promise<OverrideCliente> {
  if (p.clientId == null || p.clientId === "") return SIN_OVERRIDE;
  try {
    const r = await db.query(
      `SELECT activo, conductor, cliente FROM satisfaction_client_config
        WHERE "sourceSystem" = $1 AND ("tenantId" IS NOT DISTINCT FROM $2) AND "clientId" = $3`,
      [p.sourceSystem, p.tenantId, String(p.clientId)],
    );
    const f = r.rows[0];
    if (!f) return SIN_OVERRIDE;
    return {
      activo: f.activo == null ? null : Boolean(f.activo),
      conductor: f.conductor == null ? null : Boolean(f.conductor),
      cliente: f.cliente == null ? null : Boolean(f.cliente),
    };
  } catch {
    return SIN_OVERRIDE;
  }
}

export async function guardarOverrideCliente(p: {
  sourceSystem: Sistema;
  tenantId: string | null;
  clientId: string | number;
  valores: Partial<OverrideCliente>;
  notas?: string | null;
}): Promise<void> {
  const ahora = Date.now();
  await db.query(
    `INSERT INTO satisfaction_client_config
       ("sourceSystem","tenantId","clientId",activo,conductor,cliente,notas,"createdAtMs","updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT ("sourceSystem","tenantId","clientId") DO UPDATE
       SET activo = EXCLUDED.activo, conductor = EXCLUDED.conductor,
           cliente = EXCLUDED.cliente, notas = EXCLUDED.notas,
           "updatedAtMs" = EXCLUDED."updatedAtMs"`,
    [p.sourceSystem, p.tenantId, String(p.clientId),
     p.valores.activo ?? null, p.valores.conductor ?? null, p.valores.cliente ?? null,
     p.notas ?? null, ahora],
  );
}

/**
 * La configuración que de verdad se aplica: la global con el override encima.
 *
 * El override solo puede **restringir**. Si Satisfaction está apagado en
 * global, ningún cliente lo enciende por su cuenta: el interruptor general
 * tiene que poder parar el sistema entero de una vez, que es justo para lo que
 * está.
 */
export function combinar(global: ConfigSatisfaction, override: OverrideCliente): ConfigSatisfaction {
  const y = (g: boolean, o: boolean | null) => (o == null ? g : g && o);
  return {
    ...global,
    activo: y(global.activo, override.activo),
    conductor: y(global.conductor, override.conductor),
    cliente: y(global.cliente, override.cliente),
  };
}
