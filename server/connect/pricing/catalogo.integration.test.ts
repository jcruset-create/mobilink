/**
 * El catálogo de neumáticos y la consulta de precio, contra PostgreSQL.
 *
 * Dos cosas se prueban aquí que no se pueden probar en memoria:
 *
 *  - Que el catálogo NO duplica. La normalización de medidas y marcas es
 *    inútil si no la respalda el índice único de la tabla: si "315/80 R 22,5"
 *    y "315/80R22.5" acaban siendo dos filas, el día que se consulte un precio
 *    saldrá el de una de las dos y nadie sabrá cuál.
 *  - Que una versión publicada no se deja tocar. Es lo que sostiene que la
 *    factura de hace tres meses siga cuadrando.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAS_2026 } from "./tarifarios/seas2026.ts";
import { formatear } from "./money.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let cat: typeof import("./catalog.ts");
let precioNeumatico: typeof import("./service.ts").precioNeumatico;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const VIERNES_NOCHE = Date.parse("2026-08-14T22:17:00+02:00");
const ENERO_2026 = Date.parse("2026-01-01T00:00:00Z");

let centroId = 0;
let otroCentroId = 0;
let clienteId = 0;
let empresaId = 0;
let tallerId = 0;
let partnerId = 0;
let versionVenta = 0;
let versionCompra = 0;
let asistenciaId = 0;

describe.skipIf(!RUN)("Catálogo de neumáticos y consulta de precio", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    cat = await import("./catalog.ts");
    ({ precioNeumatico } = await import("./service.ts"));
    const { cargarTarifario, publicarVersion } = await import("./tarifario.ts");

    const centro = async (etiqueta: string) => {
      const r = await db.query(
        `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$3) RETURNING id`,
        [`cc-cat-${etiqueta}-${sufijo}`, `Central ${etiqueta} ${sufijo}`, now]);
      return Number(r.rows[0].id);
    };
    centroId = await centro("a");
    otroCentroId = await centro("b");

    const p = await db.query(
      `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`, [`pa-cat-${sufijo}`, `Partner ${sufijo}`, centroId, now]);
    partnerId = Number(p.rows[0].id);

    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [centroId, `Cliente ${sufijo}`, now]);
    clienteId = Number(cl.rows[0].id);

    const em = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`pr-cat-${sufijo}`, `Proveedora ${sufijo}`, now]);
    empresaId = Number(em.rows[0].id);

    const w = await db.query(
      `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", "createdAtMs", "updatedAtMs")
       VALUES ($1,41.1,1.2,$2,$3,$3) RETURNING id`, [`Taller ${sufijo}`, empresaId, now]);
    tallerId = Number(w.rows[0].id);

    /*
     * Dos tarifarios sobre el mismo motor: uno para lo que la central factura
     * al cliente y otro para lo que el taller le factura a ella. Se cargan
     * como BORRADOR y SIN catálogo de neumáticos —lo que se prueba aquí es la
     * vía de administración, no los datos de SEAS— se les monta el catálogo a
     * mano y solo entonces se publican. Ese es el orden real de trabajo.
     */
    const venta = await cargarTarifario(centroId, { ...SEAS_2026, code: `CATV_${sufijo}`, preciosNeumaticos: [] });
    const compra = await cargarTarifario(centroId, { ...SEAS_2026, code: `CATC_${sufijo}`, preciosNeumaticos: [] });
    versionVenta = venta.tariffVersionId;
    versionCompra = compra.tariffVersionId;

    // Bridgestone dirección: 485,49 de venta y 460 de compra
    await cat.crearPrecio(centroId, versionVenta, {
      medida: "315/80 R 22,5", marca: "Bridgestone", posicion: "STEER",
      modeloPrecio: "NET_PRICE", importeNeto: "485.49", prioridad: 10,
    });
    await cat.crearPrecio(centroId, versionCompra, {
      medida: "315/80R22.5", marca: "BRIDGESTONE", posicion: "STEER",
      modeloPrecio: "NET_PRICE", importeNeto: "460.00", prioridad: 10,
    });

    // Hankook por baremo del fabricante menos descuento, en los dos lados
    const baremo = await cat.crearBaremo(centroId, {
      marca: "Hankook", nombre: `Baremo Hankook ${sufijo}`, vigenteDesdeMs: ENERO_2026,
    });
    await cat.cargarLineasBaremo(centroId, baremo.id, [
      { medida: "315/80 R 22.5", precio: "1000.00" },
    ]);
    for (const [v, descuento] of [[versionVenta, "39"], [versionCompra, "45"]] as const) {
      await cat.crearPrecio(centroId, v, {
        medida: "315/80R22.5", marca: "Hankook", posicion: "ANY",
        modeloPrecio: "DISCOUNT_FROM_LIST", descuentoPorcentaje: descuento,
        baremoId: baremo.id, prioridad: 5,
      });
    }

    await publicarVersion(versionVenta, null);
    await publicarVersion(versionCompra, null);

    for (const [role, columna, valor, planId] of [
      ["sale", '"clientId"', clienteId, venta.tariffPlanId],
      ["purchase", '"providerCompanyId"', empresaId, compra.tariffPlanId],
    ] as const) {
      await db.query(
        `INSERT INTO connect_contracts
           ("controlCenterId", role, ${columna}, "tariffPlanId", name, status,
            "validFromMs", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$7)`,
        [centroId, role, valor, planId, `Contrato ${role}`, ENERO_2026, now]);
    }

    const a = await db.query(
      `INSERT INTO connect_assistances
         (uuid, "partnerId", "controlCenterId", "clientId", "workshopId", status,
          "serviceType", vehicle, "serviceOrderedAtMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,'assigned','tyres',$6,$7,$8,$8) RETURNING id`,
      [`cat-${sufijo}`, partnerId, centroId, clienteId, tallerId,
       JSON.stringify({ type: "truck", plate: "1234ABC" }), VIERNES_NOCHE, now]);
    asistenciaId = Number(a.rows[0].id);
  }, 90_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    for (const centro of [centroId, otroCentroId]) {
      for (const sql of [
        `DELETE FROM connect_assistances WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_contracts WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_manufacturer_price_lists WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_plans WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_calendars WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_time_bands WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_zones WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tire_brands WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tire_sizes WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_partners WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_clients WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_control_centers WHERE id = $1`,
      ]) await db.query(sql, [centro]).catch(() => {});
    }
    await db.query(`DELETE FROM connect_workshops WHERE id = $1`, [tallerId]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [empresaId]).catch(() => {});
  }, 30_000);

  // ── Catálogo ─────────────────────────────────────────────────────────────

  it("la misma medida escrita de tres formas es una sola fila", async () => {
    const a = await cat.crearMedida(centroId, "295/80 R 22,5");
    const b = await cat.crearMedida(centroId, "295/80R22.5");
    const c = await cat.crearMedida(centroId, " 295/80 r 22.5 ");
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(a.normalizedCode).toBe("295/80R22.5");
  });

  it("la medida se descompone para poder buscar por llanta", async () => {
    await cat.crearMedida(centroId, "385/65R22.5");
    const r = await db.query(
      `SELECT width, "aspectRatio", "rimDiameter" FROM connect_tire_sizes
        WHERE "controlCenterId" = $1 AND "normalizedCode" = '385/65R22.5'`, [centroId]);
    expect(Number(r.rows[0].width)).toBe(385);
    expect(Number(r.rows[0].aspectRatio)).toBe(65);
    expect(Number(r.rows[0].rimDiameter)).toBe(22.5);
  });

  it("la marca tampoco duplica por mayúsculas ni espacios", async () => {
    const a = await cat.crearMarca(centroId, "michelin");
    const b = await cat.crearMarca(centroId, "  Michelin ");
    expect(b.id).toBe(a.id);
    expect(a.normalizedName).toBe("MICHELIN");
  });

  it("cada centro tiene su catálogo y no ve el del otro", async () => {
    await cat.crearMarca(otroCentroId, `Marca-${sufijo}`);
    const mias = await cat.listarMarcas(centroId);
    expect(mias.some((m) => m.name === `Marca-${sufijo}`)).toBe(false);
    const suyas = await cat.listarMarcas(otroCentroId);
    expect(suyas.some((m) => m.name === `Marca-${sufijo}`)).toBe(true);
  });

  it("un grupo se reescribe entero: quitar una marca es mandar la lista sin ella", async () => {
    const { publicarVersion } = await import("./tarifario.ts");
    const { cargarTarifario } = await import("./tarifario.ts");
    const borrador = await cargarTarifario(centroId, { ...SEAS_2026, code: `CATG_${sufijo}`, preciosNeumaticos: [] });

    const antes = await cat.guardarGrupo(centroId, borrador.tariffVersionId,
      { code: "premium", name: "Premium", marcas: ["Bridgestone", "Michelin", "Continental"] });
    expect(antes.code).toBe("PREMIUM");
    expect(antes.marcas).toHaveLength(3);

    const despues = await cat.guardarGrupo(centroId, borrador.tariffVersionId,
      { code: "PREMIUM", name: "Premium", marcas: ["Bridgestone", "Michelin"] });
    expect(despues.id).toBe(antes.id);
    expect(despues.marcas).toEqual(["Bridgestone", "Michelin"]);

    // Y una vez publicada, ya no se toca
    await publicarVersion(borrador.tariffVersionId, null);
    await expect(cat.guardarGrupo(centroId, borrador.tariffVersionId,
      { code: "PREMIUM", name: "Premium", marcas: [] })).rejects.toThrow(/publicada/);
  });

  it("una versión publicada no admite precios nuevos", async () => {
    await expect(cat.crearPrecio(centroId, versionVenta, {
      medida: "205/55R16", modeloPrecio: "NET_PRICE", importeNeto: "90",
    })).rejects.toMatchObject({ codigo: "version_publicada" });
  });

  it("un descuento de 610 se rechaza al darlo de alta, no en la factura", async () => {
    const { cargarTarifario } = await import("./tarifario.ts");
    const b = await cargarTarifario(centroId, { ...SEAS_2026, code: `CATD_${sufijo}`, preciosNeumaticos: [] });
    // 610 es el PRECIO resultante de un baremo de 1.000 al 39 %, no el descuento
    await expect(cat.crearPrecio(centroId, b.tariffVersionId, {
      medida: "315/80R22.5", modeloPrecio: "DISCOUNT_FROM_LIST", descuentoPorcentaje: "610",
    })).rejects.toMatchObject({ codigo: "descuento_invalido" });

    await expect(cat.crearPrecio(centroId, b.tariffVersionId, {
      medida: "315/80R22.5", marca: "Bridgestone", grupoMarca: "PREMIUM",
      modeloPrecio: "NET_PRICE", importeNeto: "100",
    })).rejects.toMatchObject({ codigo: "marca_y_grupo" });
  });

  // ── Consulta de precio ───────────────────────────────────────────────────

  it("precio neto: compra, venta y margen de las dos tarifas", async () => {
    const r = await precioNeumatico(asistenciaId, {
      medida: "315/80 R 22,5", marca: "bridgestone", posicion: "STEER",
    });
    expect(formatear(r!.venta.importeUnitario!)).toBe("485.49");
    expect(formatear(r!.compra.importeUnitario!)).toBe("460.00");
    expect(formatear(r!.margen!)).toBe("25.49");
    expect(formatear(r!.margenPct!)).toBe("5.25");
    expect(r!.revisionManual).toBe(false);
    expect(r!.venta.explicacion).toContain("Precio neto de tarifa");
  });

  it("la cantidad multiplica el total, no el unitario", async () => {
    const r = await precioNeumatico(asistenciaId, {
      medida: "315/80R22.5", marca: "Bridgestone", posicion: "STEER", cantidad: 4,
    });
    expect(formatear(r!.venta.importeUnitario!)).toBe("485.49");
    expect(formatear(r!.venta.importeTotal!)).toBe("1941.96");
    expect(formatear(r!.margen!)).toBe("101.96");
  });

  it("baremo menos descuento: el porcentaje es lo que se resta, no el precio", async () => {
    const r = await precioNeumatico(asistenciaId, { medida: "315/80R22.5", marca: "Hankook" });
    // 1.000 menos el 39 % = 610 de venta; menos el 45 % = 550 de compra
    expect(formatear(r!.venta.importeUnitario!)).toBe("610.00");
    expect(formatear(r!.compra.importeUnitario!)).toBe("550.00");
    expect(formatear(r!.margen!)).toBe("60.00");
    expect(r!.venta.explicacion).toContain("39 % de descuento");
  });

  it("sin tarifa para esa medida no se inventa un precio: va a revisión manual", async () => {
    const r = await precioNeumatico(asistenciaId, { medida: "205/55R16", marca: "Bridgestone" });
    expect(r!.venta.importeUnitario).toBeNull();
    expect(r!.compra.importeUnitario).toBeNull();
    expect(r!.margen).toBeNull();
    expect(r!.revisionManual).toBe(true);
    expect(r!.avisos.map((a) => a.codigo)).toContain("TIRE_PRICE_NOT_FOUND");
  });

  it("si falta la compra sale la venta y el margen queda indeterminado", async () => {
    // Asistencia sin taller: no hay contrato de compra al que preguntar
    const a = await db.query(
      `INSERT INTO connect_assistances
         (uuid, "partnerId", "controlCenterId", "clientId", status, "serviceType",
          vehicle, "serviceOrderedAtMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,'pending','tyres',$5,$6,$7,$7) RETURNING id`,
      [`cat-sin-${sufijo}`, partnerId, centroId, clienteId,
       JSON.stringify({ type: "truck" }), VIERNES_NOCHE, now]);

    const r = await precioNeumatico(Number(a.rows[0].id), {
      medida: "315/80R22.5", marca: "Bridgestone", posicion: "STEER",
    });
    expect(formatear(r!.venta.importeUnitario!)).toBe("485.49");
    expect(r!.compra.importeUnitario).toBeNull();
    expect(r!.margen).toBeNull();
    expect(r!.avisos.map((x) => x.codigo)).toContain("PURCHASE_TARIFF_NOT_FOUND");
    expect(r!.revisionManual).toBe(true);
  });

  it("una posición concreta no se aplica a quien no la pide", async () => {
    // El precio de Bridgestone es de dirección; sin posición no debe salir
    const r = await precioNeumatico(asistenciaId, { medida: "315/80R22.5", marca: "Bridgestone" });
    expect(r!.venta.importeUnitario).toBeNull();
    expect(r!.avisos.map((x) => x.codigo)).toContain("TIRE_PRICE_NOT_FOUND");
  });

  it("dar de baja un precio lo desactiva, no lo borra, y solo puede hacerlo su centro", async () => {
    const { cargarTarifario, publicarVersion } = await import("./tarifario.ts");
    const b = await cargarTarifario(centroId, { ...SEAS_2026, code: `CATX_${sufijo}`, preciosNeumaticos: [] });
    const p = await cat.crearPrecio(centroId, b.tariffVersionId, {
      medida: "245/70R19.5", marca: "Bridgestone", posicion: "ANY",
      modeloPrecio: "NET_PRICE", importeNeto: "300",
    });
    expect(await cat.desactivarPrecio(centroId, p.id)).toBe(true);
    const quedan = await cat.listarPrecios(centroId, b.tariffVersionId);
    expect(quedan.find((x) => x.id === p.id)!.active).toBe(false);

    // Y el de otro centro no se puede desactivar aunque se sepa el id
    expect(await cat.desactivarPrecio(otroCentroId, p.id)).toBe(false);
    await publicarVersion(b.tariffVersionId, null);
  });

  // ── Carga en lote ────────────────────────────────────────────────────────

  it("una tabla entera se carga de una vez", async () => {
    const { cargarTarifario } = await import("./tarifario.ts");
    const b = await cargarTarifario(centroId, { ...SEAS_2026, code: `LOTE_${sufijo}`, preciosNeumaticos: [] });
    await cat.guardarGrupo(centroId, b.tariffVersionId,
      { code: "EUR1", name: "Europeas", marcas: ["Falken", "Sava"] });

    const r = await cat.crearPreciosEnLote(centroId, b.tariffVersionId, [
      { medida: "315/70R22.5", posicion: "STEER", marca: "Bridgestone", modeloPrecio: "NET_PRICE", importeNeto: "485.49" },
      { medida: "315/70R22.5", posicion: "DRIVE", marca: "Bridgestone", modeloPrecio: "NET_PRICE", importeNeto: "485.49" },
      { medida: "315/70R22.5", posicion: "STEER", grupoMarca: "EUR1", modeloPrecio: "NET_PRICE", importeNeto: "436.17" },
    ]);
    expect(r.escritas).toBe(3);
    expect(r.errores).toEqual([]);

    // La marca concreta se guarda con más prioridad que el grupo
    const precios = await cat.listarPrecios(centroId, b.tariffVersionId);
    expect(precios.find((p) => p.brandName === "Bridgestone")!.priority)
      .toBeGreaterThan(precios.find((p) => p.brandGroupCode === "EUR1")!.priority);
  });

  it("si una fila falla no se escribe NINGUNA", async () => {
    /*
     * Con 150 filas pegadas, escribir las 89 primeras y fallar en la 90 deja un
     * catálogo a medias que nadie sabe dónde se cortó.
     */
    const { cargarTarifario } = await import("./tarifario.ts");
    const b = await cargarTarifario(centroId, { ...SEAS_2026, code: `LOTEMAL_${sufijo}`, preciosNeumaticos: [] });

    const r = await cat.crearPreciosEnLote(centroId, b.tariffVersionId, [
      { fila: 2, medida: "315/70R22.5", marca: "Bridgestone", modeloPrecio: "NET_PRICE", importeNeto: "485.49" },
      { fila: 3, medida: "315/80R22.5", marca: "Hankook", modeloPrecio: "DISCOUNT_FROM_LIST", descuentoPorcentaje: "610" },
      { fila: 4, medida: "295/80R22.5", marca: "Pirelli", modeloPrecio: "NET_PRICE", importeNeto: "420" },
    ]);

    expect(r.escritas).toBe(0);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0].fila).toBe(3);
    expect(await cat.listarPrecios(centroId, b.tariffVersionId)).toHaveLength(0);
  });

  it("un grupo que no existe se detecta antes de borrar nada", async () => {
    const { cargarTarifario } = await import("./tarifario.ts");
    const b = await cargarTarifario(centroId, { ...SEAS_2026, code: `LOTEG_${sufijo}`, preciosNeumaticos: [] });
    await cat.crearPreciosEnLote(centroId, b.tariffVersionId, [
      { medida: "315/70R22.5", marca: "Bridgestone", modeloPrecio: "NET_PRICE", importeNeto: "100" },
    ]);

    const r = await cat.crearPreciosEnLote(centroId, b.tariffVersionId, [
      { fila: 2, medida: "315/70R22.5", grupoMarca: "NO_EXISTE", modeloPrecio: "NET_PRICE", importeNeto: "100" },
    ], { reemplazar: true });

    expect(r.escritas).toBe(0);
    expect(r.errores[0].motivo).toContain("NO_EXISTE");
    // Y lo que había sigue ahí: no se ha borrado antes de fallar
    expect(await cat.listarPrecios(centroId, b.tariffVersionId)).toHaveLength(1);
  });

  it("reemplazar sustituye la tabla en vez de duplicarla", async () => {
    /*
     * Sin esto, corregir una errata y volver a pegar dejaría dos copias de
     * ciento y pico filas y el precio saldría de una de ellas sin saber cuál.
     */
    const { cargarTarifario } = await import("./tarifario.ts");
    const b = await cargarTarifario(centroId, { ...SEAS_2026, code: `LOTER_${sufijo}`, preciosNeumaticos: [] });
    const filas = [
      { medida: "315/70R22.5", marca: "Bridgestone", modeloPrecio: "NET_PRICE", importeNeto: "485.49" },
      { medida: "315/80R22.5", marca: "Bridgestone", modeloPrecio: "NET_PRICE", importeNeto: "485.49" },
    ];

    await cat.crearPreciosEnLote(centroId, b.tariffVersionId, filas);
    const segunda = await cat.crearPreciosEnLote(centroId, b.tariffVersionId, filas, { reemplazar: true });

    expect(segunda.borradas).toBe(2);
    expect(segunda.escritas).toBe(2);
    expect(await cat.listarPrecios(centroId, b.tariffVersionId)).toHaveLength(2);
  });

  it("sin reemplazar se acumulan, que es lo que pasa al pegar dos veces sin querer", async () => {
    const { cargarTarifario } = await import("./tarifario.ts");
    const b = await cargarTarifario(centroId, { ...SEAS_2026, code: `LOTEA_${sufijo}`, preciosNeumaticos: [] });
    const fila = [{ medida: "315/70R22.5", marca: "Dunlop", modeloPrecio: "NET_PRICE", importeNeto: "460" }];
    await cat.crearPreciosEnLote(centroId, b.tariffVersionId, fila);
    await cat.crearPreciosEnLote(centroId, b.tariffVersionId, fila);
    expect(await cat.listarPrecios(centroId, b.tariffVersionId)).toHaveLength(2);
  });

  it("una fila sin medida, marca ni grupo se rechaza: valdría para todo", async () => {
    const { cargarTarifario } = await import("./tarifario.ts");
    const b = await cargarTarifario(centroId, { ...SEAS_2026, code: `LOTEV_${sufijo}`, preciosNeumaticos: [] });
    const r = await cat.crearPreciosEnLote(centroId, b.tariffVersionId, [
      { fila: 2, modeloPrecio: "NET_PRICE", importeNeto: "100" },
    ]);
    expect(r.errores[0].motivo).toContain("valdría para todo");
  });

  it("en una versión publicada no se carga ningún lote", async () => {
    await expect(cat.crearPreciosEnLote(centroId, versionVenta, [
      { medida: "315/70R22.5", marca: "Dunlop", modeloPrecio: "NET_PRICE", importeNeto: "460" },
    ])).rejects.toMatchObject({ codigo: "version_publicada" });
  });
});
