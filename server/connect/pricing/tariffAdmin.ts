/**
 * Administración del tarifario desde el panel.
 *
 * Hasta ahora un tarifario solo se cambiaba editando un fichero de datos y
 * ejecutando un script. Eso vale para cargar el primer tarifario; no vale
 * para que una central suba el nocturno en enero sin llamar a nadie.
 *
 * Tres reglas gobiernan todo lo que hay aquí:
 *
 *  1. **Una versión publicada no se toca. Nunca.** Editarla cambiaría el
 *     importe de asistencias ya facturadas con ella y dejaría la explicación
 *     histórica mintiendo. Para cambiar un precio se DUPLICA la versión, se
 *     edita el borrador y se publica con su fecha de entrada en vigor. Las dos
 *     quedan en la base: la vieja explica lo viejo.
 *
 *  2. **Las franjas y las zonas se comparten entre versiones**, porque están
 *     colgadas del centro de control y no de la versión. Eso abre una puerta
 *     de atrás: cambiarle la hora a una franja alteraría cómo resuelve una
 *     tarifa YA publicada sin pasar por el duplicado. Se cierra aquí — una
 *     franja o una zona usada por una versión publicada no se deja editar—, y
 *     en su lugar se crea otra.
 *
 *  3. **Todo pasa por el centro de control**, también al escribir sobre filas
 *     que ya existen. Un `id` en la URL no es permiso para tocarlo.
 */

import db from "../../db.ts";
import { minutosDeHora } from "./time.ts";

export class ErrorTarifario extends Error {
  constructor(readonly codigo: string, mensaje: string, readonly estado = 400) {
    super(mensaje);
  }
}

const TIPOS_CALCULO = ["FIXED", "PER_UNIT", "PER_KM", "PER_MINUTE", "PER_HOUR", "PERCENTAGE", "FORMULA"];
const DISPAROS = ["ALWAYS", "THRESHOLD_PERCENT", "THRESHOLD_ABSOLUTE"];
const ANCLAJES = ["moment", "band_start"];

// ── Planes ──────────────────────────────────────────────────────────────────

export async function listarPlanes(controlCenterId: number) {
  const r = await db.query(
    `SELECT p.id, p.code, p.name, p.description, p.currency, p.timezone, p.active,
            p."calendarId", c.name AS "calendarName",
            COUNT(v.id)::int AS versiones,
            COUNT(v.id) FILTER (WHERE v.status = 'published')::int AS publicadas,
            COUNT(ct.id)::int AS contratos
       FROM connect_tariff_plans p
       LEFT JOIN connect_calendars c ON c.id = p."calendarId"
       LEFT JOIN connect_tariff_versions v ON v."tariffPlanId" = p.id
       LEFT JOIN connect_contracts ct ON ct."tariffPlanId" = p.id AND ct.status <> 'ended'
      WHERE p."controlCenterId" = $1
      GROUP BY p.id, c.name
      ORDER BY p.name`,
    [controlCenterId],
  );
  return r.rows;
}

export async function crearPlan(controlCenterId: number, p: {
  code: string; name: string; description?: string | null;
  currency?: string | null; timezone?: string | null; calendarId?: number | null;
}) {
  const code = String(p.code ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!code) throw new ErrorTarifario("code_requerido", "El tarifario necesita un código");
  const now = Date.now();
  const r = await db.query(
    `INSERT INTO connect_tariff_plans
       ("controlCenterId", code, name, description, currency, timezone, "calendarId", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT ("controlCenterId", code) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description,
           currency = EXCLUDED.currency, timezone = EXCLUDED.timezone,
           "calendarId" = COALESCE(EXCLUDED."calendarId", connect_tariff_plans."calendarId"),
           "updatedAtMs" = EXCLUDED."updatedAtMs"
     RETURNING id, code, name`,
    [controlCenterId, code, String(p.name ?? code).trim(), p.description ?? null,
     p.currency ?? "EUR", p.timezone ?? "Europe/Madrid", p.calendarId ?? null, now],
  );
  return r.rows[0];
}

// ── Versiones ───────────────────────────────────────────────────────────────

export async function listarVersiones(controlCenterId: number, planId: number) {
  const r = await db.query(
    `SELECT v.id, v.version, v.status, v."validFromMs", v."validToMs", v.priority,
            v."publishedAtMs", v."sourceDocument", v.notes,
            (SELECT COUNT(*)::int FROM connect_tariff_rules x WHERE x."tariffVersionId" = v.id) AS reglas,
            (SELECT COUNT(*)::int FROM connect_tariff_extras x WHERE x."tariffVersionId" = v.id) AS extras,
            (SELECT COUNT(*)::int FROM connect_tariff_tire_prices x WHERE x."tariffVersionId" = v.id) AS neumaticos
       FROM connect_tariff_versions v
      WHERE v."controlCenterId" = $1 AND v."tariffPlanId" = $2
      ORDER BY v."validFromMs" DESC, v.id DESC`,
    [controlCenterId, planId],
  );
  return r.rows.map(fechas);
}

/**
 * Duplica una versión en un borrador nuevo.
 *
 * Es la vía normal para cambiar un precio: se copia lo publicado, se edita la
 * copia y se publica con su fecha. Se copia TODO —reglas, suplementos, grupos
 * de marca y precios de neumático— y se remapean las referencias internas, que
 * es lo que sale mal si se copia a mano con SQL.
 */
export async function duplicarVersion(
  controlCenterId: number,
  versionId: number,
  destino: { version: string; validFromMs: number; validToMs?: number | null; notes?: string | null },
) {
  const origen = await db.query(
    `SELECT * FROM connect_tariff_versions WHERE id = $1 AND "controlCenterId" = $2`,
    [versionId, controlCenterId],
  );
  if (!origen.rows[0]) throw new ErrorTarifario("version_no_encontrada", "Versión no encontrada", 404);
  const v = origen.rows[0];

  const etiqueta = String(destino.version ?? "").trim();
  if (!etiqueta) throw new ErrorTarifario("version_requerida", "La versión nueva necesita un nombre");

  const yaExiste = await db.query(
    `SELECT id FROM connect_tariff_versions WHERE "tariffPlanId" = $1 AND version = $2`,
    [v.tariffPlanId, etiqueta],
  );
  if (yaExiste.rows[0]) {
    throw new ErrorTarifario("version_duplicada", `Ya hay una versión "${etiqueta}" en este tarifario`, 409);
  }

  const now = Date.now();
  const nueva = await db.query(
    `INSERT INTO connect_tariff_versions
       ("controlCenterId", "tariffPlanId", version, status, "validFromMs", "validToMs",
        priority, "sourceDocument", notes, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
    [controlCenterId, v.tariffPlanId, etiqueta, destino.validFromMs, destino.validToMs ?? null,
     v.priority, v.sourceDocument, destino.notes ?? `Copia de la versión ${v.version}`, now],
  );
  const nuevaId = Number(nueva.rows[0].id);

  // Suplementos primero: las reglas los referencian
  const extras = await db.query(
    `SELECT * FROM connect_tariff_extras WHERE "tariffVersionId" = $1`, [versionId]);
  const extraId = new Map<number, number>();
  for (const e of extras.rows) {
    const ins = await db.query(
      `INSERT INTO connect_tariff_extras
         ("controlCenterId", "tariffVersionId", code, name, "calculationType", amount, percentage,
          unit, "appliesTo", "lineKind", conditions, priority, active, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [controlCenterId, nuevaId, e.code, e.name, e.calculationType, e.amount, e.percentage,
       e.unit, e.appliesTo, e.lineKind, e.conditions, e.priority, e.active, now]);
    extraId.set(Number(e.id), Number(ins.rows[0].id));
  }

  const reglas = await db.query(
    `SELECT * FROM connect_tariff_rules WHERE "tariffVersionId" = $1`, [versionId]);
  for (const g of reglas.rows) {
    await db.query(
      `INSERT INTO connect_tariff_rules
         ("controlCenterId", "tariffVersionId", code, name, "serviceTypeCode", "vehicleTypeCode",
          "zoneId", "timeBandId", "dayClasses", "minDistanceKm", "maxDistanceKm",
          "minDurationMin", "maxDurationMin", amount, "includedDistanceKm", "includedDurationMin",
          "extraDistanceExtraId", "extraDurationExtraId", "extraTriggerType",
          "extraThresholdPercent", priority, active, notes, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [controlCenterId, nuevaId, g.code, g.name, g.serviceTypeCode, g.vehicleTypeCode,
       g.zoneId, g.timeBandId, g.dayClasses, g.minDistanceKm, g.maxDistanceKm,
       g.minDurationMin, g.maxDurationMin, g.amount, g.includedDistanceKm, g.includedDurationMin,
       extraId.get(Number(g.extraDistanceExtraId)) ?? null,
       extraId.get(Number(g.extraDurationExtraId)) ?? null,
       g.extraTriggerType, g.extraThresholdPercent, g.priority, g.active, g.notes, now]);
  }

  // Grupos de marca, que también cuelgan de la versión, y sus miembros
  const grupos = await db.query(
    `SELECT * FROM connect_tire_brand_groups WHERE "tariffVersionId" = $1`, [versionId]);
  const grupoId = new Map<number, number>();
  for (const g of grupos.rows) {
    const ins = await db.query(
      `INSERT INTO connect_tire_brand_groups ("controlCenterId", "tariffVersionId", code, name)
       VALUES ($1,$2,$3,$4) RETURNING id`, [controlCenterId, nuevaId, g.code, g.name]);
    const destinoId = Number(ins.rows[0].id);
    grupoId.set(Number(g.id), destinoId);
    await db.query(
      `INSERT INTO connect_tire_brand_group_members ("groupId", "brandId")
       SELECT $1, "brandId" FROM connect_tire_brand_group_members WHERE "groupId" = $2
       ON CONFLICT DO NOTHING`, [destinoId, g.id]);
  }

  const precios = await db.query(
    `SELECT * FROM connect_tariff_tire_prices WHERE "tariffVersionId" = $1`, [versionId]);
  for (const p of precios.rows) {
    await db.query(
      `INSERT INTO connect_tariff_tire_prices
         ("controlCenterId", "tariffVersionId", "tireSizeId", "brandId", "brandGroupId",
          position, "priceModel", "netAmount", "discountPercent", "manufacturerPriceListId",
          priority, active, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [controlCenterId, nuevaId, p.tireSizeId, p.brandId,
       p.brandGroupId == null ? null : grupoId.get(Number(p.brandGroupId)) ?? null,
       p.position, p.priceModel, p.netAmount, p.discountPercent, p.manufacturerPriceListId,
       p.priority, p.active, now]);
  }

  return {
    id: nuevaId, version: etiqueta, status: "draft",
    copiado: { extras: extras.rowCount ?? 0, reglas: reglas.rowCount ?? 0,
               grupos: grupos.rowCount ?? 0, neumaticos: precios.rowCount ?? 0 },
  };
}

export async function editarVersion(controlCenterId: number, versionId: number, p: {
  validFromMs?: number | null; validToMs?: number | null; notes?: string | null; priority?: number | null;
}) {
  await exigirBorrador(controlCenterId, versionId);
  const r = await db.query(
    `UPDATE connect_tariff_versions
        SET "validFromMs" = COALESCE($1, "validFromMs"),
            "validToMs" = $2,
            notes = COALESCE($3, notes),
            priority = COALESCE($4, priority),
            "updatedAtMs" = $5
      WHERE id = $6 AND "controlCenterId" = $7
      RETURNING id, version, status, "validFromMs", "validToMs", priority, notes`,
    [p.validFromMs ?? null, p.validToMs ?? null, p.notes ?? null, p.priority ?? null,
     Date.now(), versionId, controlCenterId],
  );
  return fechas(r.rows[0]);
}

/**
 * Publica un borrador.
 *
 * Antes de publicar se comprueba lo que el motor no podría avisar hasta que ya
 * estuviera facturando: que haya reglas, que ninguna apunte a un suplemento
 * que no existe y que no haya dos con la misma prioridad, que es lo que
 * dispara AMBIGUOUS_RULES en mitad de un servicio.
 */
export async function publicar(controlCenterId: number, versionId: number, userId: number | null) {
  await exigirBorrador(controlCenterId, versionId);
  const problemas = await revisarVersion(controlCenterId, versionId);
  const graves = problemas.filter((p) => p.gravedad === "error");
  if (graves.length > 0) {
    throw new ErrorTarifario("version_con_errores",
      `No se puede publicar: ${graves.map((p) => p.mensaje).join("; ")}`, 409);
  }

  const now = Date.now();
  const r = await db.query(
    `UPDATE connect_tariff_versions
        SET status = 'published', "publishedAtMs" = $1, "publishedByUserId" = $2, "updatedAtMs" = $1
      WHERE id = $3 AND "controlCenterId" = $4 AND status = 'draft'
      RETURNING id, version, status, "publishedAtMs"`,
    [now, userId, versionId, controlCenterId],
  );
  return { publicada: (r.rowCount ?? 0) > 0, version: r.rows[0] ?? null, avisos: problemas };
}

export async function archivar(controlCenterId: number, versionId: number) {
  const r = await db.query(
    `UPDATE connect_tariff_versions SET status = 'archived', "updatedAtMs" = $1
      WHERE id = $2 AND "controlCenterId" = $3 AND status = 'published' RETURNING id`,
    [Date.now(), versionId, controlCenterId],
  );
  return (r.rowCount ?? 0) > 0;
}

export interface Problema { gravedad: "error" | "aviso"; mensaje: string }

/** Lo que se puede saber de una versión sin ejecutarla. */
export async function revisarVersion(controlCenterId: number, versionId: number): Promise<Problema[]> {
  const problemas: Problema[] = [];

  const reglas = await db.query(
    `SELECT r.code, r.name, r.priority, r.amount, r.active,
            r."extraDistanceExtraId", r."extraDurationExtraId", r."extraTriggerType",
            r."extraThresholdPercent"
       FROM connect_tariff_rules r
      WHERE r."tariffVersionId" = $1 AND r."controlCenterId" = $2`,
    [versionId, controlCenterId],
  );
  const activas = reglas.rows.filter((r: any) => r.active);
  if (activas.length === 0) {
    problemas.push({ gravedad: "error", mensaje: "la versión no tiene ninguna regla activa" });
  }

  const prioridades = new Map<number, string[]>();
  for (const r of activas) {
    const lista = prioridades.get(r.priority) ?? [];
    lista.push(r.code);
    prioridades.set(r.priority, lista);
  }
  for (const [p, codigos] of prioridades) {
    if (codigos.length > 1) {
      problemas.push({ gravedad: "aviso",
        mensaje: `${codigos.join(" y ")} comparten la prioridad ${p}: si además coinciden en especificidad, el motor avisará de reglas ambiguas` });
    }
  }

  for (const r of activas) {
    if (r.extraTriggerType === "THRESHOLD_PERCENT" && r.extraThresholdPercent == null) {
      problemas.push({ gravedad: "error",
        mensaje: `${r.code} dispara por porcentaje pero no tiene umbral` });
    }
    if (Number(r.amount) === 0) {
      problemas.push({ gravedad: "aviso", mensaje: `${r.code} tiene importe cero` });
    }
  }

  const huerfanos = await db.query(
    `SELECT r.code FROM connect_tariff_rules r
      WHERE r."tariffVersionId" = $1
        AND ((r."extraDistanceExtraId" IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM connect_tariff_extras e WHERE e.id = r."extraDistanceExtraId"
                  AND e."tariffVersionId" = $1))
          OR (r."extraDurationExtraId" IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM connect_tariff_extras e WHERE e.id = r."extraDurationExtraId"
                  AND e."tariffVersionId" = $1)))`,
    [versionId],
  );
  for (const h of huerfanos.rows) {
    problemas.push({ gravedad: "error",
      mensaje: `${h.code} apunta a un suplemento que no está en esta versión` });
  }

  return problemas;
}

// ── Contenido de una versión ────────────────────────────────────────────────

export async function detalleVersion(controlCenterId: number, versionId: number) {
  const v = await db.query(
    `SELECT v.id, v.version, v.status, v."validFromMs", v."validToMs", v.notes,
            p.id AS "planId", p.code AS "planCode", p.name AS "planName",
            p.currency, p.timezone, p."calendarId"
       FROM connect_tariff_versions v
       JOIN connect_tariff_plans p ON p.id = v."tariffPlanId"
      WHERE v.id = $1 AND v."controlCenterId" = $2`,
    [versionId, controlCenterId],
  );
  if (!v.rows[0]) throw new ErrorTarifario("version_no_encontrada", "Versión no encontrada", 404);

  const [reglas, extras, franjas, zonas, dias] = await Promise.all([
    db.query(
      `SELECT r.*, z.code AS "zoneCode", b.code AS "timeBandCode",
              ek.code AS "extraKmCode", et.code AS "extraTimeCode"
         FROM connect_tariff_rules r
         LEFT JOIN connect_tariff_zones z ON z.id = r."zoneId"
         LEFT JOIN connect_tariff_time_bands b ON b.id = r."timeBandId"
         LEFT JOIN connect_tariff_extras ek ON ek.id = r."extraDistanceExtraId"
         LEFT JOIN connect_tariff_extras et ON et.id = r."extraDurationExtraId"
        WHERE r."tariffVersionId" = $1 ORDER BY r.priority DESC, r.id`, [versionId]),
    db.query(`SELECT * FROM connect_tariff_extras WHERE "tariffVersionId" = $1 ORDER BY code`, [versionId]),
    db.query(
      `SELECT b.*, EXISTS (
                SELECT 1 FROM connect_tariff_rules r
                  JOIN connect_tariff_versions vv ON vv.id = r."tariffVersionId"
                 WHERE r."timeBandId" = b.id AND vv.status = 'published') AS "enUsoPublicado"
         FROM connect_tariff_time_bands b
        WHERE b."controlCenterId" = $1 ORDER BY b.code`, [controlCenterId]),
    db.query(
      `SELECT z.*, COALESCE(json_agg(json_build_object('matchType', m."matchType", 'value', m.value))
                            FILTER (WHERE m.id IS NOT NULL), '[]') AS miembros
         FROM connect_tariff_zones z
         LEFT JOIN connect_tariff_zone_members m ON m."zoneId" = z.id
        WHERE z."controlCenterId" = $1 GROUP BY z.id ORDER BY z.code`, [controlCenterId]),
    v.rows[0].calendarId
      ? db.query(
          `SELECT id, date, scope, "dayClass", name, yearly, active, "regionCode", "provinceCode", municipality
             FROM connect_calendar_days WHERE "calendarId" = $1 ORDER BY date`, [v.rows[0].calendarId])
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  return {
    version: fechas(v.rows[0]),
    editable: v.rows[0].status === "draft",
    reglas: reglas.rows,
    extras: extras.rows,
    franjas: franjas.rows.map((b: any) => ({ ...b, desde: hhmm(b.startMinute), hasta: hhmm(b.endMinute) })),
    zonas: zonas.rows,
    calendario: dias.rows,
    problemas: await revisarVersion(controlCenterId, versionId),
  };
}

// ── Reglas ──────────────────────────────────────────────────────────────────

export async function guardarRegla(controlCenterId: number, versionId: number, r: Record<string, any>) {
  await exigirBorrador(controlCenterId, versionId);
  const code = String(r.code ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!code) throw new ErrorTarifario("code_requerido", "La regla necesita un código");
  if (r.extraTriggerType && !DISPAROS.includes(r.extraTriggerType)) {
    throw new ErrorTarifario("disparo_desconocido", `Disparo no reconocido: ${r.extraTriggerType}`);
  }
  if (r.extraTriggerType === "THRESHOLD_PERCENT" && r.extraThresholdPercent == null) {
    throw new ErrorTarifario("umbral_requerido",
      "Un suplemento que dispara por porcentaje necesita su umbral: si no, no se sabría cuándo cobrarlo");
  }

  const now = Date.now();
  const ins = await db.query(
    `INSERT INTO connect_tariff_rules
       ("controlCenterId", "tariffVersionId", code, name, "serviceTypeCode", "vehicleTypeCode",
        "zoneId", "timeBandId", "dayClasses", "minDistanceKm", "maxDistanceKm",
        "minDurationMin", "maxDurationMin", amount, "includedDistanceKm", "includedDurationMin",
        "extraDistanceExtraId", "extraDurationExtraId", "extraTriggerType",
        "extraThresholdPercent", priority, active, notes, "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     ON CONFLICT ("tariffVersionId", code) DO UPDATE SET
       name = EXCLUDED.name, "serviceTypeCode" = EXCLUDED."serviceTypeCode",
       "vehicleTypeCode" = EXCLUDED."vehicleTypeCode", "zoneId" = EXCLUDED."zoneId",
       "timeBandId" = EXCLUDED."timeBandId", "dayClasses" = EXCLUDED."dayClasses",
       "minDistanceKm" = EXCLUDED."minDistanceKm", "maxDistanceKm" = EXCLUDED."maxDistanceKm",
       "minDurationMin" = EXCLUDED."minDurationMin", "maxDurationMin" = EXCLUDED."maxDurationMin",
       amount = EXCLUDED.amount, "includedDistanceKm" = EXCLUDED."includedDistanceKm",
       "includedDurationMin" = EXCLUDED."includedDurationMin",
       "extraDistanceExtraId" = EXCLUDED."extraDistanceExtraId",
       "extraDurationExtraId" = EXCLUDED."extraDurationExtraId",
       "extraTriggerType" = EXCLUDED."extraTriggerType",
       "extraThresholdPercent" = EXCLUDED."extraThresholdPercent",
       priority = EXCLUDED.priority, active = EXCLUDED.active, notes = EXCLUDED.notes
     RETURNING id`,
    [controlCenterId, versionId, code, String(r.name ?? code).trim(),
     vacioANulo(r.serviceTypeCode), vacioANulo(r.vehicleTypeCode),
     numeroONulo(r.zoneId), numeroONulo(r.timeBandId),
     Array.isArray(r.dayClasses) && r.dayClasses.length ? r.dayClasses : null,
     numeroONulo(r.minDistanceKm), numeroONulo(r.maxDistanceKm),
     numeroONulo(r.minDurationMin), numeroONulo(r.maxDurationMin),
     r.amount ?? 0, numeroONulo(r.includedDistanceKm), numeroONulo(r.includedDurationMin),
     numeroONulo(r.extraDistanceExtraId), numeroONulo(r.extraDurationExtraId),
     r.extraTriggerType ?? "ALWAYS", numeroONulo(r.extraThresholdPercent),
     Number(r.priority ?? 0), r.active !== false, vacioANulo(r.notes), now],
  );
  return { id: Number(ins.rows[0].id), code };
}

export async function borrarRegla(controlCenterId: number, versionId: number, reglaId: number) {
  await exigirBorrador(controlCenterId, versionId);
  const r = await db.query(
    `DELETE FROM connect_tariff_rules
      WHERE id = $1 AND "tariffVersionId" = $2 AND "controlCenterId" = $3 RETURNING id`,
    [reglaId, versionId, controlCenterId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ── Suplementos ─────────────────────────────────────────────────────────────

export async function guardarExtra(controlCenterId: number, versionId: number, e: Record<string, any>) {
  await exigirBorrador(controlCenterId, versionId);
  const code = String(e.code ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!code) throw new ErrorTarifario("code_requerido", "El suplemento necesita un código");
  if (!TIPOS_CALCULO.includes(e.calculationType)) {
    throw new ErrorTarifario("calculo_desconocido", `Tipo de cálculo no reconocido: ${e.calculationType}`);
  }
  if (e.calculationType === "PERCENTAGE" && e.percentage == null) {
    throw new ErrorTarifario("porcentaje_requerido", "Un suplemento porcentual necesita su porcentaje");
  }
  if (e.calculationType !== "PERCENTAGE" && e.amount == null) {
    throw new ErrorTarifario("importe_requerido", "Este suplemento necesita un importe");
  }

  const r = await db.query(
    `INSERT INTO connect_tariff_extras
       ("controlCenterId", "tariffVersionId", code, name, "calculationType", amount, percentage,
        unit, "appliesTo", "lineKind", priority, active, "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT ("tariffVersionId", code) DO UPDATE SET
       name = EXCLUDED.name, "calculationType" = EXCLUDED."calculationType",
       amount = EXCLUDED.amount, percentage = EXCLUDED.percentage, unit = EXCLUDED.unit,
       "appliesTo" = EXCLUDED."appliesTo", "lineKind" = EXCLUDED."lineKind",
       priority = EXCLUDED.priority, active = EXCLUDED.active
     RETURNING id`,
    [controlCenterId, versionId, code, String(e.name ?? code).trim(), e.calculationType,
     e.amount ?? null, e.percentage ?? null, vacioANulo(e.unit),
     e.appliesTo ?? "assistance", vacioANulo(e.lineKind),
     Number(e.priority ?? 0), e.active !== false, Date.now()],
  );
  return { id: Number(r.rows[0].id), code };
}

export async function borrarExtra(controlCenterId: number, versionId: number, extraId: number) {
  await exigirBorrador(controlCenterId, versionId);
  const enUso = await db.query(
    `SELECT code FROM connect_tariff_rules
      WHERE "tariffVersionId" = $1
        AND ("extraDistanceExtraId" = $2 OR "extraDurationExtraId" = $2)`,
    [versionId, extraId],
  );
  if (enUso.rows[0]) {
    throw new ErrorTarifario("extra_en_uso",
      `No se puede borrar: lo usan las reglas ${enUso.rows.map((r: any) => r.code).join(", ")}`, 409);
  }
  const r = await db.query(
    `DELETE FROM connect_tariff_extras
      WHERE id = $1 AND "tariffVersionId" = $2 AND "controlCenterId" = $3 RETURNING id`,
    [extraId, versionId, controlCenterId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ── Franjas horarias ────────────────────────────────────────────────────────

/**
 * Alta o edición de una franja.
 *
 * Las franjas cuelgan del centro de control y no de la versión, así que una la
 * comparten varias tarifas. Cambiarle la hora a una que usa una versión ya
 * PUBLICADA alteraría cómo resuelve esa tarifa sin pasar por el duplicado, que
 * es justo la puerta de atrás que el versionado quiere cerrar. Por eso se
 * rechaza y hay que crear otra franja.
 */
export async function guardarFranja(controlCenterId: number, f: Record<string, any>) {
  const code = String(f.code ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!code) throw new ErrorTarifario("code_requerido", "La franja necesita un código");
  if (f.weekdayAnchor && !ANCLAJES.includes(f.weekdayAnchor)) {
    throw new ErrorTarifario("anclaje_desconocido", `Anclaje no reconocido: ${f.weekdayAnchor}`);
  }

  // minutosDeHora lanza con una hora mal escrita; aquí eso es un 400 del
  // usuario, no un fallo del servidor.
  let desde: number;
  let hasta: number;
  try {
    desde = minutosDeHora(String(f.desde ?? ""));
    hasta = minutosDeHora(String(f.hasta ?? ""));
  } catch {
    throw new ErrorTarifario("horas_invalidas", 'Las horas van en formato "19:00"');
  }
  if (desde === hasta) {
    throw new ErrorTarifario("franja_vacia", "Una franja que empieza y acaba a la misma hora no cubre nada");
  }

  const existente = await db.query(
    `SELECT b.id, EXISTS (
              SELECT 1 FROM connect_tariff_rules r
                JOIN connect_tariff_versions v ON v.id = r."tariffVersionId"
               WHERE r."timeBandId" = b.id AND v.status = 'published') AS "enUsoPublicado"
       FROM connect_tariff_time_bands b
      WHERE b."controlCenterId" = $1 AND b.code = $2`,
    [controlCenterId, code],
  );
  if (existente.rows[0]?.enUsoPublicado) {
    throw new ErrorTarifario("franja_publicada",
      `La franja ${code} la usa una tarifa ya publicada. Cambiarla alteraría cómo se resuelve esa tarifa: ` +
      `crea otra franja con otro código y apunta la regla del borrador a la nueva.`, 409);
  }

  const dias = Array.isArray(f.weekdays) && f.weekdays.length
    ? f.weekdays.map(Number).filter((d: number) => d >= 1 && d <= 7)
    : [1, 2, 3, 4, 5, 6, 7];

  const r = await db.query(
    `INSERT INTO connect_tariff_time_bands
       ("controlCenterId", code, name, "startMinute", "endMinute", weekdays, "weekdayAnchor", active, "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT ("controlCenterId", code) DO UPDATE SET
       name = EXCLUDED.name, "startMinute" = EXCLUDED."startMinute",
       "endMinute" = EXCLUDED."endMinute", weekdays = EXCLUDED.weekdays,
       "weekdayAnchor" = EXCLUDED."weekdayAnchor", active = EXCLUDED.active
     RETURNING id`,
    [controlCenterId, code, String(f.name ?? code).trim(), desde, hasta,
     dias, f.weekdayAnchor ?? "moment", f.active !== false, Date.now()],
  );
  return { id: Number(r.rows[0].id), code, desde: hhmm(desde), hasta: hhmm(hasta) };
}

// ── Zonas ───────────────────────────────────────────────────────────────────

export async function guardarZona(controlCenterId: number, z: Record<string, any>) {
  const code = String(z.code ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!code) throw new ErrorTarifario("code_requerido", "La zona necesita un código");

  const existente = await db.query(
    `SELECT z.id, EXISTS (
              SELECT 1 FROM connect_tariff_rules r
                JOIN connect_tariff_versions v ON v.id = r."tariffVersionId"
               WHERE r."zoneId" = z.id AND v.status = 'published') AS "enUsoPublicado"
       FROM connect_tariff_zones z WHERE z."controlCenterId" = $1 AND z.code = $2`,
    [controlCenterId, code],
  );
  if (existente.rows[0]?.enUsoPublicado) {
    throw new ErrorTarifario("zona_publicada",
      `La zona ${code} la usa una tarifa ya publicada. Crea otra zona en lugar de cambiar esta.`, 409);
  }

  const r = await db.query(
    `INSERT INTO connect_tariff_zones ("controlCenterId", code, name, type, priority, active, "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT ("controlCenterId", code) DO UPDATE SET
       name = EXCLUDED.name, type = EXCLUDED.type, priority = EXCLUDED.priority, active = EXCLUDED.active
     RETURNING id`,
    [controlCenterId, code, String(z.name ?? code).trim(), z.type ?? "CUSTOM",
     Number(z.priority ?? 0), z.active !== false, Date.now()],
  );
  const zonaId = Number(r.rows[0].id);

  if (Array.isArray(z.miembros)) {
    await db.query(`DELETE FROM connect_tariff_zone_members WHERE "zoneId" = $1`, [zonaId]);
    for (const m of z.miembros) {
      if (!m?.matchType || !m?.value) continue;
      await db.query(
        `INSERT INTO connect_tariff_zone_members ("zoneId", "matchType", value) VALUES ($1,$2,$3)`,
        [zonaId, m.matchType, String(m.value).trim().toUpperCase()]);
    }
  }
  return { id: zonaId, code };
}

// ── Calendario ──────────────────────────────────────────────────────────────

export async function guardarDiaCalendario(controlCenterId: number, calendarId: number, d: Record<string, any>) {
  const propio = await db.query(
    `SELECT id FROM connect_calendars WHERE id = $1 AND "controlCenterId" = $2`,
    [calendarId, controlCenterId]);
  if (!propio.rows[0]) throw new ErrorTarifario("calendario_no_encontrado", "Calendario no encontrado", 404);

  const r = await db.query(
    `INSERT INTO connect_calendar_days
       ("calendarId", date, scope, "regionCode", "provinceCode", municipality,
        "dayClass", name, yearly, active, "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT ("calendarId", date, scope, "dayClass",
                  COALESCE("regionCode", ''), COALESCE("provinceCode", ''), COALESCE(municipality, ''))
     DO UPDATE SET name = EXCLUDED.name, yearly = EXCLUDED.yearly, active = EXCLUDED.active
     RETURNING id`,
    [calendarId, d.date, d.scope ?? "national", vacioANulo(d.regionCode), vacioANulo(d.provinceCode),
     vacioANulo(d.municipality), d.dayClass ?? "holiday", vacioANulo(d.name),
     d.yearly === true, d.active !== false, Date.now()],
  );
  return { id: Number(r.rows[0].id) };
}

export async function borrarDiaCalendario(controlCenterId: number, calendarId: number, diaId: number) {
  const r = await db.query(
    `DELETE FROM connect_calendar_days d
      USING connect_calendars c
      WHERE d.id = $1 AND d."calendarId" = c.id
        AND c.id = $2 AND c."controlCenterId" = $3 RETURNING d.id`,
    [diaId, calendarId, controlCenterId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ── Comunes ─────────────────────────────────────────────────────────────────

async function exigirBorrador(controlCenterId: number, versionId: number): Promise<void> {
  const r = await db.query(
    `SELECT status FROM connect_tariff_versions WHERE id = $1 AND "controlCenterId" = $2`,
    [versionId, controlCenterId],
  );
  if (!r.rows[0]) throw new ErrorTarifario("version_no_encontrada", "Versión no encontrada", 404);
  if (r.rows[0].status !== "draft") {
    throw new ErrorTarifario("version_publicada",
      "Esta versión ya está publicada y no se puede tocar: duplícala y edita la copia. " +
      "Cambiarla alteraría el importe de asistencias ya facturadas con ella.", 409);
  }
}

const vacioANulo = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const numeroONulo = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function fechas(v: any) {
  if (!v) return v;
  return {
    ...v,
    validFromMs: v.validFromMs == null ? null : Number(v.validFromMs),
    validToMs: v.validToMs == null ? null : Number(v.validToMs),
    publishedAtMs: v.publishedAtMs == null ? null : Number(v.publishedAtMs),
  };
}
