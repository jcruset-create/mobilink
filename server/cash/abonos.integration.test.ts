/**
 * El abono, contra base de datos de verdad.
 *
 * Lo que decide el motor se prueba sin base en `domain/operations.test.ts`.
 * Aquí van las costuras: que el tipo pasa la restricción CHECK de la tabla
 * —que es donde un tipo nuevo revienta el arranque—, que numera con su propia
 * letra, y que el resumen de la jornada lo RESTA de los cobros de su sección
 * en vez de sumarlo a los pagos.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
process.env.CASH_STORAGE_LOCAL = "1";

let db: typeof import("../db.ts").default;
let servicio: typeof import("./service.ts");

const EMPRESA = "00000000-0000-4000-a000-0000000000f2";
const ctx = { empresaId: EMPRESA, userId: null as string | null };
const sufijo = String(process.hrtime.bigint()).slice(-9);
let sesion = 0;
let gasolinera = 0;

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await (await import("./schema.ts")).initCash();
  servicio = await import("./service.ts");

  const ahora = Date.now();
  await db.query(
    `INSERT INTO cash_payment_methods
       (empresa_id, codigo, nombre, afecta_efectivo, activa, orden, en_cobros, en_pagos, created_at_ms, updated_at_ms)
     VALUES ($1,'CASH','Efectivo',true,true,1,true,true,$2,$2),
            ($1,'TARJETA','Tarjeta',false,true,2,true,false,$2,$2)`,
    [EMPRESA, ahora]
  );
  const { rows: secs } = await db.query(
    `INSERT INTO cash_sections (empresa_id, codigo, nombre, activa, por_defecto, orden, created_at_ms, updated_at_ms)
     VALUES ($1,$2,'Taller',true,true,1,$4,$4), ($1,$3,'Gasolinera',true,false,2,$4,$4)
     RETURNING id, codigo`,
    [EMPRESA, `TALLER_${sufijo}`, `GASOLINERA_${sufijo}`, ahora]
  );
  gasolinera = secs.find((r) => r.codigo.startsWith("GASOLINERA"))!.id;

  const { rows } = await db.query(
    `INSERT INTO cash_registers (empresa_id, centro, nombre, activa, created_at_ms, updated_at_ms)
     VALUES ($1,'Centro',$2,true,$3,$3) RETURNING id`,
    [EMPRESA, `Abonos ${sufijo}`, ahora]
  );
  sesion = (
    await servicio.abrirJornada(ctx, { registerId: rows[0].id, fondoManual: [{ valor: 5000, cantidad: 6 }] })
  ).sesion.id;
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`DELETE FROM cash_payment_methods WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM cash_sections WHERE empresa_id = $1`, [EMPRESA]);
});

describe.runIf(RUN)("un abono a un cliente", () => {
  it("se asienta con su letra y RESTA de los cobros de su sección", async () => {
    /* Primero se cobra por tarjeta en la gasolinera: 249,78 como el 25/09. */
    await servicio.registrarCobro(ctx, {
      sessionId: sesion,
      importeCentimos: 24978,
      formasPago: [{ forma: "TARJETA", importe: 24978 }],
      partyNombre: "GRUPO CASTELLI BOLD S.L.",
      concepto: "Cobro",
      sectionId: gasolinera,
    });

    /* Y se devuelve el abono de 59,90 por la misma tarjeta. */
    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion,
      tipo: "REFUND",
      importeCentimos: 5990,
      formasPago: [{ forma: "TARJETA", importe: 5990 }],
      partyNombre: "GRUPO CASTELLI BOLD S.L.",
      concepto: "Abono P0020000021",
      /* Con sufijo: la base se reutiliza entre pasadas y el control de
         duplicados —que es lo que se prueba dos casos más abajo— haría
         fallar la SEGUNDA ejecución con la referencia fija. */
      referencia: `P002000${sufijo}`,
      sectionId: gasolinera,
    });
    expect(r.numero).toMatch(/-AB-/);

    const resumen = await servicio.resumenJornada(sesion);
    expect(resumen.abonos.totalCentimos).toBe(5990);
    expect(resumen.cobros.totalCentimos).toBe(24978);
    // No es un gasto: los pagos siguen a cero.
    expect(resumen.pagos.totalCentimos).toBe(0);

    const seccion = resumen.porSeccion.find((s) => s.sectionId === gasolinera)!;
    expect(seccion.cobrosCentimos).toBe(24978 - 5990);
    expect(seccion.pagosCentimos).toBe(0);
  });

  it("un abono en efectivo saca las piezas del cajón", async () => {
    const antes = (await servicio.stockDeJornada(sesion)).totalCentimos;
    await servicio.registrarOperacion(ctx, {
      sessionId: sesion,
      tipo: "REFUND",
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoEntregado: [{ valor: 5000, cantidad: 1 }],
      partyNombre: "Cliente",
      concepto: "Abono en efectivo",
      sectionId: gasolinera,
    });
    expect((await servicio.stockDeJornada(sesion)).totalCentimos).toBe(antes - 5000);
  });

  it("el mismo abono no se devuelve dos veces", async () => {
    await expect(
      servicio.registrarOperacion(ctx, {
        sessionId: sesion,
        tipo: "REFUND",
        importeCentimos: 5990,
        formasPago: [{ forma: "TARJETA", importe: 5990 }],
        partyNombre: "GRUPO CASTELLI BOLD S.L.",
        concepto: "Abono repetido",
        referencia: `P002000${sufijo}`,
        sectionId: gasolinera,
      })
    ).rejects.toMatchObject({ codigo: "COBRO_DUPLICADO" });
  });

  it("se devuelve por una forma de COBRO, no por una de pagos", async () => {
    /* TARJETA está en cobros y no en pagos, y aun así vale para un abono. */
    await db.query(
      `INSERT INTO cash_payment_methods
         (empresa_id, codigo, nombre, afecta_efectivo, activa, orden, en_cobros, en_pagos, created_at_ms, updated_at_ms)
       VALUES ($1,$3,'Solo pagos',false,true,9,false,true,$2,$2)`,
      [EMPRESA, Date.now(), `SOLO_PAGOS_${sufijo}`]
    );
    await expect(
      servicio.registrarOperacion(ctx, {
        sessionId: sesion,
        tipo: "REFUND",
        importeCentimos: 100,
        formasPago: [{ forma: `SOLO_PAGOS_${sufijo}`, importe: 100 }],
        partyNombre: "Cliente",
        concepto: "x",
        sectionId: gasolinera,
      })
    ).rejects.toMatchObject({ codigo: "FORMA_PAGO_NO_EN_COBROS" });
  });
});
