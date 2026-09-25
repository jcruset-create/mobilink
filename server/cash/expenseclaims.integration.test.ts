/**
 * Liquidaciones de gastos de trabajadores, contra PostgreSQL de verdad.
 *
 * Lo que se fija aquí es lo que una prueba sin base no puede ver:
 *
 *   · que el esquema arranca (las restricciones CHECK solo fallan aquí);
 *   · que la liquidación NO toca la caja: ni operaciones ni piezas;
 *   · el flujo entero con el ejemplo del encargo (66,40 + 15,88 = 82,28);
 *   · que la IA no es requisito: todo se hace a mano y se presenta;
 *   · que un ticket repetido deja evidencia, y cada una se decide aparte;
 *   · la separación de funciones al aprobar, y el ámbito de taller;
 *   · la numeración LG-26-001, sin caja delante;
 *   · la identidad por empleado, sin duplicar personas.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE. Idempotente:
 * todo lo que crea lleva `sufijo`, así que se puede correr dos veces seguidas
 * sobre la misma base.
 */

import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.CASH_STORAGE_LOCAL = "1";

let db: typeof import("../db.ts").default;
let servicio: typeof import("./service.ts");
let config: typeof import("./config.ts");
let documentos: typeof import("./documents.ts");
let liquidaciones: typeof import("./expenseclaims/service.ts");
let tickets: typeof import("./expenseclaims/lines.ts");
let informe: typeof import("./expenseclaims/report.ts");

const EMPRESA = "00000000-0000-4000-a000-0000000000f7";
const PRESENTA = "00000000-0000-4000-a000-0000000000f8";
const APRUEBA = "00000000-0000-4000-a000-0000000000f9";
const ctx = { empresaId: EMPRESA, userId: PRESENTA as string | null };
const ctxJefe = { empresaId: EMPRESA, userId: APRUEBA as string | null };

const sufijo = String(process.hrtime.bigint()).slice(-9);

let dietas = 0;
let peajes = 0;
let ferreteria = 0;
let juan = 0;
let taller = 0;

/** Un PDF de verdad, distinto para cada texto: dos llamadas, dos huellas. */
async function pdf(texto: string): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.addPage([300, 200]).drawText(texto, { x: 20, y: 100, size: 12 });
  d.setTitle(texto);
  return Buffer.from(await d.save());
}

const fichero = (buffer: Buffer, nombre = "ticket.pdf") => ({
  originalname: nombre,
  mimetype: "application/pdf",
  buffer,
});

async function contar(tabla: string): Promise<number> {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${tabla} WHERE empresa_id = $1`, [EMPRESA]);
  return rows[0].n;
}

async function sod(activo: boolean) {
  await db.query(
    `INSERT INTO cash_settings (empresa_id, clave, valor, updated_at_ms) VALUES ($1,'sod_activo',$2,$3)
     ON CONFLICT (empresa_id, clave) DO UPDATE SET valor = EXCLUDED.valor`,
    [EMPRESA, activo ? "1" : "0", Date.now()]
  );
}

/** Rellena y da por revisada una línea, como haría una persona a mano. */
async function aMano(claimId: number, lineId: number, importe: number, concepto: number, fecha = "2026-09-22") {
  return tickets.editarLinea(ctx, claimId, lineId, {
    fecha,
    emisorNombre: `Establecimiento ${lineId}`,
    importeCentimos: importe,
    expenseConceptId: concepto,
    revisada: true,
  });
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await (await import("./schema.ts")).initCash();
  servicio = await import("./service.ts");
  config = await import("./config.ts");
  documentos = await import("./documents.ts");
  liquidaciones = await import("./expenseclaims/service.ts");
  tickets = await import("./expenseclaims/lines.ts");
  informe = await import("./expenseclaims/report.ts");

  /*
   * `sea_employees` la crean las migraciones de Supabase, no el arranque, así
   * que en la CI no existe. Se crea lo mínimo que lee el servicio, igual que
   * las pruebas de Therefore crean `app_usuario_modulos`.
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS sea_employees (
      id UUID PRIMARY KEY,
      nombre TEXT NOT NULL,
      apellidos TEXT,
      activo BOOLEAN NOT NULL DEFAULT true
    )`);

  dietas = (await config.crearConcepto(ctx, { nombre: `Dietas ${sufijo}`, tipoDestino: "PERSONA" })).id;
  peajes = (await config.crearConcepto(ctx, { nombre: `Peajes ${sufijo}`, tipoDestino: "NINGUNO" })).id;
  ferreteria = (await config.crearConcepto(ctx, { nombre: `Ferreteria ${sufijo}`, tipoDestino: "CENTRO_COSTE" })).id;
  juan = (await config.crearDestino(ctx, { nombre: `Juan ${sufijo}`, tipo: "PERSONA" })).id;
  taller = (await config.crearDestino(ctx, { nombre: `Taller ${sufijo}`, tipo: "CENTRO_COSTE" })).id;
  await sod(false);
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await sod(false);
});

describe.runIf(RUN)("Liquidaciones · el flujo del encargo", () => {
  it("de borrador a aprobada, con 66,40 + 15,88 = 82,28, sin tocar la caja", async () => {
    const operacionesAntes = await contar("cash_operations");

    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan, notas: "Viaje a Lleida" });
    expect(l.estado).toBe("BORRADOR");
    expect(l.empleadoNombre).toBe(`Juan ${sufijo}`);
    // Sin caja delante: LG-26-001, no LG-LG-26-001.
    expect(l.numero).toMatch(/^LG-\d{2}-\d{3,}$/);

    const lineas = await tickets.subirTickets(ctx, l.id, [
      fichero(await pdf(`comida ${sufijo}`)),
      fichero(await pdf(`cena ${sufijo}`)),
      fichero(await pdf(`peaje 1 ${sufijo}`)),
      fichero(await pdf(`peaje 2 ${sufijo}`)),
    ]);
    expect(lineas).toHaveLength(4);
    // La IA no ha intervenido: la lectura está OMITIDA y eso no es un error.
    expect(lineas.every((x) => x.analisis === "OMITIDO" && x.situacion === "INCLUIDA")).toBe(true);
    expect(lineas.map((x) => x.orden)).toEqual([1, 2, 3, 4]);

    // Sin datos no se presenta, y se dice TODO lo que falta de una vez.
    const antes = await liquidaciones.detalleLiquidacion(ctx, l.id);
    expect(antes.bloqueos.filter((b) => b.codigo === "LINEA_SIN_REVISAR")).toHaveLength(4);
    await expect(liquidaciones.presentarLiquidacion(ctx, l.id)).rejects.toMatchObject({
      codigo: "LINEA_SIN_FECHA",
    });

    // Todo a mano.
    await aMano(l.id, lineas[0].id, 2440, dietas);
    await aMano(l.id, lineas[1].id, 4200, dietas, "2026-09-23");
    await aMano(l.id, lineas[2].id, 1024, peajes);
    await aMano(l.id, lineas[3].id, 564, peajes, "2026-09-21");

    const listo = await liquidaciones.detalleLiquidacion(ctx, l.id);
    expect(listo.bloqueos).toEqual([]);
    expect(listo.totales.totalCentimos).toBe(8228);
    expect(listo.totales.porConcepto.map((p) => [p.nombre, p.importeCentimos])).toEqual([
      [`Dietas ${sufijo}`, 6640],
      [`Peajes ${sufijo}`, 1588],
    ]);

    const presentada = await liquidaciones.presentarLiquidacion(ctx, l.id);
    expect(presentada.estado).toBe("PRESENTADA");
    expect(presentada.totalCentimos).toBe(8228);
    expect(presentada.periodoDesde).toBe("2026-09-21");
    expect(presentada.periodoHasta).toBe("2026-09-23");
    expect(presentada.presentadaPor).toBe(PRESENTA);

    // Presentada, las líneas están congeladas.
    await expect(tickets.editarLinea(ctx, l.id, lineas[0].id, { importeCentimos: 1 })).rejects.toMatchObject({
      codigo: "LINEA_NO_EDITABLE",
    });
    await expect(tickets.subirTickets(ctx, l.id, [fichero(await pdf(`tarde ${sufijo}`))])).rejects.toMatchObject({
      codigo: "LINEA_NO_EDITABLE",
    });

    const aprobada = await liquidaciones.aprobarLiquidacion(ctxJefe, l.id);
    expect(aprobada.estado).toBe("APROBADA");
    expect(aprobada.aprobadaPor).toBe(APRUEBA);

    /*
     * LO MÁS IMPORTANTE DE ESTE BLOQUE: nada de esto ha sido un movimiento de
     * caja. Una liquidación aprobada todavía no es dinero que haya salido.
     */
    expect(await contar("cash_operations")).toBe(operacionesAntes);
    expect(aprobada.operationPagoId).toBeNull();

    // Una aprobada no se vuelve a presentar ni se rechaza.
    await expect(liquidaciones.presentarLiquidacion(ctx, l.id)).rejects.toMatchObject({
      codigo: "TRANSICION_NO_VALIDA",
    });
    await expect(liquidaciones.rechazarLiquidacion(ctxJefe, l.id, "tarde")).rejects.toMatchObject({
      codigo: "TRANSICION_NO_VALIDA",
    });
  });

  it("una línea excluida se queda, con su motivo, y no suma", async () => {
    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const [a, b] = await tickets.subirTickets(ctx, l.id, [
      fichero(await pdf(`menu ${sufijo}`)),
      fichero(await pdf(`copas ${sufijo}`)),
    ]);
    await aMano(l.id, a.id, 1500, dietas);
    const excluida = await tickets.excluirLinea(ctx, l.id, b.id, "Las copas no se reembolsan");
    expect(excluida.situacion).toBe("EXCLUIDA");
    expect(excluida.excluidaMotivo).toBe("Las copas no se reembolsan");

    // Sin motivo no se excluye: quien lo revise tiene que saber por qué.
    await expect(tickets.excluirLinea(ctx, l.id, a.id, "  ")).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });

    // La excluida está sin revisar y sin datos, y aun así no impide presentar.
    const p = await liquidaciones.presentarLiquidacion(ctx, l.id);
    expect(p.totalCentimos).toBe(1500);
  });
});

describe.runIf(RUN)("Liquidaciones · categoría y persona son dos cosas", () => {
  let claim = 0;
  let linea = 0;

  beforeAll(async () => {
    claim = (await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan })).id;
    linea = (await tickets.subirTickets(ctx, claim, [fichero(await pdf(`tornillos ${sufijo}`))]))[0].id;
  });

  it("vale cualquier concepto, no solo los que imputan a una persona", async () => {
    // Peajes es NINGUNO y Ferretería CENTRO_COSTE: los dos se reembolsan igual.
    expect((await tickets.editarLinea(ctx, claim, linea, { expenseConceptId: peajes })).expenseConceptId).toBe(peajes);
    const f = await tickets.editarLinea(ctx, claim, linea, { expenseConceptId: ferreteria, expenseTargetId: taller });
    expect(f.expenseTargetId).toBe(taller);
  });

  it("cambiar a un concepto que no pide centro de coste limpia el que hubiera", async () => {
    const d = await tickets.editarLinea(ctx, claim, linea, { expenseConceptId: dietas });
    expect(d.expenseTargetId).toBeNull();
  });

  it("con un concepto de PERSONA no se elige destino: es el trabajador", async () => {
    await expect(
      tickets.editarLinea(ctx, claim, linea, { expenseConceptId: dietas, expenseTargetId: juan })
    ).rejects.toMatchObject({ codigo: "DESTINO_NO_VALIDO" });
  });

  it("un centro de coste tiene que ser un centro de coste", async () => {
    await expect(
      tickets.editarLinea(ctx, claim, linea, { expenseConceptId: ferreteria, expenseTargetId: juan })
    ).rejects.toMatchObject({ codigo: "DESTINO_NO_VALIDO" });
  });

  it("un importe negativo no entra: el dinero siempre va en positivo", async () => {
    await expect(tickets.editarLinea(ctx, claim, linea, { importeCentimos: -100 })).rejects.toMatchObject({
      codigo: "IMPORTE_NO_VALIDO",
    });
  });

  it("una fecha imposible tampoco", async () => {
    await expect(tickets.editarLinea(ctx, claim, linea, { fecha: "2026-02-30" })).rejects.toMatchObject({
      codigo: "ENTRADA_NO_VALIDA",
    });
  });

  it("a un centro de coste no se le hace una liquidación", async () => {
    await expect(liquidaciones.crearLiquidacion(ctx, { expenseTargetId: taller })).rejects.toMatchObject({
      codigo: "DESTINO_NO_ES_PERSONA",
    });
  });
});

describe.runIf(RUN)("Liquidaciones · duplicados", () => {
  it("el mismo fichero en otra liquidación deja evidencia y bloquea presentar hasta decidir", async () => {
    const papel = await pdf(`repetido ${sufijo}`);
    const primera = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    await tickets.subirTickets(ctx, primera.id, [fichero(papel)]);

    const segunda = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    // No se rechaza: se sube y se marca. Quien decide es una persona.
    const [linea] = await tickets.subirTickets(ctx, segunda.id, [fichero(papel)]);
    expect(linea.duplicados).toHaveLength(1);
    expect(linea.duplicados[0]).toMatchObject({
      tipo: "MISMO_FICHERO",
      referenciaTipo: "LINEA",
      referenciaNumero: primera.numero,
      resolucion: "PENDIENTE",
      detectadoEn: "SUBIDA",
    });

    await aMano(segunda.id, linea.id, 900, dietas);
    await expect(liquidaciones.presentarLiquidacion(ctx, segunda.id)).rejects.toMatchObject({
      codigo: "DUPLICADO_SIN_RESOLVER",
    });

    // «No es duplicado» exige motivo…
    await expect(
      tickets.resolverDuplicado(ctx, segunda.id, linea.duplicados[0].id, { resolucion: "ACEPTADA", motivo: "" })
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
    // …y con él queda escrito quién y por qué.
    const r = await tickets.resolverDuplicado(ctxJefe, segunda.id, linea.duplicados[0].id, {
      resolucion: "ACEPTADA",
      motivo: "Son dos comidas el mismo día, mismo menú",
    });
    expect(r.duplicados[0]).toMatchObject({ resolucion: "ACEPTADA", resueltoPor: APRUEBA });
    // Lo decidido no se vuelve a decidir.
    await expect(
      tickets.resolverDuplicado(ctx, segunda.id, linea.duplicados[0].id, { resolucion: "ACEPTADA", motivo: "otra vez" })
    ).rejects.toMatchObject({ codigo: "DUPLICADO_YA_RESUELTO" });

    expect((await liquidaciones.presentarLiquidacion(ctx, segunda.id)).estado).toBe("PRESENTADA");
  });

  it("una línea puede coincidir con varias cosas, y se guardan todas", async () => {
    /*
     * El mismo ticket ya colgado de un pago de la caja Y subido a otra
     * liquidación. Una columna de texto se habría quedado con una sola.
     */
    const papel = await pdf(`doble ${sufijo}`);
    const { rows } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, activa, created_at_ms, updated_at_ms)
       VALUES ($1,'Centro',$2,true,$3,$3) RETURNING id`,
      [EMPRESA, `Liquidaciones ${sufijo}`, Date.now()]
    );
    const sesion = (
      await servicio.abrirJornada(ctx, { registerId: rows[0].id, fondoManual: [{ valor: 2000, cantidad: 5 }] })
    ).sesion.id;
    const pago = await servicio.registrarOperacion(ctx, {
      sessionId: sesion,
      tipo: "PAYMENT",
      importeCentimos: 2000,
      formasPago: [{ forma: "CASH", importe: 2000 }],
      efectivoEntregado: [{ valor: 2000, cantidad: 1 }],
      concepto: "comida pagada por Entregas",
    });
    await documentos.adjuntarDocumento(ctx, pago.operacionId, fichero(papel));

    const otra = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    await tickets.subirTickets(ctx, otra.id, [fichero(papel)]);

    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const [linea] = await tickets.subirTickets(ctx, l.id, [fichero(papel)]);
    const porTipo = linea.duplicados.map((d) => `${d.referenciaTipo}:${d.referenciaNumero}`).sort();
    expect(porTipo).toEqual([`DOCUMENTO:${pago.numero}`, `LINEA:${otra.numero}`].sort());

    // Excluir la línea resuelve TODAS sus coincidencias pendientes…
    const excluida = await tickets.resolverDuplicado(ctx, l.id, linea.duplicados[0].id, {
      resolucion: "EXCLUIDA",
      motivo: "",
    });
    expect(excluida.situacion).toBe("EXCLUIDA");
    expect(excluida.excluidaMotivo).toMatch(/^Duplicado de /);
    expect(excluida.duplicados.every((d) => d.resolucion === "EXCLUIDA")).toBe(true);

    // …y volver a incluirla las reabre: si se va a pagar, hay que volver a decidir.
    const incluida = await tickets.incluirLinea(ctx, l.id, linea.id);
    expect(incluida.duplicados.every((d) => d.resolucion === "PENDIENTE")).toBe(true);
  });

  it("lo de una liquidación anulada ya no cuenta como duplicado", async () => {
    const papel = await pdf(`anulada ${sufijo}`);
    const vieja = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    await tickets.subirTickets(ctx, vieja.id, [fichero(papel)]);
    await liquidaciones.anularLiquidacion(ctx, vieja.id, "Se hizo por error");

    const nueva = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const [linea] = await tickets.subirTickets(ctx, nueva.id, [fichero(papel)]);
    expect(linea.duplicados).toEqual([]);
  });
});

describe.runIf(RUN)("Liquidaciones · aprobar, rechazar, anular", () => {
  async function presentadaDe(importe = 1000) {
    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const [x] = await tickets.subirTickets(ctx, l.id, [fichero(await pdf(`p ${randomUUID()}`))]);
    await aMano(l.id, x.id, importe, dietas);
    return liquidaciones.presentarLiquidacion(ctx, l.id);
  }

  it("con separación de funciones, quien presenta no aprueba", async () => {
    await sod(true);
    try {
      const l = await presentadaDe();
      await expect(liquidaciones.aprobarLiquidacion(ctx, l.id)).rejects.toMatchObject({
        codigo: "SOD_REQUIERE_OTRA_PERSONA",
      });
      expect((await liquidaciones.aprobarLiquidacion(ctxJefe, l.id)).estado).toBe("APROBADA");
    } finally {
      await sod(false);
    }
  });

  it("sin ella, el mismo puede (el taller de dos personas)", async () => {
    const l = await presentadaDe();
    expect((await liquidaciones.aprobarLiquidacion(ctx, l.id)).estado).toBe("APROBADA");
  });

  it("rechazar exige motivo, reabrir la devuelve a borrador y conserva el porqué", async () => {
    const l = await presentadaDe();
    await expect(liquidaciones.rechazarLiquidacion(ctxJefe, l.id, " ")).rejects.toMatchObject({
      codigo: "ENTRADA_NO_VALIDA",
    });
    const r = await liquidaciones.rechazarLiquidacion(ctxJefe, l.id, "Falta el ticket de la cena");
    expect(r.estado).toBe("RECHAZADA");
    // Rechazada no se edita sin reabrir.
    const [linea] = (await liquidaciones.detalleLiquidacion(ctx, l.id)).lineas;
    await expect(tickets.editarLinea(ctx, l.id, linea.id, { importeCentimos: 2000 })).rejects.toMatchObject({
      codigo: "LINEA_NO_EDITABLE",
    });
    const b = await liquidaciones.reabrirLiquidacion(ctx, l.id);
    expect(b.estado).toBe("BORRADOR");
    expect(b.rechazoMotivo).toBe("Falta el ticket de la cena");
    expect((await tickets.editarLinea(ctx, l.id, linea.id, { importeCentimos: 2000 })).importeCentimos).toBe(2000);
  });

  it("anular exige motivo y es definitivo", async () => {
    const l = await presentadaDe();
    await expect(liquidaciones.anularLiquidacion(ctx, l.id, "")).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
    const a = await liquidaciones.anularLiquidacion(ctx, l.id, "Duplicada con otra");
    expect(a.estado).toBe("ANULADA");
    await expect(liquidaciones.reabrirLiquidacion(ctx, l.id)).rejects.toMatchObject({ codigo: "TRANSICION_NO_VALIDA" });
  });

  it("una pagada no se anula desde aquí: se dice por qué", async () => {
    // El pago llega en la fase 2; se simula el estado para fijar la frontera ya.
    const l = await presentadaDe();
    await db.query(`UPDATE cash_expense_claims SET estado = 'PAGADA' WHERE id = $1`, [l.id]);
    await expect(liquidaciones.anularLiquidacion(ctx, l.id, "no")).rejects.toMatchObject({
      codigo: "LIQUIDACION_PAGADA",
    });
  });
});

describe.runIf(RUN)("Liquidaciones · identidad, numeración y ámbito", () => {
  it("por empleado: se crea su persona en Cash una sola vez", async () => {
    const empleado = randomUUID();
    await db.query(`INSERT INTO sea_employees (id, nombre, apellidos, activo) VALUES ($1,$2,$3,true)`, [
      empleado,
      "Marta",
      `Soler ${sufijo}`,
    ]);
    const a = await liquidaciones.crearLiquidacion(ctx, { employeeId: empleado });
    const b = await liquidaciones.crearLiquidacion(ctx, { employeeId: empleado });
    expect(a.employeeId).toBe(empleado);
    expect(a.empleadoNombre).toBe(`Soler ${sufijo}, Marta`);
    // Una persona, una proyección: las dos liquidaciones apuntan al mismo destino.
    expect(b.expenseTargetId).toBe(a.expenseTargetId);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM cash_expense_targets WHERE empresa_id = $1 AND employee_id = $2`,
      [EMPRESA, empleado]
    );
    expect(rows[0].n).toBe(1);
  });

  it("si ya hay una persona suelta con ese nombre, no se enlaza sola: se pregunta", async () => {
    const empleado = randomUUID();
    await db.query(`INSERT INTO sea_employees (id, nombre, apellidos, activo) VALUES ($1,$2,$3,true)`, [
      empleado,
      "Pere",
      `Vidal ${sufijo}`,
    ]);
    const suelta = await config.crearDestino(ctx, { nombre: `Pere Vidal ${sufijo}`, tipo: "PERSONA" });
    await expect(liquidaciones.crearLiquidacion(ctx, { employeeId: empleado })).rejects.toMatchObject({
      codigo: "DESTINO_SIN_VINCULAR",
      detalle: { candidato: { id: suelta.id } },
    });
  });

  it("un empleado de baja o inexistente no", async () => {
    const baja = randomUUID();
    await db.query(`INSERT INTO sea_employees (id, nombre, activo) VALUES ($1,'Baja',false)`, [baja]);
    await expect(liquidaciones.crearLiquidacion(ctx, { employeeId: baja })).rejects.toMatchObject({
      codigo: "EMPLEADO_INACTIVO",
    });
    await expect(liquidaciones.crearLiquidacion(ctx, { employeeId: randomUUID() })).rejects.toMatchObject({
      codigo: "EMPLEADO_NO_ENCONTRADO",
    });
  });

  it("dos a la vez no repiten número", async () => {
    const [a, b, c] = await Promise.all([
      liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan }),
      liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan }),
      liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan }),
    ]);
    expect(new Set([a.numero, b.numero, c.numero]).size).toBe(3);
  });

  it("el ámbito de taller: la de otro taller no se ve; la creada sin ámbito sí", async () => {
    const tallerA = randomUUID();
    const tallerB = randomUUID();
    const deA = await liquidaciones.crearLiquidacion({ ...ctx, centroId: tallerA }, { expenseTargetId: juan });
    const sinAmbito = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });

    await expect(liquidaciones.detalleLiquidacion({ ...ctx, centroId: tallerB }, deA.id)).rejects.toMatchObject({
      codigo: "LIQUIDACION_DE_OTRO_CENTRO",
    });
    const vistasDesdeB = await liquidaciones.listarLiquidaciones({ ...ctx, centroId: tallerB }, {});
    expect(vistasDesdeB.some((x) => x.id === deA.id)).toBe(false);
    expect(vistasDesdeB.some((x) => x.id === sinAmbito.id)).toBe(true);
    expect((await liquidaciones.detalleLiquidacion({ ...ctx, centroId: tallerA }, deA.id)).liquidacion.id).toBe(deA.id);
  });

  it("la liquidación de otra empresa no existe", async () => {
    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    await expect(
      liquidaciones.detalleLiquidacion({ ...ctx, empresaId: "00000000-0000-4000-a000-0000000000fa" }, l.id)
    ).rejects.toMatchObject({ codigo: "LIQUIDACION_NO_ENCONTRADA" });
  });
});

describe.runIf(RUN)("Liquidaciones · el PDF", () => {
  it("sale en cualquier estado, con los tickets incluidos detrás", async () => {
    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const [a, b] = await tickets.subirTickets(ctx, l.id, [
      fichero(await pdf(`pdf a ${sufijo}`)),
      fichero(await pdf(`pdf b ${sufijo}`)),
    ]);
    await aMano(l.id, a.id, 2440, dietas);
    await tickets.excluirLinea(ctx, l.id, b.id, "no");

    const paginas = async () => (await PDFDocument.load(await informe.informeLiquidacion(ctx, l.id))).getPageCount();

    // Borrador: portada + el ticket incluido. El excluido no va detrás…
    const conUno = await paginas();
    expect(conUno).toBeGreaterThanOrEqual(2);
    // …y se nota: al volver a incluirlo, el PDF gana exactamente su página.
    await tickets.incluirLinea(ctx, l.id, b.id);
    expect(await paginas()).toBe(conUno + 1);
    await tickets.excluirLinea(ctx, l.id, b.id, "no");
    const enBorrador = await paginas();
    expect(enBorrador).toBe(conUno);

    await liquidaciones.presentarLiquidacion(ctx, l.id);
    expect(await paginas()).toBe(enBorrador);
    await liquidaciones.aprobarLiquidacion(ctxJefe, l.id);
    expect(await paginas()).toBe(enBorrador);
  });
});
