/**
 * Administración del tarifario desde el panel, contra PostgreSQL.
 *
 * Lo que se fija aquí es la promesa que sostiene todo el versionado: **una
 * versión publicada no se toca**. Ni por la puerta principal ni por la de
 * atrás, que es cambiarle la hora a una franja compartida y alterar así cómo
 * resuelve una tarifa que ya está facturando.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAS_2026_VENTA } from "./tarifarios/seas2026.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let ta: typeof import("./tariffAdmin.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const ENERO_2026 = Date.parse("2026-01-01T00:00:00Z");
const ENERO_2027 = Date.parse("2027-01-01T00:00:00Z");

let centroId = 0;
let otroCentroId = 0;
let planId = 0;
let versionPublicada = 0;

describe.skipIf(!RUN)("Administración del tarifario", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    ta = await import("./tariffAdmin.ts");
    const { cargarTarifario, publicarVersion } = await import("./tarifario.ts");

    const centro = async (e: string) => {
      const r = await db.query(
        `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$3) RETURNING id`,
        [`cc-ta-${e}-${sufijo}`, `Central ${e} ${sufijo}`, now]);
      return Number(r.rows[0].id);
    };
    centroId = await centro("a");
    otroCentroId = await centro("b");

    const v = await cargarTarifario(centroId, { ...SEAS_2026_VENTA, code: `TA_${sufijo}` });
    planId = v.tariffPlanId;
    versionPublicada = v.tariffVersionId;
    await publicarVersion(versionPublicada, null);
  }, 90_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    for (const c of [centroId, otroCentroId]) {
      for (const sql of [
        `DELETE FROM connect_tariff_plans WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_calendars WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_time_bands WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_zones WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tire_brands WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tire_sizes WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_control_centers WHERE id = $1`,
      ]) await db.query(sql, [c]).catch(() => {});
    }
  }, 30_000);

  // ── La promesa del versionado ────────────────────────────────────────────

  it("una versión publicada no admite cambios en sus reglas", async () => {
    await expect(ta.guardarRegla(centroId, versionPublicada, {
      code: "DIURNO", name: "Diurno", amount: "250", priority: 40,
    })).rejects.toMatchObject({ codigo: "version_publicada", estado: 409 });
  });

  it("ni borrar una regla, ni tocar sus fechas", async () => {
    const reglas = await db.query(
      `SELECT id FROM connect_tariff_rules WHERE "tariffVersionId" = $1 LIMIT 1`, [versionPublicada]);
    await expect(ta.borrarRegla(centroId, versionPublicada, Number(reglas.rows[0].id)))
      .rejects.toMatchObject({ codigo: "version_publicada" });
    await expect(ta.editarVersion(centroId, versionPublicada, { notes: "otra cosa" }))
      .rejects.toMatchObject({ codigo: "version_publicada" });
  });

  it("duplicar copia reglas, suplementos, grupos y neumáticos, y remapea las referencias", async () => {
    const d = await ta.duplicarVersion(centroId, versionPublicada, {
      version: `2027-${sufijo}`, validFromMs: ENERO_2027,
    });
    expect(d.status).toBe("draft");
    expect(d.copiado.reglas).toBe(SEAS_2026_VENTA.reglas.length);
    expect(d.copiado.extras).toBe(SEAS_2026_VENTA.extras.length);
    expect(d.copiado.neumaticos).toBeGreaterThan(50);

    /*
     * Lo que de verdad hay que comprobar: que las reglas de la copia apuntan a
     * los suplementos de la COPIA y no a los del original. Es lo que sale mal
     * al duplicar a mano con SQL, y no se nota hasta que alguien borra la
     * versión vieja.
     */
    const cruzadas = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_tariff_rules r
         JOIN connect_tariff_extras e ON e.id = r."extraDistanceExtraId"
        WHERE r."tariffVersionId" = $1 AND e."tariffVersionId" <> $1`,
      [d.id]);
    expect(cruzadas.rows[0].n).toBe(0);

    const conExtra = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_tariff_rules
        WHERE "tariffVersionId" = $1 AND "extraDistanceExtraId" IS NOT NULL`, [d.id]);
    expect(conExtra.rows[0].n).toBe(SEAS_2026_VENTA.reglas.length);

    // Y los precios de neumático de la copia apuntan a los grupos de la copia
    const gruposCruzados = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_tariff_tire_prices p
         JOIN connect_tire_brand_groups g ON g.id = p."brandGroupId"
        WHERE p."tariffVersionId" = $1 AND g."tariffVersionId" <> $1`, [d.id]);
    expect(gruposCruzados.rows[0].n).toBe(0);
  });

  it("el borrador SÍ se edita, y el original se queda como estaba", async () => {
    const d = await ta.duplicarVersion(centroId, versionPublicada, {
      version: `edit-${sufijo}`, validFromMs: ENERO_2027,
    });
    await ta.guardarRegla(centroId, d.id, {
      code: "DIURNO", name: "Diurno", amount: "250", priority: 40,
    });

    const copia = await db.query(
      `SELECT amount FROM connect_tariff_rules WHERE "tariffVersionId" = $1 AND code = 'DIURNO'`, [d.id]);
    expect(Number(copia.rows[0].amount)).toBe(250);

    const original = await db.query(
      `SELECT amount FROM connect_tariff_rules WHERE "tariffVersionId" = $1 AND code = 'DIURNO'`,
      [versionPublicada]);
    expect(Number(original.rows[0].amount)).toBe(198);
  });

  it("no se puede duplicar con una etiqueta de versión que ya existe", async () => {
    await expect(ta.duplicarVersion(centroId, versionPublicada, {
      version: SEAS_2026_VENTA.version, validFromMs: ENERO_2027,
    })).rejects.toMatchObject({ codigo: "version_duplicada", estado: 409 });
  });

  // ── La puerta de atrás: franjas y zonas compartidas ──────────────────────

  it("una franja que usa una tarifa publicada no se deja cambiar", async () => {
    /*
     * Las franjas cuelgan del centro, no de la versión. Cambiarle la hora al
     * nocturno alteraría cómo resuelve la tarifa YA publicada sin pasar por el
     * duplicado, que es justo lo que el versionado quiere impedir.
     */
    await expect(ta.guardarFranja(centroId, {
      code: "NOCTURNO", name: "Nocturno", desde: "20:00", hasta: "07:00",
    })).rejects.toMatchObject({ codigo: "franja_publicada", estado: 409 });
  });

  it("pero se puede crear otra franja nueva sin problema", async () => {
    const f = await ta.guardarFranja(centroId, {
      code: `MADRUGADA_${sufijo}`, name: "Madrugada", desde: "02:00", hasta: "06:00",
      weekdays: [1, 2, 3, 4, 5],
    });
    expect(f.desde).toBe("02:00");
    expect(f.hasta).toBe("06:00");

    // Y editarla mientras no la use nada publicado
    const otra = await ta.guardarFranja(centroId, {
      code: `MADRUGADA_${sufijo}`, name: "Madrugada", desde: "01:00", hasta: "06:00",
    });
    expect(otra.id).toBe(f.id);
    expect(otra.desde).toBe("01:00");
  });

  it("una franja con horas mal escritas da un error de usuario, no un fallo del servidor", async () => {
    await expect(ta.guardarFranja(centroId, { code: `X_${sufijo}`, desde: "25:99", hasta: "08:00" }))
      .rejects.toMatchObject({ codigo: "horas_invalidas", estado: 400 });
    await expect(ta.guardarFranja(centroId, { code: `Y_${sufijo}`, desde: "08:00", hasta: "08:00" }))
      .rejects.toMatchObject({ codigo: "franja_vacia" });
  });

  // ── Revisión antes de publicar ───────────────────────────────────────────

  it("no se publica una versión sin reglas activas", async () => {
    const p = await ta.crearPlan(centroId, { code: `VACIO_${sufijo}`, name: "Vacío" });
    const v = await db.query(
      `INSERT INTO connect_tariff_versions
         ("controlCenterId", "tariffPlanId", version, "validFromMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'1',$3,$4,$4) RETURNING id`, [centroId, p.id, ENERO_2026, now]);

    await expect(ta.publicar(centroId, Number(v.rows[0].id), null))
      .rejects.toMatchObject({ codigo: "version_con_errores" });
  });

  it("no se publica una regla que dispara por porcentaje sin umbral", async () => {
    const p = await ta.crearPlan(centroId, { code: `SINUMBRAL_${sufijo}`, name: "Sin umbral" });
    const v = await db.query(
      `INSERT INTO connect_tariff_versions
         ("controlCenterId", "tariffPlanId", version, "validFromMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'1',$3,$4,$4) RETURNING id`, [centroId, p.id, ENERO_2026, now]);
    const versionId = Number(v.rows[0].id);

    // El propio guardado ya lo impide
    await expect(ta.guardarRegla(centroId, versionId, {
      code: "R1", name: "Regla", amount: "100", extraTriggerType: "THRESHOLD_PERCENT",
    })).rejects.toMatchObject({ codigo: "umbral_requerido" });

    // Y si se cuela por SQL, la revisión previa lo caza
    await db.query(
      `INSERT INTO connect_tariff_rules
         ("controlCenterId", "tariffVersionId", code, name, amount, "extraTriggerType", "createdAtMs")
       VALUES ($1,$2,'R1','Regla','100','THRESHOLD_PERCENT',$3)`, [centroId, versionId, now]);
    const problemas = await ta.revisarVersion(centroId, versionId);
    expect(problemas.some((x) => x.gravedad === "error" && x.mensaje.includes("umbral"))).toBe(true);
    await expect(ta.publicar(centroId, versionId, null))
      .rejects.toMatchObject({ codigo: "version_con_errores" });
  });

  it("dos reglas con la misma prioridad avisan pero no impiden publicar", async () => {
    // Es un aviso: solo empatan de verdad si además coinciden en especificidad
    const d = await ta.duplicarVersion(centroId, versionPublicada, {
      version: `empate-${sufijo}`, validFromMs: ENERO_2027,
    });
    await ta.guardarRegla(centroId, d.id, {
      code: "OTRA", name: "Otra", amount: "198", priority: 40,   // DIURNO ya tiene 40
    });
    const problemas = await ta.revisarVersion(centroId, d.id);
    expect(problemas.some((x) => x.gravedad === "aviso" && x.mensaje.includes("prioridad 40"))).toBe(true);

    const r = await ta.publicar(centroId, d.id, null);
    expect(r.publicada).toBe(true);
    expect(r.avisos.length).toBeGreaterThan(0);
  });

  it("publicar deja la versión publicada y ya no se puede volver a publicar", async () => {
    const d = await ta.duplicarVersion(centroId, versionPublicada, {
      version: `pub-${sufijo}`, validFromMs: ENERO_2027,
    });
    const r = await ta.publicar(centroId, d.id, 7);
    expect(r.publicada).toBe(true);
    expect(r.version.status).toBe("published");
    await expect(ta.publicar(centroId, d.id, 7)).rejects.toMatchObject({ codigo: "version_publicada" });
  });

  // ── Aislamiento ──────────────────────────────────────────────────────────

  it("no se ve ni se toca el tarifario de otro centro", async () => {
    const planes = await ta.listarPlanes(otroCentroId);
    expect(planes).toHaveLength(0);

    await expect(ta.detalleVersion(otroCentroId, versionPublicada))
      .rejects.toMatchObject({ codigo: "version_no_encontrada", estado: 404 });
    await expect(ta.duplicarVersion(otroCentroId, versionPublicada, {
      version: "robo", validFromMs: ENERO_2027,
    })).rejects.toMatchObject({ codigo: "version_no_encontrada" });
  });

  // ── Suplementos ──────────────────────────────────────────────────────────

  it("un suplemento en uso no se borra: dice qué reglas lo usan", async () => {
    const d = await ta.duplicarVersion(centroId, versionPublicada, {
      version: `extra-${sufijo}`, validFromMs: ENERO_2027,
    });
    const extra = await db.query(
      `SELECT id FROM connect_tariff_extras WHERE "tariffVersionId" = $1 AND code = 'EXTRA_KM'`, [d.id]);

    await expect(ta.borrarExtra(centroId, d.id, Number(extra.rows[0].id)))
      .rejects.toMatchObject({ codigo: "extra_en_uso", estado: 409 });
  });

  it("un suplemento porcentual sin porcentaje no se guarda", async () => {
    const d = await ta.duplicarVersion(centroId, versionPublicada, {
      version: `pct-${sufijo}`, validFromMs: ENERO_2027,
    });
    await expect(ta.guardarExtra(centroId, d.id, {
      code: "RECARGO", name: "Recargo", calculationType: "PERCENTAGE",
    })).rejects.toMatchObject({ codigo: "porcentaje_requerido" });
  });

  it("el detalle trae todo lo que hace falta para pintar la pantalla", async () => {
    const d = await ta.detalleVersion(centroId, versionPublicada);
    expect(d.editable).toBe(false);
    expect(d.version.planName).toBe(SEAS_2026_VENTA.name);
    expect(d.reglas.length).toBe(SEAS_2026_VENTA.reglas.length);
    expect(d.extras.length).toBe(SEAS_2026_VENTA.extras.length);
    expect(d.franjas.some((f: any) => f.code === "NOCTURNO" && f.desde === "19:00")).toBe(true);
    expect(d.franjas.find((f: any) => f.code === "NOCTURNO").enUsoPublicado).toBe(true);
    expect(d.calendario.length).toBeGreaterThan(5);
  });
});
