/**
 * Gestión de accesos físicos: dispositivos y sus salidas, puertas, personas
 * autorizadas, permisos manuales, accesos temporales y consulta de eventos.
 *
 * Cada cambio que afecta a quién puede entrar llama a `marcarCambioAcceso`
 * en su transacción (permisos + listas de teléfonos) y, tras el COMMIT, a
 * `programarAplicacion` (enviar las listas a los dispositivos).
 *
 * Secretos: aquí sólo se guarda el NOMBRE de la variable de entorno con las
 * credenciales del dispositivo. La API nunca devuelve credenciales.
 */

import { createHash, randomBytes } from "node:crypto";
import type { z } from "zod";
import { auditar, diferencias, type Actor } from "../../shared/audit.ts";
import { construirSet, enTx, pool, type Ejecutor } from "../../shared/db.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { normalizarTelefono } from "../../domain/identidad.ts";
import { evaluateAccess, horarioValido } from "../../domain/accesos.ts";
import { adapterDe, conTiempo } from "../../integrations/access-devices/index.ts";
import { cargarActor, cargarPuerta, dispositivoDeFila } from "./contexto.ts";
import { aplicarSync, marcarCambioAcceso, programarAplicacion, recalcularDeseado, registrarComunicacion, type ObjetivoCambio } from "./sincronizacion.ts";
import type {
  dispositivoAlta,
  dispositivoCambio,
  filtroEventos,
  miembroAlta,
  miembroCambio,
  permisoManual,
  puertaAlta,
  puertaCambio,
  salidaAlta,
  salidaCambio,
  temporalAlta,
} from "../../schemas.ts";

/** Transacción que, si cambia el acceso, envía después las listas a los dispositivos. */
async function conCambioDeAcceso<T>(empresaId: string, fn: (c: Ejecutor, marcar: (o: ObjetivoCambio) => Promise<void>) => Promise<T>): Promise<T> {
  const dispositivos = new Set<string>();
  const r = await enTx(async (c) =>
    fn(c, async (o) => {
      (await marcarCambioAcceso(c, empresaId, o)).forEach((id) => dispositivos.add(id));
    })
  );
  programarAplicacion([...dispositivos]);
  return r;
}

// ── Dispositivos ────────────────────────────────────────────────────────────

const COLUMNAS_DISPOSITIVO = `
  v.id, v.center_id AS "centerId", ce.name AS "centerName", v.name, v.manufacturer, v.model, v.serial, v.imei,
  v.phone_number AS "phoneNumber", v.connection_type AS "connectionType", v.endpoint,
  v.credentials_secret_name AS "credentialsSecretName", v.driver_options AS "driverOptions", v.simulation,
  v.phone_access_mode AS "phoneAccessMode", v.firmware, v.status, v.last_seen_at AS "lastSeenAt",
  v.last_error AS "lastError", v.last_error_at AS "lastErrorAt", v.enabled, v.notes, v.created_at AS "createdAt",
  s.status AS "syncStatus", s.desired_state AS "syncDesired", s.actual_state AS "syncActual", s.last_attempt_at AS "syncLastAttemptAt",
  s.last_success_at AS "syncLastSuccessAt", s.error AS "syncError", s.attempts AS "syncAttempts", s.next_attempt_at AS "syncNextAttemptAt",
  (SELECT coalesce(json_agg(json_build_object('id', o.id, 'outputNumber', o.output_number, 'name', o.name, 'outputType', o.output_type,
           'pulseDurationMs', o.pulse_duration_ms, 'enabled', o.enabled,
           'doorId', (SELECT d.id FROM self_storage_doors d WHERE d.device_output_id = o.id),
           'doorName', (SELECT d.name FROM self_storage_doors d WHERE d.device_output_id = o.id)) ORDER BY o.output_number), '[]')
     FROM self_storage_device_outputs o WHERE o.device_id = v.id) AS outputs`;

const FROM_DISPOSITIVO = `FROM self_storage_devices v JOIN self_storage_centers ce ON ce.id = v.center_id
  LEFT JOIN self_storage_device_syncs s ON s.device_id = v.id AND s.sync_type = 'phone_whitelist'`;

export async function dispositivos(empresaId: string, centerId?: string | null) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_DISPOSITIVO}
       ${FROM_DISPOSITIVO}
      WHERE v.empresa_id = $1 ${centerId ? "AND v.center_id = $2" : ""}
      ORDER BY ce.name, v.name`,
    centerId ? [empresaId, centerId] : [empresaId]
  );
  return rows;
}

export async function dispositivo(empresaId: string, id: string, db: Ejecutor = pool) {
  const { rows } = await db.query(`SELECT ${COLUMNAS_DISPOSITIVO} ${FROM_DISPOSITIVO} WHERE v.empresa_id = $1 AND v.id = $2`, [empresaId, id]);
  if (!rows.length) throw noExiste("El dispositivo");
  return rows[0];
}

const COLUMNA_DISPOSITIVO: Record<string, string> = {
  name: "name",
  manufacturer: "manufacturer",
  model: "model",
  serial: "serial",
  imei: "imei",
  phoneNumber: "phone_number",
  connectionType: "connection_type",
  endpoint: "endpoint",
  credentialsSecretName: "credentials_secret_name",
  driverOptions: "driver_options",
  simulation: "simulation",
  phoneAccessMode: "phone_access_mode",
  enabled: "enabled",
  notes: "notes",
};

function datosDispositivo<T extends Record<string, unknown>>(d: T): T {
  const out = { ...d } as Record<string, unknown>;
  if (out.phoneNumber) out.phoneNumber = normalizarTelefono(out.phoneNumber as string);
  if (out.driverOptions) out.driverOptions = JSON.stringify(out.driverOptions);
  if (out.simulation) out.simulation = JSON.stringify(out.simulation);
  return out as T;
}

function soloSimulador(tipo: string, simulation: unknown) {
  if (simulation && Object.keys(simulation as object).length && tipo !== "mock") {
    throw new ErrorSelfStorage("SIMULACION_SOLO_MOCK", "La simulación sólo se configura en dispositivos de tipo «Simulador».", 422);
  }
}

export function crearDispositivo(actor: Actor, d: z.infer<typeof dispositivoAlta>) {
  soloSimulador(d.connectionType, d.simulation);
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const v = datosDispositivo(d);
    const { rows } = await c.query(
      `INSERT INTO self_storage_devices (empresa_id, center_id, name, manufacturer, model, serial, imei, phone_number, connection_type, endpoint,
         credentials_secret_name, driver_options, simulation, phone_access_mode, enabled, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [
        actor.empresaId, d.centerId, v.name, v.manufacturer, v.model, v.serial ?? null, v.imei ?? null, v.phoneNumber ?? null, v.connectionType,
        v.endpoint ?? null, v.credentialsSecretName ?? null, v.driverOptions ?? "{}", v.simulation ?? "{}", v.phoneAccessMode, v.enabled, v.notes ?? null,
      ]
    );
    const id = rows[0].id as string;
    // Una salida por defecto (el RUT241 tiene una): se puede cambiar después.
    if (d.outputs?.length) {
      for (const o of d.outputs) {
        await c.query(
          `INSERT INTO self_storage_device_outputs (empresa_id, device_id, output_number, name, output_type, pulse_duration_ms) VALUES ($1,$2,$3,$4,$5,$6)`,
          [actor.empresaId, id, o.outputNumber, o.name, o.outputType, o.pulseDurationMs]
        );
      }
    }
    await auditar(c, actor, { action: "device.created", entityType: "device", entityId: id, after: { name: d.name, model: d.model, connectionType: d.connectionType } });
    await marcar({ centerIds: [d.centerId] });
    return dispositivo(actor.empresaId, id, c);
  });
}

export function actualizarDispositivo(actor: Actor, id: string, d: z.infer<typeof dispositivoCambio>) {
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const antes = await dispositivo(actor.empresaId, id, c);
    soloSimulador(d.connectionType ?? antes.connectionType, d.simulation);
    const set = construirSet(datosDispositivo(d), COLUMNA_DISPOSITIVO, 3);
    if (set.sql) await c.query(`UPDATE self_storage_devices SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [actor.empresaId, id, ...set.valores]);
    const dif = diferencias(antes, d);
    if (dif) await auditar(c, actor, { action: "device.updated", entityType: "device", entityId: id, ...dif });
    await marcar({ centerIds: [antes.centerId] });
    return dispositivo(actor.empresaId, id, c);
  });
}

/** «Probar conexión»: habla con el equipo y deja su estado al día. */
export async function probarDispositivo(actor: Actor, id: string) {
  const { rows } = await pool.query(
    `SELECT v.*, v.id AS device_id, v.name AS device_name FROM self_storage_devices v WHERE v.empresa_id = $1 AND v.id = $2`,
    [actor.empresaId, id]
  );
  if (!rows.length) throw noExiste("El dispositivo");
  const d = dispositivoDeFila(rows[0]);
  const r = await conTiempo(adapterDe(d).testConnection(d), 15_000).catch((e) => ({ ok: false, latencyMs: 15_000, code: "TIMEOUT" as const, message: String(e?.message ?? e) }));
  await registrarComunicacion(id, r.ok, r.ok ? null : `${r.code ?? "ERROR"}: ${r.message ?? ""}`, "firmware" in r ? (r.firmware ?? null) : null);
  await auditar(pool, actor, { action: "device.tested", entityType: "device", entityId: id, after: { ok: r.ok, code: r.code ?? null, latencyMs: r.latencyMs } });
  return { ok: r.ok, latencyMs: r.latencyMs, code: r.code ?? null, message: r.message ?? null };
}

/** Sincronizar ahora (botón del panel): recalcula y envía. */
export async function sincronizarAhora(actor: Actor, id: string) {
  await dispositivo(actor.empresaId, id);
  await enTx((c) => recalcularDeseado(c, actor.empresaId, id));
  await pool.query(`UPDATE self_storage_device_syncs SET status = CASE WHEN status = 'synced' THEN status ELSE 'pending' END, next_attempt_at = now() WHERE device_id = $1`, [id]);
  const r = await aplicarSync(id);
  await auditar(pool, actor, { action: "device.sync_requested", entityType: "device", entityId: id, after: { result: r } });
  return dispositivo(actor.empresaId, id);
}

export function crearSalida(actor: Actor, deviceId: string, d: z.infer<typeof salidaAlta>) {
  return enTx(async (c) => {
    await dispositivo(actor.empresaId, deviceId, c);
    const { rows } = await c.query(
      `INSERT INTO self_storage_device_outputs (empresa_id, device_id, output_number, name, output_type, pulse_duration_ms, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [actor.empresaId, deviceId, d.outputNumber, d.name, d.outputType, d.pulseDurationMs, d.enabled]
    );
    await auditar(c, actor, { action: "device_output.created", entityType: "device", entityId: deviceId, after: { outputId: rows[0].id, ...d } });
    return dispositivo(actor.empresaId, deviceId, c);
  });
}

export function actualizarSalida(actor: Actor, outputId: string, d: z.infer<typeof salidaCambio>) {
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const { rows } = await c.query(
      `SELECT o.*, v.center_id FROM self_storage_device_outputs o JOIN self_storage_devices v ON v.id = o.device_id WHERE o.empresa_id = $1 AND o.id = $2`,
      [actor.empresaId, outputId]
    );
    if (!rows.length) throw noExiste("La salida");
    const set = construirSet(d, { outputNumber: "output_number", name: "name", outputType: "output_type", pulseDurationMs: "pulse_duration_ms", enabled: "enabled" }, 3);
    if (set.sql) await c.query(`UPDATE self_storage_device_outputs SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [actor.empresaId, outputId, ...set.valores]);
    await auditar(c, actor, { action: "device_output.updated", entityType: "device", entityId: rows[0].device_id, after: { outputId, ...d } });
    await marcar({ centerIds: [rows[0].center_id] });
    return dispositivo(actor.empresaId, rows[0].device_id, c);
  });
}

// ── Puertas ─────────────────────────────────────────────────────────────────

/** Puertas con el estado del hardware: dispositivo, salida, online, última apertura y último error. */
export async function puertas(empresaId: string, centerId?: string | null) {
  const { rows } = await pool.query(
    `SELECT d.id, d.center_id AS "centerId", d.zone_id AS "zoneId", z.name AS "zoneName", d.name, d.door_type AS "doorType",
            d.device_output_id AS "deviceOutputId", d.enabled, d.allow_app AS "allowApp", d.allow_phone AS "allowPhone",
            d.access_schedule AS "accessSchedule", d.sort_order AS "sortOrder",
            o.output_number AS "outputNumber", o.name AS "outputName", o.enabled AS "outputEnabled",
            v.id AS "deviceId", v.name AS "deviceName", v.model AS "deviceModel", v.connection_type AS "connectionType",
            v.status AS "deviceStatus", v.enabled AS "deviceEnabled", v.last_seen_at AS "lastSeenAt",
            v.last_error AS "lastError", v.last_error_at AS "lastErrorAt",
            (SELECT max(e.executed_at) FROM self_storage_access_events e WHERE e.door_id = d.id AND e.execution_status = 'succeeded') AS "lastOpenedAt",
            s.status AS "syncStatus"
       FROM self_storage_doors d
       LEFT JOIN self_storage_zones z ON z.id = d.zone_id
       LEFT JOIN self_storage_device_outputs o ON o.id = d.device_output_id
       LEFT JOIN self_storage_devices v ON v.id = o.device_id
       LEFT JOIN self_storage_device_syncs s ON s.device_id = v.id AND s.sync_type = 'phone_whitelist'
      WHERE d.empresa_id = $1 ${centerId ? "AND d.center_id = $2" : ""}
      ORDER BY d.sort_order, d.name`,
    centerId ? [empresaId, centerId] : [empresaId]
  );
  return rows;
}

function validarHorario(h: unknown) {
  if (h != null && !horarioValido(h)) {
    throw new ErrorSelfStorage("HORARIO_NO_VALIDO", "El horario no es válido: reglas con días (1-7) y horas «HH:MM».", 422);
  }
}

export function crearPuerta(actor: Actor, d: z.infer<typeof puertaAlta>) {
  validarHorario(d.accessSchedule);
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const { rows } = await c.query(
      `INSERT INTO self_storage_doors (empresa_id, center_id, zone_id, name, door_type, device_output_id, enabled, allow_app, allow_phone, access_schedule, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [actor.empresaId, d.centerId, d.zoneId ?? null, d.name, d.doorType, d.deviceOutputId ?? null, d.enabled, d.allowApp, d.allowPhone, d.accessSchedule ? JSON.stringify(d.accessSchedule) : null, d.sortOrder]
    );
    await auditar(c, actor, { action: "door.created", entityType: "door", entityId: rows[0].id, after: d });
    // Una puerta nueva cambia los permisos de los contratos del centro.
    await marcar({ centerIds: [d.centerId] });
    return (await puertas(actor.empresaId)).find((p) => p.id === rows[0].id) ?? { id: rows[0].id };
  });
}

export function actualizarPuerta(actor: Actor, id: string, d: z.infer<typeof puertaCambio>) {
  if (d.accessSchedule !== undefined) validarHorario(d.accessSchedule);
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const { rows } = await c.query(`SELECT * FROM self_storage_doors WHERE empresa_id = $1 AND id = $2 FOR UPDATE`, [actor.empresaId, id]);
    if (!rows.length) throw noExiste("La puerta");
    const datos: Record<string, unknown> = { ...d };
    if (d.accessSchedule !== undefined) datos.accessSchedule = d.accessSchedule ? JSON.stringify(d.accessSchedule) : null;
    const set = construirSet(
      datos,
      { zoneId: "zone_id", name: "name", doorType: "door_type", deviceOutputId: "device_output_id", enabled: "enabled", allowApp: "allow_app", allowPhone: "allow_phone", accessSchedule: "access_schedule", sortOrder: "sort_order" },
      3
    );
    if (set.sql) await c.query(`UPDATE self_storage_doors SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [actor.empresaId, id, ...set.valores]);
    await auditar(c, actor, { action: "door.updated", entityType: "door", entityId: id, after: d });
    await marcar({ centerIds: [rows[0].center_id] });
    return (await puertas(actor.empresaId)).find((p) => p.id === id);
  });
}

// ── Personas autorizadas de un contrato ─────────────────────────────────────

async function contratoDe(c: Ejecutor, empresaId: string, contractId: string) {
  const { rows } = await c.query(`SELECT id, customer_id, center_id, status FROM self_storage_contracts WHERE empresa_id = $1 AND id = $2`, [empresaId, contractId]);
  if (!rows.length) throw noExiste("El contrato");
  return rows[0];
}

export async function miembros(empresaId: string, contractId: string) {
  await contratoDe(pool, empresaId, contractId);
  const { rows } = await pool.query(
    `SELECT id, full_name AS "fullName", phone_e164 AS phone, email, status, allow_app AS "allowApp", allow_phone AS "allowPhone",
            notes, auth_user_id IS NOT NULL AS "hasPortalAccount", created_at AS "createdAt"
       FROM self_storage_contract_members WHERE empresa_id = $1 AND contract_id = $2 ORDER BY created_at`,
    [empresaId, contractId]
  );
  return rows;
}

export function crearMiembro(actor: Actor, contractId: string, d: z.infer<typeof miembroAlta>) {
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const k = await contratoDe(c, actor.empresaId, contractId);
    const phone = d.phone ? normalizarTelefono(d.phone) : null;
    const { rows } = await c.query(
      `INSERT INTO self_storage_contract_members (empresa_id, contract_id, full_name, phone_e164, email, allow_app, allow_phone, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [actor.empresaId, contractId, d.fullName, phone, d.email ?? null, d.allowApp, d.allowPhone, d.notes ?? null, actor.userId || null]
    );
    await auditar(c, actor, { action: "contract.member_added", entityType: "contract", entityId: contractId, after: { memberId: rows[0].id, fullName: d.fullName, phone, allowApp: d.allowApp, allowPhone: d.allowPhone } });
    await marcar({ centerIds: [k.center_id] });
    return miembrosEn(c, actor.empresaId, contractId);
  });
}

async function miembrosEn(c: Ejecutor, empresaId: string, contractId: string) {
  const { rows } = await c.query(
    `SELECT id, full_name AS "fullName", phone_e164 AS phone, email, status, allow_app AS "allowApp", allow_phone AS "allowPhone",
            notes, auth_user_id IS NOT NULL AS "hasPortalAccount" FROM self_storage_contract_members WHERE empresa_id = $1 AND contract_id = $2 ORDER BY created_at`,
    [empresaId, contractId]
  );
  return rows;
}

export function actualizarMiembro(actor: Actor, contractId: string, memberId: string, d: z.infer<typeof miembroCambio>) {
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const k = await contratoDe(c, actor.empresaId, contractId);
    const { rows } = await c.query(`SELECT * FROM self_storage_contract_members WHERE empresa_id = $1 AND contract_id = $2 AND id = $3`, [actor.empresaId, contractId, memberId]);
    if (!rows.length) throw noExiste("La persona autorizada");
    const datos: Record<string, unknown> = { ...d };
    if (d.phone !== undefined) datos.phone = d.phone ? normalizarTelefono(d.phone) : null;
    const set = construirSet(datos, { fullName: "full_name", phone: "phone_e164", email: "email", allowApp: "allow_app", allowPhone: "allow_phone", status: "status", notes: "notes" }, 4);
    if (set.sql) await c.query(`UPDATE self_storage_contract_members SET ${set.sql} WHERE empresa_id = $1 AND contract_id = $2 AND id = $3`, [actor.empresaId, contractId, memberId, ...set.valores]);
    await auditar(c, actor, { action: "contract.member_updated", entityType: "contract", entityId: contractId, after: { memberId, ...datos } });
    await marcar({ centerIds: [k.center_id] });
    return miembrosEn(c, actor.empresaId, contractId);
  });
}

/** Invita a la persona autorizada a abrir desde la app (cuenta propia, sin acceso a lo financiero). */
export async function invitarMiembro(actor: Actor, contractId: string, memberId: string, redirectTo: string) {
  const { rows } = await pool.query(
    `SELECT id, email, allow_app FROM self_storage_contract_members WHERE empresa_id = $1 AND contract_id = $2 AND id = $3`,
    [actor.empresaId, contractId, memberId]
  );
  if (!rows.length) throw noExiste("La persona autorizada");
  if (!rows[0].email || !rows[0].allow_app) throw new ErrorSelfStorage("SIN_APP", "Para invitarla a la app necesita email y «abre con la app».", 422);
  const { supabase } = await import("../../../supabase.ts");
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(rows[0].email, { redirectTo });
  if (error || !data.user) throw new ErrorSelfStorage("INVITACION_FALLIDA", `No se ha podido enviar la invitación: ${error?.message ?? "sin usuario"}`, 502);
  await pool.query(`UPDATE self_storage_contract_members SET auth_user_id = $2 WHERE id = $1`, [memberId, data.user.id]);
  await auditar(pool, actor, { action: "contract.member_invited", entityType: "contract", entityId: contractId, after: { memberId, email: rows[0].email } });
  return { invited: true, email: rows[0].email };
}

// ── Permisos del contrato ───────────────────────────────────────────────────

/** Permisos del contrato y, para cada puerta del centro, qué diría ahora el motor para el titular. */
export async function accesosDelContrato(empresaId: string, contractId: string) {
  const k = await contratoDe(pool, empresaId, contractId);
  const { rows: permisos } = await pool.query(
    `SELECT p.id, p.door_id AS "doorId", d.name AS "doorName", p.source, p.status, p.valid_from AS "validFrom", p.valid_until AS "validUntil",
            p.notes, p.created_at AS "createdAt", p.revoked_at AS "revokedAt"
       FROM self_storage_access_permissions p JOIN self_storage_doors d ON d.id = p.door_id
      WHERE p.contract_id = $1 ORDER BY p.status, d.sort_order, d.name`,
    [contractId]
  );
  const { rows: ids } = await pool.query(`SELECT id FROM self_storage_doors WHERE empresa_id = $1 AND center_id = $2 ORDER BY sort_order, name`, [empresaId, k.center_id]);
  const ahora = new Date();
  const puertasEval = [];
  for (const { id } of ids) {
    const p = await cargarPuerta(pool, empresaId, id);
    const cargado = await cargarActor(pool, empresaId, { tipo: "customer", customerId: k.customer_id }, p);
    // Sólo este contrato (el cliente puede tener otros).
    const actor = cargado && cargado.actor.tipo === "customer" ? { ...cargado.actor, contratos: cargado.actor.contratos.filter((x) => x.id === contractId) } : null;
    const ev = actor ? evaluateAccess(p, actor, ahora, "app") : { granted: false, reason: "PERSON_NOT_FOUND" as const, contractId: null };
    puertasEval.push({ doorId: p.id, doorName: p.name, doorType: p.doorType, granted: ev.granted, reason: ev.reason });
  }
  return { permisos, puertas: puertasEval };
}

export function concederPermiso(actor: Actor, contractId: string, d: z.infer<typeof permisoManual>) {
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const k = await contratoDe(c, actor.empresaId, contractId);
    const p = await cargarPuerta(c, actor.empresaId, d.doorId);
    if (p.centerId !== k.center_id) throw new ErrorSelfStorage("PUERTA_DE_OTRO_CENTRO", "La puerta es de otro centro.", 422);
    // Si ya había uno de contrato activo, el manual lo sustituye (con sus fechas).
    await c.query(`UPDATE self_storage_access_permissions SET status = 'revoked', revoked_at = now(), revoked_by = $3 WHERE contract_id = $1 AND door_id = $2 AND status = 'active'`, [
      contractId,
      d.doorId,
      actor.userId || null,
    ]);
    const { rows } = await c.query(
      `INSERT INTO self_storage_access_permissions (empresa_id, contract_id, door_id, source, valid_from, valid_until, granted_by, notes)
       VALUES ($1,$2,$3,'manual',$4,$5,$6,$7) RETURNING id`,
      [actor.empresaId, contractId, d.doorId, d.validFrom ?? null, d.validUntil ?? null, actor.userId || null, d.notes ?? null]
    );
    await auditar(c, actor, { action: "access_permission.granted", entityType: "contract", entityId: contractId, after: { permissionId: rows[0].id, doorId: d.doorId, validFrom: d.validFrom ?? null, validUntil: d.validUntil ?? null } });
    await marcar({ contractIds: [contractId] });
  }).then(() => accesosDelContrato(actor.empresaId, contractId));
}

export function revocarPermiso(actor: Actor, contractId: string, permisoId: string) {
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const { rows } = await c.query(
      `UPDATE self_storage_access_permissions SET status = 'revoked', revoked_at = now(), revoked_by = $4
        WHERE empresa_id = $1 AND contract_id = $2 AND id = $3 AND status = 'active' AND source = 'manual' RETURNING door_id`,
      [actor.empresaId, contractId, permisoId, actor.userId || null]
    );
    if (!rows.length) throw new ErrorSelfStorage("PERMISO_NO_REVOCABLE", "Sólo se revocan permisos manuales activos; los del contrato los calcula el sistema.", 409);
    await auditar(c, actor, { action: "access_permission.revoked", entityType: "contract", entityId: contractId, after: { permissionId: permisoId, doorId: rows[0].door_id } });
    await marcar({ contractIds: [contractId] });
  }).then(() => accesosDelContrato(actor.empresaId, contractId));
}

// ── Accesos temporales ──────────────────────────────────────────────────────

const COLUMNAS_TEMPORAL = `t.id, t.center_id AS "centerId", t.contract_id AS "contractId", k.contract_number AS "contractNumber",
  t.customer_id AS "customerId", t.holder_type AS "holderType", t.full_name AS "fullName", t.phone_e164 AS phone, t.email,
  t.starts_at AS "startsAt", t.ends_at AS "endsAt", t.max_uses AS "maxUses", t.uses_count AS "usesCount",
  t.token_hash IS NOT NULL AS "hasLink", t.status, t.notes, t.created_at AS "createdAt", t.revoked_at AS "revokedAt",
  coalesce((SELECT json_agg(json_build_object('id', d.id, 'name', d.name)) FROM self_storage_temporary_access_doors td
             JOIN self_storage_doors d ON d.id = td.door_id WHERE td.temporary_access_id = t.id), '[]') AS doors`;

export async function temporales(empresaId: string, f: { contractId?: string; centerId?: string; activos?: boolean }) {
  const cond = ["t.empresa_id = $1"];
  const v: unknown[] = [empresaId];
  if (f.contractId) {
    v.push(f.contractId);
    cond.push(`t.contract_id = $${v.length}`);
  }
  if (f.centerId) {
    v.push(f.centerId);
    cond.push(`t.center_id = $${v.length}`);
  }
  if (f.activos) cond.push(`t.status = 'active' AND t.ends_at > now()`);
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_TEMPORAL} FROM self_storage_temporary_accesses t LEFT JOIN self_storage_contracts k ON k.id = t.contract_id
      WHERE ${cond.join(" AND ")} ORDER BY t.starts_at DESC LIMIT 200`,
    v
  );
  return rows;
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Crea un acceso temporal. Con `withLink` devuelve UNA vez el token del enlace
 * de apertura (en la base sólo queda su huella).
 */
export function crearTemporal(actor: Actor, d: z.infer<typeof temporalAlta>) {
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    let centro = d.centerId ?? null;
    let cliente = d.customerId ?? null;
    if (d.contractId) {
      const k = await contratoDe(c, actor.empresaId, d.contractId);
      if (centro && centro !== k.center_id) throw new ErrorSelfStorage("CENTRO_NO_COINCIDE", "El contrato es de otro centro.", 422);
      centro = k.center_id;
      cliente = k.customer_id;
    }
    if (!centro) throw new ErrorSelfStorage("CENTRO_OBLIGATORIO", "Indica el centro o el contrato.", 422);
    const { rows: ps } = await c.query(`SELECT id FROM self_storage_doors WHERE empresa_id = $1 AND center_id = $2 AND id = ANY($3::uuid[])`, [actor.empresaId, centro, d.doorIds]);
    if (ps.length !== new Set(d.doorIds).size) throw new ErrorSelfStorage("PUERTA_NO_VALIDA", "Alguna puerta no existe o es de otro centro.", 422);
    const token = d.withLink ? randomBytes(24).toString("base64url") : null;
    const phone = d.phone ? normalizarTelefono(d.phone) : null;
    const { rows } = await c.query(
      `INSERT INTO self_storage_temporary_accesses (empresa_id, center_id, contract_id, customer_id, holder_type, full_name, phone_e164, email, starts_at, ends_at, max_uses, token_hash, created_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [actor.empresaId, centro, d.contractId ?? null, cliente, d.holderType, d.fullName, phone, d.email ?? null, d.startsAt, d.endsAt, d.maxUses ?? null, token ? hashToken(token) : null, actor.userId || null, d.notes ?? null]
    );
    const id = rows[0].id as string;
    for (const doorId of new Set(d.doorIds)) {
      await c.query(`INSERT INTO self_storage_temporary_access_doors (temporary_access_id, door_id, empresa_id) VALUES ($1,$2,$3)`, [id, doorId, actor.empresaId]);
    }
    await auditar(c, actor, { action: "temporary_access.created", entityType: "temporary_access", entityId: id, after: { ...d, phone, withLink: Boolean(token) } });
    await marcar({ centerIds: [centro] });
    const { rows: t } = await c.query(`SELECT ${COLUMNAS_TEMPORAL} FROM self_storage_temporary_accesses t LEFT JOIN self_storage_contracts k ON k.id = t.contract_id WHERE t.id = $1`, [id]);
    return { ...t[0], token };
  });
}

export function revocarTemporal(actor: Actor, id: string) {
  return conCambioDeAcceso(actor.empresaId, async (c, marcar) => {
    const { rows } = await c.query(
      `UPDATE self_storage_temporary_accesses SET status = 'revoked', revoked_at = now() WHERE empresa_id = $1 AND id = $2 AND status = 'active' RETURNING center_id`,
      [actor.empresaId, id]
    );
    if (!rows.length) throw noExiste("El acceso temporal");
    await auditar(c, actor, { action: "temporary_access.revoked", entityType: "temporary_access", entityId: id });
    await marcar({ centerIds: [rows[0].center_id] });
    return { id, status: "revoked" };
  });
}

/** El acceso temporal de un enlace (por la huella del token). */
export async function temporalPorToken(token: string): Promise<{ id: string; empresaId: string } | null> {
  const { rows } = await pool.query(`SELECT id, empresa_id FROM self_storage_temporary_accesses WHERE token_hash = $1`, [hashToken(token)]);
  return rows.length ? { id: rows[0].id, empresaId: rows[0].empresa_id } : null;
}

// ── Eventos ─────────────────────────────────────────────────────────────────

export async function eventos(empresaId: string, f: z.infer<typeof filtroEventos>) {
  const cond = ["e.empresa_id = $1"];
  const v: unknown[] = [empresaId];
  const add = (col: string, val: unknown) => {
    v.push(val);
    cond.push(`${col} = $${v.length}`);
  };
  if (f.doorId) add("e.door_id", f.doorId);
  if (f.customerId) add("e.customer_id", f.customerId);
  if (f.contractId) add("e.contract_id", f.contractId);
  if (f.centerId) add("e.center_id", f.centerId);
  if (f.decision) add("e.decision", f.decision);
  if (f.method) add("e.method", f.method);
  const { rows } = await pool.query(
    `SELECT e.id, e.requested_at AS "requestedAt", e.method, e.decision, e.reason, e.execution_status AS "executionStatus",
            e.executed_at AS "executedAt", e.latency_ms AS "latencyMs", e.actor_type AS "actorType", e.actor_name AS "actorName",
            e.door_id AS "doorId", d.name AS "doorName", e.device_id AS "deviceId", v.name AS "deviceName",
            e.contract_id AS "contractId", k.contract_number AS "contractNumber", e.customer_id AS "customerId",
            e.contract_member_id AS "contractMemberId", e.temporary_access_id AS "temporaryAccessId", e.admin_reason AS "adminReason",
            e.device_response AS "deviceResponse"
       FROM self_storage_access_events e
       LEFT JOIN self_storage_doors d ON d.id = e.door_id
       LEFT JOIN self_storage_devices v ON v.id = e.device_id
       LEFT JOIN self_storage_contracts k ON k.id = e.contract_id
      WHERE ${cond.join(" AND ")}
      ORDER BY e.requested_at DESC LIMIT ${Math.min(f.limit ?? 100, 500)} OFFSET ${f.offset ?? 0}`,
    v
  );
  return rows;
}
