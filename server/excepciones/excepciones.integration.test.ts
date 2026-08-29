/**
 * Bandeja de excepciones y costes, contra PostgreSQL real.
 *
 * Lo que se fija:
 *   · la bandeja enseña solo lo atascado, no todas las asistencias
 *   · lo urgente sale primero
 *   · una desviación grande bloquea la facturación hasta que se aprueba
 *   · el importe que manda la plataforma externa entra como coste acordado,
 *     y su coste interno NO entra porque no se lee
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const HORA = 60 * 60_000;

let sinAceptar = 0;
let desviada = 0;
let normal = 0;
let conDespacho = 0;
let destinoId = 0;

async function crearAsistencia(campos: Record<string, unknown> = {}) {
  const r = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", "customerPhone", address, plate,
        "descripcionAveria", "trackingToken", "createdAtMs", "updatedAtMs",
        "costeAcordado", "costeFinal", "importeVenta", "estadoAdmin", "finishedAtMs")
     VALUES ($1,'normal',$2,'600111222','Calle 1',$3,'Avería',$4,$5,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      campos.status ?? "finalizada",
      campos.customerName ?? `Cliente ${sufijo}`,
      campos.plate ?? "1234ABC",
      `tok-exc-${sufijo}-${Math.random().toString(36).slice(2, 8)}`,
      campos.createdAtMs ?? now,
      campos.costeAcordado ?? null,
      campos.costeFinal ?? null,
      campos.importeVenta ?? null,
      campos.estadoAdmin ?? null,
      campos.finishedAtMs ?? now,
    ],
  );
  return Number(r.rows[0].id);
}

describe.skipIf(!RUN)("Bandeja de excepciones y costes", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("../dispatch/schema.ts");
    const { initDocumentos } = await import("../documentos/schema.ts");
    const { initCorreo } = await import("../correo/schema.ts");
    const { initExcepciones } = await import("./schema.ts");
    await initDb();
    await initConnect();
    await initDispatch();
    await initDocumentos();
    await initCorreo();
    await initExcepciones();
    svc = await import("./servicio.ts");

    // Pendiente desde hace dos horas: nadie la ha cogido.
    sinAceptar = await crearAsistencia({
      status: "pendiente", createdAtMs: now - 2 * HORA, finishedAtMs: null, plate: "SINACEP",
    });
    // Coste final muy por encima de lo acordado.
    desviada = await crearAsistencia({
      costeAcordado: 1000, costeFinal: 1200, importeVenta: 1500, plate: "DESVIAD",
    });
    // Todo en orden: NO puede salir en la bandeja.
    normal = await crearAsistencia({
      costeAcordado: 100, costeFinal: 100, importeVenta: 150,
      estadoAdmin: "FACTURADA", plate: "NORMAL1",
    });
    conDespacho = await crearAsistencia({ plate: "DESPACH" });

    const d = await db.query(
      `INSERT INTO external_destinations
         (uuid, name, kind, "baseUrl", "secretName", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'central','https://x.example.com','X_KEY',$3,$3) RETURNING id`,
      [`dest-exc-${sufijo}`, `Plataforma ${sufijo}`, now],
    );
    destinoId = Number(d.rows[0].id);
    await db.query(
      `INSERT INTO external_dispatches
         (uuid, "sourceSystem", "sourceAssistanceId", "destinationId", "correlationId",
          status, "lastError", "retryCount", "lastAttemptAtMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,'assist',$2,$3,$4,'ERROR','El destino no respondió',3,$5,$5,$5)`,
      [`disp-exc-${sufijo}`, String(conDespacho), destinoId, `COR-exc-${sufijo}`, now],
    );
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_events WHERE "correlationId" = $1
      OR "assistanceId" = ANY($2::text[])`,
      [`COR-exc-${sufijo}`, [sinAceptar, desviada, normal, conDespacho].map(String)]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM external_dispatches WHERE "destinationId" = $1`, [destinoId]).catch(() => {});
    await db.query(`DELETE FROM external_destinations WHERE id = $1`, [destinoId]).catch(() => {});
    await db.query(`DELETE FROM roadside_assistances WHERE "trackingToken" LIKE $1`,
      [`tok-exc-${sufijo}%`]).catch(() => {});
  }, 30_000);

  it("la bandeja enseña lo atascado", async () => {
    const b = await svc.bandejaDe(null);
    const ids = b.data.map((e) => e.assistanceId);
    expect(ids).toContain(sinAceptar);
    expect(ids).toContain(conDespacho);
    expect(ids).toContain(desviada);
  });

  /* Lo que va bien no necesita que nadie lo mire. */
  it("una asistencia en orden NO sale en la bandeja", async () => {
    const b = await svc.bandejaDe(null);
    expect(b.data.map((e) => e.assistanceId)).not.toContain(normal);
  });

  it("cada entrada dice qué le pasa, no solo que le pasa algo", async () => {
    const b = await svc.bandejaDe(null);
    const e = b.data.find((x) => x.assistanceId === sinAceptar)!;
    expect(e.cajon).toBe("sin_aceptar");
    expect(e.detalle).toMatch(/\d+ min sin asignar/);
    expect(e.referencia).toBe(`AST-${sinAceptar}`);
    expect(e.matricula).toBe("SINACEP");
  });

  it("un error de integración sale con su motivo y sus intentos", async () => {
    const b = await svc.bandejaDe(null);
    const e = b.data.find((x) => x.assistanceId === conDespacho)!;
    expect(e.cajon).toBe("error_integracion");
    expect(e.detalle).toContain("no respondió");
    expect(e.detalle).toContain("3 intentos");
  });

  /*
   * Lo operativo antes que lo administrativo: una grúa sin coger tiene a
   * alguien esperando en la carretera.
   */
  it("lo urgente sale primero", async () => {
    const b = await svc.bandejaDe(null);
    const iSinAceptar = b.data.findIndex((e) => e.cajon === "sin_aceptar");
    const iFacturacion = b.data.findIndex((e) => e.cajon === "facturacion_bloqueada");
    expect(iSinAceptar).toBeGreaterThanOrEqual(0);
    if (iFacturacion >= 0) expect(iSinAceptar).toBeLessThan(iFacturacion);
  });

  it("cuenta por cajón, para poder pintar los avisos", async () => {
    const b = await svc.bandejaDe(null);
    expect(b.total).toBe(b.data.length);
    expect(b.porCajon.sin_aceptar).toBeGreaterThanOrEqual(1);
  });

  /* ── Costes ───────────────────────────────────────────────────────────── */

  it("una desviación grande bloquea la facturación", async () => {
    const i = await svc.importesDe(desviada);
    expect(i.margen.desviacionEuros).toBe(200);
    expect(i.nivelDesviacion).toBe("aprobacion");
    expect(i.facturacion.bloqueada).toBe(true);
    expect(i.facturacion.motivo).toContain("200");

    const b = await svc.bandejaDe(null);
    const e = b.data.find((x) => x.assistanceId === desviada)!;
    expect(e.cajon).toBe("facturacion_bloqueada");
  });

  it("aprobar la desviación la desbloquea, con nombre y fecha", async () => {
    const i = await svc.aprobarDesviacion(desviada, "Jordi");
    expect(i.aprobada).toBe(true);
    expect(i.aprobadaPor).toBe("Jordi");
    expect(i.facturacion.bloqueada).toBe(false);

    // Sigue en la bandeja, pero ya como aviso y no como bloqueo.
    const b = await svc.bandejaDe(null);
    const e = b.data.find((x) => x.assistanceId === desviada)!;
    expect(e.cajon).toBe("coste_desviado");
  });

  it("no se puede aprobar lo que no tiene desviación", async () => {
    await expect(svc.aprobarDesviacion(normal, "Jordi")).rejects.toThrow(/desviación/i);
  });

  it("guarda los importes y recalcula el margen", async () => {
    const i = await svc.guardarImportes(conDespacho, {
      costeAcordado: 155, costeFinal: 155, importeVenta: 195, pedidoCliente: `PO-${sufijo}`,
    }, "Marta");
    expect(i.margen.margenEuros).toBe(40);
    expect(i.referencias.pedidoCliente).toBe(`PO-${sufijo}`);
    expect(i.facturacion.bloqueada).toBe(false);
  });

  it("rechaza un importe negativo", async () => {
    await expect(svc.guardarImportes(normal, { costeFinal: -10 }, null))
      .rejects.toThrow(/negativo/i);
  });

  /* ── Lo que llega de la plataforma externa ────────────────────────────── */

  /*
   * LA prueba de privacidad de esta tanda: se manda a propósito el coste
   * interno y el margen del otro lado, y no entran porque no se leen.
   */
  it("el importe del destino entra; su coste interno y su margen, no", async () => {
    const r = await svc.registrarImporteDelDestino(`COR-exc-${sufijo}`, {
      importe: 155, concepto: "Asistencia en carretera", impuestos: 32.55, moneda: "EUR",
      // Esto viene en el mismo sobre y NO puede acabar en la base:
      ...({ costeProveedor: 120, margen: 35 } as any),
    });
    expect(r.aplicado).toBe(true);

    const fila = await db.query(
      `SELECT * FROM roadside_assistances WHERE id = $1`, [conDespacho]);
    const texto = JSON.stringify(fila.rows[0]);
    expect(texto).not.toContain("120");
    expect(Number(fila.rows[0].importeDestino)).toBe(155);
    expect(fila.rows[0].conceptoDestino).toBe("Asistencia en carretera");
  });

  /*
   * Si alguien ya pactó un precio a mano, lo que diga la integración no lo
   * pisa: el acuerdo lo hizo una persona.
   */
  it("no pisa un coste acordado que ya existía", async () => {
    const fila = await db.query(
      `SELECT "costeAcordado" FROM roadside_assistances WHERE id = $1`, [conDespacho]);
    expect(Number(fila.rows[0].costeAcordado)).toBe(155);   // el que se puso a mano
  });

  it("un correlation_id desconocido no aplica nada", async () => {
    const r = await svc.registrarImporteDelDestino("COR-noexiste", { importe: 100 });
    expect(r.aplicado).toBe(false);
    expect(r.motivo).toContain("desconocido");
  });

  it("un importe que no es un número se rechaza", async () => {
    const r = await svc.registrarImporteDelDestino(`COR-exc-${sufijo}`, { importe: "muchos" });
    expect(r.aplicado).toBe(false);
  });
});
