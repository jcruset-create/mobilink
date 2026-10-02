/**
 * Tipos de trastero y trasteros: casos de uso.
 *
 * Reglas que aplica este fichero (las decisiones están en `domain/`):
 *   · m² y m³ se calculan de las medidas si no se indican;
 *   · precio: base + IVA + PVP coherentes (`resolverPrecio`);
 *   · el estado sólo se cambia a mano entre disponible / mantenimiento /
 *     bloqueado, y nunca con un contrato vivo o una reserva activa;
 *   · todo cambio deja su línea en la auditoría, y un cambio de precio, una
 *     propia (`unit.price_changed`).
 */

import type { z } from "zod";
import { auditar, diferencias, type Actor } from "../../shared/audit.ts";
import { enTx, pool } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { areaM2, resolverPrecio, volumenM3 } from "../../domain/pricing.ts";
import { validarCambioEstado } from "../../domain/unitStatus.ts";
import { vistaTrasteroPanel } from "../../domain/vistas.ts";
import type { tipoAlta, tipoCambio, trasteroAlta, trasteroCambio, trasteroEstado } from "../../schemas.ts";
import * as repoCentros from "../centros/repository.ts";
import * as repo from "./repository.ts";
import type { UnitStatus } from "../../../../src/modules/self-storage/types/enums.ts";

// ── Tipos ────────────────────────────────────────────────────────────────────

export async function listarTipos(actor: Actor, centerId: string | null) {
  return repo.listarTipos(pool, actor.empresaId, centerId);
}

export function crearTipo(actor: Actor, d: z.infer<typeof tipoAlta>) {
  return enTx(async (c) => {
    if (d.centerId && !(await repoCentros.obtenerCentro(c, actor.empresaId, d.centerId))) throw noExiste("El centro");
    const id = await repo.crearTipo(c, actor.empresaId, {
      ...d,
      nominalAreaM2: d.nominalAreaM2 ?? areaM2(d.widthCm, d.lengthCm),
      nominalVolumeM3: d.nominalVolumeM3 ?? volumenM3(d.widthCm, d.lengthCm, d.heightCm),
    });
    const tipo = (await repo.obtenerTipo(c, actor.empresaId, id))!;
    await auditar(c, actor, { action: "unit_type.created", entityType: "unit_type", entityId: id, after: tipo });
    return tipo;
  });
}

export function actualizarTipo(actor: Actor, id: string, cambios: z.infer<typeof tipoCambio>) {
  return enTx(async (c) => {
    const antes = await repo.obtenerTipo(c, actor.empresaId, id);
    if (!antes) throw noExiste("El tipo de trastero");
    await repo.actualizarTipo(c, actor.empresaId, id, cambios);
    const d = diferencias(antes as unknown as Record<string, unknown>, cambios);
    if (d) await auditar(c, actor, { action: "unit_type.updated", entityType: "unit_type", entityId: id, ...d });
    return (await repo.obtenerTipo(c, actor.empresaId, id))!;
  });
}

// ── Trasteros ────────────────────────────────────────────────────────────────

export async function listarTrasteros(actor: Actor, filtro: repo.FiltroTrasteros, verClientes: boolean) {
  const filas = await repo.listarTrasteros(pool, actor.empresaId, filtro);
  const ocupadas = verClientes ? await repo.ocupaciones(pool, actor.empresaId, filas.map((f) => f.id)) : new Map();
  return filas.map((f) => vistaTrasteroPanel(f, ocupadas.get(f.id) ?? null, verClientes));
}

export async function obtenerTrastero(actor: Actor, id: string, verClientes: boolean) {
  const f = await repo.obtenerTrastero(pool, actor.empresaId, id);
  if (!f) throw noExiste("El trastero");
  const ocupada = verClientes ? (await repo.ocupaciones(pool, actor.empresaId, [id])).get(id) ?? null : null;
  return vistaTrasteroPanel(f, ocupada, verClientes);
}

export function crearTrastero(actor: Actor, d: z.infer<typeof trasteroAlta>) {
  return enTx(async (c) => {
    const centro = await repoCentros.obtenerCentro(c, actor.empresaId, d.centerId);
    if (!centro) throw noExiste("El centro");
    const ivaPorDefecto = await leerAjuste(c, actor.empresaId, d.centerId, "units.default_rental_tax_rate");
    const precio = resolverPrecio({ base: d.monthlyPrice, iva: d.taxRate ?? ivaPorDefecto, pvp: d.monthlyPriceGross });
    const id = await repo.crearTrastero(c, actor.empresaId, d.centerId, {
      zone_id: d.zoneId,
      unit_type_id: d.unitTypeId ?? null,
      code: d.code.trim().toUpperCase(),
      name: d.name ?? null,
      width_cm: d.widthCm,
      length_cm: d.lengthCm,
      height_cm: d.heightCm,
      area_m2: d.areaM2 ?? areaM2(d.widthCm, d.lengthCm),
      volume_m3: d.volumeM3 ?? volumenM3(d.widthCm, d.lengthCm, d.heightCm),
      monthly_price: precio.base,
      tax_rate: precio.iva,
      monthly_price_gross: precio.pvp,
      deposit_amount: d.depositAmount,
      image_3d_url: d.image3dUrl ?? null,
      floor_plan_shape_id: d.floorPlanShapeId ?? null,
      public_visible: d.publicVisible,
      notes: d.notes ?? null,
    });
    const fila = (await repo.obtenerTrastero(c, actor.empresaId, id))!;
    await auditar(c, actor, { action: "unit.created", entityType: "unit", entityId: id, after: fila });
    return vistaTrasteroPanel(fila, null, true);
  });
}

const CAMPOS_PRECIO = ["monthly_price", "tax_rate", "monthly_price_gross"] as const;

export function actualizarTrastero(actor: Actor, id: string, d: z.infer<typeof trasteroCambio>, verClientes: boolean) {
  return enTx(async (c) => {
    const antes = await repo.obtenerTrastero(c, actor.empresaId, id, true);
    if (!antes) throw noExiste("El trastero");

    const v: Partial<repo.ValoresTrastero> = {};
    if (d.zoneId !== undefined) v.zone_id = d.zoneId;
    if (d.unitTypeId !== undefined) v.unit_type_id = d.unitTypeId;
    if (d.code !== undefined) v.code = d.code.trim().toUpperCase();
    if (d.name !== undefined) v.name = d.name ?? null;
    if (d.widthCm !== undefined) v.width_cm = d.widthCm;
    if (d.lengthCm !== undefined) v.length_cm = d.lengthCm;
    if (d.heightCm !== undefined) v.height_cm = d.heightCm;
    if (d.depositAmount !== undefined) v.deposit_amount = d.depositAmount;
    if (d.image3dUrl !== undefined) v.image_3d_url = d.image3dUrl ?? null;
    if (d.floorPlanShapeId !== undefined) v.floor_plan_shape_id = d.floorPlanShapeId ?? null;
    if (d.publicVisible !== undefined) v.public_visible = d.publicVisible;
    if (d.notes !== undefined) v.notes = d.notes ?? null;

    // Si cambian las medidas y no se dan m²/m³, se recalculan.
    const medidasCambian = v.width_cm !== undefined || v.length_cm !== undefined || v.height_cm !== undefined;
    const ancho = v.width_cm ?? antes.width_cm;
    const largo = v.length_cm ?? antes.length_cm;
    const alto = v.height_cm ?? antes.height_cm;
    if (d.areaM2 !== undefined) v.area_m2 = d.areaM2;
    else if (medidasCambian) v.area_m2 = areaM2(ancho, largo);
    if (d.volumeM3 !== undefined) v.volume_m3 = d.volumeM3;
    else if (medidasCambian) v.volume_m3 = volumenM3(ancho, largo, alto);

    // Precio: lo que se toque manda; lo que no, se deduce. Si sólo cambia el
    // IVA se conserva la base y se recalcula el PVP.
    if (d.monthlyPrice !== undefined || d.monthlyPriceGross !== undefined || d.taxRate !== undefined) {
      const iva = d.taxRate ?? antes.tax_rate;
      const base = d.monthlyPrice ?? (d.monthlyPriceGross !== undefined ? null : antes.monthly_price);
      const precio = resolverPrecio({ base, iva, pvp: d.monthlyPriceGross ?? null });
      v.monthly_price = precio.base;
      v.tax_rate = precio.iva;
      v.monthly_price_gross = precio.pvp;
    }

    await repo.actualizarTrastero(c, actor.empresaId, id, v);
    const dif = diferencias(antes as unknown as Record<string, unknown>, v as Record<string, unknown>);
    if (dif) {
      const precioCambia = CAMPOS_PRECIO.some((k) => k in dif.after);
      await auditar(c, actor, { action: "unit.updated", entityType: "unit", entityId: id, ...dif });
      if (precioCambia) {
        await auditar(c, actor, {
          action: "unit.price_changed",
          entityType: "unit",
          entityId: id,
          before: { monthlyPrice: antes.monthly_price, taxRate: antes.tax_rate, monthlyPriceGross: antes.monthly_price_gross },
          after: { monthlyPrice: v.monthly_price, taxRate: v.tax_rate, monthlyPriceGross: v.monthly_price_gross },
        });
      }
    }
    const fila = (await repo.obtenerTrastero(c, actor.empresaId, id))!;
    const ocupada = verClientes ? (await repo.ocupaciones(c, actor.empresaId, [id])).get(id) ?? null : null;
    return vistaTrasteroPanel(fila, ocupada, verClientes);
  });
}

/**
 * Cambio MANUAL de estado. El trastero se bloquea con FOR UPDATE antes de mirar
 * sus contratos y reservas: entre la comprobación y el UPDATE nadie puede
 * contratarlo.
 */
export function cambiarEstado(actor: Actor, id: string, d: z.infer<typeof trasteroEstado>, verClientes: boolean) {
  return enTx(async (c) => {
    const antes = await repo.obtenerTrastero(c, actor.empresaId, id, true);
    if (!antes) throw noExiste("El trastero");
    const comp = await repo.compromisos(c, id);
    const motivo = validarCambioEstado(antes.status, d.status as UnitStatus, {
      origen: "manual",
      motivo: d.reason ?? null,
      tieneContratoVivo: comp.contratoVivo,
      tieneReservaActiva: comp.reservaActiva,
    });
    await repo.fijarEstado(c, actor.empresaId, id, d.status, motivo);
    await auditar(c, actor, {
      action: "unit.status_changed",
      entityType: "unit",
      entityId: id,
      before: { status: antes.status, reason: antes.status_reason },
      after: { status: d.status, reason: motivo },
    });
    const fila = (await repo.obtenerTrastero(c, actor.empresaId, id))!;
    return vistaTrasteroPanel(fila, null, verClientes);
  });
}

/** Vincula (o desvincula, con null) un trastero con una forma del plano vigente. */
export function vincularForma(actor: Actor, id: string, shapeId: string | null) {
  return enTx(async (c) => {
    const antes = await repo.obtenerTrastero(c, actor.empresaId, id, true);
    if (!antes) throw noExiste("El trastero");
    if (shapeId) {
      const { rows } = await c.query(
        `SELECT shape_ids FROM self_storage_floor_plans WHERE empresa_id = $1 AND center_id = $2 ORDER BY version DESC LIMIT 1`,
        [actor.empresaId, antes.center_id]
      );
      if (!rows.length) throw new ErrorSelfStorage("SIN_PLANO", "El centro todavía no tiene plano.", 409);
      if (!(rows[0].shape_ids as string[]).includes(shapeId)) {
        throw new ErrorSelfStorage("FORMA_NO_EXISTE", `El plano vigente no tiene ninguna forma con id «${shapeId}».`, 422);
      }
    }
    await repo.actualizarTrastero(c, actor.empresaId, id, { floor_plan_shape_id: shapeId });
    await auditar(c, actor, {
      action: "unit.shape_linked",
      entityType: "unit",
      entityId: id,
      before: { floorPlanShapeId: antes.floor_plan_shape_id },
      after: { floorPlanShapeId: shapeId },
    });
    return { id, floorPlanShapeId: shapeId };
  });
}
