/**
 * Definición de un tarifario como DATOS, y el cargador que la mete en la base.
 *
 * El cargador es genérico: no sabe nada de ningún cliente. Recibe una
 * definición como la de `tarifarios/seas2026.ts` y la escribe. Cargar el
 * tarifario de otro cliente es escribir otro fichero de datos, sin tocar una
 * línea de esto.
 *
 * Dos garantías:
 *
 * 1. **Es idempotente.** Volver a cargar el mismo tarifario no duplica nada ni
 *    cambia lo ya publicado. Se puede ejecutar tantas veces como haga falta.
 * 2. **Nace como borrador.** Un tarifario recién cargado NO factura. Publicarlo
 *    es un acto manual y deliberado, porque un fichero de datos que se
 *    convierte solo en tarifa activa es exactamente lo que no se quiere.
 */

import db from "../../db.ts";
import { minutosDeHora } from "./time.ts";
import type { AmbitoCalendario } from "./calendar.ts";
import type { TipoCalculo, TipoDisparo } from "./extras.ts";
import type { PosicionNeumatico, ModeloPrecio } from "./tires.ts";

export interface DefFranja {
  code: string; name: string;
  desde: string; hasta: string;              // "08:00"
  dias?: number[];                            // 1 = lunes … 7 = domingo
  anclajeDia?: "moment" | "band_start";
}

export interface DefZona {
  code: string; name: string;
  type: "COUNTRY" | "COUNTRY_GROUP" | "REGION" | "PROVINCE" | "CUSTOM" | "ROAD_NETWORK" | "PRIVATE_HIGHWAY";
  miembros: { tipo: "country" | "region" | "province" | "postal_prefix" | "road"; valor: string }[];
}

export interface DefDiaCalendario {
  fecha: string; ambito: AmbitoCalendario; clase?: string;
  nombre?: string; anual?: boolean;
  regionCode?: string; provinceCode?: string; municipio?: string;
}

export interface DefExtra {
  code: string; name: string;
  calculo: TipoCalculo;
  importe?: string; porcentaje?: string;
  unidad?: string;
  aplicaA?: "assistance" | "forfait" | "line";
  tipoLinea?: string;
}

export interface DefRegla {
  code: string; name: string;
  servicio?: string | null; vehiculo?: string | null;
  zona?: string | null; franja?: string | null;
  clasesDia?: string[] | null;
  maxKm?: number | null; maxMin?: number | null;
  importe: string;
  incluyeKm?: number | null; incluyeMin?: number | null;
  extraKm?: string | null; extraTiempo?: string | null;
  disparoExtra?: TipoDisparo; umbralPorcentaje?: number | null;
  prioridad: number;
}

export interface DefPrecioNeumatico {
  medida?: string | null;
  marca?: string | null; grupoMarca?: string | null;
  posicion: PosicionNeumatico;
  modelo: ModeloPrecio;
  neto?: string | null; descuento?: string | null;
  prioridad?: number;
}

export interface DefinicionTarifario {
  code: string;
  name: string;
  descripcion?: string;
  currency?: string;
  timezone?: string;
  version: string;
  vigenteDesde: string;                       // "2026-01-01"
  vigenteHasta?: string | null;
  /** De dónde salen los números, para poder contrastarlos después. */
  fuente: string;
  calendario: { code: string; name: string; dias: DefDiaCalendario[] };
  franjas: DefFranja[];
  zonas: DefZona[];
  extras: DefExtra[];
  reglas: DefRegla[];
  gruposMarca?: { code: string; name: string; marcas: string[] }[];
  preciosNeumaticos?: DefPrecioNeumatico[];
}

export interface ResultadoCarga {
  tariffPlanId: number;
  tariffVersionId: number;
  status: string;
  creado: boolean;
  reglas: number;
  extras: number;
  franjas: number;
  zonas: number;
  diasCalendario: number;
  preciosNeumaticos: number;
}

const fechaAMs = (f: string): number => Date.parse(`${f}T00:00:00Z`);

/**
 * Carga (o vuelve a cargar) un tarifario para un centro de control.
 *
 * Si la versión ya está publicada NO se toca nada: una versión publicada es
 * inmutable, y corregir un precio se hace publicando otra versión. Cargar
 * encima cambiaría el precio de asistencias ya facturadas.
 */
export async function cargarTarifario(
  controlCenterId: number,
  def: DefinicionTarifario,
): Promise<ResultadoCarga> {
  const now = Date.now();
  const moneda = def.currency ?? "EUR";

  // ── Calendario ──────────────────────────────────────────────────────────
  const cal = await upsert(
    `INSERT INTO connect_calendars ("controlCenterId", code, name, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT ("controlCenterId", code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [controlCenterId, def.calendario.code, def.calendario.name, now],
  );
  let diasCalendario = 0;
  for (const d of def.calendario.dias) {
    const r = await db.query(
      `INSERT INTO connect_calendar_days
         ("calendarId", date, scope, "regionCode", "provinceCode", municipality,
          "dayClass", name, yearly, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING RETURNING id`,
      [cal, d.fecha, d.ambito, d.regionCode ?? null, d.provinceCode ?? null,
       d.municipio ?? null, d.clase ?? "holiday", d.nombre ?? null, !!d.anual, now],
    );
    diasCalendario += r.rowCount ?? 0;
  }

  // ── Franjas y zonas: son del centro, no de la versión ───────────────────
  const franjaId = new Map<string, number>();
  for (const f of def.franjas) {
    const id = await upsert(
      `INSERT INTO connect_tariff_time_bands
         ("controlCenterId", code, name, "startMinute", "endMinute", weekdays, "weekdayAnchor", "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT ("controlCenterId", code) DO UPDATE
         SET name = EXCLUDED.name, "startMinute" = EXCLUDED."startMinute",
             "endMinute" = EXCLUDED."endMinute", weekdays = EXCLUDED.weekdays,
             "weekdayAnchor" = EXCLUDED."weekdayAnchor"
       RETURNING id`,
      [controlCenterId, f.code, f.name, minutosDeHora(f.desde), minutosDeHora(f.hasta),
       f.dias ?? [1, 2, 3, 4, 5, 6, 7], f.anclajeDia ?? "moment", now],
    );
    franjaId.set(f.code, id);
  }

  const zonaId = new Map<string, number>();
  for (const z of def.zonas) {
    const id = await upsert(
      `INSERT INTO connect_tariff_zones ("controlCenterId", code, name, type, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("controlCenterId", code) DO UPDATE
         SET name = EXCLUDED.name, type = EXCLUDED.type
       RETURNING id`,
      [controlCenterId, z.code, z.name, z.type, now],
    );
    zonaId.set(z.code, id);
    for (const m of z.miembros) {
      await db.query(
        `INSERT INTO connect_tariff_zone_members ("zoneId", "matchType", value)
         SELECT $1,$2,$3
          WHERE NOT EXISTS (SELECT 1 FROM connect_tariff_zone_members
                             WHERE "zoneId" = $1 AND "matchType" = $2 AND value = $3)`,
        [id, m.tipo, m.valor],
      );
    }
  }

  // ── Tarifario y versión ─────────────────────────────────────────────────
  const planId = await upsert(
    `INSERT INTO connect_tariff_plans
       ("controlCenterId", code, name, description, currency, timezone, "calendarId", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT ("controlCenterId", code) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description,
           "calendarId" = EXCLUDED."calendarId", "updatedAtMs" = EXCLUDED."updatedAtMs"
     RETURNING id`,
    [controlCenterId, def.code, def.name, def.descripcion ?? null, moneda,
     def.timezone ?? "Europe/Madrid", cal, now],
  );

  const existente = await db.query(
    `SELECT id, status FROM connect_tariff_versions WHERE "tariffPlanId" = $1 AND version = $2`,
    [planId, def.version],
  );

  if (existente.rows[0]?.status === "published") {
    /*
     * Publicada e inmutable: no se toca. Corregir un precio de una versión
     * publicada cambiaría el importe de asistencias ya facturadas con ella.
     */
    return {
      tariffPlanId: planId, tariffVersionId: existente.rows[0].id,
      status: "published", creado: false,
      reglas: 0, extras: 0, franjas: franjaId.size, zonas: zonaId.size,
      diasCalendario, preciosNeumaticos: 0,
    };
  }

  const versionId = await upsert(
    `INSERT INTO connect_tariff_versions
       ("controlCenterId", "tariffPlanId", version, status, "validFromMs", "validToMs",
        "sourceDocument", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$7)
     ON CONFLICT ("tariffPlanId", version) DO UPDATE
       SET "validFromMs" = EXCLUDED."validFromMs", "validToMs" = EXCLUDED."validToMs",
           "sourceDocument" = EXCLUDED."sourceDocument", "updatedAtMs" = EXCLUDED."updatedAtMs"
     RETURNING id`,
    [controlCenterId, planId, def.version, fechaAMs(def.vigenteDesde),
     def.vigenteHasta ? fechaAMs(def.vigenteHasta) : null, def.fuente, now],
  );

  // Un borrador se puede recargar entero: se limpia y se vuelve a escribir,
  // que es más simple y más seguro que ir casando fila a fila.
  await db.query(`DELETE FROM connect_tariff_rules WHERE "tariffVersionId" = $1`, [versionId]);
  await db.query(`DELETE FROM connect_tariff_extras WHERE "tariffVersionId" = $1`, [versionId]);
  await db.query(`DELETE FROM connect_tariff_tire_prices WHERE "tariffVersionId" = $1`, [versionId]);
  await db.query(`DELETE FROM connect_tire_brand_groups WHERE "tariffVersionId" = $1`, [versionId]);

  const extraId = new Map<string, number>();
  for (const e of def.extras) {
    const id = await upsert(
      `INSERT INTO connect_tariff_extras
         ("controlCenterId", "tariffVersionId", code, name, "calculationType", amount,
          percentage, unit, "appliesTo", "lineKind", "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [controlCenterId, versionId, e.code, e.name, e.calculo, e.importe ?? null,
       e.porcentaje ?? null, e.unidad ?? null, e.aplicaA ?? "assistance", e.tipoLinea ?? null, now],
    );
    extraId.set(e.code, id);
  }

  for (const r of def.reglas) {
    await db.query(
      `INSERT INTO connect_tariff_rules
         ("controlCenterId", "tariffVersionId", code, name, "serviceTypeCode", "vehicleTypeCode",
          "zoneId", "timeBandId", "dayClasses", "maxDistanceKm", "maxDurationMin",
          amount, "includedDistanceKm", "includedDurationMin",
          "extraDistanceExtraId", "extraDurationExtraId", "extraTriggerType",
          "extraThresholdPercent", priority, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        controlCenterId, versionId, r.code, r.name, r.servicio ?? null, r.vehiculo ?? null,
        r.zona ? zonaId.get(r.zona) ?? null : null,
        r.franja ? franjaId.get(r.franja) ?? null : null,
        r.clasesDia ?? null, r.maxKm ?? null, r.maxMin ?? null,
        r.importe, r.incluyeKm ?? null, r.incluyeMin ?? null,
        r.extraKm ? extraId.get(r.extraKm) ?? null : null,
        r.extraTiempo ? extraId.get(r.extraTiempo) ?? null : null,
        r.disparoExtra ?? "ALWAYS", r.umbralPorcentaje ?? null, r.prioridad, now,
      ],
    );
  }

  // ── Neumáticos ──────────────────────────────────────────────────────────
  const grupoId = new Map<string, number>();
  for (const g of def.gruposMarca ?? []) {
    const id = await upsert(
      `INSERT INTO connect_tire_brand_groups ("controlCenterId", "tariffVersionId", code, name)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [controlCenterId, versionId, g.code, g.name],
    );
    grupoId.set(g.code, id);
    for (const marca of g.marcas) {
      const marcaId = await upsert(
        `INSERT INTO connect_tire_brands ("controlCenterId", code, name, "normalizedName", "createdAtMs")
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT ("controlCenterId", "normalizedName") DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [controlCenterId, marca.toUpperCase().replace(/\s+/g, "_"), marca, marca.toUpperCase(), now],
      );
      await db.query(
        `INSERT INTO connect_tire_brand_group_members ("groupId", "brandId")
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, marcaId],
      );
    }
  }

  let preciosNeumaticos = 0;
  for (const p of def.preciosNeumaticos ?? []) {
    const marcaId = p.marca ? await upsert(
      `INSERT INTO connect_tire_brands ("controlCenterId", code, name, "normalizedName", "createdAtMs")
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("controlCenterId", "normalizedName") DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [controlCenterId, p.marca.toUpperCase().replace(/\s+/g, "_"), p.marca, p.marca.toUpperCase(), now],
    ) : null;

    const medidaId = p.medida ? await upsert(
      `INSERT INTO connect_tire_sizes ("controlCenterId", "normalizedCode", "rawInput", "createdAtMs")
       VALUES ($1,$2,$3,$4)
       ON CONFLICT ("controlCenterId", "normalizedCode") DO UPDATE SET "rawInput" = EXCLUDED."rawInput"
       RETURNING id`,
      [controlCenterId, p.medida, p.medida, now],
    ) : null;

    await db.query(
      `INSERT INTO connect_tariff_tire_prices
         ("controlCenterId", "tariffVersionId", "tireSizeId", "brandId", "brandGroupId",
          position, "priceModel", "netAmount", "discountPercent", priority, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [controlCenterId, versionId, medidaId, marcaId,
       p.grupoMarca ? grupoId.get(p.grupoMarca) ?? null : null,
       p.posicion, p.modelo, p.neto ?? null, p.descuento ?? null, p.prioridad ?? 10, now],
    );
    preciosNeumaticos++;
  }

  return {
    tariffPlanId: planId, tariffVersionId: versionId, status: "draft",
    creado: !existente.rows[0],
    reglas: def.reglas.length, extras: def.extras.length,
    franjas: franjaId.size, zonas: zonaId.size, diasCalendario, preciosNeumaticos,
  };
}

/**
 * Publica una versión. Es un acto deliberado y aparte de la carga: hasta que
 * alguien la publica, el tarifario está cargado pero no factura.
 */
export async function publicarVersion(versionId: number, userId: number | null): Promise<boolean> {
  const r = await db.query(
    `UPDATE connect_tariff_versions
        SET status = 'published', "publishedAtMs" = $1, "publishedByUserId" = $2, "updatedAtMs" = $1
      WHERE id = $3 AND status = 'draft' RETURNING id`,
    [Date.now(), userId, versionId],
  );
  return (r.rowCount ?? 0) > 0;
}

async function upsert(sql: string, valores: unknown[]): Promise<number> {
  const r = await db.query(sql, valores as any[]);
  if (r.rows[0]?.id != null) return Number(r.rows[0].id);
  throw new Error("La inserción no devolvió identificador");
}
