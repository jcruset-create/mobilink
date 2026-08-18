/**
 * El calendario de los TALLERES, que no es el de la central.
 *
 * La central trabaja 365 días 24 horas: su calendario no cierra nunca. Los que
 * cierran —o cobran distinto— son los talleres, cada uno con los festivos de su
 * comunidad autónoma y los dos o tres de su municipio.
 *
 * Eso importa en el momento de asignar. Cuando el operador va a avisar a un
 * taller un 5 de agosto, tiene que ver que en ese pueblo es fiesta local antes
 * de llamar, no después: con esa información puede elegir otro taller cercano
 * que sí esté trabajando, y de paso más barato.
 *
 * Dos criterios:
 *
 *  1. **Lo autonómico se guarda una vez por comunidad, no una vez por taller.**
 *     Repetir el festivo de Aragón en cada taller de Zaragoza haría que
 *     corregir la fecha fuera corregirla catorce veces.
 *
 *  2. **Un taller sin comunidad reconocida se dice, no se calla.** Si la
 *     provincia viene escrita de una forma que no se reconoce, ese taller se
 *     queda sin festivos autonómicos y hay que verlo. Un taller que parece
 *     abierto porque no sabemos que está cerrado es peor que uno marcado como
 *     desconocido.
 */

import db from "../db.ts";
import { regionDeProvincia, nombreRegion } from "./regiones.ts";

export type AmbitoFestivo = "national" | "regional" | "local";

export interface FestivoTaller {
  ambito: AmbitoFestivo;
  fecha: string;
  nombre: string | null;
}

export interface CalendarioTaller {
  workshopId: number;
  regionCode: string | null;
  regionName: string | null;
  /** true si ese día es festivo por cualquier vía. */
  esFestivo: boolean;
  festivos: FestivoTaller[];
  /** Para poder avisar de que a este taller le faltan sus autonómicos. */
  regionDesconocida: boolean;
}

const iso = (d: Date | string): string =>
  typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/**
 * Rellena la comunidad autónoma de los talleres a partir de su provincia.
 *
 * Se guarda resuelta en lugar de deducirla en cada consulta porque la
 * provincia llega como texto libre —de importaciones, de WhatsApp, de altas a
 * mano— y hay que poder corregir a mano el taller que no se reconozca.
 */
export async function resolverRegiones(controlCenterId: number): Promise<{
  actualizados: number; sinReconocer: { id: number; name: string; province: string | null }[];
}> {
  const r = await db.query(
    `SELECT w.id, w.name, w.province, w."regionCode"
       FROM connect_workshops w
       JOIN connect_provider_authorizations a ON a."providerCompanyId" = w."providerCompanyId"
      WHERE a."controlCenterId" = $1`,
    [controlCenterId],
  );

  let actualizados = 0;
  const sinReconocer: { id: number; name: string; province: string | null }[] = [];

  for (const w of r.rows) {
    const code = regionDeProvincia(w.province);
    if (!code) {
      sinReconocer.push({ id: w.id, name: w.name, province: w.province ?? null });
      continue;
    }
    if (w.regionCode !== code) {
      await db.query(`UPDATE connect_workshops SET "regionCode" = $1 WHERE id = $2`, [code, w.id]);
      actualizados++;
    }
  }
  return { actualizados, sinReconocer };
}

/**
 * Qué festivos le tocan a cada taller en una fecha.
 *
 * Se resuelve para varios talleres de una vez porque quien lo pregunta es el
 * comparador de candidatos, que tiene diez delante y no puede hacer diez
 * viajes a la base.
 */
export async function calendarioDeTalleres(
  controlCenterId: number,
  workshopIds: number[],
  fecha: Date | string,
): Promise<Map<number, CalendarioTaller>> {
  const salida = new Map<number, CalendarioTaller>();
  if (workshopIds.length === 0) return salida;

  const dia = iso(fecha);

  const talleres = await db.query(
    `SELECT id, "regionCode", province FROM connect_workshops WHERE id = ANY($1::int[])`,
    [workshopIds],
  );

  /*
   * Los nacionales salen del calendario de la central: son los mismos para
   * todos sus talleres. Se leen aquí y no del motor de tarifas porque esto es
   * una pregunta operativa —¿está abierto?— y no de precio.
   */
  const nacionales = await db.query(
    `SELECT DISTINCT d.name
       FROM connect_calendar_days d
       JOIN connect_calendars c ON c.id = d."calendarId"
      WHERE c."controlCenterId" = $1 AND d.active
        AND d.scope IN ('national', 'special')
        AND (d.date = $2::date
             OR (d.yearly AND EXTRACT(MONTH FROM d.date) = EXTRACT(MONTH FROM $2::date)
                          AND EXTRACT(DAY FROM d.date) = EXTRACT(DAY FROM $2::date)))`,
    [controlCenterId, dia],
  );

  const propios = await db.query(
    `SELECT scope, "regionCode", "workshopId", name
       FROM connect_workshop_holidays
      WHERE "controlCenterId" = $1 AND date = $2::date`,
    [controlCenterId, dia],
  );

  const porRegion = new Map<string, string[]>();
  const porTaller = new Map<number, string[]>();
  for (const f of propios.rows) {
    if (f.scope === "regional" && f.regionCode) {
      porRegion.set(f.regionCode, [...(porRegion.get(f.regionCode) ?? []), f.name ?? "Festivo autonómico"]);
    } else if (f.scope === "local" && f.workshopId != null) {
      const id = Number(f.workshopId);
      porTaller.set(id, [...(porTaller.get(id) ?? []), f.name ?? "Fiesta local"]);
    }
  }

  for (const w of talleres.rows) {
    const id = Number(w.id);
    // Si nadie lo ha resuelto todavía, se intenta al vuelo con la provincia
    const region = w.regionCode ?? regionDeProvincia(w.province);
    const festivos: FestivoTaller[] = [];

    for (const n of nacionales.rows) {
      festivos.push({ ambito: "national", fecha: dia, nombre: n.name ?? "Festivo nacional" });
    }
    for (const n of (region ? porRegion.get(region) ?? [] : [])) {
      festivos.push({ ambito: "regional", fecha: dia, nombre: n });
    }
    for (const n of porTaller.get(id) ?? []) {
      festivos.push({ ambito: "local", fecha: dia, nombre: n });
    }

    salida.set(id, {
      workshopId: id,
      regionCode: region ?? null,
      regionName: nombreRegion(region),
      esFestivo: festivos.length > 0,
      festivos,
      regionDesconocida: region == null,
    });
  }

  return salida;
}

// ── Mantenimiento ───────────────────────────────────────────────────────────

export async function listarFestivos(controlCenterId: number, p: {
  desde?: string | null; hasta?: string | null; workshopId?: number | null;
} = {}) {
  const r = await db.query(
    `SELECT h.id, h.scope, h."regionCode", h."workshopId", h.date, h.name,
            w.name AS "workshopName", w.city, w.province
       FROM connect_workshop_holidays h
       LEFT JOIN connect_workshops w ON w.id = h."workshopId"
      WHERE h."controlCenterId" = $1
        AND ($2::date IS NULL OR h.date >= $2::date)
        AND ($3::date IS NULL OR h.date <= $3::date)
        AND ($4::int IS NULL OR h."workshopId" = $4)
      ORDER BY h.date, h.scope`,
    [controlCenterId, p.desde ?? null, p.hasta ?? null, p.workshopId ?? null],
  );
  return r.rows.map((x: any) => ({ ...x, date: iso(x.date), regionName: nombreRegion(x.regionCode) }));
}

export class ErrorCalendarioTaller extends Error {
  constructor(readonly codigo: string, mensaje: string, readonly estado = 400) {
    super(mensaje);
  }
}

/**
 * Alta de festivos, uno o muchos.
 *
 * En lote porque así llegan: los festivos de una comunidad son doce o catorce
 * de golpe, publicados en un boletín, y los locales de un taller son dos. De
 * uno en uno no los mete nadie.
 */
export async function guardarFestivos(
  controlCenterId: number,
  entradas: { scope: string; regionCode?: string | null; workshopId?: number | null;
              date: string; name?: string | null }[],
): Promise<{ escritos: number; errores: string[] }> {
  const errores: string[] = [];
  const validas: typeof entradas = [];

  for (const e of entradas) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date ?? ""))) {
      errores.push(`Fecha no válida: ${e.date}`);
      continue;
    }
    if (e.scope === "regional" && !e.regionCode) {
      errores.push(`${e.date}: un festivo autonómico necesita la comunidad`);
      continue;
    }
    if (e.scope === "local" && !e.workshopId) {
      errores.push(`${e.date}: una fiesta local necesita el taller`);
      continue;
    }
    if (e.scope !== "regional" && e.scope !== "local") {
      errores.push(`${e.date}: ámbito no reconocido (${e.scope})`);
      continue;
    }
    validas.push(e);
  }

  if (errores.length > 0) return { escritos: 0, errores };

  const now = Date.now();
  let escritos = 0;
  for (const e of validas) {
    const r = await db.query(
      `INSERT INTO connect_workshop_holidays
         ("controlCenterId", scope, "regionCode", "workshopId", date, name, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5::date,$6,$7)
       ON CONFLICT ("controlCenterId", date, scope, COALESCE("regionCode", ''), COALESCE("workshopId", 0))
       DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [controlCenterId, e.scope,
       e.scope === "regional" ? e.regionCode : null,
       e.scope === "local" ? e.workshopId : null,
       e.date, e.name ?? null, now],
    );
    if (r.rows[0]) escritos++;
  }
  return { escritos, errores: [] };
}

export async function borrarFestivo(controlCenterId: number, id: number): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM connect_workshop_holidays WHERE id = $1 AND "controlCenterId" = $2 RETURNING id`,
    [id, controlCenterId],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Talleres agrupados por comunidad, con cuántos festivos tiene cargados cada
 * una. Es la pantalla que dice dónde falta trabajo: una comunidad con catorce
 * talleres y cero festivos es una comunidad cuyos talleres van a parecer
 * abiertos todos los días del año.
 */
export async function coberturaPorRegion(controlCenterId: number, anio: number) {
  const r = await db.query(
    `SELECT w."regionCode", COUNT(DISTINCT w.id)::int AS talleres,
            (SELECT COUNT(*)::int FROM connect_workshop_holidays h
              WHERE h."controlCenterId" = $1 AND h.scope = 'regional'
                AND h."regionCode" = w."regionCode"
                AND EXTRACT(YEAR FROM h.date) = $2) AS "festivosAutonomicos",
            (SELECT COUNT(*)::int FROM connect_workshop_holidays h
              WHERE h."controlCenterId" = $1 AND h.scope = 'local'
                AND h."workshopId" IN (
                  SELECT w2.id FROM connect_workshops w2
                   WHERE w2."regionCode" IS NOT DISTINCT FROM w."regionCode"
                     AND w2."providerCompanyId" = ANY(
                       SELECT a2."providerCompanyId" FROM connect_provider_authorizations a2
                        WHERE a2."controlCenterId" = $1))
                AND EXTRACT(YEAR FROM h.date) = $2) AS "festivosLocales"
       FROM connect_workshops w
       JOIN connect_provider_authorizations a ON a."providerCompanyId" = w."providerCompanyId"
      WHERE a."controlCenterId" = $1
      GROUP BY w."regionCode"
      ORDER BY talleres DESC`,
    [controlCenterId, anio],
  );

  return r.rows.map((x: any) => ({
    regionCode: x.regionCode,
    regionName: nombreRegion(x.regionCode),
    talleres: x.talleres,
    festivosAutonomicos: x.festivosAutonomicos,
    festivosLocales: x.festivosLocales,
    // Sin autonómicos cargados, esos talleres parecerán abiertos todo el año
    aviso: x.regionCode == null
      ? "Talleres sin comunidad reconocida: no tendrán festivos autonómicos"
      : x.festivosAutonomicos === 0
        ? "Sin festivos autonómicos cargados para este año"
        : null,
  }));
}
