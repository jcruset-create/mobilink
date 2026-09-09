/**
 * Qué empresa de TyreControl corresponde a un cliente de Assist.
 *
 * ── Por qué hace falta ──────────────────────────────────────────────────────
 *
 * `tc_vehiculos` tiene `unique(empresa_id, matricula)`: la matrícula es única
 * DENTRO de una empresa. Sin saber de qué empresa hablamos, una matrícula
 * repetida entre dos clientes de TC es irresoluble, y adivinarla aplicaría un
 * trabajo al vehículo de otro.
 *
 * ── Por qué explícito y nunca por nombre ────────────────────────────────────
 *
 * Comparar `connect_clients.name` con `tc_empresas.nombre` acertaría casi
 * siempre. «Casi siempre» es justo la clase de fallo que ya corregimos en la
 * fase anterior: funciona hasta que no, y cuando falla no avisa. La relación
 * la declara una persona una vez.
 *
 * ── Por qué no hay tabla nueva ──────────────────────────────────────────────
 *
 * `integration_mappings` ya es exactamente esto: entidad, sistema externo,
 * código externo e id de Mobilink. Encaja sin forzarlo.
 *
 * Lo único que le falta es UNA invariante: su UNIQUE está sobre `external_code`,
 * o sea que impide que dos clientes reclamen la misma empresa de TC, pero NO
 * impide que un mismo cliente apunte a dos empresas. Eso se añade con un índice
 * parcial acotado a este tipo de entidad, sin tocar nada de lo que ya usa la
 * tabla.
 */

import db from "../db.ts";
import { supabase } from "../supabase.ts";
import { ErrorTyreControl } from "./vehiculos.ts";

/** Cómo se identifica esta relación dentro de `integration_mappings`. */
export const ENTIDAD = "customer";
export const SISTEMA = "tyrecontrol";

/**
 * El lado Assist es `connect_clients.id`.
 *
 * Se eligió frente a las alternativas por lo que representa: es el CLIENTE DE
 * FACTURACIÓN, el dueño del vehículo y a quien se le cobra. `roadside_vehicles`
 * son las grúas propias; la matrícula suelta no identifica a nadie; y
 * `otf.clientId` y `roadside_assistances.clienteFacturacionId` apuntan los dos
 * aquí, así que sirve igual para asistencias y para OTF.
 */
export type MapeoEmpresa = {
  id: number;
  clienteId: number;
  clienteNombre: string | null;
  tcEmpresaId: string;
  tcEmpresaNombre: string | null;
  activo: boolean;
  actualizadoEnMs: number;
};

export async function initMapeoEmpresas(): Promise<void> {
  /*
   * Un cliente, una empresa de TC. El índice es PARCIAL —solo para este tipo de
   * entidad y este sistema— para no imponer nada a los mapeos de producto o de
   * ERP que ya viven en la misma tabla.
   */
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_mappings_tc_cliente
      ON integration_mappings (tenant_id, mobilink_id)
      WHERE entity_type = 'customer' AND system = 'tyrecontrol'
  `).catch((e) => {
    console.warn("[TyreControl] índice único de mapeo no creado:", (e as any)?.message);
  });
}

function tenant(tenantId: string | null | undefined): string {
  // El tenant de Assist es el taller. Sin él se usa una clave fija: hoy hay un
  // solo taller y no tener tenant no puede impedir configurar el mapeo.
  return tenantId == null || tenantId === "" ? "assist" : String(tenantId);
}

function aMapeo(f: any, clientes: Map<number, string>, empresas: Map<string, string>): MapeoEmpresa {
  const clienteId = Number(f.mobilink_id);
  return {
    id: Number(f.id),
    clienteId,
    clienteNombre: clientes.get(clienteId) ?? null,
    tcEmpresaId: String(f.external_code),
    tcEmpresaNombre: empresas.get(String(f.external_code)) ?? null,
    activo: (f.metadata?.activo ?? true) !== false,
    actualizadoEnMs: Number(f.updated_at_ms ?? 0),
  };
}

/** Nombres de los dos lados, en dos consultas y no una por fila. */
async function etiquetas(filas: any[]) {
  const idsCliente = [...new Set(filas.map((f) => Number(f.mobilink_id)).filter(Number.isInteger))];
  const idsEmpresa = [...new Set(filas.map((f) => String(f.external_code)).filter(Boolean))];

  const clientes = new Map<number, string>();
  if (idsCliente.length) {
    const r = await db.query(
      `SELECT id, name FROM connect_clients WHERE id = ANY($1::int[])`, [idsCliente],
    ).catch(() => ({ rows: [] as any[] }));
    for (const c of r.rows) clientes.set(Number(c.id), String(c.name ?? ""));
  }

  const empresas = new Map<string, string>();
  if (idsEmpresa.length) {
    const { data } = await supabase.from("tc_empresas").select("id, nombre, activo").in("id", idsEmpresa);
    for (const e of data ?? []) empresas.set(String(e.id), String(e.nombre ?? ""));
  }
  return { clientes, empresas };
}

export async function listarMapeos(tenantId?: string | null): Promise<MapeoEmpresa[]> {
  const r = await db.query(
    `SELECT * FROM integration_mappings
      WHERE tenant_id = $1 AND entity_type = $2 AND system = $3
      ORDER BY updated_at_ms DESC`,
    [tenant(tenantId), ENTIDAD, SISTEMA],
  );
  const { clientes, empresas } = await etiquetas(r.rows);
  return r.rows.map((f) => aMapeo(f, clientes, empresas));
}

/** La empresa de TC de un cliente, o null si no está mapeado. */
export async function empresaDeCliente(
  clienteId: number | null | undefined, tenantId?: string | null,
): Promise<{ tcEmpresaId: string; activo: boolean } | null> {
  if (clienteId == null || !Number.isInteger(Number(clienteId))) return null;
  const r = await db.query(
    `SELECT external_code, metadata FROM integration_mappings
      WHERE tenant_id = $1 AND entity_type = $2 AND system = $3 AND mobilink_id = $4`,
    [tenant(tenantId), ENTIDAD, SISTEMA, String(clienteId)],
  );
  const f = r.rows[0];
  if (!f) return null;
  return {
    tcEmpresaId: String(f.external_code),
    activo: (f.metadata?.activo ?? true) !== false,
  };
}

/**
 * Comprueba que la empresa existe y está activa en TyreControl.
 *
 * Un mapeo que apunta a una empresa borrada o desactivada es un error de
 * configuración, y hay que decirlo: resolver por otra empresa «porque esa no
 * vale» es exactamente lo que no debe pasar.
 */
export async function comprobarEmpresa(tcEmpresaId: string): Promise<{ nombre: string; activa: boolean } | null> {
  const { data, error } = await supabase
    .from("tc_empresas").select("id, nombre, activo").eq("id", tcEmpresaId).maybeSingle();
  if (error) {
    console.error("[TyreControl] error comprobando empresa:", error.message);
    throw new ErrorTyreControl("tc_unavailable", "No se ha podido consultar TyreControl");
  }
  if (!data) return null;
  return { nombre: String(data.nombre ?? ""), activa: data.activo !== false };
}

export class ErrorMapeo extends Error {
  constructor(public codigo: string, mensaje: string, public estado = 422) { super(mensaje); }
}

export async function guardarMapeo(p: {
  clienteId: number; tcEmpresaId: string; activo?: boolean;
  tenantId?: string | null; porQuien?: string | null;
}): Promise<MapeoEmpresa> {
  if (!Number.isInteger(Number(p.clienteId))) {
    throw new ErrorMapeo("cliente_invalido", "Indica el cliente");
  }
  const cliente = await db.query(`SELECT id, name FROM connect_clients WHERE id = $1`, [p.clienteId]);
  if (!cliente.rows.length) throw new ErrorMapeo("cliente_no_encontrado", "Ese cliente no existe", 404);

  // Se comprueba ANTES de guardar: un mapeo a una empresa que no existe es un
  // error de configuración que se descubriría al primer envío, y para entonces
  // ya nadie recuerda haberlo creado.
  const empresa = await comprobarEmpresa(p.tcEmpresaId);
  if (!empresa) throw new ErrorMapeo("empresa_no_encontrada", "Esa empresa no existe en TyreControl", 404);
  if (!empresa.activa) {
    throw new ErrorMapeo("empresa_inactiva", `«${empresa.nombre}» está dada de baja en TyreControl`);
  }

  /*
   * La tabla ya traía un UNIQUE sobre `external_code`: una empresa de TC solo
   * puede estar reclamada por un cliente. Es una restricción razonable —una
   * empresa de TyreControl es de alguien— pero su error es ilegible, así que se
   * comprueba antes y se dice con nombres.
   */
  const yaTiene = await db.query(
    `SELECT mobilink_id FROM integration_mappings
      WHERE tenant_id = $1 AND entity_type = $2 AND system = $3 AND external_code = $4`,
    [tenant(p.tenantId), ENTIDAD, SISTEMA, p.tcEmpresaId],
  );
  const dueno = yaTiene.rows[0];
  if (dueno && Number(dueno.mobilink_id) !== Number(p.clienteId)) {
    const otro = await db.query(`SELECT name FROM connect_clients WHERE id = $1`, [dueno.mobilink_id]);
    throw new ErrorMapeo(
      "empresa_ya_asignada",
      `«${empresa.nombre}» ya está asignada a ${otro.rows[0]?.name ?? `el cliente ${dueno.mobilink_id}`}. ` +
      "Quita ese mapeo antes de asignarla a otro cliente.",
      409,
    );
  }

  const now = Date.now();
  const metadata = JSON.stringify({
    activo: p.activo !== false,
    actualizadoPor: p.porQuien ?? null,
  });

  /*
   * El conflicto que se resuelve aquí es el del índice parcial: un cliente que
   * ya tenía empresa pasa a tener otra. Es un cambio legítimo —un cliente puede
   * cambiar de empresa en TC— y se registra encima, no se duplica.
   */
  await db.query(
    `INSERT INTO integration_mappings
       (tenant_id, entity_type, system, external_code, mobilink_id, metadata, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$7)
     ON CONFLICT (tenant_id, mobilink_id) WHERE entity_type = 'customer' AND system = 'tyrecontrol'
     DO UPDATE SET external_code = EXCLUDED.external_code,
                   metadata = EXCLUDED.metadata,
                   updated_at_ms = EXCLUDED.updated_at_ms`,
    [tenant(p.tenantId), ENTIDAD, SISTEMA, p.tcEmpresaId, String(p.clienteId), metadata, now],
  );

  const guardado = (await listarMapeos(p.tenantId)).find((m) => m.clienteId === Number(p.clienteId));
  return guardado!;
}

export async function borrarMapeo(clienteId: number, tenantId?: string | null): Promise<void> {
  const r = await db.query(
    `DELETE FROM integration_mappings
      WHERE tenant_id = $1 AND entity_type = $2 AND system = $3 AND mobilink_id = $4`,
    [tenant(tenantId), ENTIDAD, SISTEMA, String(clienteId)],
  );
  if ((r.rowCount ?? 0) === 0) throw new ErrorMapeo("not_found", "Ese cliente no tenía mapeo", 404);
}

/** Empresas de TyreControl, para poder elegir una en la pantalla. */
export async function empresasDeTyreControl(): Promise<{ id: string; nombre: string; activa: boolean }[]> {
  const { data, error } = await supabase
    .from("tc_empresas").select("id, nombre, activo").order("nombre");
  if (error) {
    console.error("[TyreControl] error listando empresas:", error.message);
    throw new ErrorTyreControl("tc_unavailable", "No se ha podido consultar TyreControl");
  }
  return (data ?? []).map((e: any) => ({
    id: String(e.id), nombre: String(e.nombre ?? ""), activa: e.activo !== false,
  }));
}
