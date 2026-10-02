/**
 * Centros y zonas: casos de uso. Cada escritura va en una transacción con su
 * línea de auditoría.
 */

import type { z } from "zod";
import { auditar, diferencias, type Actor } from "../../shared/audit.ts";
import { enTx, pool } from "../../shared/db.ts";
import { noExiste } from "../../errors.ts";
import type { centroAlta, centroCambio, zonaAlta, zonaCambio } from "../../schemas.ts";
import * as repo from "./repository.ts";

export const listarCentros = (actor: Actor) => repo.listarCentros(pool, actor.empresaId);

export async function obtenerCentro(actor: Actor, id: string) {
  const c = await repo.obtenerCentro(pool, actor.empresaId, id);
  if (!c) throw noExiste("El centro");
  return c;
}

export function crearCentro(actor: Actor, d: z.infer<typeof centroAlta>) {
  return enTx(async (c) => {
    const centro = await repo.crearCentro(c, actor.empresaId, d);
    await auditar(c, actor, { action: "center.created", entityType: "center", entityId: centro.id, after: centro });
    return centro;
  });
}

export function actualizarCentro(actor: Actor, id: string, cambios: z.infer<typeof centroCambio>) {
  return enTx(async (c) => {
    const antes = await repo.obtenerCentro(c, actor.empresaId, id, true);
    if (!antes) throw noExiste("El centro");
    await repo.actualizarCentro(c, actor.empresaId, id, cambios);
    const d = diferencias(antes as unknown as Record<string, unknown>, cambios);
    if (d) await auditar(c, actor, { action: "center.updated", entityType: "center", entityId: id, ...d });
    return (await repo.obtenerCentro(c, actor.empresaId, id))!;
  });
}

export async function listarZonas(actor: Actor, centerId: string) {
  await obtenerCentro(actor, centerId);
  return repo.listarZonas(pool, actor.empresaId, centerId);
}

export function crearZona(actor: Actor, centerId: string, d: z.infer<typeof zonaAlta>) {
  return enTx(async (c) => {
    if (!(await repo.obtenerCentro(c, actor.empresaId, centerId))) throw noExiste("El centro");
    const zona = await repo.crearZona(c, actor.empresaId, centerId, d);
    await auditar(c, actor, { action: "zone.created", entityType: "zone", entityId: zona.id, after: zona });
    return zona;
  });
}

export function actualizarZona(actor: Actor, id: string, cambios: z.infer<typeof zonaCambio>) {
  return enTx(async (c) => {
    const antes = await repo.obtenerZona(c, actor.empresaId, id);
    if (!antes) throw noExiste("La zona");
    await repo.actualizarZona(c, actor.empresaId, id, cambios);
    const d = diferencias(antes as unknown as Record<string, unknown>, cambios);
    if (d) await auditar(c, actor, { action: "zone.updated", entityType: "zone", entityId: id, ...d });
    return (await repo.obtenerZona(c, actor.empresaId, id))!;
  });
}
