/**
 * Clientes de Self Storage: casos de uso.
 *
 * El NIF/NIE/CIF y los teléfonos se normalizan ANTES de guardar: así el UNIQUE
 * de la base detecta como el mismo cliente «12345678-z» y «12345678Z».
 *
 * Auditoría: alta, modificación (sólo lo que cambia), bloqueo y desbloqueo con
 * su motivo, y alta/baja de teléfonos (un teléfono autorizado abre puertas en
 * la fase 3: es un cambio de permisos).
 */

import type { z } from "zod";
import { auditar, diferencias, type Actor } from "../../shared/audit.ts";
import { enTx, pool } from "../../shared/db.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { normalizarTelefono, validarDocumento } from "../../domain/identidad.ts";
import type { clienteAlta, clienteCambio, filtroClientes, telefonoAlta } from "../../schemas.ts";
import * as repo from "./repository.ts";

export const listar = (actor: Actor, f: z.infer<typeof filtroClientes>) => repo.listar(pool, actor.empresaId, f);

export async function ficha(actor: Actor, id: string) {
  const cliente = await repo.obtener(pool, actor.empresaId, id);
  if (!cliente) throw noExiste("El cliente");
  const [telefonos, contratos] = await Promise.all([
    repo.telefonos(pool, actor.empresaId, id),
    repo.contratos(pool, actor.empresaId, id),
  ]);
  return { ...cliente, phones: telefonos, contracts: contratos };
}

/** Normaliza lo que llega del formulario. Lanza 422 si algo no vale. */
function normalizar<T extends Partial<z.infer<typeof clienteAlta>>>(d: T, paisActual?: string): T {
  const r = { ...d };
  const pais = (d.country ?? paisActual ?? "ES").toUpperCase();
  if (d.taxId !== undefined) r.taxId = validarDocumento(d.taxId, pais).valor;
  if (d.phone !== undefined) r.phone = normalizarTelefono(d.phone);
  if (d.email !== undefined) r.email = d.email.trim().toLowerCase();
  return r;
}

export function crear(actor: Actor, entrada: z.infer<typeof clienteAlta>) {
  const d = normalizar(entrada);
  return enTx(async (c) => {
    const id = await repo.crear(c, actor.empresaId, d, actor.userId || null);
    const cliente = (await repo.obtener(c, actor.empresaId, id))!;
    await auditar(c, actor, { action: "customer.created", entityType: "customer", entityId: id, after: cliente });
    return cliente;
  });
}

export function actualizar(actor: Actor, id: string, entrada: z.infer<typeof clienteCambio>) {
  return enTx(async (c) => {
    const antes = await repo.obtener(c, actor.empresaId, id, true);
    if (!antes) throw noExiste("El cliente");
    const d = normalizar(entrada, antes.country);

    // Cambiar el país obliga a revalidar el documento que ya tenía.
    if (d.country && d.country !== antes.country && d.taxId === undefined) {
      d.taxId = validarDocumento(antes.taxId, d.country).valor;
    }

    const { status, statusReason, ...datos } = d;
    if (status !== undefined && status !== antes.status) {
      if (status === "blocked" && !statusReason) {
        throw new ErrorSelfStorage("MOTIVO_OBLIGATORIO", "Indica el motivo del bloqueo del cliente.", 422);
      }
    }

    const cambios: Record<string, unknown> = { ...datos };
    if (status !== undefined) {
      cambios.status = status;
      cambios.statusReason = status === "active" ? null : (statusReason ?? antes.statusReason);
    } else if (statusReason !== undefined) {
      cambios.statusReason = statusReason;
    }
    await repo.actualizar(c, actor.empresaId, id, cambios);

    const dif = diferencias(antes as unknown as Record<string, unknown>, datos);
    if (dif) await auditar(c, actor, { action: "customer.updated", entityType: "customer", entityId: id, ...dif });
    if (status !== undefined && status !== antes.status) {
      const accion = status === "blocked" ? "customer.blocked" : antes.status === "blocked" ? "customer.unblocked" : "customer.status_changed";
      await auditar(c, actor, {
        action: accion,
        entityType: "customer",
        entityId: id,
        before: { status: antes.status, reason: antes.statusReason },
        after: { status, reason: cambios.statusReason ?? null },
      });
    }
    return (await repo.obtener(c, actor.empresaId, id))!;
  });
}

export function anadirTelefono(actor: Actor, customerId: string, d: z.infer<typeof telefonoAlta>) {
  const phone = normalizarTelefono(d.phone);
  return enTx(async (c) => {
    if (!(await repo.obtener(c, actor.empresaId, customerId, true))) throw noExiste("El cliente");
    const id = await repo.crearTelefono(c, actor.empresaId, customerId, phone, d.label ?? null, d.allowDoorAccess);
    await auditar(c, actor, {
      action: "customer.phone_added",
      entityType: "customer",
      entityId: customerId,
      after: { phoneId: id, phone, label: d.label ?? null, allowDoorAccess: d.allowDoorAccess },
    });
    return repo.telefonos(c, actor.empresaId, customerId);
  });
}

export function quitarTelefono(actor: Actor, customerId: string, phoneId: string) {
  return enTx(async (c) => {
    if (!(await repo.obtener(c, actor.empresaId, customerId, true))) throw noExiste("El cliente");
    const borrado = await repo.borrarTelefono(c, actor.empresaId, customerId, phoneId);
    if (!borrado) throw noExiste("El teléfono");
    await auditar(c, actor, { action: "customer.phone_removed", entityType: "customer", entityId: customerId, before: { phoneId, ...borrado } });
    return repo.telefonos(c, actor.empresaId, customerId);
  });
}
