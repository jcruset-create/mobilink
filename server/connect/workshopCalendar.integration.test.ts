/**
 * El calendario de los talleres, contra PostgreSQL.
 *
 * Lo que se fija aquí: que el operador vea que en el pueblo de ese taller es
 * fiesta ANTES de llamar. El caso que da sentido a todo el fichero es el
 * último: dos talleres a la misma distancia, uno de fiesta local y el otro no.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let wc: typeof import("./workshopCalendar.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let centroId = 0;
let otroCentroId = 0;
let empresaId = 0;
let zaragozaA = 0;
let zaragozaB = 0;
let barcelona = 0;
let sinProvincia = 0;

async function taller(nombre: string, provincia: string | null, ciudad: string): Promise<number> {
  const r = await db.query(
    `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", province, city,
                                    "createdAtMs", "updatedAtMs")
     VALUES ($1,41.6,-0.9,$2,$3,$4,$5,$5) RETURNING id`,
    [`${nombre} ${sufijo}`, empresaId, provincia, ciudad, now]);
  return Number(r.rows[0].id);
}

describe.skipIf(!RUN)("Calendario de los talleres", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    wc = await import("./workshopCalendar.ts");

    const centro = async (e: string) => {
      const r = await db.query(
        `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$3) RETURNING id`,
        [`cc-wc-${e}-${sufijo}`, `Central ${e} ${sufijo}`, now]);
      return Number(r.rows[0].id);
    };
    centroId = await centro("a");
    otroCentroId = await centro("b");

    const em = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`pr-wc-${sufijo}`, `Proveedora ${sufijo}`, now]);
    empresaId = Number(em.rows[0].id);

    await db.query(
      `INSERT INTO connect_provider_authorizations ("controlCenterId", "providerCompanyId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3)`, [centroId, empresaId, now]).catch(async () => {
        await db.query(
          `INSERT INTO connect_provider_authorizations ("controlCenterId", "providerCompanyId", "createdAtMs")
           VALUES ($1,$2,$3)`, [centroId, empresaId, now]);
      });

    zaragozaA = await taller("Taller Zaragoza A", "Zaragoza", "Zaragoza");
    zaragozaB = await taller("Taller Zaragoza B", "Zaragoza", "Utebo");
    barcelona = await taller("Taller Barcelona", "Barcelona", "Sabadell");
    sinProvincia = await taller("Taller sin sitio", null, "");
  }, 60_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    for (const c of [centroId, otroCentroId]) {
      await db.query(`DELETE FROM connect_workshop_holidays WHERE "controlCenterId" = $1`, [c]).catch(() => {});
      await db.query(`DELETE FROM connect_calendars WHERE "controlCenterId" = $1`, [c]).catch(() => {});
    }
    await db.query(`DELETE FROM connect_provider_authorizations WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    for (const w of [zaragozaA, zaragozaB, barcelona, sinProvincia]) {
      await db.query(`DELETE FROM connect_workshops WHERE id = $1`, [w]).catch(() => {});
    }
    await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [empresaId]).catch(() => {});
    for (const c of [centroId, otroCentroId]) {
      await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [c]).catch(() => {});
    }
  }, 30_000);

  it("la comunidad de cada taller se resuelve desde su provincia", async () => {
    const r = await wc.resolverRegiones(centroId);
    expect(r.actualizados).toBeGreaterThanOrEqual(3);

    const filas = await db.query(
      `SELECT id, "regionCode" FROM connect_workshops WHERE id = ANY($1::int[])`,
      [[zaragozaA, barcelona]]);
    const porId = new Map(filas.rows.map((x: any) => [Number(x.id), x.regionCode]));
    expect(porId.get(zaragozaA)).toBe("AR");
    expect(porId.get(barcelona)).toBe("CT");
  });

  it("el taller cuya provincia no se reconoce se señala, no se adivina", async () => {
    /*
     * Adivinarle una comunidad le daría los festivos de otro sitio y nadie lo
     * notaría hasta llamar a un taller cerrado.
     */
    const r = await wc.resolverRegiones(centroId);
    expect(r.sinReconocer.map((x) => x.id)).toContain(sinProvincia);
  });

  it("un festivo autonómico vale para todos los talleres de esa comunidad", async () => {
    // Se guarda UNA vez, no una por taller: corregir la fecha es corregirla una vez
    await wc.guardarFestivos(centroId, [
      { scope: "regional", regionCode: "AR", date: "2026-04-23", name: "San Jorge" },
    ]);

    const cal = await wc.calendarioDeTalleres(centroId, [zaragozaA, zaragozaB, barcelona], "2026-04-23");
    expect(cal.get(zaragozaA)!.esFestivo).toBe(true);
    expect(cal.get(zaragozaB)!.esFestivo).toBe(true);
    expect(cal.get(zaragozaA)!.festivos[0]).toMatchObject({ ambito: "regional", nombre: "San Jorge" });

    // En Barcelona ese día se trabaja
    expect(cal.get(barcelona)!.esFestivo).toBe(false);
  });

  it("una fiesta local es solo del taller que la declara", async () => {
    await wc.guardarFestivos(centroId, [
      { scope: "local", workshopId: zaragozaA, date: "2026-10-13", name: "Fiestas del Pilar" },
    ]);

    const cal = await wc.calendarioDeTalleres(centroId, [zaragozaA, zaragozaB], "2026-10-13");
    expect(cal.get(zaragozaA)!.esFestivo).toBe(true);
    expect(cal.get(zaragozaA)!.festivos[0].ambito).toBe("local");
    // El de Utebo está a diez kilómetros y ese día abre
    expect(cal.get(zaragozaB)!.esFestivo).toBe(false);
  });

  it("los nacionales del calendario de la central valen para todos", async () => {
    const cal = await db.query(
      `INSERT INTO connect_calendars ("controlCenterId", code, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`, [centroId, `NAC_${sufijo}`, "Nacional", now]);
    await db.query(
      `INSERT INTO connect_calendar_days ("calendarId", date, scope, name, yearly, "createdAtMs")
       VALUES ($1,'2026-08-15','national','Asunción',true,$2)`, [cal.rows[0].id, now]);

    const r = await wc.calendarioDeTalleres(centroId, [zaragozaA, barcelona], "2026-08-15");
    expect(r.get(zaragozaA)!.esFestivo).toBe(true);
    expect(r.get(barcelona)!.festivos[0]).toMatchObject({ ambito: "national", nombre: "Asunción" });
  });

  it("un festivo anual se repite el año siguiente sin volver a cargarlo", async () => {
    const r = await wc.calendarioDeTalleres(centroId, [zaragozaA], "2027-08-15");
    expect(r.get(zaragozaA)!.esFestivo).toBe(true);
  });

  it("un taller sin comunidad reconocida se marca para que se vea", async () => {
    const cal = await wc.calendarioDeTalleres(centroId, [sinProvincia], "2026-04-23");
    expect(cal.get(sinProvincia)!.regionDesconocida).toBe(true);
    expect(cal.get(sinProvincia)!.regionCode).toBeNull();
  });

  it("los festivos de una central no se ven desde otra", async () => {
    const cal = await wc.calendarioDeTalleres(otroCentroId, [zaragozaA], "2026-04-23");
    expect(cal.get(zaragozaA)!.esFestivo).toBe(false);
    expect(await wc.borrarFestivo(otroCentroId, 999_999)).toBe(false);
  });

  it("un alta con la fecha mal escrita no escribe nada y dice cuál", async () => {
    const r = await wc.guardarFestivos(centroId, [
      { scope: "regional", regionCode: "CT", date: "2026-09-11", name: "Diada" },
      { scope: "regional", regionCode: "CT", date: "11/09/2026", name: "Diada mal escrita" },
    ]);
    expect(r.escritos).toBe(0);
    expect(r.errores[0]).toContain("11/09/2026");

    const cal = await wc.calendarioDeTalleres(centroId, [barcelona], "2026-09-11");
    expect(cal.get(barcelona)!.esFestivo).toBe(false);
  });

  it("un autonómico sin comunidad y una local sin taller se rechazan", async () => {
    const r = await wc.guardarFestivos(centroId, [
      { scope: "regional", date: "2026-05-02", name: "Sin comunidad" },
    ]);
    expect(r.errores[0]).toContain("comunidad");

    const r2 = await wc.guardarFestivos(centroId, [
      { scope: "local", date: "2026-05-02", name: "Sin taller" },
    ]);
    expect(r2.errores[0]).toContain("taller");
  });

  it("la cobertura dice en qué comunidad faltan festivos por cargar", async () => {
    /*
     * Una comunidad con talleres y sin festivos es una comunidad cuyos talleres
     * van a parecer abiertos todos los días del año.
     */
    const c = await wc.coberturaPorRegion(centroId, 2026);
    const aragon = c.find((x) => x.regionCode === "AR")!;
    expect(aragon.talleres).toBe(2);
    expect(aragon.festivosAutonomicos).toBeGreaterThanOrEqual(1);
    expect(aragon.aviso).toBeNull();

    const desconocida = c.find((x) => x.regionCode == null);
    expect(desconocida?.aviso).toContain("sin comunidad reconocida");
  });

  it("el caso que da sentido a todo: dos talleres cerca, uno de fiesta", async () => {
    /*
     * Zaragoza capital está de Pilar el 13 de octubre; Utebo, a diez
     * kilómetros, trabaja. El operador tiene que ver eso antes de llamar para
     * poder mandar el servicio al segundo.
     */
    const cal = await wc.calendarioDeTalleres(centroId, [zaragozaA, zaragozaB], "2026-10-13");
    const abiertos = [...cal.values()].filter((c) => !c.esFestivo);
    expect(abiertos).toHaveLength(1);
    expect(abiertos[0].workshopId).toBe(zaragozaB);
  });
});
