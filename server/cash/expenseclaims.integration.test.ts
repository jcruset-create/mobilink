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
let pago: typeof import("./expenseclaims/pago.ts");
let stats: typeof import("./expensestats.ts");
let analisis: typeof import("./expenseclaims/analisis.ts");

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
  pago = await import("./expenseclaims/pago.ts");
  stats = await import("./expensestats.ts");
  analisis = await import("./expenseclaims/analisis.ts");

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

describe.runIf(RUN)("Liquidaciones · el pago", () => {
  /*
   * Un cajón con las piezas justas para pagar 82,28 € sin vuelta:
   * 50 + 20 + 10 + 2 + 0,20 + 0,05 + 0,02 + 0,01.
   */
  // Para una docena de pagos: cada prueba saca las mismas piezas.
  const FONDO = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1].map((valor) => ({
    valor,
    cantidad: 12,
  }));
  const PIEZAS_82_28 = [
    { valor: 5000, cantidad: 1 },
    { valor: 2000, cantidad: 1 },
    { valor: 1000, cantidad: 1 },
    { valor: 200, cantidad: 1 },
    { valor: 20, cantidad: 1 },
    { valor: 5, cantidad: 1 },
    { valor: 2, cantidad: 1 },
    { valor: 1, cantidad: 1 },
  ];

  let sesion = 0;
  let fecha = "";

  beforeAll(async () => {
    const { rows } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, activa, created_at_ms, updated_at_ms)
       VALUES ($1,'Centro',$2,true,$3,$3) RETURNING id`,
      [EMPRESA, `Pago liquidaciones ${sufijo}`, Date.now()]
    );
    sesion = (await servicio.abrirJornada(ctx, { registerId: rows[0].id, fondoManual: FONDO })).sesion.id;
    fecha = (await db.query(`SELECT fecha::text AS f FROM cash_sessions WHERE id = $1`, [sesion])).rows[0].f;
  });

  /** El ejemplo del encargo, aprobado y listo para pagar. */
  async function aprobada82() {
    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const ls = await tickets.subirTickets(ctx, l.id, [
      fichero(await pdf(`p1 ${randomUUID()}`)),
      fichero(await pdf(`p2 ${randomUUID()}`)),
      fichero(await pdf(`p3 ${randomUUID()}`)),
      fichero(await pdf(`p4 ${randomUUID()}`)),
    ]);
    await aMano(l.id, ls[0].id, 2440, dietas);
    await aMano(l.id, ls[1].id, 4200, dietas);
    await aMano(l.id, ls[2].id, 1024, peajes);
    await aMano(l.id, ls[3].id, 564, peajes);
    await liquidaciones.presentarLiquidacion(ctx, l.id);
    return liquidaciones.aprobarLiquidacion(ctxJefe, l.id);
  }

  const enEfectivo = (clave: string, importe = 8228) => ({
    sessionId: sesion,
    importeCentimos: importe,
    formasPago: [{ forma: "CASH", importe }],
    efectivoEntregado: PIEZAS_82_28,
    idempotencyKey: clave,
  });

  const gastoDelDia = () =>
    stats.informeDeGasto(
      { empresaId: EMPRESA, desde: fecha, hasta: fecha, granularidad: "dia", centroId: null, conceptoId: null },
      false
    );

  it("sale UN pago por el total, del cajón, y los tickets quedan como sus justificantes", async () => {
    const l = await aprobada82();
    const operacionesAntes = await contar("cash_operations");
    const antes = await gastoDelDia();

    const r = await pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(`clave-${randomUUID()}`));
    expect(r.repetido).toBe(false);
    expect(r.liquidacion.estado).toBe("PAGADA");
    expect(r.liquidacion.operationPagoId).toBe(r.pago.operacionId);
    expect(r.liquidacion.pagoNumero).toBe(r.pago.numero);
    expect(await contar("cash_operations")).toBe(operacionesAntes + 1);

    // Es un pago normal de la caja, con la liquidación como referencia.
    const { rows: ops } = await db.query(
      `SELECT tipo, importe_centimos, party_nombre, referencia, expense_concept_id, created_by
         FROM cash_operations WHERE id = $1`,
      [r.pago.operacionId]
    );
    expect(ops[0]).toMatchObject({
      tipo: "PAYMENT",
      party_nombre: `Juan ${sufijo}`,
      referencia: l.numero,
      expense_concept_id: null,
      created_by: APRUEBA,
    });
    expect(Number(ops[0].importe_centimos)).toBe(8228);

    // Las piezas salieron de verdad: 82,28 € menos en el cajón.
    const { rows: mov } = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN direccion = 'OUT' THEN valor_unitario_centimos * cantidad ELSE -valor_unitario_centimos * cantidad END), 0)::bigint AS sale
         FROM cash_denomination_movements WHERE operation_id = $1`,
      [r.pago.operacionId]
    );
    expect(Number(mov[0].sale)).toBe(8228);

    // Los cuatro tickets, colgados del pago con la MISMA ruta: sin copiar el fichero.
    const { rows: docs } = await db.query(
      `SELECT d.ruta FROM cash_operation_documents d WHERE d.operation_id = $1 AND NOT d.anulado ORDER BY d.id`,
      [r.pago.operacionId]
    );
    const { rows: rutas } = await db.query(
      `SELECT ruta FROM cash_expense_claim_lines WHERE claim_id = $1 ORDER BY orden`,
      [l.id]
    );
    expect(docs.map((d: { ruta: string }) => d.ruta)).toEqual(rutas.map((x: { ruta: string }) => x.ruta));
    // Y por eso salen en el informe de cierre del día.
    const delDia = await documentos.documentosDeJornada(sesion);
    expect(delDia.filter((d) => d.operacionNumero === r.pago.numero)).toHaveLength(4);

    // La auditoría del pago, escrita con él.
    const { rows: aud } = await db.query(
      `SELECT detalle FROM app_auditoria WHERE accion = 'cash.expense_claim.pay' AND entidad_id = $1`,
      [String(l.id)]
    );
    expect(aud).toHaveLength(1);
    expect(aud[0].detalle.pago).toBe(r.pago.numero);

    /*
     * La estadística reparte el pago por concepto en vez de dejarlo en «sin
     * clasificar», y el total y las operaciones suben exactamente lo pagado:
     * 82,28 € y UNA operación, aunque sean dos conceptos.
     */
    const despues = await gastoDelDia();
    expect(despues.totalCentimos - antes.totalCentimos).toBe(8228);
    expect(despues.operaciones - antes.operaciones).toBe(1);
    expect(despues.sinClasificarCentimos).toBe(antes.sinClasificarCentimos);
    const de = (inf: Awaited<ReturnType<typeof gastoDelDia>>, id: number) =>
      inf.conceptos.find((c) => c.conceptoId === id)?.importeCentimos ?? 0;
    expect(de(despues, dietas) - de(antes, dietas)).toBe(6640);
    expect(de(despues, peajes) - de(antes, peajes)).toBe(1588);

    // Las dietas se imputan al trabajador; los peajes (NINGUNO), a nadie.
    const porPersona = await stats.informeDeGasto(
      { empresaId: EMPRESA, desde: fecha, hasta: fecha, granularidad: "dia", centroId: null, conceptoId: dietas },
      false
    );
    expect(porPersona.destinos.find((d) => d.destinoId === juan)?.importeCentimos).toBeGreaterThanOrEqual(6640);
  });

  it("un ticket excluido ni se paga, ni se cuelga del pago, ni cuenta como gasto", async () => {
    /*
     * La liquidación aprobada de 82,28 € con un quinto ticket excluido de
     * 18,00 €. Si se colara en alguna parte, el pago dejaría de cuadrar con lo
     * que se ve: cinco justificantes para cuatro gastos, o 100,28 € de gasto
     * para 82,28 € pagados.
     */
    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const ls = await tickets.subirTickets(ctx, l.id, [
      fichero(await pdf(`e1 ${randomUUID()}`)),
      fichero(await pdf(`e2 ${randomUUID()}`)),
      fichero(await pdf(`e3 ${randomUUID()}`)),
      fichero(await pdf(`e4 ${randomUUID()}`)),
      fichero(await pdf(`copas ${randomUUID()}`)),
    ]);
    await aMano(l.id, ls[0].id, 2440, dietas);
    await aMano(l.id, ls[1].id, 4200, dietas);
    await aMano(l.id, ls[2].id, 1024, peajes);
    await aMano(l.id, ls[3].id, 564, peajes);
    await aMano(l.id, ls[4].id, 1800, dietas);
    await tickets.excluirLinea(ctx, l.id, ls[4].id, "Las copas no se reembolsan");
    await liquidaciones.presentarLiquidacion(ctx, l.id);
    await liquidaciones.aprobarLiquidacion(ctxJefe, l.id);

    const antes = await gastoDelDia();
    const r = await pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(`ex-${randomUUID()}`));
    const { rows: docs } = await db.query(
      `SELECT COUNT(*)::int AS n FROM cash_operation_documents WHERE operation_id = $1`,
      [r.pago.operacionId]
    );
    expect(docs[0].n).toBe(4);
    const despues = await gastoDelDia();
    expect(despues.totalCentimos - antes.totalCentimos).toBe(8228);
  });

  it("reintentar con la MISMA clave devuelve el mismo pago; con otra, es un error", async () => {
    const l = await aprobada82();
    const clave = `clave-${randomUUID()}`;
    const primero = await pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(clave));
    const operaciones = await contar("cash_operations");

    const otra = await pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(clave));
    expect(otra.repetido).toBe(true);
    expect(otra.pago).toEqual(primero.pago);
    expect(await contar("cash_operations")).toBe(operaciones);

    await expect(pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(`otra-${randomUUID()}`))).rejects.toMatchObject({
      codigo: "LIQUIDACION_YA_PAGADA",
    });
  });

  it("dos pagos a la vez con claves distintas: sale uno solo", async () => {
    const l = await aprobada82();
    const operaciones = await contar("cash_operations");
    const intentos = await Promise.allSettled([
      pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(`a-${randomUUID()}`)),
      pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(`b-${randomUUID()}`)),
    ]);
    expect(intentos.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await contar("cash_operations")).toBe(operaciones + 1);
  });

  it("sin clave, con otro importe o sin aprobar, no sale dinero", async () => {
    const l = await aprobada82();
    const operaciones = await contar("cash_operations");
    await expect(pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(""))).rejects.toMatchObject({
      codigo: "IDEMPOTENCY_KEY_REQUERIDA",
    });
    await expect(
      pago.pagarLiquidacion(ctxJefe, l.id, { ...enEfectivo(`x-${randomUUID()}`), importeCentimos: 8200 })
    ).rejects.toMatchObject({ codigo: "IMPORTE_NO_COINCIDE" });

    const presentada = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const [x] = await tickets.subirTickets(ctx, presentada.id, [fichero(await pdf(`np ${randomUUID()}`))]);
    await aMano(presentada.id, x.id, 8228, dietas);
    await liquidaciones.presentarLiquidacion(ctx, presentada.id);
    await expect(
      pago.pagarLiquidacion(ctxJefe, presentada.id, enEfectivo(`y-${randomUUID()}`))
    ).rejects.toMatchObject({ codigo: "TRANSICION_NO_VALIDA" });

    expect(await contar("cash_operations")).toBe(operaciones);
  });

  it("un concepto desactivado entre la aprobación y el pago lo para, y no deja nada a medias", async () => {
    const efimero = (await config.crearConcepto(ctx, { nombre: `Efimero ${sufijo}`, tipoDestino: "NINGUNO" })).id;
    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const [x] = await tickets.subirTickets(ctx, l.id, [fichero(await pdf(`ef ${randomUUID()}`))]);
    await aMano(l.id, x.id, 8228, efimero);
    await liquidaciones.presentarLiquidacion(ctx, l.id);
    await liquidaciones.aprobarLiquidacion(ctxJefe, l.id);
    await config.actualizarConcepto(ctx, efimero, { activo: false });

    const operaciones = await contar("cash_operations");
    await expect(pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(`z-${randomUUID()}`))).rejects.toMatchObject({
      codigo: "CONCEPTO_INACTIVO",
    });
    expect(await contar("cash_operations")).toBe(operaciones);
    expect((await liquidaciones.detalleLiquidacion(ctx, l.id)).liquidacion.estado).toBe("APROBADA");
  });

  it("por transferencia: sin piezas, el cajón no se toca", async () => {
    // El catálogo de la empresa se siembra la primera vez que se lista.
    const transferencia = (await config.listarFormasPago(EMPRESA)).find((f) => f.codigo === "BANK_TRANSFER");
    await config.actualizarFormaPago(ctx, transferencia!.id, { enPagos: true });
    const l = await aprobada82();
    const r = await pago.pagarLiquidacion(ctxJefe, l.id, {
      sessionId: sesion,
      importeCentimos: 8228,
      formasPago: [{ forma: "BANK_TRANSFER", importe: 8228, referencia: "TRF-2026-0925" }],
      idempotencyKey: `t-${randomUUID()}`,
    });
    const { rows: mov } = await db.query(
      `SELECT COUNT(*)::int AS n FROM cash_denomination_movements WHERE operation_id = $1`,
      [r.pago.operacionId]
    );
    expect(mov[0].n).toBe(0);
  });

  it("anular el pago en la caja devuelve la liquidación a APROBADA, y se puede volver a pagar", async () => {
    const l = await aprobada82();
    const r = await pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(`an-${randomUUID()}`));

    // Otra liquidación con el mismo ticket: coincide con el justificante del pago.
    const { rows: lineas } = await db.query(
      `SELECT ruta FROM cash_expense_claim_lines WHERE claim_id = $1 ORDER BY orden LIMIT 1`,
      [l.id]
    );
    const papel = await (await import("./storage.ts")).leerDocumento(lineas[0].ruta);
    const otra = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const [copia] = await tickets.subirTickets(ctx, otra.id, [fichero(papel!)]);
    const contraElPago = copia.duplicados.find((d) => d.referenciaTipo === "DOCUMENTO");
    expect(contraElPago?.referenciaNumero).toBe(r.pago.numero);

    const antes = await gastoDelDia();
    await servicio.anularOperacion(ctxJefe, r.pago.operacionId, "Se pagó a quien no era");

    const tras = (await liquidaciones.detalleLiquidacion(ctx, l.id)).liquidacion;
    expect(tras.estado).toBe("APROBADA");
    expect(tras.operationPagoId).toBeNull();
    expect(tras.pagoNumero).toBeNull();

    // Los justificantes del pago anulado se anulan, no se borran.
    const { rows: docs } = await db.query(
      `SELECT anulado, anulado_motivo FROM cash_operation_documents WHERE operation_id = $1`,
      [r.pago.operacionId]
    );
    expect(docs).toHaveLength(4);
    expect(docs.every((d: { anulado: boolean }) => d.anulado)).toBe(true);

    // La coincidencia con ese justificante ya no tiene sentido.
    const { rows: ev } = await db.query(`SELECT resolucion FROM cash_expense_claim_duplicates WHERE id = $1`, [
      contraElPago!.id,
    ]);
    expect(ev[0].resolucion).toBe("DESCARTADA");

    // La estadística deja de contarla.
    const despues = await gastoDelDia();
    expect(antes.totalCentimos - despues.totalCentimos).toBe(8228);

    // Y se puede pagar otra vez, con una clave nueva: es otro pago.
    const segundo = await pago.pagarLiquidacion(ctxJefe, l.id, enEfectivo(`an2-${randomUUID()}`));
    expect(segundo.pago.operacionId).not.toBe(r.pago.operacionId);
    expect(segundo.liquidacion.estado).toBe("PAGADA");

    // El PDF de la pagada sale igual que antes: portada + sus cuatro tickets.
    const { PDFDocument: P } = await import("pdf-lib");
    const paginas = (await P.load(await informe.informeLiquidacion(ctx, l.id))).getPageCount();
    expect(paginas).toBeGreaterThanOrEqual(5);
  });

  it("anular una operación que no es de ninguna liquidación sigue igual", async () => {
    const op = await servicio.registrarOperacion(ctx, {
      sessionId: sesion,
      tipo: "PAYMENT",
      importeCentimos: 1000,
      formasPago: [{ forma: "CASH", importe: 1000 }],
      efectivoEntregado: [{ valor: 1000, cantidad: 1 }],
      concepto: "suelto",
    });
    const r = await servicio.anularOperacion(ctx, op.operacionId, "prueba");
    expect(r.numero).toBeTruthy();
  });
});

describe.runIf(RUN)("Liquidaciones · la lectura automática", () => {
  /*
   * Sin clave de IA las líneas nacen OMITIDAS y la lectura no se intenta. Para
   * probar el camino con lectura se finge que la hay; el extractor, que es lo
   * único que llamaría al proveedor, es falso y devuelve un ticket conocido.
   */
  const claveAntes = process.env.OPENAI_API_KEY;
  const conIA = () => {
    process.env.OPENAI_API_KEY = "clave-ficticia-de-pruebas";
  };
  const sinIA = () => {
    if (claveAntes === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = claveAntes;
  };
  afterAll(sinIA);

  /** El ticket de la AP-2, tal y como lo devolvería el modelo. */
  const peaje = (extra: Record<string, unknown> = {}): import("./invoice-scan/types.ts").ExtraccionCruda => ({
    es_factura: true,
    tipo_documento: "TICKET",
    tipo_establecimiento: "PEAJE",
    facturas_detectadas: 1,
    factura: { numero: `AP2-${randomUUID().slice(0, 8)}`, fecha: "22/09/2026" },
    cliente: { codigo: null, nombre: null, nif: null },
    emisor: { nombre: "AUTOPISTAS AUMAR", nif: "A-28029130" },
    vehiculo: { marca: null, modelo: null, matricula: null },
    concepto: "Tránsito Lleida - Tarragona",
    totales: { base_imponible: null, iva_importe: null, iva_porcentaje: null, total: "10,24 €", moneda: "EUR" },
    recibo: {
      detectado: false, recibos_detectados: 0, plantilla: "DESCONOCIDA", importe: null, tipo_operacion: null,
      tarjeta: null, num_operacion: null, cod_autorizacion: null, comercio: null, terminal: null, red: null,
      adquirente: null, cuenta: null, fecha_hora: null, texto: null,
    },
    confianza: { numero_factura: 0.95, cliente: 0, emisor: 0.97, total: 0.99, concepto: 0.9, recibo: 0 },
    ...extra,
  });
  const extractor = (cruda = peaje()) => async () => cruda;

  let reglaPeaje = 0;
  beforeAll(async () => {
    reglaPeaje = (await config.guardarReglaGasto(ctx, { campo: "TIPO_ESTABLECIMIENTO", patron: "peaje", conceptoId: peajes })).id;
  });

  async function liquidacionConTicket() {
    const l = await liquidaciones.crearLiquidacion(ctx, { expenseTargetId: juan });
    const [x] = await tickets.subirTickets(ctx, l.id, [fichero(await pdf(`lect ${randomUUID()}`))]);
    return { l, x };
  }
  const linea = async (claimId: number, lineId: number) =>
    (await liquidaciones.detalleLiquidacion(ctx, claimId)).lineas.find((y) => y.id === lineId)!;

  it("sin IA, el ticket nace OMITIDO y no se puede pedir leerlo", async () => {
    sinIA();
    const { l, x } = await liquidacionConTicket();
    expect(x.analisis).toBe("OMITIDO");
    await expect(analisis.reintentarAnalisis(ctx, l.id, x.id)).rejects.toMatchObject({
      codigo: "LECTURA_NO_DISPONIBLE",
    });
  });

  it("con IA, se lee y RELLENA los huecos, y el concepto sale de la regla de la empresa", async () => {
    conIA();
    const { l, x } = await liquidacionConTicket();
    expect(x.analisis).toBe("PENDIENTE");
    await analisis.procesarPendientes(50, extractor());

    const y = await linea(l.id, x.id);
    expect(y.analisis).toBe("LISTO");
    expect(y).toMatchObject({
      fecha: "2026-09-22",
      emisorNombre: "AUTOPISTAS AUMAR",
      emisorNif: "A-28029130",
      importeCentimos: 1024,
      moneda: "EUR",
      expenseConceptId: peajes,
    });
    // Lo leído, guardado aparte y con el porqué del concepto.
    expect(y.leido?.tipoEstablecimiento).toBe("PEAJE");
    expect(y.leido?.conceptoPropuesto.reglaId).toBe(reglaPeaje);
    // Leer NO es revisar: sigue haciendo falta que una persona lo dé por bueno.
    expect(y.revisada).toBe(false);
    const { rows } = await db.query(`SELECT scan_id FROM cash_expense_claim_lines WHERE id = $1`, [x.id]);
    expect(rows[0].scan_id).toBeTruthy();

    // Y lo que la persona corrige queda apuntado: es la medida del acierto.
    const c = await tickets.editarLinea(ctx, l.id, x.id, { importeCentimos: 1000, revisada: true });
    expect(c.camposCorregidos).toEqual(["importeCentimos"]);
  });

  it("si la lectura del emisor es dudosa, el concepto se PROPONE pero no se pone solo", async () => {
    conIA();
    const { l, x } = await liquidacionConTicket();
    const dudosa = peaje({ confianza: { numero_factura: 0.9, cliente: 0, emisor: 0.5, total: 0.99, concepto: 0.9, recibo: 0 } });
    await analisis.procesarPendientes(50, extractor(dudosa));
    const y = await linea(l.id, x.id);
    expect(y.expenseConceptId).toBeNull();
    expect(y.leido?.conceptoPropuesto).toMatchObject({ conceptoId: peajes, autoSeleccionar: false });
    const { rows } = await db.query(`SELECT concepto_propuesto_id FROM cash_expense_claim_lines WHERE id = $1`, [x.id]);
    expect(rows[0].concepto_propuesto_id).toBe(peajes);
    // Lo demás sí se rellena: la duda es sobre el emisor, no sobre el importe.
    expect(y.importeCentimos).toBe(1024);
  });

  it("no pisa lo que una persona ya había escrito", async () => {
    conIA();
    const { l, x } = await liquidacionConTicket();
    await tickets.editarLinea(ctx, l.id, x.id, { emisorNombre: "Lo que puso Marta", importeCentimos: 999 });
    await analisis.procesarPendientes(50, extractor());
    const y = await linea(l.id, x.id);
    expect(y.emisorNombre).toBe("Lo que puso Marta");
    expect(y.importeCentimos).toBe(999);
    // Lo que estaba vacío, sí.
    expect(y.fecha).toBe("2026-09-22");
  });

  it("una línea ya revisada no se toca, y una liquidación ya presentada tampoco", async () => {
    conIA();
    const a = await liquidacionConTicket();
    await tickets.editarLinea(ctx, a.l.id, a.x.id, { revisada: true });
    const b = await liquidacionConTicket();
    await db.query(`UPDATE cash_expense_claims SET estado = 'PRESENTADA' WHERE id = $1`, [b.l.id]);

    await analisis.procesarPendientes(50, extractor());
    for (const { l, x } of [a, b]) {
      const y = await linea(l.id, x.id);
      expect(y.analisis).toBe("LISTO");
      expect(y.leido?.importeCentimos).toBe(1024);
      expect(y.importeCentimos).toBe(0);
      expect(y.fecha).toBeNull();
      expect(y.expenseConceptId).toBeNull();
    }
  });

  it("si la lectura falla, la línea queda FALLIDA con el fichero, y se puede reintentar", async () => {
    conIA();
    const { l, x } = await liquidacionConTicket();
    await analisis.procesarPendientes(50, async () => {
      throw new Error("El proveedor no responde");
    });
    let y = await linea(l.id, x.id);
    expect(y.analisis).toBe("FALLIDO");
    expect(y.analisisError).toContain("no responde");
    expect(y.url).toBeTruthy();

    // Fallida no bloquea: se rellena a mano y se presenta igual.
    await aMano(l.id, x.id, 1024, peajes);
    expect((await liquidaciones.detalleLiquidacion(ctx, l.id)).bloqueos).toEqual([]);

    await analisis.reintentarAnalisis(ctx, l.id, x.id);
    await analisis.procesarPendientes(50, extractor());
    y = await linea(l.id, x.id);
    expect(y.analisis).toBe("LISTO");
    // Ya estaba revisada a mano: lo leído se guarda y no cambia nada.
    expect(y.importeCentimos).toBe(1024);
  });

  it("un abono no rellena el importe: un ticket de gasto no devuelve dinero", async () => {
    conIA();
    const { l, x } = await liquidacionConTicket();
    await analisis.procesarPendientes(50, extractor(peaje({ tipo_documento: "ABONO", totales: { base_imponible: null, iva_importe: null, iva_porcentaje: null, total: "-10,24 €", moneda: "EUR" } })));
    const y = await linea(l.id, x.id);
    expect(y.leido?.esAbono).toBe(true);
    expect(y.importeCentimos).toBe(0);
  });

  it("un ticket en otra moneda se marca, y no se presenta hasta pasarlo a euros", async () => {
    conIA();
    const { l, x } = await liquidacionConTicket();
    await analisis.procesarPendientes(50, extractor(peaje({ totales: { base_imponible: null, iva_importe: null, iva_porcentaje: null, total: "12,00 GBP", moneda: "GBP" } })));
    expect((await linea(l.id, x.id)).moneda).toBe("GBP");
    await tickets.editarLinea(ctx, l.id, x.id, { revisada: true, importeCentimos: 1200, expenseConceptId: peajes, fecha: "2026-09-22" });
    // Con todo lo demás relleno, lo único que queda es la moneda.
    const d = await liquidaciones.detalleLiquidacion(ctx, l.id);
    expect(d.bloqueos.map((b) => b.codigo)).toEqual(["LINEA_EN_OTRA_MONEDA"]);
    await expect(liquidaciones.presentarLiquidacion(ctx, l.id)).rejects.toMatchObject({
      codigo: "LINEA_EN_OTRA_MONEDA",
    });
  });

  it("una lectura colgada vuelve a la cola; tras tres intentos, FALLIDA", async () => {
    conIA();
    const { l, x } = await liquidacionConTicket();
    const hace = Date.now() - analisis.ANALISIS_COLGADO_MS - 1000;
    await db.query(
      `UPDATE cash_expense_claim_lines SET analisis = 'ANALIZANDO', analisis_intentos = 1, updated_at_ms = $2 WHERE id = $1`,
      [x.id, hace]
    );
    await analisis.procesarPendientes(50, extractor());
    expect((await linea(l.id, x.id)).analisis).toBe("LISTO");

    const otro = await liquidacionConTicket();
    await db.query(
      `UPDATE cash_expense_claim_lines SET analisis = 'ANALIZANDO', analisis_intentos = $2, updated_at_ms = $3 WHERE id = $1`,
      [otro.x.id, analisis.MAXIMO_INTENTOS, hace]
    );
    await analisis.procesarPendientes(50, extractor());
    expect((await linea(otro.l.id, otro.x.id)).analisis).toBe("FALLIDO");
  });

  it("las reglas: guardar el mismo par lo reapunta, y una sin concepto vigente sale marcada", async () => {
    const r1 = await config.guardarReglaGasto(ctx, { campo: "NOMBRE_EMISOR", patron: `Cal Pere ${sufijo}`, conceptoId: dietas });
    const r2 = await config.guardarReglaGasto(ctx, { campo: "NOMBRE_EMISOR", patron: `Cal Pere ${sufijo}`, conceptoId: peajes });
    expect(r2.id).toBe(r1.id);
    expect(r2.conceptoId).toBe(peajes);

    await expect(
      config.guardarReglaGasto(ctx, { campo: "NOMBRE_EMISOR", patron: "x", conceptoId: 999_999 })
    ).rejects.toMatchObject({ codigo: "CONCEPTO_NO_ENCONTRADO" });
    await expect(
      config.guardarReglaGasto(ctx, { campo: "MATRICULA", patron: "x", conceptoId: dietas })
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });

    // El tipo se guarda como lo lee el modelo: en mayúsculas.
    expect((await config.guardarReglaGasto(ctx, { campo: "TIPO_ESTABLECIMIENTO", patron: "parking", conceptoId: dietas })).patron).toBe("PARKING");

    const temporal = (await config.crearConcepto(ctx, { nombre: `Temporal ${sufijo}` })).id;
    const r3 = await config.guardarReglaGasto(ctx, { campo: "CONCEPTO", patron: `temp ${sufijo}`, conceptoId: temporal });
    await db.query(`DELETE FROM cash_expense_concepts WHERE id = $1`, [temporal]);
    const listada = (await config.listarReglasGasto(EMPRESA)).find((r) => r.id === r3.id);
    expect(listada?.conceptoVigente).toBe(false);
  });
});
