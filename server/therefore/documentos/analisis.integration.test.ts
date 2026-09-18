/**
 * El análisis del albarán, de punta a punta y contra PostgreSQL de verdad.
 *
 * Aquí se fijan los casos 10–23 del encargo. Todo pasa por donde pasará en
 * producción: entra un correo por HTTP, se adjunta un PDF por HTTP, el worker
 * coge la fila de la cola con `FOR UPDATE SKIP LOCKED` y el resultado se lee
 * por HTTP. Lo que se prueba es el camino, no una simulación del camino.
 *
 *   10  un PDF de un albarán → COMPLETADO, OK, todas sus líneas y la suma;
 *   11  un PDF de cinco, se pide uno → sólo sus líneas;
 *   12  «0501234» pedido y «ENT-770199-0501234» impreso → es el mismo;
 *   13  «0501234» y «0501235» en el mismo PDF → no se confunden;
 *   14  un albarán partido en dos páginas → una sola sección con todo;
 *   15  «60% + 10%» → dos filas en orden, con lo impreso intacto;
 *   16  el importe no cuadra → validación IMPORTE con el mensaje literal;
 *   17  referencia ilegible → null, y NO se corrige;
 *   18  cantidad ilegible → revisión, y la aritmética queda sin comprobar;
 *   19  el albarán no está → ERROR, y el expediente sigue gestionándose;
 *   20  dos albaranes pedidos → dos análisis independientes;
 *   21  un albarán pegado al siguiente → sin mezclar líneas;
 *   22  «Portes» detrás de las líneas → aparte, y fuera de la suma;
 *   23  MODIFICAR → el mismo análisis completo.
 *
 * Y tres cosas que sólo se ven contra la base: que una fila que se quedó
 * PROCESANDO vuelve sola a la cola, que reanalizar guarda la anterior en vez
 * de machacarla, y que una empresa no ve los análisis de otra.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pdfDeFactura, pdfEscaneado, type AlbaranFixture, type LineaFixture } from "../fixtures/albaranPdf.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

// Sin Supabase: los PDF de la prueba van a disco, como en la CI.
process.env.THEREFORE_STORAGE_LOCAL = "1";

vi.mock("../../core/auth.ts", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.authCtx = {
      userId: String(req.headers["x-test-user"] ?? ""),
      username: "prueba",
      nombre: "Prueba",
      empresaId: String(req.headers["x-test-empresa"] ?? ""),
      esSuperadmin: false,
    };
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));

let base = "";
let servidor: Server;
let db: typeof import("../../db.ts").default;
let procesarPendientes: typeof import("./worker.ts").procesarPendientes;

const EMPRESA_A = "00000000-0000-4000-a000-00000000da01";
const EMPRESA_B = "00000000-0000-4000-a000-00000000db01";
const ADMIN_A = "00000000-0000-4000-a000-0000000000d1";
const CONSULTA_A = "00000000-0000-4000-a000-0000000000d2";
const ADMIN_B = "00000000-0000-4000-a000-0000000000d3";

const adminA = { usuario: ADMIN_A, empresa: EMPRESA_A };
const consultaA = { usuario: CONSULTA_A, empresa: EMPRESA_A };
const adminB = { usuario: ADMIN_B, empresa: EMPRESA_B };

type Quien = { usuario: string; empresa: string };
type Respuesta = { status: number; body: any };

function api(ruta: string, quien: Quien, init?: { method?: string; body?: unknown }): Promise<Respuesta> {
  return fetch(`${base}/api/therefore${ruta}`, {
    method: init?.method ?? "GET",
    headers: {
      "x-test-user": quien.usuario,
      "x-test-empresa": quien.empresa,
      "Content-Type": "application/json",
    },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

/** El PDF va por multipart, como irá desde el panel. */
async function subirPdf(expedienteId: string, pdf: Buffer, quien: Quien = adminA): Promise<Respuesta> {
  const form = new FormData();
  form.append("archivo", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "factura.pdf");
  return fetch(`${base}/api/therefore/expedientes/${expedienteId}/documentos`, {
    method: "POST",
    headers: { "x-test-user": quien.usuario, "x-test-empresa": quien.empresa },
    body: form,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

let contador = 0;
function messageId(): string {
  contador += 1;
  return `<thf-alb-${contador}-${Date.now()}@ejemplo.invalid>`;
}

type Accion = { accion: string; albaran?: string; importeCentimos?: number | null };

async function importar(acciones: Accion[], quien: Quien = adminA): Promise<string> {
  const r = await api("/correos", quien, {
    method: "POST",
    body: {
      messageId: messageId(),
      fecha: "2026-09-01T08:15:00.000Z",
      de: "therefore@ejemplo.invalid",
      para: "incidencias@ejemplo.invalid",
      asunto: "Incidencia en factura F-2026-0001",
      texto: "Por favor, gestiona los albaranes de la factura F-2026-0001.",
      tipo: "INCIDENCIA_ALBARAN",
      empresaCodigo: "007",
      proveedorNombre: "PROVEEDOR EJEMPLO SL",
      facturaNumero: "F-2026-0001",
      facturaFecha: "2026-08-31",
      acciones,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.expedienteId;
}

/** Importa, adjunta el PDF y vacía la cola. Es el camino completo. */
async function analizar(acciones: Accion[], pdf: Buffer): Promise<{ expedienteId: string; analisis: any }> {
  const expedienteId = await importar(acciones);
  const subida = await subirPdf(expedienteId, pdf);
  expect(subida.status, JSON.stringify(subida.body)).toBe(201);
  await procesarPendientes(10);
  const r = await api(`/expedientes/${expedienteId}/analisis`, adminA);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { expedienteId, analisis: r.body };
}

const de = (albaran: any, tipo: string) => albaran.validaciones.find((v: any) => v.tipo === tipo);

/* ── El papel de las pruebas ─────────────────────────────────────────────── */

const LINEA_UNO: LineaFixture = {
  ref: "4400111222333",
  desc: "PASTILLA FRENO DELT",
  cant: "1,00",
  precio: "77,50",
  dto: "60% + 10%",
  importe: "27,90",
};
const LINEA_DOS: LineaFixture = {
  ref: "4400111222444",
  desc: "DISCO FRENO TRAS",
  cant: "2,00",
  precio: "155,00",
  dto: "40%",
  importe: "186,00",
};

const uno = (numero: string | null, lineas: LineaFixture[] = [LINEA_UNO], extra: Partial<AlbaranFixture> = {}) =>
  ({ numero, lineas, ...extra }) satisfies AlbaranFixture;

async function limpiarHistorico(empresas: readonly string[]): Promise<void> {
  const cliente = await db.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query(`ALTER TABLE thf_eventos DISABLE TRIGGER thf_eventos_inmutable_trg`);
    await cliente.query(`DELETE FROM thf_eventos WHERE empresa_id = ANY($1)`, [empresas]);
    await cliente.query(`ALTER TABLE thf_eventos ENABLE TRIGGER thf_eventos_inmutable_trg`);
    await cliente.query("COMMIT");
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

afterAll(async () => {
  servidor?.close();
  await db?.end().catch(() => {});
});

describe.runIf(RUN)("El análisis de albaranes de Therefore", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    procesarPendientes = (await import("./worker.ts")).procesarPendientes;

    await db.query(`
      CREATE TABLE IF NOT EXISTS app_usuario_modulos (
        user_id UUID NOT NULL,
        modulo TEXT NOT NULL,
        rol TEXT,
        pantallas TEXT[],
        centro_id UUID,
        PRIMARY KEY (user_id, modulo)
      );
    `);
    for (const [usuario, rol] of [
      [ADMIN_A, "admin"],
      [CONSULTA_A, "consulta"],
      [ADMIN_B, "admin"],
    ] as const) {
      await db.query(
        `INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'therefore',$2)
         ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`,
        [usuario, rol]
      );
    }

    const { createThereforeRouter } = await import("../router.ts");
    const app = express();
    app.use(express.json());
    app.use("/api/therefore", createThereforeRouter());
    await new Promise<void>((listo) => {
      servidor = app.listen(0, () => {
        base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
        listo();
      });
    });
  }, 60_000);

  beforeEach(async () => {
    const empresas = [EMPRESA_A, EMPRESA_B];
    await limpiarHistorico(empresas);
    await db.query(`DELETE FROM thf_validaciones WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_albaranes_analizados WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_documentos WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_decisiones WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_adjuntos WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_notificaciones WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_actuaciones WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_expedientes WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_contadores WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_config WHERE empresa_id = ANY($1)`, [empresas]);
  });

  /* ── Caso 10 ───────────────────────────────────────────────────────────── */

  it("10 · un PDF de un albarán: COMPLETADO, OK, sus líneas y la suma calculada", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO, LINEA_DOS], { matricula: "4417KDT", bastidor: "WZ10A2BCDEF345678" })],
      totales: { base: "213,90", total: "258,82" },
    });
    const { analisis } = await analizar(
      [{ accion: "GRABAR", albaran: "0501234", importeCentimos: 21390 }],
      pdf
    );

    expect(analisis.albaranes).toHaveLength(1);
    const a = analisis.albaranes[0];
    expect(a.estadoProceso).toBe("COMPLETADO");
    expect(a.estadoAnalisis).toBe("OK");
    expect(a.lineas).toHaveLength(2);
    expect(a.importeLineasCentimos).toBe(2790 + 18600);
    expect(a.diferenciaCentimos).toBe(0);
    expect(a.matricula).toBe("4417KDT");
    expect(a.bastidor).toBe("WZ10A2BCDEF345678");

    // La cabecera del documento se guarda una vez, con sus totales.
    expect(analisis.documentos).toHaveLength(1);
    expect(analisis.documentos[0].numeroDocumento).toBe("F-2026-0001");
    expect(analisis.documentos[0].totalCentimos).toBe(25882);
  });

  /* ── Casos 11, 12, 13 ──────────────────────────────────────────────────── */

  it("11 · con cinco albaranes en la factura, sólo se cogen las líneas del pedido", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [1, 2, 3, 4, 5].map((n) =>
        uno(`050123${n}`, [{ ref: `99000${n}`, desc: `ARTICULO ${n}`, cant: "1,00", precio: `${n}0,00`, dto: "-", importe: `${n}0,00` }])
      ),
      totales: { base: "150,00", total: "181,50" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501233", importeCentimos: 3000 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.lineas).toHaveLength(1);
    expect(a.lineas[0].referencia).toBe("990003");
    expect(a.importeLineasCentimos).toBe(3000);
    expect(de(a, "SEPARACION_ALBARANES").estado).toBe("OK");
  });

  it("12 · se pide 0501234 y el papel pone ENT-770199-0501234: es el mismo", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("ENT-770199-0501234")],
      totales: { base: "27,90", total: "33,76" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.resultadoMatch).toBe("MATCH");
    expect(Number(a.confianzaMatch)).toBeGreaterThanOrEqual(0.9);
    expect(a.numeroDocumento).toBe("ENT-770199-0501234");
  });

  it("13 · 0501234 y 0501235 en el mismo PDF no se confunden", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO]), uno("0501235", [LINEA_DOS])],
      totales: { base: "213,90", total: "258,82" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501235", importeCentimos: 18600 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.numeroDocumento).toBe("0501235");
    expect(a.lineas).toHaveLength(1);
    expect(a.lineas[0].referencia).toBe(LINEA_DOS.ref);
  });

  it("13b · un albarán que no está no se lleva las líneas del que se le parece", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501235", [LINEA_DOS])],
      totales: { base: "186,00", total: "225,06" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501236", importeCentimos: 18600 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.resultadoMatch).toBe("NO_MATCH");
    expect(a.lineas).toHaveLength(0);
    expect(a.metadata.parecidos).toContain("0501235");
  });

  /* ── Caso 14 ───────────────────────────────────────────────────────────── */

  it("14 · un albarán partido en dos páginas sigue siendo uno, con todas sus líneas", async () => {
    const pdf = await pdfDeFactura({
      conCabeceraYPie: true,
      albaranes: [uno("0501234", [LINEA_UNO, LINEA_DOS], { partirTras: 1 })],
      totales: { base: "213,90", total: "258,82" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 21390 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.lineas).toHaveLength(2);
    expect(a.paginaInicio).toBe(1);
    expect(a.paginaFin).toBe(2);
    expect(a.importeLineasCentimos).toBe(21390);
  });

  /* ── Caso 15 ───────────────────────────────────────────────────────────── */

  it("15 · «60% + 10%» son dos descuentos en orden, con lo impreso intacto", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234")],
      totales: { base: "27,90", total: "33,76" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }], pdf);

    const linea = analisis.albaranes[0].lineas[0];
    expect(linea.descuentos).toEqual([
      { orden: 1, porcentaje: 60, raw: "60%" },
      { orden: 2, porcentaje: 10, raw: "10%" },
    ]);
    // Y no se colapsan a un 64 % por el camino.
    expect(linea.descuentos.some((d: any) => d.porcentaje === 64)).toBe(false);
    expect(linea.cuadraAritmetica).toBe(true);
  });

  /* ── Caso 16 ───────────────────────────────────────────────────────────── */

  it("16 · el importe de la incidencia no cuadra: validación IMPORTE con el mensaje literal", async () => {
    const { MENSAJE_DESCUADRE } = await import("../domain/validaciones.ts");
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO, LINEA_DOS])],
      totales: { base: "213,90", total: "258,82" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 19995 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.estadoAnalisis).toBe("REVISAR");
    expect(a.diferenciaCentimos).toBe(21390 - 19995);
    const v = de(a, "IMPORTE");
    expect(v.estado).toBe("REVISAR");
    expect(v.mensaje).toBe(MENSAJE_DESCUADRE);

    // Y el expediente queda pidiendo revisión, que es lo que lo hace visible.
    const ficha = await api(`/expedientes/${(await api(`/expedientes/${a.expedienteId}`, adminA)).body.expediente.id}`, adminA);
    expect(ficha.body.expediente.requiereRevision).toBe(true);
  });

  it("16b · los PDF en revisión se descargan en un zip con índice, sólo para quien configura", async () => {
    const { indiceZip } = await import("../zip.ts");
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO, LINEA_DOS])],
      totales: { base: "213,90", total: "258,82" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 19995 }], pdf);
    expect(analisis.albaranes[0].estadoAnalisis).toBe("REVISAR");

    const cabeceras = (q: Quien) => ({ "x-test-user": q.usuario, "x-test-empresa": q.empresa });
    const r = await fetch(`${base}/api/therefore/documentos/revision?dias=7`, { headers: cabeceras(adminA) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/zip");
    const entradas = indiceZip(Buffer.from(await r.arrayBuffer()));
    const nombres = entradas.map((e) => e.nombre);
    expect(nombres).toContain("indice.csv");
    expect(nombres.some((n) => /^INC-\d+_0501234_REVISAR\.pdf$/.test(n))).toBe(true);
    // El PDF va entero, sin comprimir.
    expect(entradas.find((e) => e.nombre.endsWith(".pdf"))?.tamano).toBe(pdf.length);

    // Consulta no puede: lleva precios de compra.
    const sinPermiso = await fetch(`${base}/api/therefore/documentos/revision`, { headers: cabeceras(consultaA) });
    expect(sinPermiso.status).toBe(403);
    // Otra empresa no ve nada suyo.
    const otra = await fetch(`${base}/api/therefore/documentos/revision`, { headers: cabeceras(adminB) });
    expect(otra.status).toBe(404);
  });

  it("16c · el PDF se devuelve con el albarán subrayado, y sin albarán no se devuelve", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO, LINEA_DOS]), uno("0509999", [LINEA_UNO])],
      totales: { base: "241,80", total: "292,58" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234" }], pdf);
    const a = analisis.albaranes[0];
    expect(a.resultadoMatch).toBe("MATCH");

    const cabeceras = (q: Quien) => ({ "x-test-user": q.usuario, "x-test-empresa": q.empresa });
    const r = await fetch(`${base}/api/therefore/albaranes/${a.id}/documento/resaltado`, {
      headers: cabeceras(adminA),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
    const bytes = Buffer.from(await r.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    // Es el documento del proveedor con algo encima, no un documento nuevo.
    const { PDFDocument } = await import("pdf-lib");
    const salida = await PDFDocument.load(bytes);
    const original = await PDFDocument.load(pdf);
    expect(salida.getPageCount()).toBe(original.getPageCount());
    expect(bytes.length).toBeGreaterThan(pdf.length);

  });

  it("16d · un albarán que no está en el papel no se puede subrayar, y se dice", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0509999", [LINEA_DOS])],
      totales: { base: "186,00", total: "225,06" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234" }], pdf);
    const a = analisis.albaranes[0];
    expect(a.estadoAnalisis).toBe("ERROR");

    const r = await fetch(`${base}/api/therefore/albaranes/${a.id}/documento/resaltado`, {
      headers: { "x-test-user": adminA.usuario, "x-test-empresa": adminA.empresa },
    });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code?: string }).code).toBe("SIN_RESALTADO");
  });

  it("16e · «prepara todos los albaranes»: uno por cada uno del documento, y sin repetir", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO]), uno("0509999", [LINEA_DOS])],
      totales: { base: "213,90", total: "258,82" },
    });
    // El correo pide la factura entera: una actuación GRABAR sin número.
    const expedienteId = await importar([{ accion: "GRABAR" }]);
    const sinPdf = await api(`/expedientes/${expedienteId}/albaranes/preparar`, adminA, { method: "POST" });
    expect(sinPdf.status).toBe(409);
    expect(sinPdf.body.code).toBe("SIN_DOCUMENTO");

    expect((await subirPdf(expedienteId, pdf)).status).toBe(201);
    const r = await api(`/expedientes/${expedienteId}/albaranes/preparar`, adminA, { method: "POST" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.encontrados).toEqual(["0501234", "0509999"]);
    expect(r.body.preparados).toEqual(["0501234", "0509999"]);
    // La genérica se retira: ya no hay nada que hacer en ella, y dejarla viva
    // impediría dar el expediente por resuelto.
    expect(r.body.retiradas).toBe(1);
    const tras = (await api(`/expedientes/${expedienteId}`, adminA)).body.actuaciones;
    const generica = tras.find((a: any) => !a.albaranSolicitado);
    expect(generica.estado).toBe("DESCARTADA");
    expect(generica.observaciones).toContain("Desglosada en 2");
    expect(tras.filter((a: any) => a.estado !== "DESCARTADA")).toHaveLength(2);

    // Cada una entra en la cola: al vaciarla están las dos analizadas.
    await procesarPendientes(10);
    const analisis = (await api(`/expedientes/${expedienteId}/analisis`, adminA)).body;
    expect(analisis.albaranes.map((a: any) => a.numeroDocumento).sort()).toEqual(["0501234", "0509999"]);
    for (const a of analisis.albaranes) expect(a.resultadoMatch).toBe("MATCH");

    // Pedirlo otra vez no duplica nada.
    const otra = await api(`/expedientes/${expedienteId}/albaranes/preparar`, adminA, { method: "POST" });
    expect(otra.body.preparados).toEqual([]);
    expect(otra.body.yaEstaban).toEqual(["0501234", "0509999"]);
  });

  it("16f · si el documento no trae ningún número de albarán, no se inventa ninguno", async () => {
    const pdf = await pdfEscaneado();
    const expedienteId = await importar([{ accion: "GRABAR" }]);
    expect((await subirPdf(expedienteId, pdf)).status).toBe(201);

    const r = await api(`/expedientes/${expedienteId}/albaranes/preparar`, adminA, { method: "POST" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("SIN_ALBARANES");
    const ficha = await api(`/expedientes/${expedienteId}`, adminA);
    expect(ficha.body.actuaciones).toHaveLength(1);
  });

  /* ── Casos 17 y 18 ─────────────────────────────────────────────────────── */

  it("17 · una referencia ilegible se deja en null y NO se corrige", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [
        uno("0501234", [
          { ...LINEA_UNO, ref: "440011122233" },
          { ...LINEA_DOS, ref: "440011122244" },
          { ref: "44OO11122255", desc: "LIQUIDO FRENOS", cant: "4,00", precio: "22,00", dto: "28%", importe: "63,36" },
        ]),
      ],
      totales: { base: "277,26", total: "335,48" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 27726 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.lineas).toHaveLength(3);
    expect(a.lineas[2].referencia).toBeNull();
    expect(Number(a.lineas[2].confianza.referencia)).toBeCloseTo(0.3, 5);
    expect(a.estadoAnalisis).toBe("REVISAR");
    expect(de(a, "CAMPOS_CRITICOS").estado).toBe("REVISAR");
    // Las otras dos no se tocan: sólo la dudosa.
    expect(a.lineas[0].referencia).toBe("440011122233");
  });

  it("18 · una cantidad ilegible deja la aritmética sin comprobar y manda a revisión", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [{ ...LINEA_UNO, cant: "??" }])],
      totales: { base: "27,90", total: "33,76" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.lineas[0].cantidad).toBeNull();
    expect(a.lineas[0].cuadraAritmetica).toBeNull();
    expect(a.estadoAnalisis).toBe("REVISAR");
    expect(de(a, "LINEAS").estado).toBe("REVISAR");
  });

  /* ── Caso 19 ───────────────────────────────────────────────────────────── */

  it("19 · el albarán no está en el documento: ERROR, y el expediente sigue gestionándose", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0509999", [LINEA_DOS])],
      totales: { base: "186,00", total: "225,06" },
    });
    const { expedienteId, analisis } = await analizar(
      [{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }],
      pdf
    );

    const a = analisis.albaranes[0];
    expect(a.estadoAnalisis).toBe("ERROR");
    expect(de(a, "ALBARAN_MATCH").mensaje).toContain("Albarán no encontrado");

    // El fallo del análisis NO toca la actuación: el trabajo sigue siendo el
    // mismo aunque el papel no lo respalde, y alguien tiene que poder hacerlo.
    const ficha = await api(`/expedientes/${expedienteId}`, adminA);
    expect(ficha.body.actuaciones[0].estado).toBe("PENDIENTE");
    const mover = await api(`/actuaciones/${ficha.body.actuaciones[0].id}/resolver`, adminA, {
      method: "POST",
      body: { observaciones: "Grabado a mano." },
    });
    expect(mover.status, JSON.stringify(mover.body)).toBe(200);
  });

  /* ── Casos 20 y 21 ─────────────────────────────────────────────────────── */

  it("20 · dos albaranes pedidos dan dos análisis independientes", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO]), uno("0501299", [LINEA_DOS])],
      totales: { base: "213,90", total: "258,82" },
    });
    const { analisis } = await analizar(
      [
        { accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 },
        { accion: "MODIFICAR", albaran: "0501299", importeCentimos: 18600 },
      ],
      pdf
    );

    expect(analisis.albaranes).toHaveLength(2);
    const porNumero = Object.fromEntries(analisis.albaranes.map((a: any) => [a.numeroSolicitado, a]));
    expect(porNumero["0501234"].importeLineasCentimos).toBe(2790);
    expect(porNumero["0501299"].importeLineasCentimos).toBe(18600);
    // Cada uno con su estado: son análisis separados, no uno con dos mitades.
    expect(porNumero["0501234"].estadoAnalisis).toBe("OK");
    expect(porNumero["0501299"].estadoAnalisis).toBe("OK");
  });

  it("21 · un albarán pegado al siguiente no mezcla líneas", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO]), uno("0501299", [LINEA_DOS])],
      totales: { base: "213,90", total: "258,82" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.lineas).toHaveLength(1);
    expect(a.lineas[0].referencia).toBe(LINEA_UNO.ref);
    expect(a.metadata.seccionesVecinas.siguiente).toBe("0501299");
  });

  /* ── Caso 22 ───────────────────────────────────────────────────────────── */

  it("22 · «Portes» detrás de las líneas no es un artículo ni entra en la suma", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO])],
      conceptos: [{ etiqueta: "Portes", importe: "12,50" }],
      totales: { base: "40,40", total: "48,88" },
    });
    const { analisis } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }], pdf);

    const a = analisis.albaranes[0];
    expect(a.lineas).toHaveLength(1);
    expect(a.importeLineasCentimos).toBe(2790);
    expect(a.metadata.conceptosAdicionales).toHaveLength(1);
    expect(a.metadata.conceptosAdicionales[0].importeCentimos).toBe(1250);
    // Y la diferencia NO se «explica» con los portes: sigue siendo cero aquí.
    expect(a.diferenciaCentimos).toBe(0);
  });

  /* ── Caso 23 ───────────────────────────────────────────────────────────── */

  it("23 · con MODIFICAR el análisis es el mismo: sólo cambia la acción", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [uno("0501234", [LINEA_UNO, LINEA_DOS])],
      totales: { base: "213,90", total: "258,82" },
    });
    const { expedienteId, analisis } = await analizar(
      [{ accion: "MODIFICAR", albaran: "0501234", importeCentimos: 21390 }],
      pdf
    );

    const a = analisis.albaranes[0];
    expect(a.estadoAnalisis).toBe("OK");
    expect(a.lineas).toHaveLength(2);
    expect(a.importeLineasCentimos).toBe(21390);

    const ficha = await api(`/expedientes/${expedienteId}`, adminA);
    expect(ficha.body.actuaciones[0].tipoAccion).toBe("MODIFICAR");
  });

  /* ── La cola, el reanálisis y el aislamiento ───────────────────────────── */

  it("sin ningún PDF adjunto, el análisis queda en ERROR diciendo que falta el documento", async () => {
    const expedienteId = await importar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }]);
    await procesarPendientes(10);

    const r = await api(`/expedientes/${expedienteId}/analisis`, adminA);
    const a = r.body.albaranes[0];
    expect(a.estadoProceso).toBe("ERROR");
    expect(a.error).toContain("Documento no disponible");

    // Y en cuanto llega uno, vuelve a la cola solo.
    const pdf = await pdfDeFactura({ albaranes: [uno("0501234")], totales: { base: "27,90", total: "33,76" } });
    const subida = await subirPdf(expedienteId, pdf);
    expect(subida.body.reencolados).toBe(1);
    await procesarPendientes(10);

    const despues = await api(`/expedientes/${expedienteId}/analisis`, adminA);
    expect(despues.body.albaranes[0].estadoProceso).toBe("COMPLETADO");
  });

  it("una fila que se quedó PROCESANDO vuelve sola a la cola", async () => {
    const expedienteId = await importar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }]);
    // Como si la instancia que la cogió se hubiera reiniciado hace media hora.
    await db.query(
      `UPDATE thf_albaranes_analizados
          SET estado_proceso = 'PROCESANDO', procesando_desde = now() - interval '30 minutes'
        WHERE expediente_id = $1`,
      [expedienteId]
    );
    const repo = await import("../repository.ts");
    expect(await repo.reencolarHuerfanos(10)).toBe(1);

    const { rows } = await db.query(
      `SELECT estado_proceso FROM thf_albaranes_analizados WHERE expediente_id = $1`,
      [expedienteId]
    );
    expect(rows[0].estado_proceso).toBe("PENDIENTE");
  });

  it("reanalizar crea una fila nueva y guarda la anterior en vez de machacarla", async () => {
    const pdf = await pdfDeFactura({ albaranes: [uno("0501234")], totales: { base: "27,90", total: "33,76" } });
    const { expedienteId, analisis } = await analizar(
      [{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }],
      pdf
    );
    const primera = analisis.albaranes[0];

    const ficha = await api(`/expedientes/${expedienteId}`, adminA);
    const actuacionId = ficha.body.actuaciones[0].id;
    const r = await api(`/actuaciones/${actuacionId}/reanalizar`, adminA, { method: "POST" });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    await procesarPendientes(10);

    const despues = await api(`/expedientes/${expedienteId}/analisis`, adminA);
    expect(despues.body.albaranes).toHaveLength(2);
    const vieja = despues.body.albaranes.find((a: any) => a.id === primera.id);
    expect(vieja.metadata.sustituidaPor).toBeTruthy();
  });

  it("una empresa no ve los análisis de otra, y consulta no puede adjuntar", async () => {
    const pdf = await pdfDeFactura({ albaranes: [uno("0501234")], totales: { base: "27,90", total: "33,76" } });
    const { expedienteId } = await analizar([{ accion: "GRABAR", albaran: "0501234", importeCentimos: 2790 }], pdf);

    // «No existe» y «no es tuyo» contestan igual: 404, no 403.
    const ajena = await api(`/expedientes/${expedienteId}/analisis`, adminB);
    expect(ajena.status).toBe(404);

    const sinPermiso = await subirPdf(expedienteId, pdf, consultaA);
    expect(sinPermiso.status).toBe(403);
  });
});
