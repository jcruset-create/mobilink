/**
 * Carga de la base los HECHOS que necesita el motor (`domain/accesos.ts`):
 * puerta (con su salida y dispositivo), persona y contratos con sus bloqueos y
 * permisos. Aquí no se decide nada: sólo se lee, siempre con la empresa.
 */

import type { Ejecutor } from "../../shared/db.ts";
import { noExiste } from "../../errors.ts";
import { puertaCorrespondeAlContrato, type Actor, type HechosContrato, type HechosPuerta, type Horario } from "../../domain/accesos.ts";
import type { BlockReason, ContractStatus, DoorType } from "../../../../src/modules/self-storage/types/enums.ts";
import type { DispositivoAcceso } from "../../integrations/access-devices/index.ts";

/** Quién intenta abrir. La identidad sale de la sesión o del token, nunca del cuerpo de la petición. */
export type Quien =
  | { tipo: "customer"; customerId: string }
  | { tipo: "member"; memberId: string }
  | { tipo: "temporary"; temporaryAccessId: string }
  | { tipo: "staff"; userId: string; nombre: string };

export type PuertaCargada = HechosPuerta & {
  name: string;
  zoneId: string | null;
  doorType: DoorType;
  deviceId: string | null;
  deviceOutputId: string | null;
  outputNumber: number | null;
  pulseDurationMs: number | null;
  outputType: "relay" | "digital_output" | null;
  dispositivo: DispositivoAcceso | null;
};

const SELECT_PUERTA = `
  SELECT d.id, d.empresa_id, d.center_id, d.zone_id, d.name, d.door_type, d.enabled, d.allow_app, d.allow_phone,
         d.access_schedule, d.device_output_id, ce.timezone,
         o.output_number, o.pulse_duration_ms, o.output_type, o.enabled AS output_enabled,
         v.id AS device_id, v.name AS device_name, v.manufacturer, v.model, v.connection_type, v.endpoint,
         v.credentials_secret_name, v.driver_options, v.simulation, v.enabled AS device_enabled, v.status AS device_status
    FROM self_storage_doors d
    JOIN self_storage_centers ce ON ce.id = d.center_id
    LEFT JOIN self_storage_device_outputs o ON o.id = d.device_output_id
    LEFT JOIN self_storage_devices v ON v.id = o.device_id`;

export function dispositivoDeFila(r: Record<string, unknown>): DispositivoAcceso {
  return {
    id: r.device_id as string,
    name: r.device_name as string,
    manufacturer: r.manufacturer as string,
    model: r.model as string,
    connectionType: r.connection_type as DispositivoAcceso["connectionType"],
    endpoint: (r.endpoint as string) ?? null,
    credentialsSecretName: (r.credentials_secret_name as string) ?? null,
    driverOptions: (r.driver_options as Record<string, unknown>) ?? {},
    simulation: (r.simulation as Record<string, unknown>) ?? {},
  };
}

function aPuerta(r: Record<string, unknown>): PuertaCargada {
  const conSalida = Boolean(r.device_output_id && r.device_id);
  return {
    id: r.id as string,
    centerId: r.center_id as string,
    zoneId: (r.zone_id as string) ?? null,
    name: r.name as string,
    doorType: r.door_type as DoorType,
    enabled: r.enabled as boolean,
    allowApp: r.allow_app as boolean,
    allowPhone: r.allow_phone as boolean,
    schedule: (r.access_schedule as Horario) ?? null,
    timezone: (r.timezone as string) || "Europe/Madrid",
    salida: conSalida
      ? { enabled: r.output_enabled as boolean, dispositivo: { enabled: r.device_enabled as boolean, status: r.device_status as "unknown" | "online" | "offline" } }
      : null,
    deviceId: (r.device_id as string) ?? null,
    deviceOutputId: (r.device_output_id as string) ?? null,
    outputNumber: (r.output_number as number) ?? null,
    pulseDurationMs: (r.pulse_duration_ms as number) ?? null,
    outputType: (r.output_type as "relay" | "digital_output") ?? null,
    dispositivo: conSalida ? dispositivoDeFila(r) : null,
  };
}

export async function cargarPuerta(c: Ejecutor, empresaId: string, doorId: string): Promise<PuertaCargada> {
  const { rows } = await c.query(`${SELECT_PUERTA} WHERE d.empresa_id = $1 AND d.id = $2`, [empresaId, doorId]);
  if (!rows.length) throw noExiste("La puerta");
  return aPuerta(rows[0]);
}

export async function puertasDeDispositivo(c: Ejecutor, empresaId: string, deviceId: string): Promise<PuertaCargada[]> {
  const { rows } = await c.query(`${SELECT_PUERTA} WHERE d.empresa_id = $1 AND v.id = $2 ORDER BY d.sort_order, d.name`, [empresaId, deviceId]);
  return rows.map(aPuerta);
}

export async function puertasDeCentro(c: Ejecutor, empresaId: string, centerId: string): Promise<PuertaCargada[]> {
  const { rows } = await c.query(`${SELECT_PUERTA} WHERE d.empresa_id = $1 AND d.center_id = $2 ORDER BY d.sort_order, d.name`, [empresaId, centerId]);
  return rows.map(aPuerta);
}

/**
 * Contratos (con sus bloqueos y su permiso para ESTA puerta) de un cliente o
 * de un único contrato. Los bloqueos son los abiertos del contrato y los del
 * cliente sin contrato (afectan a todos sus contratos).
 */
export async function contratosParaPuerta(
  c: Ejecutor,
  empresaId: string,
  puerta: { id: string; centerId: string; zoneId: string | null; doorType: DoorType; enabled: boolean },
  filtro: { customerId: string } | { contractId: string }
): Promise<HechosContrato[]> {
  const porCliente = "customerId" in filtro;
  const { rows } = await c.query(
    `SELECT k.id, k.status, k.center_id, u.zone_id AS unit_zone_id,
            p.source AS perm_source, p.valid_from, p.valid_until,
            coalesce((SELECT array_agg(DISTINCT b.reason::text) FROM self_storage_access_blocks b
                       WHERE b.lifted_at IS NULL
                         AND (b.contract_id = k.id OR (b.contract_id IS NULL AND b.customer_id = k.customer_id))), '{}') AS bloqueos
       FROM self_storage_contracts k
       JOIN self_storage_units u ON u.id = k.storage_unit_id
       LEFT JOIN self_storage_access_permissions p ON p.contract_id = k.id AND p.door_id = $3 AND p.status = 'active'
      WHERE k.empresa_id = $1 AND ${porCliente ? "k.customer_id = $2" : "k.id = $2"}
        AND k.status NOT IN ('draft','cancelled')`,
    [empresaId, porCliente ? filtro.customerId : filtro.contractId, puerta.id]
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status as ContractStatus,
    puertaDerivada: puertaCorrespondeAlContrato(puerta, { centerId: r.center_id, unitZoneId: r.unit_zone_id }),
    permiso: r.perm_source ? { source: r.perm_source, validFrom: r.valid_from ?? null, validUntil: r.valid_until ?? null } : null,
    bloqueos: (r.bloqueos as string[]) as BlockReason[],
  }));
}

export type IdentidadEvento = {
  actorType: "staff" | "customer" | "member" | "guest";
  actorName: string;
  customerId: string | null;
  contractMemberId: string | null;
  temporaryAccessId: string | null;
  staffUserId: string | null;
  /** Contrato de referencia cuando la persona sólo tiene uno (miembro, temporal). */
  contractId: string | null;
};

/** El actor (hechos) y su identidad para el evento: «Juan abrió», «María abrió». */
export async function cargarActor(c: Ejecutor, empresaId: string, quien: Quien, puerta: PuertaCargada, bloquearTemporal = false): Promise<{ actor: Actor; identidad: IdentidadEvento } | null> {
  if (quien.tipo === "staff") {
    return {
      actor: { tipo: "staff" },
      identidad: { actorType: "staff", actorName: quien.nombre, customerId: null, contractMemberId: null, temporaryAccessId: null, staffUserId: quien.userId, contractId: null },
    };
  }
  if (quien.tipo === "customer") {
    const { rows } = await c.query(
      `SELECT id, status, CASE WHEN customer_type = 'company' THEN company_name ELSE btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) END AS nombre
         FROM self_storage_customers WHERE empresa_id = $1 AND id = $2`,
      [empresaId, quien.customerId]
    );
    if (!rows.length) return null;
    return {
      actor: { tipo: "customer", customerStatus: rows[0].status, contratos: await contratosParaPuerta(c, empresaId, puerta, { customerId: quien.customerId }) },
      identidad: { actorType: "customer", actorName: rows[0].nombre, customerId: rows[0].id, contractMemberId: null, temporaryAccessId: null, staffUserId: null, contractId: null },
    };
  }
  if (quien.tipo === "member") {
    const { rows } = await c.query(
      `SELECT m.id, m.full_name, m.status, m.allow_app, m.allow_phone, m.contract_id, k.customer_id, cu.status AS customer_status
         FROM self_storage_contract_members m
         JOIN self_storage_contracts k ON k.id = m.contract_id
         JOIN self_storage_customers cu ON cu.id = k.customer_id
        WHERE m.empresa_id = $1 AND m.id = $2`,
      [empresaId, quien.memberId]
    );
    if (!rows.length) return null;
    const m = rows[0];
    return {
      actor: {
        tipo: "member",
        memberStatus: m.status,
        allowApp: m.allow_app,
        allowPhone: m.allow_phone,
        customerStatus: m.customer_status,
        contratos: await contratosParaPuerta(c, empresaId, puerta, { contractId: m.contract_id }),
      },
      identidad: { actorType: "member", actorName: m.full_name, customerId: m.customer_id, contractMemberId: m.id, temporaryAccessId: null, staffUserId: null, contractId: m.contract_id },
    };
  }
  // Acceso temporal. Con `bloquearTemporal` se lee con FOR UPDATE: dos usos a
  // la vez de un acceso de un solo uso no pueden pasar los dos.
  const { rows } = await c.query(
    `SELECT t.*, coalesce(t.customer_id, k.customer_id) AS cliente, cu.status AS customer_status,
            coalesce((SELECT array_agg(door_id) FROM self_storage_temporary_access_doors WHERE temporary_access_id = t.id), '{}') AS door_ids
       FROM self_storage_temporary_accesses t
       LEFT JOIN self_storage_contracts k ON k.id = t.contract_id
       LEFT JOIN self_storage_customers cu ON cu.id = coalesce(t.customer_id, k.customer_id)
      WHERE t.empresa_id = $1 AND t.id = $2 ${bloquearTemporal ? "FOR UPDATE OF t" : ""}`,
    [empresaId, quien.temporaryAccessId]
  );
  if (!rows.length) return null;
  const t = rows[0];
  return {
    actor: {
      tipo: "temporary",
      status: t.status,
      startsAt: t.starts_at,
      endsAt: t.ends_at,
      maxUses: t.max_uses,
      usesCount: t.uses_count,
      doorIds: t.door_ids,
      customerStatus: t.customer_status ?? null,
      dependeDeContrato: Boolean(t.contract_id),
      contratos: t.contract_id ? await contratosParaPuerta(c, empresaId, puerta, { contractId: t.contract_id }) : [],
    },
    identidad: {
      actorType: t.holder_type === "holder" ? "customer" : "guest",
      actorName: t.full_name,
      customerId: t.cliente ?? null,
      contractMemberId: null,
      temporaryAccessId: t.id,
      staffUserId: null,
      contractId: t.contract_id ?? null,
    },
  };
}
