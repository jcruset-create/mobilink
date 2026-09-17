/**
 * Las reglas de sección, contra base de datos de verdad.
 *
 * Lo que DECIDE se prueba aparte y sin base de datos, en `seccion.test.ts`.
 * Aquí se prueban las costuras que allí no se ven, que son las que rompen en
 * producción:
 *
 *   1. Que la regla que se guarda desde Configuración es la misma que lee el
 *      escáner. Dos mitades que normalizan distinto fallan solo a ratos, que es
 *      la peor manera de fallar.
 *   2. Que una sección dada de baja NO desaparece de la pantalla, sino que sale
 *      marcada. Es el mismo fallo que ya se coló una vez con las equivalencias
 *      del ERP: la prueba usaba una forma de baja —que deja la fila— en vez de
 *      una BORRADA, y el LEFT JOIN que decía probar no lo estaba probando.
 *   3. Que guardar dos veces el mismo par (campo, patrón) lo REAPUNTA.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.CASH_STORAGE_LOCAL = "1";

let db: typeof import("../../db.ts").default;
let config: typeof import("../config.ts");
let servicio: typeof import("./service.ts");
let seccion: typeof import("./seccion.ts");

const EMPRESA = "00000000-0000-4000-a000-0000000000f1";
const ctx = { empresaId: EMPRESA, userId: null as string | null };

const sufijo = String(process.hrtime.bigint()).slice(-9);
let taller = 0;
let gasolinera = 0;

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../../db.ts")).default;
  await (await import("../schema.ts")).initCash();
  config = await import("../config.ts");
  servicio = await import("./service.ts");
  seccion = await import("./seccion.ts");

  const ahora = Date.now();
  const { rows } = await db.query(
    `INSERT INTO cash_sections (empresa_id, codigo, nombre, activa, por_defecto, orden,
                                created_at_ms, updated_at_ms)
     VALUES ($1,$2,'Taller',true,true,1,$4,$4),
            ($1,$3,'Gasolinera',true,false,2,$4,$4)
     RETURNING id, codigo`,
    [EMPRESA, `TALLER_${sufijo}`, `GASOLINERA_${sufijo}`, ahora]
  );
  taller = rows.find((r) => r.codigo.startsWith("TALLER"))!.id;
  gasolinera = rows.find((r) => r.codigo.startsWith("GASOLINERA"))!.id;
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`DELETE FROM cash_section_rules WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM cash_sections WHERE empresa_id = $1`, [EMPRESA]);
});

/** El ticket del surtidor del 17/09/2026, con sus cifras de verdad. */
const TICKET = {
  cifEmisor: "A43044379",
  nombreEmisor: "E.S CONFORTAUTO",
  numeroFactura: "T5-155",
  concepto: "GAS-OIL A DIESEL",
  baseCentimos: 4132,
  ivaCentimos: 868,
  totalCentimos: 5000,
  confianzaEmisor: 0.95,
};

describe.runIf(RUN)("Reglas de sección", () => {
  it("lo que se guarda en Configuración es lo que lee el escáner", async () => {
    /*
     * LA PRUEBA QUE ATA LAS DOS MITADES, con datos que han pasado por la base
     * de datos de verdad. Se guarda la regla por un lado, se lee por el otro y
     * se clasifica el ticket. Si alguna de las dos puntas normalizara a su
     * manera, esto se pondría en rojo.
     */
    await config.guardarReglaSeccion(ctx, {
      campo: "CIF_EMISOR",
      patron: "A43044379",
      sectionId: gasolinera,
    });

    const reglas = await servicio.reglasSeccionDeEmpresa(EMPRESA);
    const secciones = await servicio.seccionesDeEmpresa(EMPRESA);

    const r = seccion.clasificarSeccion(TICKET, reglas, secciones.activas, secciones.porDefecto);
    expect(r.sectionId).toBe(gasolinera);
    expect(r.autoSeleccionar).toBe(true);
  });

  it("la sección por defecto sale de la base, y es la marcada", async () => {
    const secciones = await servicio.seccionesDeEmpresa(EMPRESA);
    expect(secciones.porDefecto).toBe(taller);
  });

  it("una factura que no reconoce nadie cae en el taller, pero sin cambiar el chip", async () => {
    const reglas = await servicio.reglasSeccionDeEmpresa(EMPRESA);
    const secciones = await servicio.seccionesDeEmpresa(EMPRESA);

    const r = seccion.clasificarSeccion(
      { ...TICKET, cifEmisor: "B43999111", nombreEmisor: "OTRA S.L.", numeroFactura: "B2_26/611", concepto: "Montaje" },
      reglas,
      secciones.activas,
      secciones.porDefecto
    );
    expect(r.sectionId).toBe(taller);
    expect(r.autoSeleccionar).toBe(false);
  });

  it("guardar el mismo par campo+patrón lo REAPUNTA, no crea otra", async () => {
    await config.guardarReglaSeccion(ctx, {
      campo: "SERIE",
      patron: "T5-",
      sectionId: gasolinera,
    });
    await config.guardarReglaSeccion(ctx, {
      campo: "SERIE",
      patron: "T5-",
      sectionId: taller,
    });

    const todas = await config.listarReglasSeccion(EMPRESA);
    const deSerie = todas.filter((x) => x.campo === "SERIE" && x.patron === "T5-");
    expect(deSerie).toHaveLength(1);
    expect(deSerie[0]!.sectionId).toBe(taller);
  });

  it("no se puede apuntar a una sección de otra empresa", async () => {
    /*
     * No hay clave ajena —el catálogo es editable y no debe tumbar reglas— así
     * que la comprobación vive en el servicio. Sin ella se guardaría una regla
     * que no propone nunca y no dice por qué.
     */
    await expect(
      config.guardarReglaSeccion(ctx, { campo: "CONCEPTO", patron: "loquesea", sectionId: 999_999 })
    ).rejects.toMatchObject({ codigo: "SECCION_NO_ENCONTRADA" });
  });

  it("si la sección se BORRA, la regla sigue saliendo y sale marcada", async () => {
    /*
     * Borrada, no dada de baja: dar de baja deja la fila, y entonces un JOIN
     * normal la encuentra igual y el LEFT JOIN no se estaría probando. Es
     * exactamente el fallo que se coló en las equivalencias del ERP.
     */
    const ahora = Date.now();
    const { rows } = await db.query(
      `INSERT INTO cash_sections (empresa_id, codigo, nombre, activa, por_defecto, orden,
                                  created_at_ms, updated_at_ms)
       VALUES ($1,$2,'Efímera',true,false,9,$3,$3) RETURNING id`,
      [EMPRESA, `EFIMERA_${sufijo}`, ahora]
    );
    const efimera = rows[0].id as number;

    await config.guardarReglaSeccion(ctx, {
      campo: "NOMBRE_EMISOR",
      patron: "efimera",
      sectionId: efimera,
    });
    await db.query(`DELETE FROM cash_sections WHERE id = $1`, [efimera]);

    const todas = await config.listarReglasSeccion(EMPRESA);
    const huerfana = todas.find((x) => x.patron === "efimera");
    expect(huerfana).toBeDefined();
    expect(huerfana!.seccionVigente).toBe(false);
    expect(huerfana!.seccionNombre).toBe("");
  });
});
