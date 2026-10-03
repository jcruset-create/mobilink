/**
 * Importación de trasteros: validar (dry-run) → revisar → aplicar.
 *
 *   validar  — lee el CSV, decide fila a fila crear / actualizar / saltar /
 *              error, y lo GUARDA como vista previa. No toca los trasteros.
 *   aplicar  — dentro de una transacción, con el centro bloqueado, vuelve a
 *              decidir contra lo que hay AHORA en la base (alguien pudo crear
 *              un trastero entre la vista previa y la confirmación) y escribe.
 *              Si aparece un error que no estaba, no aplica nada: se pide
 *              volver a validar. Una importación aplicada no se aplica dos
 *              veces (la fila de la importación se bloquea y se mira su estado).
 *
 * Idempotencia: el número de trastero + centro es el identificador comercial,
 * así que reimportar el mismo fichero sólo produce «saltar».
 */

import { createHash } from "node:crypto";
import type { z } from "zod";
import { auditar, type Actor } from "../../shared/audit.ts";
import { enTx, pool, type Ejecutor } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { decidirAcciones, leerFilas, normalizarCabecera, resumen, ZONA_GENERAL_NUEVA, type ContextoCentro, type FilaDecidida, type TrasteroExistente } from "../../domain/importUnits.ts";
import type { importacionAlta } from "../../schemas.ts";
import * as repoCentros from "../centros/repository.ts";
import * as repoTrasteros from "../trasteros/repository.ts";

async function contextoCentro(db: Ejecutor, empresaId: string, centerId: string, zonaElegida: string | null, crearTiposQueFalten: boolean): Promise<ContextoCentro> {
  const [unidades, zonas, tipos] = await Promise.all([
    db.query(
      `SELECT id, code, zone_id, unit_type_id, name, width_cm, length_cm, height_cm,
              area_m2::float8 AS area_m2, volume_m3::float8 AS volume_m3, monthly_price::float8 AS monthly_price,
              tax_rate::float8 AS tax_rate, vat_amount::float8 AS vat_amount, monthly_price_gross::float8 AS monthly_price_gross,
              deposit_amount::float8 AS deposit_amount
         FROM self_storage_units WHERE empresa_id = $1 AND center_id = $2`,
      [empresaId, centerId]
    ),
    db.query(`SELECT id, code FROM self_storage_zones WHERE empresa_id = $1 AND center_id = $2`, [empresaId, centerId]),
    db.query(
      `SELECT id, code FROM self_storage_unit_types WHERE empresa_id = $1 AND (center_id IS NULL OR center_id = $2)
        ORDER BY center_id NULLS FIRST`,
      [empresaId, centerId]
    ),
  ]);
  // Sin zona elegida y con UNA sola zona en el centro, no hay nada que elegir.
  const zonaPorDefecto = zonaElegida ?? (zonas.rows.length === 1 ? zonas.rows[0].id : null);
  return {
    crearTiposQueFalten,
    // Sin ninguna zona en el centro no hay nada que elegir: se crea «General».
    crearZonaGeneral: zonas.rows.length === 0,
    existentes: new Map(unidades.rows.map((u: TrasteroExistente) => [u.code, u])),
    zonasPorCodigo: new Map(zonas.rows.map((z: { id: string; code: string }) => [z.code, z.id])),
    // Si hay un tipo común y uno del centro con el mismo código, gana el del centro.
    tiposPorCodigo: new Map(tipos.rows.map((t: { id: string; code: string }) => [t.code, t.id])),
    zonaPorDefecto,
  };
}

export async function validar(actor: Actor, centerId: string, d: z.infer<typeof importacionAlta>) {
  const centro = await repoCentros.obtenerCentro(pool, actor.empresaId, centerId);
  if (!centro) throw noExiste("El centro");
  if (d.defaultZoneId) {
    const zona = await repoCentros.obtenerZona(pool, actor.empresaId, d.defaultZoneId);
    if (!zona || zona.centerId !== centerId) throw new ErrorSelfStorage("ZONA_DE_OTRO_CENTRO", "La zona por defecto no es de este centro.", 422);
  }
  // El tipo de IVA no viene del fichero: es el IVA general de la EMPRESA.
  const ivaGeneral = await leerAjuste(pool, actor.empresaId, null, "default_vat_rate");
  const opciones = { unidadMedidas: d.measureUnit, crearTiposQueFalten: d.createMissingTypes };
  const leido = leerFilas(d.content, { ...opciones, ivaGeneral });
  const ctx = await contextoCentro(pool, actor.empresaId, centerId, d.defaultZoneId ?? null, d.createMissingTypes);
  const filas = decidirAcciones(leido.filas, ctx);
  const res = { ...resumen(filas), columnasIgnoradas: leido.desconocidas, columnas: leido.mapa, avisos: leido.avisos, ivaGeneral };
  const sha = createHash("sha256").update(d.content).digest("hex");

  return enTx(async (c) => {
    const imp = await c.query(
      `INSERT INTO self_storage_unit_imports (empresa_id, center_id, file_name, file_sha256, default_zone_id, status, options, summary, created_by)
       VALUES ($1,$2,$3,$4,$5,'validated',$6,$7,$8) RETURNING id`,
      [actor.empresaId, centerId, d.fileName, sha, d.defaultZoneId ?? null, JSON.stringify({ ...opciones, content: d.content }), JSON.stringify(res), actor.userId || null]
    );
    const importId = imp.rows[0].id as string;
    await guardarFilas(c, importId, filas);
    return obtener(actor, importId, c);
  });
}

async function guardarFilas(c: Ejecutor, importId: string, filas: FilaDecidida[]) {
  // Por lotes: un CSV de miles de filas no puede ser miles de idas y vueltas.
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const vals: unknown[] = [];
    const tuplas = lote.map((f, j) => {
      const b = j * 9;
      vals.push(importId, f.rowNumber, f.code || null, JSON.stringify(f.raw), f.valores ? JSON.stringify({ ...f.valores, cambios: f.cambios }) : null, f.errors, f.warnings, f.action, f.storageUnitId);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
    });
    await c.query(
      `INSERT INTO self_storage_unit_import_rows (import_id, row_number, unit_code, raw, parsed, errors, warnings, action, storage_unit_id)
       VALUES ${tuplas.join(", ")}`,
      vals
    );
  }
}

export async function obtener(actor: Actor, id: string, db: Ejecutor = pool) {
  const { rows } = await db.query(
    `SELECT i.id, i.center_id AS "centerId", i.file_name AS "fileName", i.status, i.summary,
            i.default_zone_id AS "defaultZoneId", i.created_at AS "createdAt", i.applied_at AS "appliedAt"
       FROM self_storage_unit_imports i WHERE i.empresa_id = $1 AND i.id = $2`,
    [actor.empresaId, id]
  );
  if (!rows.length) throw noExiste("La importación");
  const filas = await db.query(
    `SELECT row_number AS "rowNumber", unit_code AS "unitCode", raw, parsed, errors, warnings, action, storage_unit_id AS "storageUnitId"
       FROM self_storage_unit_import_rows WHERE import_id = $1 ORDER BY row_number`,
    [id]
  );
  return { ...rows[0], rows: filas.rows };
}

export async function listar(actor: Actor, centerId: string) {
  const { rows } = await pool.query(
    `SELECT id, file_name AS "fileName", status, summary, created_at AS "createdAt", applied_at AS "appliedAt"
       FROM self_storage_unit_imports WHERE empresa_id = $1 AND center_id = $2
      ORDER BY created_at DESC LIMIT 50`,
    [actor.empresaId, centerId]
  );
  return rows;
}

export function aplicar(actor: Actor, id: string) {
  return enTx(async (c) => {
    const { rows } = await c.query(
      `SELECT id, center_id, status, default_zone_id, options FROM self_storage_unit_imports
        WHERE empresa_id = $1 AND id = $2 FOR UPDATE`,
      [actor.empresaId, id]
    );
    const imp = rows[0];
    if (!imp) throw noExiste("La importación");
    if (imp.status === "applied") throw new ErrorSelfStorage("IMPORTACION_YA_APLICADA", "Esta importación ya se aplicó.", 409);

    // Bloquear el centro serializa las importaciones del mismo centro y las
    // altas manuales concurrentes no pueden colar un número a medias.
    await repoCentros.obtenerCentro(c, actor.empresaId, imp.center_id, true);

    // Se vuelve a calcular con el IVA general de AHORA: es el que vale al aplicar.
    const opciones = imp.options as { unidadMedidas: "auto" | "m" | "cm"; content: string; crearTiposQueFalten?: boolean };
    const ivaGeneral = await leerAjuste(c, actor.empresaId, null, "default_vat_rate");
    const leido = leerFilas(opciones.content, { unidadMedidas: opciones.unidadMedidas, ivaGeneral });
    const ctx = await contextoCentro(c, actor.empresaId, imp.center_id, imp.default_zone_id, Boolean(opciones.crearTiposQueFalten));
    const filas = decidirAcciones(leido.filas, ctx);
    const res = resumen(filas);
    if (res.error > 0) {
      throw new ErrorSelfStorage(
        "IMPORTACION_CON_ERRORES",
        `Hay ${res.error} fila(s) con errores. Corrige el fichero y vuelve a validarlo; no se ha importado nada.`,
        422,
        { resumen: res }
      );
    }

    // Zona «General» si el centro no tenía ninguna (se avisó en la vista previa).
    if (filas.some((f) => f.valores?.zone_id === ZONA_GENERAL_NUEVA)) {
      const { rows: z } = await c.query(
        `INSERT INTO self_storage_zones (empresa_id, center_id, code, name) VALUES ($1,$2,'GENERAL','General') RETURNING id`,
        [actor.empresaId, imp.center_id]
      );
      for (const f of filas) if (f.valores?.zone_id === ZONA_GENERAL_NUEVA) f.valores.zone_id = z[0].id;
      await auditar(c, actor, { action: "zone.created", entityType: "zone", entityId: z[0].id, after: { code: "GENERAL", name: "General", via: "import", importId: id } });
    }

    // Tipos nuevos: uno por código, con las medidas del primer trastero que lo
    // trae (son las «nominales»; cada trastero conserva las suyas).
    const tiposCreados: string[] = [];
    for (const f of filas) {
      if (!f.tipoACrear || !f.valores || ctx.tiposPorCodigo.has(f.tipoACrear)) continue;
      const v = f.valores;
      const original = (f.raw[Object.keys(f.raw).find((k) => normalizarCabecera(k) === "tipo") ?? ""] ?? f.tipoACrear).trim();
      const nombre = original ? original.charAt(0).toUpperCase() + original.slice(1).toLowerCase() : f.tipoACrear;
      const { rows: t } = await c.query(
        `INSERT INTO self_storage_unit_types (empresa_id, center_id, code, name, width_cm, length_cm, height_cm, nominal_area_m2, nominal_volume_m3)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [actor.empresaId, imp.center_id, f.tipoACrear, nombre, v.width_cm, v.length_cm, v.height_cm, v.area_m2, v.volume_m3]
      );
      ctx.tiposPorCodigo.set(f.tipoACrear, t[0].id);
      tiposCreados.push(f.tipoACrear);
      await auditar(c, actor, { action: "unit_type.created", entityType: "unit_type", entityId: t[0].id, after: { code: f.tipoACrear, name: nombre, via: "import", importId: id } });
    }
    for (const f of filas) {
      if (f.tipoACrear && f.valores) f.valores.unit_type_id = ctx.tiposPorCodigo.get(f.tipoACrear) ?? null;
    }

    let creados = 0;
    let actualizados = 0;
    for (const f of filas) {
      if (f.action === "create" && f.valores) {
        const unitId = await repoTrasteros.crearTrastero(c, actor.empresaId, imp.center_id, {
          ...f.valores,
          deposit_amount: f.valores.deposit_amount ?? 0,
          image_3d_url: null,
          floor_plan_shape_id: null,
          public_visible: true,
          notes: null,
        });
        f.storageUnitId = unitId;
        creados++;
      } else if (f.action === "update" && f.valores && f.storageUnitId) {
        const v = f.valores;
        // Sólo lo que viene del fichero: nunca el estado, ni el plano, ni las notas.
        await repoTrasteros.actualizarTrastero(c, actor.empresaId, f.storageUnitId, {
          zone_id: v.zone_id,
          unit_type_id: v.unit_type_id,
          name: v.name,
          width_cm: v.width_cm,
          length_cm: v.length_cm,
          height_cm: v.height_cm,
          area_m2: v.area_m2,
          volume_m3: v.volume_m3,
          monthly_price: v.monthly_price,
          tax_rate: v.tax_rate,
          vat_amount: v.vat_amount,
          monthly_price_gross: v.monthly_price_gross,
          deposit_amount: v.deposit_amount ?? 0,
        });
        const antes = ctx.existentes.get(f.code)!;
        await auditar(c, actor, {
          action: "unit.updated",
          entityType: "unit",
          entityId: f.storageUnitId,
          before: Object.fromEntries(f.cambios.map((k) => [k, antes[k as keyof TrasteroExistente]])),
          after: { ...Object.fromEntries(f.cambios.map((k) => [k, v[k as keyof typeof v]])), via: "import", importId: id },
        });
        if (f.cambios.some((k) => k === "monthly_price" || k === "vat_amount" || k === "monthly_price_gross")) {
          await auditar(c, actor, {
            action: "unit.price_changed",
            entityType: "unit",
            entityId: f.storageUnitId,
            before: { monthlyPrice: antes.monthly_price, vatAmount: antes.vat_amount, monthlyPriceGross: antes.monthly_price_gross },
            after: { monthlyPrice: v.monthly_price, vatAmount: v.vat_amount, monthlyPriceGross: v.monthly_price_gross, via: "import", importId: id },
          });
        }
        actualizados++;
      }
    }

    await c.query(`DELETE FROM self_storage_unit_import_rows WHERE import_id = $1`, [id]);
    await guardarFilas(c, id, filas);
    const resumenFinal = { ...res, creados, actualizados, tiposCreados };
    await c.query(
      `UPDATE self_storage_unit_imports SET status = 'applied', applied_at = now(), applied_by = $2, summary = summary || $3::jsonb WHERE id = $1`,
      [id, actor.userId || null, JSON.stringify(resumenFinal)]
    );
    await auditar(c, actor, { action: "import.applied", entityType: "unit_import", entityId: id, after: resumenFinal });
    return obtener(actor, id, c);
  });
}
