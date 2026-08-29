/**
 * Correo del expediente contra PostgreSQL real.
 *
 * Lo que se fija:
 *   · una respuesta se engancha por la referencia del asunto Y por las
 *     cabeceras, que son las dos mitades de los casos reales
 *   · lo que no se reconoce NO se pierde: va a sin clasificar
 *   · el mismo correo entrante no se procesa dos veces
 *   · los adjuntos entran como documentos del expediente
 *   · un recordatorio no se manda dos veces, y deja de mandarse en cuanto
 *     llega lo que pedía
 *
 * El SMTP no está configurado a propósito: los mensajes quedan en el hilo con
 * estado `fallido`, que es exactamente lo que tiene que pasar en producción
 * cuando el correo está caído — el expediente enseña que la petición no salió.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");
let mod: typeof import("./index.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const DIA = 24 * 60 * 60 * 1000;

let asistencia = 0;
let otraAsistencia = 0;

async function crearAsistencia(estado = "finalizada") {
  const r = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", "customerPhone", address, plate,
        "descripcionAveria", "trackingToken", "finishedAtMs", "createdAtMs", "updatedAtMs")
     VALUES ($1,'normal','Cliente','600111222','AP-7 km 245','1234ABC','Rueda',$2,$3,$3,$3)
     RETURNING id`,
    [estado, `tok-mail-${sufijo}-${Math.random().toString(36).slice(2, 8)}`, now],
  );
  return Number(r.rows[0].id);
}

describe.skipIf(!RUN)("Correo del expediente", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("../dispatch/schema.ts");
    const { initDocumentos } = await import("../documentos/schema.ts");
    const { initCorreo } = await import("./schema.ts");
    await initDb();
    await initConnect();
    await initDispatch();
    await initDocumentos();
    await initCorreo();
    svc = await import("./servicio.ts");
    mod = await import("./index.ts");

    asistencia = await crearAsistencia();
    otraAsistencia = await crearAsistencia();
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    const ids = [String(asistencia), String(otraAsistencia)];
    await db.query(`DELETE FROM assistance_messages WHERE "assistanceId" = ANY($1::text[])
      OR asunto LIKE $2`, [ids, `%${sufijo}%`]).catch(() => {});
    await db.query(`DELETE FROM assistance_reminders WHERE "assistanceId" = ANY($1::text[])`, [ids]).catch(() => {});
    await db.query(`DELETE FROM assistance_documents WHERE "assistanceId" = ANY($1::text[])`, [ids]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_events WHERE "assistanceId" = ANY($1::text[])`, [ids]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM roadside_assistances WHERE "trackingToken" LIKE $1`,
      [`tok-mail-${sufijo}%`]).catch(() => {});
  }, 30_000);

  /*
   * Sin SMTP el correo no sale, pero el mensaje SÍ queda en el expediente. Si
   * no se guardara, nadie sabría que el taller nunca recibió la petición y el
   * albarán se esperaría eternamente.
   */
  it("un correo que no se puede enviar queda igualmente en el hilo, con su error", async () => {
    const r = await svc.enviarCorreo({
      system: "assist", assistanceId: asistencia, motivo: "solicitud_albaran",
      para: "Taller <TALLER@ejemplo.es>",
      datos: { expediente: `AST-${asistencia}`, matricula: "1234ABC" },
    });
    expect(r.estado).toBe("fallido");
    expect(r.error).toContain("SMTP");
    expect(r.asunto).toContain(`[AST-${asistencia}]`);

    const hilo = await svc.hiloDe("assist", asistencia);
    expect(hilo).toHaveLength(1);
    expect(hilo[0].direccion).toBe("saliente");
    expect(hilo[0].para).toBe("taller@ejemplo.es");   // normalizada
    expect(hilo[0].error).toBeTruthy();
  });

  it("rechaza un destinatario que no es una dirección", async () => {
    await expect(svc.enviarCorreo({
      system: "assist", assistanceId: asistencia, motivo: "solicitud_albaran",
      para: "no-es-un-correo", datos: { expediente: `AST-${asistencia}` },
    })).rejects.toThrow(/destinatario/i);
  });

  /* Primera mitad de los casos: reenvían el correo y el asunto conserva la referencia. */
  it("engancha una respuesta por la referencia del asunto", async () => {
    const r = await svc.procesarEntrante({
      messageId: `<resp1-${sufijo}@taller.es>`,
      from: "Marta <marta@ejemplo.es>",
      subject: `RV: Re: [AST-${asistencia}] Falta el albarán`,
      text: "Ahí va",
      fechaMs: now + 1000,
    });
    expect(r.enganchado).toBe(true);
    expect((r as any).assistanceId).toBe(String(asistencia));

    const hilo = await svc.hiloDe("assist", asistencia);
    expect(hilo.some((m) => m.direccion === "entrante")).toBe(true);
  });

  /* Segunda mitad: reescriben el asunto entero, y solo quedan las cabeceras. */
  it("engancha una respuesta por las cabeceras aunque el asunto se haya reescrito", async () => {
    const salida = await db.query(
      `SELECT "messageId" FROM assistance_messages
        WHERE "assistanceId" = $1 AND direccion = 'saliente' LIMIT 1`,
      [String(asistencia)]);
    const messageId = salida.rows[0].messageId;

    const r = await svc.procesarEntrante({
      messageId: `<resp2-${sufijo}@taller.es>`,
      inReplyTo: `<${messageId}>`,
      from: "marta@ejemplo.es",
      subject: "documentacion",          // sin referencia ninguna
      text: "adjunto",
      fechaMs: now + 2000,
    });
    expect(r.enganchado).toBe(true);
    expect((r as any).assistanceId).toBe(String(asistencia));
  });

  /*
   * Descartar un correo que no cuadra es como se pierde el albarán que alguien
   * mandó bien. Va a una bandeja de trabajo.
   */
  it("lo que no se reconoce no se pierde: va a sin clasificar", async () => {
    const r = await svc.procesarEntrante({
      messageId: `<suelto-${sufijo}@x.es>`,
      from: "desconocido@x.es",
      subject: `un correo cualquiera ${sufijo}`,
      text: "hola",
      fechaMs: now + 3000,
    });
    expect(r.enganchado).toBe(false);
    expect(r.duplicado).toBe(false);

    const bandeja = await svc.sinClasificar();
    expect(bandeja.some((m: any) => m.asunto.includes(sufijo))).toBe(true);
  });

  /* El buzón se lee cada pocos minutos: un reinicio a mitad de tanda releería. */
  it("el mismo correo entrante no se procesa dos veces", async () => {
    const correo = {
      messageId: `<repe-${sufijo}@x.es>`,
      from: "marta@ejemplo.es",
      subject: `[AST-${asistencia}] repetido`,
      text: "uno",
      fechaMs: now + 4000,
    };
    expect((await svc.procesarEntrante(correo)).duplicado).toBe(false);
    expect((await svc.procesarEntrante(correo)).duplicado).toBe(true);

    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM assistance_messages WHERE "messageId" = $1`,
      [`repe-${sufijo}@x.es`]);
    expect(n.rows[0].n).toBe(1);
  });

  it("los adjuntos entran como documentos del expediente", async () => {
    await svc.procesarEntrante({
      messageId: `<conadj-${sufijo}@x.es>`,
      from: "taller@ejemplo.es",
      subject: `[AST-${asistencia}] aquí va`,
      text: "adjunto el albarán",
      fechaMs: now + 5000,
      adjuntos: [
        { filename: `albaran-${sufijo}.pdf`, contentType: "application/pdf", url: "https://x/a.pdf" },
        { filename: "foto.jpg", contentType: "image/jpeg", url: "https://x/f.jpg" },
      ],
    });

    const docs = await db.query(
      `SELECT tipo, origen, visibilidad FROM assistance_documents
        WHERE "sourceSystem" = 'assist' AND "assistanceId" = $1 ORDER BY id`,
      [String(asistencia)]);
    const tipos = docs.rows.map((d: any) => d.tipo);
    expect(tipos).toContain("albaran");
    expect(tipos).toContain("fotografia");
    // Vienen del taller: origen proveedor.
    expect(docs.rows.every((d: any) => d.origen === "proveedor")).toBe(true);
  });

  /*
   * Un PDF cualquiera dado por albarán cerraría el expediente con el documento
   * equivocado. Lo que no se reconoce entra como «otro».
   */
  it("un adjunto con nombre irreconocible no se clasifica a ciegas", async () => {
    await svc.procesarEntrante({
      messageId: `<raro-${sufijo}@x.es>`,
      from: "taller@ejemplo.es",
      subject: `[AST-${otraAsistencia}] mira esto`,
      fechaMs: now + 6000,
      adjuntos: [{ filename: "documento1.pdf", contentType: "application/pdf", url: "https://x/d.pdf" }],
    });
    const d = await db.query(
      `SELECT tipo FROM assistance_documents WHERE "assistanceId" = $1`,
      [String(otraAsistencia)]);
    expect(d.rows[0].tipo).toBe("otro");
  });

  /* ── Recordatorios ────────────────────────────────────────────────────── */

  it("al finalizar, se programa que se pida lo que falta", async () => {
    const faltan = await mod.revisarDocumentacionAlFinalizar("assist", otraAsistencia);
    expect(faltan).toContain("albaran");

    const r = await db.query(
      `SELECT * FROM assistance_reminders WHERE "assistanceId" = $1`, [String(otraAsistencia)]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].motivo).toBe("albaran");
    expect(r.rows[0].intentos).toBe(0);
  });

  it("programarlo diez veces deja una sola fila", async () => {
    for (let i = 0; i < 10; i++) {
      await svc.programarRecordatorio("assist", otraAsistencia, "albaran", "taller@ejemplo.es");
    }
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM assistance_reminders
        WHERE "assistanceId" = $1 AND motivo = 'albaran'`, [String(otraAsistencia)]);
    expect(r.rows[0].n).toBe(1);
  });

  /*
   * LA prueba de los recordatorios: dos pasadas seguidas del worker no mandan
   * dos correos. La segunda ve que la espera no ha vencido.
   */
  it("dos pasadas seguidas del worker no mandan dos veces lo mismo", async () => {
    await db.query(
      `UPDATE assistance_reminders SET destinatario = 'taller@ejemplo.es'
        WHERE "assistanceId" = $1`, [String(otraAsistencia)]);

    await svc.enviarRecordatoriosPendientes();
    const tras1 = await db.query(
      `SELECT intentos, "ultimoEnvioMs" FROM assistance_reminders WHERE "assistanceId" = $1`,
      [String(otraAsistencia)]);
    expect(Number(tras1.rows[0].intentos)).toBe(1);

    await svc.enviarRecordatoriosPendientes();
    const tras2 = await db.query(
      `SELECT intentos FROM assistance_reminders WHERE "assistanceId" = $1`,
      [String(otraAsistencia)]);
    expect(Number(tras2.rows[0].intentos)).toBe(1);   // sigue en uno
  });

  it("pasada la espera sí se manda el siguiente, y el asunto dice que es recordatorio", async () => {
    await db.query(
      `UPDATE assistance_reminders
          SET "ultimoEnvioMs" = $2, "proximoEnvioMs" = $2
        WHERE "assistanceId" = $1`,
      [String(otraAsistencia), now - 10 * DIA]);

    await svc.enviarRecordatoriosPendientes();
    const r = await db.query(
      `SELECT intentos FROM assistance_reminders WHERE "assistanceId" = $1`,
      [String(otraAsistencia)]);
    expect(Number(r.rows[0].intentos)).toBe(2);

    const m = await db.query(
      `SELECT asunto FROM assistance_messages
        WHERE "assistanceId" = $1 AND direccion = 'saliente'
        ORDER BY id DESC LIMIT 1`, [String(otraAsistencia)]);
    expect(m.rows[0].asunto).toContain("Recordatorio");
  });

  /* El fallo que más molesta a un taller: que le pidan lo que ya mandó. */
  it("en cuanto llega el albarán, se deja de pedir", async () => {
    const { registrarDocumento } = await import("../documentos/servicio.ts");
    await registrarDocumento({
      system: "assist", assistanceId: otraAsistencia, tipo: "albaran", origen: "proveedor",
    });
    await svc.resolverRecordatoriosPorDocumentos("assist", otraAsistencia);

    const r = await db.query(
      `SELECT "resueltoAtMs" FROM assistance_reminders WHERE "assistanceId" = $1`,
      [String(otraAsistencia)]);
    expect(r.rows[0].resueltoAtMs).toBeTruthy();

    const antes = Number((await db.query(
      `SELECT intentos FROM assistance_reminders WHERE "assistanceId" = $1`,
      [String(otraAsistencia)])).rows[0].intentos);
    await svc.enviarRecordatoriosPendientes();
    const despues = Number((await db.query(
      `SELECT intentos FROM assistance_reminders WHERE "assistanceId" = $1`,
      [String(otraAsistencia)])).rows[0].intentos);
    expect(despues).toBe(antes);      // no ha vuelto a mandar nada
  });

  /*
   * Sin dirección no se puede pedir nada, pero tampoco se calla: la bandeja
   * tiene que poder enseñar «falta el albarán y no sabemos a quién pedírselo».
   */
  it("sin destinatario se anota el motivo en vez de fallar en silencio", async () => {
    const sinCorreo = await crearAsistencia();
    await svc.programarRecordatorio("assist", sinCorreo, "albaran", null);
    await svc.enviarRecordatoriosPendientes();

    const r = await db.query(
      `SELECT intentos, "ultimoError" FROM assistance_reminders WHERE "assistanceId" = $1`,
      [String(sinCorreo)]);
    expect(Number(r.rows[0].intentos)).toBe(0);
    expect(r.rows[0].ultimoError).toContain("dirección");

    await db.query(`DELETE FROM assistance_reminders WHERE "assistanceId" = $1`, [String(sinCorreo)]);
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [sinCorreo]);
  });
});
