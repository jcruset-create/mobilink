/**
 * El buzón de punta a punta, con un servidor IMAP falso y PostgreSQL de verdad.
 *
 * Lo falso es SÓLO el transporte: el buzón devuelve mensajes MIME compuestos
 * con nodemailer, que mailparser tiene que parsear como parsearía uno real. A
 * partir de ahí todo es el camino de producción: el parser del correo, el
 * almacenamiento del PDF, `procesarCorreo`, la cola de análisis.
 *
 * Lo que se fija:
 *   · un correo de Therefore con su PDF abre el expediente, guarda el PDF y
 *     encola el albarán;
 *   · el mismo correo dos veces es un duplicado, no dos expedientes;
 *   · un remitente que no está en la lista se ignora y se marca leído;
 *   · un correo anterior a la activación no se toca;
 *   · un correo que falla se queda SIN leer, para reintentarlo;
 *   · cada pasada deja su fila, y un buzón que no abre también.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { pdfDeFactura } from "./fixtures/albaranPdf.ts";
import type { ClienteBuzon, ConfigBuzon } from "./buzon.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
process.env.THEREFORE_STORAGE_LOCAL = "1";

vi.mock("../core/auth.ts", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));

const EMPRESA = "00000000-0000-4000-a000-00000000ea01";
const CFG: ConfigBuzon = {
  host: "imap.ejemplo.invalid",
  port: 993,
  user: "therefore@ejemplo.invalid",
  pass: "no-se-usa",
  carpeta: "INBOX",
  minutos: 5,
  empresaId: EMPRESA,
};
const REMITENTE = "therefore@sistema.invalid";

let db: typeof import("../db.ts").default;
let revisarBuzon: typeof import("./buzon.ts").revisarBuzon;
let repo: typeof import("./repository.ts");

type Mensaje = { uid: number; source: Buffer; seen: boolean; date: Date };

/**
 * Un buzón en memoria con la misma forma que ImapFlow.
 *
 * Aplica `seen` y `since` como lo haría el servidor (since por día), marca
 * las banderas y puede fallar al abrir, que es lo que hay que poder probar.
 */
function buzonFalso(mensajes: Mensaje[], opciones: { falloAlAbrir?: string } = {}): ClienteBuzon & { mensajes: Mensaje[] } {
  return {
    mensajes,
    async connect() {
      if (opciones.falloAlAbrir) throw new Error(opciones.falloAlAbrir);
    },
    async getMailboxLock() {
      return { release() {} };
    },
    async search(q) {
      const diaDesde = q.since ? new Date(new Date(q.since).toDateString()) : null;
      return mensajes
        .filter((m) => (q.seen === undefined || m.seen === q.seen) && (!diaDesde || m.date >= diaDesde))
        .map((m) => m.uid);
    },
    async fetchOne(uid) {
      const m = mensajes.find((x) => String(x.uid) === uid);
      return m ? { source: m.source } : false;
    },
    async messageFlagsAdd(rango, flags) {
      const m = mensajes.find((x) => String(x.uid) === rango.uid);
      if (m && flags.includes("\\Seen")) m.seen = true;
    },
    async logout() {},
  };
}

let siguienteUid = 1;
async function mensaje(sobre: {
  de?: string;
  asunto?: string;
  texto: string;
  fecha?: Date;
  pdf?: Buffer;
  messageId?: string;
}): Promise<Mensaje> {
  const uid = siguienteUid++;
  const fecha = sobre.fecha ?? new Date();
  const composer = new MailComposer({
    from: sobre.de ?? REMITENTE,
    to: CFG.user,
    subject: sobre.asunto ?? "Incidencia en factura F-2026-0001",
    text: sobre.texto,
    date: fecha,
    messageId: sobre.messageId ?? `<buzon-${uid}-${Date.now()}@ejemplo.invalid>`,
    attachments: sobre.pdf ? [{ filename: "factura.pdf", content: sobre.pdf, contentType: "application/pdf" }] : [],
  });
  const source = await composer.compile().build();
  return { uid, source, seen: false, date: fecha };
}

/** El cuerpo con la plantilla de Therefore, tal y como lo lee el parser. */
const CUERPO = `Estimado usuario,

Se ha registrado una incidencia en la factura.

Empresa: 007 Comercial Ejemplo
Código Proveedor: 8.
Razón Social: PROVEEDOR EJEMPLO SL.
Nº Factura: F-2026-0001.
Fecha Factura: 31/08/2026.
Importe: 27,90.

Información Adicional:
Necesitamos que gestionéis los siguientes albaranes:
GRABAR
0501234 27.90e
`;

afterAll(async () => {
  await db?.end().catch(() => {});
});

describe.runIf(RUN)("El buzón de Therefore", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    ({ revisarBuzon } = await import("./buzon.ts"));
    repo = await import("./repository.ts");
  }, 60_000);

  beforeEach(async () => {
    const e = [EMPRESA];
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query(`ALTER TABLE thf_eventos DISABLE TRIGGER thf_eventos_inmutable_trg`);
      await c.query(`DELETE FROM thf_eventos WHERE empresa_id = ANY($1)`, [e]);
      await c.query(`ALTER TABLE thf_eventos ENABLE TRIGGER thf_eventos_inmutable_trg`);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
    for (const t of [
      "thf_buzon_pasadas", "thf_validaciones", "thf_albaranes_analizados", "thf_documentos",
      "thf_decisiones", "thf_adjuntos", "thf_notificaciones", "thf_actuaciones",
      "thf_expedientes", "thf_contadores", "thf_config",
    ]) {
      await db.query(`DELETE FROM ${t} WHERE empresa_id = ANY($1)`, [e]);
    }
  });

  it("un correo de Therefore con su PDF abre el expediente, guarda el PDF y encola el albarán", async () => {
    const pdf = await pdfDeFactura({ albaranes: [{ numero: "0501234", lineas: [] }] });
    const buzon = buzonFalso([await mensaje({ texto: CUERPO, pdf })]);

    const r = await revisarBuzon({ cliente: buzon, config: CFG });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r).toMatchObject({ correos: 1, procesados: 1, ignorados: 0, errores: 0 });
    expect(r.detalle[0].expedienteNumero).toMatch(/^INC-/);
    expect(buzon.mensajes[0].seen).toBe(true);

    const { rows: exps } = await db.query(`SELECT id, factura_numero FROM thf_expedientes WHERE empresa_id = $1`, [EMPRESA]);
    expect(exps).toHaveLength(1);
    expect(exps[0].factura_numero).toBe("F-2026-0001");

    const adjuntos = await repo.adjuntosDeExpediente(EMPRESA, exps[0].id);
    expect(adjuntos).toHaveLength(1);
    expect(adjuntos[0].storagePath).toBeTruthy();
    expect(adjuntos[0].tipoDocumento).toBe("PDF_FACTURA");

    const { rows: cola } = await db.query(
      `SELECT numero_solicitado, estado_proceso FROM thf_albaranes_analizados WHERE expediente_id = $1`,
      [exps[0].id]
    );
    expect(cola).toEqual([{ numero_solicitado: "0501234", estado_proceso: "PENDIENTE" }]);
  });

  it("el mismo correo dos veces es un duplicado, no dos expedientes", async () => {
    const m = await mensaje({ texto: CUERPO, messageId: "<repetido@ejemplo.invalid>" });
    const buzon = buzonFalso([m, { ...m, uid: 99, seen: false }]);
    const r = await revisarBuzon({ cliente: buzon, config: CFG });
    if ("error" in r) throw new Error(r.error);
    expect(r.detalle.map((d) => d.resultado)).toEqual(["procesado", "duplicado"]);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM thf_expedientes WHERE empresa_id = $1`, [EMPRESA]);
    expect(rows[0].n).toBe(1);
  });

  it("un remitente que no está en la lista se ignora y se marca leído", async () => {
    await db.query(
      `INSERT INTO thf_config (empresa_id, clave, valor) VALUES ($1, 'buzon.remitentes', $2)`,
      [EMPRESA, REMITENTE]
    );
    const buzon = buzonFalso([await mensaje({ de: "persona@ejemplo.invalid", texto: CUERPO })]);
    const r = await revisarBuzon({ cliente: buzon, config: CFG });
    if ("error" in r) throw new Error(r.error);
    expect(r).toMatchObject({ correos: 1, procesados: 0, ignorados: 1 });
    expect(r.detalle[0].error).toContain("Remitente no admitido");
    expect(buzon.mensajes[0].seen).toBe(true);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM thf_expedientes WHERE empresa_id = $1`, [EMPRESA]);
    expect(rows[0].n).toBe(0);
  });

  it("lo anterior a la activación no se toca, y la fecha de activación no cambia al reiniciar", async () => {
    const activacion = new Date("2026-09-10T10:00:00Z");
    const viejo = await mensaje({ texto: CUERPO, fecha: new Date("2026-09-10T08:00:00Z") });
    const nuevo = await mensaje({ texto: CUERPO, fecha: new Date("2026-09-10T12:00:00Z") });
    const buzon = buzonFalso([viejo, nuevo]);

    const r = await revisarBuzon({ cliente: buzon, config: CFG, ahora: activacion });
    if ("error" in r) throw new Error(r.error);
    // El del mismo día pero anterior a la hora pasa el `since` del IMAP (que
    // es por día) y lo para la comprobación fina.
    expect(r.detalle.map((d) => d.resultado)).toEqual(["ignorado", "procesado"]);

    // Segunda pasada «tras un reinicio», con otro ahora: la activación no se mueve.
    const { rows } = await db.query(`SELECT valor FROM thf_config WHERE empresa_id = $1 AND clave = 'buzon.activado_el'`, [EMPRESA]);
    expect(new Date(rows[0].valor).toISOString()).toBe(activacion.toISOString());
    const r2 = await revisarBuzon({ cliente: buzon, config: CFG, ahora: new Date("2026-09-20T00:00:00Z") });
    if ("error" in r2) throw new Error(r2.error);
    expect(r2.correos).toBe(0);
  });

  it("un correo que falla se queda SIN leer, para reintentarlo", async () => {
    // Un correo sin cuerpo pasa el parser; uno cuya ingesta revienta no. Se
    // fuerza el fallo con una factura imposible de guardar: la empresa con la
    // tabla de contadores bloqueada. Más sencillo y fiel: se rompe la conexión
    // a mitad haciendo que el fetch del mensaje explote.
    const m = await mensaje({ texto: CUERPO });
    const buzon = buzonFalso([m]);
    const original = buzon.fetchOne.bind(buzon);
    let llamadas = 0;
    buzon.fetchOne = async (...args) => {
      llamadas++;
      if (llamadas === 1) throw new Error("conexión cortada");
      return original(...args);
    };

    const r1 = await revisarBuzon({ cliente: buzon, config: CFG });
    if ("error" in r1) throw new Error(r1.error);
    expect(r1).toMatchObject({ correos: 1, errores: 1, procesados: 0 });
    expect(buzon.mensajes[0].seen).toBe(false);

    const r2 = await revisarBuzon({ cliente: buzon, config: CFG });
    if ("error" in r2) throw new Error(r2.error);
    expect(r2).toMatchObject({ correos: 1, procesados: 1, errores: 0 });
    expect(buzon.mensajes[0].seen).toBe(true);
  });

  it("cada pasada deja su fila, y un buzón que no abre también", async () => {
    const r = await revisarBuzon({ cliente: buzonFalso([], { falloAlAbrir: "AUTHENTICATIONFAILED" }), config: CFG });
    expect(r).toEqual({ error: "AUTHENTICATIONFAILED" });
    const { rows } = await db.query(
      `SELECT error, terminada_at IS NOT NULL AS cerrada FROM thf_buzon_pasadas WHERE empresa_id = $1`,
      [EMPRESA]
    );
    expect(rows).toEqual([{ error: "AUTHENTICATIONFAILED", cerrada: true }]);
  });
});
