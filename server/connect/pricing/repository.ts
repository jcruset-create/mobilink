/**
 * Lectura de la configuración tarifaria desde la base.
 *
 * Es la única pieza del motor que habla con PostgreSQL en la lectura. Todo lo
 * que decide precios vive en los módulos puros; aquí solo se cargan filas y se
 * dan la forma que el motor espera.
 *
 * El acceso exige SIEMPRE el centro de control. No es una convención: es el
 * aislamiento entre centrales, y aquí se manejan costes y márgenes. Por eso
 * `controlCenterId` es el primer parámetro de todo lo que hay debajo y no un
 * campo opcional del filtro.
 *
 * La escritura del resultado (etapas, líneas, snapshot) llega en la fase 8.
 */

import db from "../../db.ts";
import type { ConfiguracionLado, ConfiguracionTarifa, ReglaConImporte } from "./engine.ts";
import type { DiaCalendario } from "./calendar.ts";
import type { Extra } from "./extras.ts";
import type { FranjaHoraria } from "./timeBands.ts";
import { seleccionarVersion, type VersionTarifa } from "./versions.ts";
import type { CatalogoNeumaticos, BaremoFabricante, PrecioNeumaticoTarifa } from "./tires.ts";

export interface ContratoAplicable {
  id: number;
  role: "sale" | "purchase";
  tariffPlanId: number;
  tariffPlanName: string;
  timezone: string;
  calendarId: number | null;
  currency: string;
}

/**
 * Contrato vigente para una contraparte.
 *
 * En la compra se busca primero el acuerdo con el taller concreto y, si no lo
 * hay, el de su empresa: un taller puede tener condiciones propias dentro de
 * un acuerdo general, y lo específico manda.
 */
export async function contratoVigente(
  controlCenterId: number,
  role: "sale" | "purchase",
  contraparte: { clientId?: number | null; providerCompanyId?: number | null; workshopId?: number | null },
  atMs: number,
): Promise<ContratoAplicable | null> {
  const r = await db.query(
    `SELECT c.id, c.role, c."tariffPlanId", c.currency,
            p.name AS "tariffPlanName", p.timezone, p."calendarId",
            (c."workshopId" IS NOT NULL) AS "esDeTaller"
       FROM connect_contracts c
       JOIN connect_tariff_plans p ON p.id = c."tariffPlanId"
      WHERE c."controlCenterId" = $1
        AND c.role = $2
        AND c.status = 'active'
        AND c."validFromMs" <= $3
        AND (c."validToMs" IS NULL OR $3 < c."validToMs")
        AND ($4::int IS NULL OR c."clientId" = $4)
        AND ($5::int IS NULL OR c."providerCompanyId" = $5)
        AND (c."workshopId" IS NULL OR c."workshopId" = $6)
      ORDER BY "esDeTaller" DESC, c.priority DESC, c.id ASC
      LIMIT 1`,
    [controlCenterId, role,
     atMs,
     contraparte.clientId ?? null,
     contraparte.providerCompanyId ?? null,
     contraparte.workshopId ?? null],
  );
  const c = r.rows[0];
  return c ? {
    id: c.id, role: c.role, tariffPlanId: c.tariffPlanId,
    tariffPlanName: c.tariffPlanName, timezone: c.timezone ?? "Europe/Madrid",
    calendarId: c.calendarId ?? null, currency: c.currency ?? "EUR",
  } : null;
}

/** Configuración de un lado, ya con su versión vigente resuelta. */
export async function cargarLado(
  controlCenterId: number,
  contrato: ContratoAplicable,
  atMs: number,
): Promise<{ lado: ConfiguracionLado | null; avisos: string[] }> {
  const vs = await db.query(
    `SELECT id, "tariffPlanId", version, status, "validFromMs", "validToMs", priority
       FROM connect_tariff_versions
      WHERE "controlCenterId" = $1 AND "tariffPlanId" = $2`,
    [controlCenterId, contrato.tariffPlanId],
  );
  const versiones: VersionTarifa[] = vs.rows.map((v: any) => ({
    id: v.id, tariffPlanId: v.tariffPlanId, version: v.version, status: v.status,
    validFromMs: Number(v.validFromMs),
    validToMs: v.validToMs == null ? null : Number(v.validToMs),
    priority: v.priority,
  }));

  const sel = seleccionarVersion(versiones, atMs);
  if (!sel.version) return { lado: null, avisos: sel.avisos };

  const versionId = sel.version.id;
  const [reglas, extras, catalogo] = await Promise.all([
    cargarReglas(controlCenterId, versionId),
    cargarExtras(controlCenterId, versionId),
    cargarCatalogoNeumaticos(controlCenterId, versionId, atMs),
  ]);

  return {
    avisos: sel.avisos,
    lado: {
      contractId: contrato.id,
      tariffPlanId: contrato.tariffPlanId,
      tariffPlanName: contrato.tariffPlanName,
      tariffVersionId: versionId,
      version: sel.version.version,
      currency: contrato.currency,
      reglas, extras,
      catalogoNeumaticos: catalogo,
    } as ConfiguracionLado,
  };
}

async function cargarReglas(controlCenterId: number, versionId: number): Promise<ReglaConImporte[]> {
  const r = await db.query(
    `SELECT id, code, name, "serviceTypeCode", "vehicleTypeCode", "zoneId", "timeBandId",
            "dayClasses", "minDistanceKm", "maxDistanceKm", "minDurationMin", "maxDurationMin",
            amount, "includedDistanceKm", "includedDurationMin",
            "extraDistanceExtraId", "extraDurationExtraId", "extraTriggerType",
            "extraThresholdPercent", priority, active
       FROM connect_tariff_rules
      WHERE "controlCenterId" = $1 AND "tariffVersionId" = $2 AND active
      ORDER BY id`,
    [controlCenterId, versionId],
  );
  return r.rows.map((x: any) => ({
    ...x,
    minDistanceKm: x.minDistanceKm == null ? null : Number(x.minDistanceKm),
    maxDistanceKm: x.maxDistanceKm == null ? null : Number(x.maxDistanceKm),
  }));
}

async function cargarExtras(controlCenterId: number, versionId: number): Promise<Extra[]> {
  const r = await db.query(
    `SELECT id, code, name, "calculationType", amount, percentage, unit, "lineKind"
       FROM connect_tariff_extras
      WHERE "controlCenterId" = $1 AND "tariffVersionId" = $2 AND active
      ORDER BY id`,
    [controlCenterId, versionId],
  );
  return r.rows as Extra[];
}

async function cargarCatalogoNeumaticos(
  controlCenterId: number, versionId: number, atMs: number,
): Promise<CatalogoNeumaticos> {
  const precios = await db.query(
    `SELECT p.id, s."normalizedCode" AS "tireSizeCode", b."normalizedName" AS "brandName",
            g.code AS "brandGroupCode", p.position, p."priceModel", p."netAmount",
            p."discountPercent", p."manufacturerPriceListId", p.priority, p.active
       FROM connect_tariff_tire_prices p
       LEFT JOIN connect_tire_sizes s ON s.id = p."tireSizeId"
       LEFT JOIN connect_tire_brands b ON b.id = p."brandId"
       LEFT JOIN connect_tire_brand_groups g ON g.id = p."brandGroupId"
      WHERE p."controlCenterId" = $1 AND p."tariffVersionId" = $2 AND p.active
      ORDER BY p.id`,
    [controlCenterId, versionId],
  );

  const grupos = await db.query(
    `SELECT b."normalizedName" AS marca, g.code AS grupo
       FROM connect_tire_brand_group_members m
       JOIN connect_tire_brand_groups g ON g.id = m."groupId"
       JOIN connect_tire_brands b ON b.id = m."brandId"
      WHERE g."tariffVersionId" = $1`,
    [versionId],
  );
  const gruposPorMarca = new Map<string, string[]>();
  for (const g of grupos.rows) {
    const previos = gruposPorMarca.get(g.marca) ?? [];
    previos.push(g.grupo);
    gruposPorMarca.set(g.marca, previos);
  }

  // Solo los baremos vigentes en la fecha del servicio: mezclar el de este año
  // con el del anterior daría precios de neumático de otra temporada.
  const baremos = await db.query(
    `SELECT mp."priceListId", s."normalizedCode" AS "tireSizeCode",
            b."normalizedName" AS "brandName", mp.model, mp."listPrice"
       FROM connect_manufacturer_tire_prices mp
       JOIN connect_manufacturer_price_lists l ON l.id = mp."priceListId"
       JOIN connect_tire_sizes s ON s.id = mp."tireSizeId"
       JOIN connect_tire_brands b ON b.id = l."brandId"
      WHERE l."controlCenterId" = $1 AND l.active
        AND l."validFromMs" <= $2 AND (l."validToMs" IS NULL OR $2 < l."validToMs")`,
    [controlCenterId, atMs],
  );

  return {
    precios: precios.rows as PrecioNeumaticoTarifa[],
    gruposPorMarca,
    baremos: baremos.rows as BaremoFabricante[],
  };
}

export async function cargarFranjas(controlCenterId: number): Promise<FranjaHoraria[]> {
  const r = await db.query(
    `SELECT id, code, name, "startMinute", "endMinute", weekdays, "weekdayAnchor", active
       FROM connect_tariff_time_bands WHERE "controlCenterId" = $1 AND active ORDER BY id`,
    [controlCenterId],
  );
  return r.rows as FranjaHoraria[];
}

export async function cargarCalendario(calendarId: number | null): Promise<DiaCalendario[]> {
  if (calendarId == null) return [];
  const r = await db.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, scope, "regionCode", "provinceCode",
            municipality, "dayClass", name, yearly, active
       FROM connect_calendar_days WHERE "calendarId" = $1 AND active ORDER BY date`,
    [calendarId],
  );
  return r.rows as DiaCalendario[];
}

/** Zonas a las que pertenece un punto, por país, región, provincia o CP. */
export async function zonasDe(
  controlCenterId: number,
  lugar: { country?: string | null; regionCode?: string | null; provinceCode?: string | null; postalCode?: string | null },
): Promise<{ ids: number[]; nombre: string | null }> {
  const r = await db.query(
    `SELECT DISTINCT z.id, z.name, z.priority
       FROM connect_tariff_zones z
       JOIN connect_tariff_zone_members m ON m."zoneId" = z.id
      WHERE z."controlCenterId" = $1 AND z.active
        AND (
          (m."matchType" = 'country'  AND upper(m.value) = upper($2)) OR
          (m."matchType" = 'region'   AND upper(m.value) = upper($3)) OR
          (m."matchType" = 'province' AND upper(m.value) = upper($4)) OR
          (m."matchType" = 'postal_prefix' AND $5 LIKE m.value || '%')
        )
      ORDER BY z.priority DESC, z.id`,
    [controlCenterId, lugar.country ?? "", lugar.regionCode ?? "",
     lugar.provinceCode ?? "", lugar.postalCode ?? ""],
  );
  return { ids: r.rows.map((z: any) => z.id), nombre: r.rows[0]?.name ?? null };
}

/** Configuración completa para tarificar una asistencia. */
export async function cargarConfiguracion(opciones: {
  controlCenterId: number;
  clientId: number | null;
  providerCompanyId: number | null;
  workshopId: number | null;
  atMs: number;
  lugar?: { country?: string | null; regionCode?: string | null; provinceCode?: string | null; postalCode?: string | null };
}): Promise<{ configuracion: ConfiguracionTarifa; timezone: string; avisos: string[] }> {
  const { controlCenterId, atMs } = opciones;
  const avisos: string[] = [];

  const contratoVenta = opciones.clientId
    ? await contratoVigente(controlCenterId, "sale", { clientId: opciones.clientId }, atMs)
    : null;
  const contratoCompra = opciones.providerCompanyId
    ? await contratoVigente(controlCenterId, "purchase",
        { providerCompanyId: opciones.providerCompanyId, workshopId: opciones.workshopId }, atMs)
    : null;

  const venta = contratoVenta ? await cargarLado(controlCenterId, contratoVenta, atMs) : null;
  const compra = contratoCompra ? await cargarLado(controlCenterId, contratoCompra, atMs) : null;
  avisos.push(...(venta?.avisos ?? []), ...(compra?.avisos ?? []));

  const referencia = contratoVenta ?? contratoCompra;
  const [franjas, calendario, zonas] = await Promise.all([
    cargarFranjas(controlCenterId),
    cargarCalendario(referencia?.calendarId ?? null),
    zonasDe(controlCenterId, opciones.lugar ?? {}),
  ]);

  return {
    timezone: referencia?.timezone ?? "Europe/Madrid",
    avisos,
    configuracion: {
      franjas, calendario,
      venta: venta?.lado ?? null,
      compra: compra?.lado ?? null,
      nombreZona: zonas.nombre,
      zoneIds: zonas.ids,
    } as ConfiguracionTarifa & { zoneIds: number[] },
  };
}
