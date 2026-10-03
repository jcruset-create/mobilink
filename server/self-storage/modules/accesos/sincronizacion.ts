/**
 * Permisos de acceso y sincronización de teléfonos con los dispositivos.
 *
 * Todo es ESTADO DESEADO calculado, nunca altas/bajas sueltas:
 *   · permisos de contrato = puertas que le corresponden si está activo o
 *     suspendido (el bloqueo lo decide el motor en cada intento);
 *   · teléfonos de un dispositivo = los de las personas que, con el mismo
 *     motor (`evaluateAccess`), pueden abrir por llamada alguna de sus puertas
 *     AHORA. Un número compartido por dos contratos sigue mientras uno lo
 *     justifique.
 *
 * Flujo tras cualquier cambio (bloqueo, estado del contrato, teléfono,
 * persona autorizada, acceso temporal, puerta):
 *   marcarCambioAcceso (en la MISMA transacción que el cambio)
 *     → recalcular permisos → recalcular lista deseada (pending si cambia)
 *   → después del COMMIT: aplicar en el dispositivo (y el trabajo `accesos`
 *     reintenta lo que falle con espera creciente).
 *
 * La app no espera a la sincronización: abrir desde la app consulta el motor
 * en el momento, así que un bloqueo se nota al instante. La lista del RUT241
 * es la que puede ir por detrás, y por eso su estado está a la vista.
 */

import { createHash } from "node:crypto";
import type { Ejecutor } from "../../shared/db.ts";
import { enTx, pool } from "../../shared/db.ts";
import { ESTADOS_CON_PERMISOS, puertasDelContrato, telefonosDeseados, type CandidatoTelefono } from "../../domain/accesos.ts";
import { adapterDe, type DispositivoAcceso, type EstadoDispositivo } from "../../integrations/access-devices/index.ts";
import { cargarActor, dispositivoDeFila, puertasDeCentro, puertasDeDispositivo, type Quien } from "./contexto.ts";
import type { ContractStatus } from "../../../../src/modules/self-storage/types/enums.ts";

// ── Permisos ────────────────────────────────────────────────────────────────

export async function recalcularPermisosContrato(c: Ejecutor, empresaId: string, contractId: string): Promise<void> {
  const { rows } = await c.query(
    `SELECT k.status, k.center_id, u.zone_id FROM self_storage_contracts k JOIN self_storage_units u ON u.id = k.storage_unit_id
      WHERE k.empresa_id = $1 AND k.id = $2`,
    [empresaId, contractId]
  );
  if (!rows.length) return;
  const k = rows[0];
  const deseadas = ESTADOS_CON_PERMISOS.includes(k.status as ContractStatus)
    ? puertasDelContrato(await puertasDeCentro(c, empresaId, k.center_id), { centerId: k.center_id, unitZoneId: k.zone_id })
    : [];
  // Revocar las de contrato que sobran (las manuales no se tocan).
  await c.query(
    `UPDATE self_storage_access_permissions SET status = 'revoked', revoked_at = now()
      WHERE contract_id = $1 AND source = 'contract' AND status = 'active' AND NOT (door_id = ANY($2::uuid[]))`,
    [contractId, deseadas]
  );
  for (const doorId of deseadas) {
    await c.query(
      `INSERT INTO self_storage_access_permissions (empresa_id, contract_id, door_id, source)
       VALUES ($1,$2,$3,'contract')
       ON CONFLICT (contract_id, door_id) WHERE status = 'active' DO NOTHING`,
      [empresaId, contractId, doorId]
    );
  }
}

// ── Lista deseada de teléfonos ──────────────────────────────────────────────

/**
 * Personas con teléfono que podrían abrir por llamada en el centro:
 *   · teléfonos del cliente marcados «abre puertas»;
 *   · personas autorizadas con llamada y teléfono;
 *   · accesos temporales con teléfono y SIN límite de usos. Uno de N usos no
 *     se pone en la lista: el RUT241 abre sin preguntar y no se podrían contar
 *     (se usan por la app o por el enlace).
 */
async function candidatos(c: Ejecutor, empresaId: string, centerId: string): Promise<{ phone: string; quien: Quien; origen: string }[]> {
  const { rows } = await c.query(
    `SELECT cp.phone_e164 AS phone, 'customer' AS tipo, cp.customer_id AS id
       FROM self_storage_customer_phones cp
      WHERE cp.empresa_id = $1 AND cp.allow_door_access
        AND EXISTS (SELECT 1 FROM self_storage_contracts k WHERE k.customer_id = cp.customer_id AND k.center_id = $2 AND k.status NOT IN ('draft','cancelled'))
     UNION ALL
     SELECT m.phone_e164, 'member', m.id
       FROM self_storage_contract_members m JOIN self_storage_contracts k ON k.id = m.contract_id
      WHERE m.empresa_id = $1 AND k.center_id = $2 AND m.allow_phone AND m.phone_e164 IS NOT NULL
     UNION ALL
     SELECT t.phone_e164, 'temporary', t.id
       FROM self_storage_temporary_accesses t
      WHERE t.empresa_id = $1 AND t.center_id = $2 AND t.phone_e164 IS NOT NULL AND t.status = 'active'
        AND t.max_uses IS NULL AND t.ends_at > now()`,
    [empresaId, centerId]
  );
  return rows.map((r) => ({
    phone: r.phone,
    origen: `${r.tipo}:${r.id}`,
    quien: r.tipo === "customer" ? { tipo: "customer", customerId: r.id } : r.tipo === "member" ? { tipo: "member", memberId: r.id } : { tipo: "temporary", temporaryAccessId: r.id },
  }));
}

export async function telefonosDeseadosDe(c: Ejecutor, empresaId: string, deviceId: string, at = new Date()): Promise<string[]> {
  const { rows } = await c.query(`SELECT center_id, phone_access_mode FROM self_storage_devices WHERE empresa_id = $1 AND id = $2`, [empresaId, deviceId]);
  if (!rows.length || rows[0].phone_access_mode === "none") return [];
  const puertas = await puertasDeDispositivo(c, empresaId, deviceId);
  if (!puertas.some((p) => p.allowPhone)) return [];
  const lista: CandidatoTelefono[] = [];
  for (const cand of await candidatos(c, empresaId, rows[0].center_id)) {
    // Hechos de esa persona en cada puerta del dispositivo (permiso y zona dependen de la puerta).
    const porPuerta = new Map<string, Awaited<ReturnType<typeof cargarActor>>>();
    for (const p of puertas) porPuerta.set(p.id, await cargarActor(c, empresaId, cand.quien, p));
    lista.push({ phone: cand.phone, origen: cand.origen, actor: (puertaId) => porPuerta.get(puertaId)?.actor ?? null });
  }
  return telefonosDeseados(puertas, lista, at);
}

export const huella = (phones: string[]) => createHash("sha256").update(JSON.stringify(phones)).digest("hex");

/** Recalcula la lista deseada; si cambia, la sincronización pasa a `pending`. */
export async function recalcularDeseado(c: Ejecutor, empresaId: string, deviceId: string, at = new Date()): Promise<void> {
  const phones = await telefonosDeseadosDe(c, empresaId, deviceId, at);
  const h = huella(phones);
  await c.query(
    `INSERT INTO self_storage_device_syncs (empresa_id, device_id, desired_state, desired_hash, status, next_attempt_at)
     VALUES ($1, $2, $3, $4, 'pending', now())
     ON CONFLICT (device_id, sync_type) DO UPDATE SET
       status = CASE WHEN EXCLUDED.desired_hash = self_storage_device_syncs.actual_hash THEN 'synced'
                     WHEN EXCLUDED.desired_hash <> self_storage_device_syncs.desired_hash THEN 'pending'
                     ELSE self_storage_device_syncs.status END,
       attempts = CASE WHEN EXCLUDED.desired_hash <> self_storage_device_syncs.desired_hash THEN 0 ELSE self_storage_device_syncs.attempts END,
       next_attempt_at = CASE WHEN EXCLUDED.desired_hash <> self_storage_device_syncs.desired_hash THEN now() ELSE self_storage_device_syncs.next_attempt_at END,
       error = CASE WHEN EXCLUDED.desired_hash = self_storage_device_syncs.actual_hash THEN NULL ELSE self_storage_device_syncs.error END,
       desired_state = EXCLUDED.desired_state,
       desired_hash = EXCLUDED.desired_hash,
       updated_at = now()`,
    [empresaId, deviceId, JSON.stringify(phones), h]
  );
}

// ── Cambios de acceso ───────────────────────────────────────────────────────

export type ObjetivoCambio = { contractIds?: string[]; customerId?: string; centerIds?: string[] };

/**
 * Llamar DENTRO de la transacción del cambio. Recalcula permisos y listas
 * deseadas de los dispositivos afectados y devuelve sus ids para aplicar
 * después del COMMIT (`programarAplicacion`).
 */
export async function marcarCambioAcceso(c: Ejecutor, empresaId: string, o: ObjetivoCambio): Promise<string[]> {
  const contratos = new Set(o.contractIds ?? []);
  const centros = new Set(o.centerIds ?? []);
  if (o.customerId) {
    const { rows } = await c.query(`SELECT id FROM self_storage_contracts WHERE empresa_id = $1 AND customer_id = $2`, [empresaId, o.customerId]);
    rows.forEach((r) => contratos.add(r.id));
  }
  for (const centro of o.centerIds ?? []) {
    const { rows } = await c.query(`SELECT id FROM self_storage_contracts WHERE empresa_id = $1 AND center_id = $2 AND status NOT IN ('draft','cancelled')`, [empresaId, centro]);
    rows.forEach((r) => contratos.add(r.id));
  }
  if (contratos.size) {
    const { rows } = await c.query(`SELECT DISTINCT center_id FROM self_storage_contracts WHERE id = ANY($1::uuid[])`, [[...contratos]]);
    rows.forEach((r) => centros.add(r.center_id));
  }
  for (const k of contratos) await recalcularPermisosContrato(c, empresaId, k);
  const { rows: dispositivos } = await c.query(
    `SELECT id FROM self_storage_devices WHERE empresa_id = $1 AND center_id = ANY($2::uuid[])`,
    [empresaId, [...centros]]
  );
  for (const d of dispositivos) await recalcularDeseado(c, empresaId, d.id);
  return dispositivos.map((d) => d.id as string);
}

/**
 * Aplica en los dispositivos después del COMMIT (no se habla con un equipo
 * con una transacción abierta). Si falla, el trabajo `accesos` reintenta.
 */
export function programarAplicacion(deviceIds: string[], esperaMs = 250): void {
  if (!deviceIds.length || process.env.SELF_STORAGE_JOBS === "0") return;
  setTimeout(() => {
    for (const id of deviceIds) void aplicarSync(id).catch((e) => console.error("[Self Storage] sincronización de dispositivo:", e));
  }, esperaMs).unref?.();
}

/**
 * Para código que ya está dentro de una transacción ajena (bloqueos, impagos,
 * webhooks): recalcula en ella y programa el envío con margen para el COMMIT.
 * Si el envío llegara antes del COMMIT, no pasa nada: vería la lista anterior
 * (sin cambios que enviar) y el trabajo `accesos` lo enviaría en su vuelta.
 */
export async function cambioDeAccesoEnTx(c: Ejecutor, empresaId: string, o: ObjetivoCambio): Promise<void> {
  programarAplicacion(await marcarCambioAcceso(c, empresaId, o), 1500);
}

// ── Aplicar en el dispositivo ───────────────────────────────────────────────

const ESPERA_MAX_MIN = 60;

/** Envía la lista deseada si no está al día. Devuelve el estado final. */
export async function aplicarSync(deviceId: string): Promise<"synced" | "failed" | "skipped"> {
  const { rows } = await pool.query(
    `SELECT s.desired_state, s.desired_hash, s.actual_hash, s.status, s.attempts,
            v.id AS device_id, v.name AS device_name, v.manufacturer, v.model, v.connection_type, v.endpoint,
            v.credentials_secret_name, v.driver_options, v.simulation, v.enabled
       FROM self_storage_device_syncs s JOIN self_storage_devices v ON v.id = s.device_id
      WHERE s.device_id = $1 AND s.sync_type = 'phone_whitelist'`,
    [deviceId]
  );
  const s = rows[0];
  if (!s || !s.enabled || (s.desired_hash === s.actual_hash && s.status === "synced")) return "skipped";
  const dispositivo: DispositivoAcceso = dispositivoDeFila(s);
  await pool.query(`UPDATE self_storage_device_syncs SET last_attempt_at = now() WHERE device_id = $1`, [deviceId]);
  const r = await adapterDe(dispositivo).syncAuthorizedPhones(dispositivo, s.desired_state);
  if (r.ok) {
    // Sólo se da por bueno si mientras tanto no ha cambiado lo deseado.
    const { rowCount } = await pool.query(
      `UPDATE self_storage_device_syncs
          SET actual_state = $2, actual_hash = $3, status = 'synced', last_success_at = now(), error = NULL, attempts = 0, next_attempt_at = NULL, updated_at = now()
        WHERE device_id = $1 AND desired_hash = $3`,
      [deviceId, JSON.stringify(r.applied), huella(r.applied)]
    );
    if (!rowCount) {
      await pool.query(`UPDATE self_storage_device_syncs SET actual_state = $2, actual_hash = $3, updated_at = now() WHERE device_id = $1`, [deviceId, JSON.stringify(r.applied), huella(r.applied)]);
    }
    await registrarComunicacion(deviceId, true, null);
    return "synced";
  }
  const intentos = Number(s.attempts) + 1;
  const espera = Math.min(ESPERA_MAX_MIN, 2 ** Math.min(intentos, 6));
  await pool.query(
    `UPDATE self_storage_device_syncs
        SET status = 'failed', attempts = $2, next_attempt_at = now() + make_interval(mins => $3), error = $4, updated_at = now()
      WHERE device_id = $1`,
    [deviceId, intentos, espera, `${r.code ?? "ERROR"}: ${r.message ?? "sin detalle"}`.slice(0, 500)]
  );
  if (r.code === "OFFLINE" || r.code === "TIMEOUT") await registrarComunicacion(deviceId, false, `${r.code}: ${r.message ?? ""}`);
  return "failed";
}

/** Último contacto con el dispositivo: online/offline y último error. */
export async function registrarComunicacion(deviceId: string, ok: boolean, error: string | null, firmware?: string | null): Promise<void> {
  await pool.query(
    ok
      ? `UPDATE self_storage_devices SET status = 'online', last_seen_at = now(), firmware = coalesce($2, firmware) WHERE id = $1`
      : `UPDATE self_storage_devices SET status = 'offline', last_error = $2, last_error_at = now() WHERE id = $1`,
    ok ? [deviceId, firmware ?? null] : [deviceId, (error ?? "sin respuesta").slice(0, 500)]
  );
}

/**
 * Trabajo programado `accesos`: latido de cada dispositivo, recálculo de las
 * listas (los accesos temporales y los horarios cambian con la hora) y
 * aplicación de lo pendiente o fallido cuyo reintento ya toca.
 */
export async function trabajoAccesos(): Promise<{ dispositivos: number; aplicados: number; fallidos: number }> {
  const { rows } = await pool.query(
    `SELECT v.id, v.empresa_id, v.name AS device_name, v.id AS device_id, v.manufacturer, v.model, v.connection_type, v.endpoint,
            v.credentials_secret_name, v.driver_options, v.simulation
       FROM self_storage_devices v WHERE v.enabled`
  );
  let aplicados = 0;
  let fallidos = 0;
  for (const v of rows) {
    const d = dispositivoDeFila(v);
    const estado: EstadoDispositivo = await adapterDe(d).getStatus(d).catch(() => ({ online: false, latencyMs: 0, code: "ERROR" as const, message: "error" }));
    await registrarComunicacion(v.id, estado.online, estado.online ? null : `${estado.code ?? "OFFLINE"}: ${estado.message ?? ""}`, estado.firmware ?? null);
    await enTx((c) => recalcularDeseado(c, v.empresa_id, v.id));
    const { rows: s } = await pool.query(
      `SELECT 1 FROM self_storage_device_syncs WHERE device_id = $1 AND status IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= now())`,
      [v.id]
    );
    if (s.length) {
      const r = await aplicarSync(v.id);
      if (r === "synced") aplicados++;
      if (r === "failed") fallidos++;
    }
  }
  return { dispositivos: rows.length, aplicados, fallidos };
}
