/**
 * Flujo de presupuesto de punta a punta, contra PostgreSQL y por HTTP.
 *
 * Lo que se fija, y por qué importa cada cosa:
 *
 *   · **No se pide precio a quien no sabe presupuestar.** Ese destino tomaría
 *     el sobre por un encargo y mandaría una grúa a un sitio donde solo se
 *     estaba preguntando. El cerrojo está en el backend, no en el botón.
 *   · **La correlación es la misma** en la petición de precio y en el encargo:
 *     es el mismo servicio en la misma conversación, y con dos el destino
 *     vería dos peticiones distintas para lo mismo.
 *   · **Aceptar es encargar**, en un solo paso. Si se dejara en dos habría
 *     presupuestos aceptados que nadie confirmó.
 *   · Y los nombres de campo que consume la pantalla.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

vi.mock("../core/auth.ts", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.authCtx = {
      userId: `test-${req.headers["x-test-user"] ?? ""}`,
      username: String(req.headers["x-test-user"] ?? ""),
      nombre: "Prueba", empresaId: "test", esSuperadmin: false,
    };
    next();
  },
}));

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let centro = 0, email = "";
let asistencia = 0, asistencia2 = 0;
let empresa = 0, acuerdo = 0;
let destinoConPresupuesto = 0, destinoSinPresupuesto = 0;

async function api(
  ruta: string, init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "x-test-user": email, "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe.skipIf(!RUN)("Flujo de presupuesto", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("../dispatch/schema.ts");
    const { createAcuerdosRouter } = await import("./router.ts");
    const { createDispatchRouter } = await import("../dispatch/router.ts");
    const { requireConnectRole } = await import("../connect/rbac.ts");
    await initDb(); await initConnect(); await initDispatch();
    svc = await import("./servicio.ts");

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`cc-pre-${sufijo}`, `Plataforma ${sufijo}`, now]);
    centro = Number(cc.rows[0].id);
    email = `admin-pre-${sufijo}@example.com`;
    await db.query(
      `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'Admin','cc_admin',$3,$3)`, [centro, email, now]);

    for (const n of [1, 2]) {
      const a = await db.query(
        `INSERT INTO connect_assistances
           ("controlCenterId", uuid, status, address, "customerName", "customerPhone",
            description, priority, "serviceType", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,'pending','Carrer Major 12, 43201 Reus','Cliente','600111222',
                 'No arranca, posible batería','normal','tow_truck',$3,$3) RETURNING id`,
        [centro, `asi-pre-${n}-${sufijo}`, now]);
      if (n === 1) asistencia = Number(a.rows[0].id); else asistencia2 = Number(a.rows[0].id);
    }

    // Un destino que sabe presupuestar y otro que no. La diferencia es el punto.
    const d1 = await db.query(
      `INSERT INTO external_destinations (uuid, name, kind, "baseUrl", "secretName",
         "ownerSystem", "ownerTenantId", capabilities, "createdAtMs", "updatedAtMs")
       VALUES ($1,'Central Que Presupuesta','central','https://a.example.com','PRE_KEY',
               'central',$2,$3,$4,$4) RETURNING id`,
      [`dest-pre-si-${sufijo}`, String(centro),
       JSON.stringify(["supports_status_updates", "supports_quotes"]), now]);
    destinoConPresupuesto = Number(d1.rows[0].id);

    const d2 = await db.query(
      `INSERT INTO external_destinations (uuid, name, kind, "baseUrl", "secretName",
         "ownerSystem", "ownerTenantId", capabilities, "createdAtMs", "updatedAtMs")
       VALUES ($1,'Central Sencilla','central','https://b.example.com','PRE_KEY',
               'central',$2,$3,$4,$4) RETURNING id`,
      [`dest-pre-no-${sufijo}`, String(centro),
       JSON.stringify(["supports_status_updates"]), now]);
    destinoSinPresupuesto = Number(d2.rows[0].id);

    const e = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "taxId", "taxIdNormalized",
         "createdAtMs", "updatedAtMs") VALUES ($1,'Grúas Presupuesto',$2,$2,$3,$3) RETURNING id`,
      [`emp-pre-${sufijo}`, `P${sufijo}`, now]);
    empresa = Number(e.rows[0].id);
    const ac = await db.query(
      `INSERT INTO connect_provider_authorizations
         ("controlCenterId","providerCompanyId",status,"destinationId","createdAtMs","updatedAtMs")
       VALUES ($1,$2,'active',$3,$4,$4) RETURNING id`,
      [centro, empresa, destinoConPresupuesto, now]);
    acuerdo = Number(ac.rows[0].id);

    // La credencial existe para que el destino sea utilizable; el envío fallará
    // al no haber servidor al otro lado, que es lo esperado y no lo que se mide.
    process.env.PRE_KEY = "mkc_test_0123456789abcdef0123456789abcdef";

    const app = express();
    app.use("/acuerdos", createAcuerdosRouter());
    app.use("/envios", createDispatchRouter(requireConnectRole("supervisor"), "central"));
    servidor = app.listen(0);
    await new Promise<void>((ok) => servidor.once("listening", () => ok()));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidor?.closeAllConnections?.();
    servidor?.close();
    delete process.env.PRE_KEY;
    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_events WHERE "tenantId" = $1`, [String(centro)]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM connect_quotes WHERE "controlCenterId" = $1`, [centro]).catch(() => {});
    await db.query(`DELETE FROM external_dispatches WHERE "destinationId" = ANY($1::int[])`,
      [[destinoConPresupuesto, destinoSinPresupuesto]]).catch(() => {});
    await db.query(`DELETE FROM external_destinations WHERE id = ANY($1::int[])`,
      [[destinoConPresupuesto, destinoSinPresupuesto]]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_authorizations WHERE "controlCenterId" = $1`, [centro]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [empresa]).catch(() => {});
    await db.query(`DELETE FROM connect_assistances WHERE "controlCenterId" = $1`, [centro]).catch(() => {});
    await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [centro]).catch(() => {});
    await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [centro]).catch(() => {});
  }, 30_000);

  /* ── El cerrojo ────────────────────────────────────────────────────────── */

  /*
   * LA prueba de esta tanda. Sin este cerrojo, pedir precio a una plataforma
   * sencilla le mandaría una grúa de verdad.
   */
  it("no se pide precio a un destino que no sabe presupuestar", async () => {
    const r = await api(`/envios/asistencias/${asistencia}/presupuesto`, {
      method: "POST", body: { destinationId: destinoSinPresupuesto },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("quotes_unsupported");
    expect(r.body.error).toContain("lo tomaría como un encargo");

    // Y sobre todo: NO se ha creado ningún envío a ese destino.
    const envios = await db.query(
      `SELECT COUNT(*)::int AS n FROM external_dispatches WHERE "destinationId" = $1`,
      [destinoSinPresupuesto]);
    expect(envios.rows[0].n).toBe(0);
  });

  it("a ese mismo destino sí se le puede encargar directamente", async () => {
    const r = await api(`/envios/asistencias/${asistencia2}/subcontratar`, {
      method: "POST", body: { destinationId: destinoSinPresupuesto },
    });
    expect(r.status).toBe(201);
    expect(r.body.soloPresupuesto).toBe(false);
  });

  /* ── Pedir precio ──────────────────────────────────────────────────────── */

  it("pedir precio crea el envío marcado y el presupuesto, con la misma correlación", async () => {
    const r = await api(`/envios/asistencias/${asistencia}/presupuesto`, {
      method: "POST", body: { destinationId: destinoConPresupuesto, authorizationId: acuerdo },
    });
    expect(r.status).toBe(201);
    expect(r.body.despacho.soloPresupuesto).toBe(true);
    expect(r.body.presupuesto.status).toBe("REQUESTED");
    // La misma conversación: si fueran dos, el destino vería dos peticiones.
    expect(r.body.presupuesto.correlationId).toBe(r.body.despacho.correlationId);
  });

  /* El destino necesita los datos igual: sin ellos no puede poner precio. */
  it("el sobre de la petición de precio va marcado y con los datos completos", async () => {
    const d = await db.query(
      `SELECT "payloadSnapshot", "quoteOnly" FROM external_dispatches
        WHERE "destinationId" = $1 ORDER BY id DESC LIMIT 1`, [destinoConPresupuesto]);
    expect(d.rows[0].quoteOnly).toBe(true);
    const sobre = JSON.parse(d.rows[0].payloadSnapshot);
    expect(sobre.metadata.quote_only).toBe(true);
    expect(sobre.address).toContain("Reus");
    expect(sobre.customer.phone).toBe("600111222");
  });

  /* Un encargo normal no puede salir marcado como presupuesto. */
  it("un encargo normal no lleva la marca", async () => {
    const d = await db.query(
      `SELECT "payloadSnapshot" FROM external_dispatches WHERE "destinationId" = $1`,
      [destinoSinPresupuesto]);
    const sobre = JSON.parse(d.rows[0].payloadSnapshot);
    expect(sobre.metadata.quote_only).toBeUndefined();
  });

  /* ── La oferta y su aceptación ─────────────────────────────────────────── */

  it("la oferta del partner entra por correlación y pasa a QUOTED", async () => {
    const q = await db.query(
      `SELECT "correlationId" FROM connect_quotes WHERE "assistanceId" = $1`, [asistencia]);
    const r = await svc.registrarOferta(q.rows[0].correlationId, {
      importe: 245, moneda: "EUR", concepto: "Grúa hasta taller", etaMin: 40,
    });
    expect(r.aplicado).toBe(true);

    const lista = await api(`/acuerdos/presupuestos/asistencia/${asistencia}`);
    const p = lista.body.data[0];
    expect(p.status).toBe("QUOTED");
    expect(Number(p.amount)).toBe(245);
    // Nombres que consume la pantalla.
    expect(p.partnerName).toBe("Grúas Presupuesto");
    expect(p.etaMin).toBe(40);
    expect(p.currency).toBe("EUR");
  });

  /*
   * Aceptar es encargar. En dos pasos habría presupuestos aceptados que nadie
   * confirmó y partners esperando una llamada que no llega.
   */
  it("aceptar quita la marca del MISMO envío, conservando la correlación", async () => {
    const antes = await db.query(
      `SELECT id, "correlationId", "quoteOnly" FROM external_dispatches
        WHERE "destinationId" = $1 ORDER BY id DESC LIMIT 1`, [destinoConPresupuesto]);

    const q = await db.query(
      `SELECT id FROM connect_quotes WHERE "assistanceId" = $1`, [asistencia]);
    const r = await api(`/acuerdos/presupuestos/${q.rows[0].id}/decidir`, {
      method: "POST", body: { aceptar: true },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ACCEPTED");

    const despues = await db.query(
      `SELECT id, "correlationId", "quoteOnly" FROM external_dispatches
        WHERE "destinationId" = $1 ORDER BY id DESC LIMIT 1`, [destinoConPresupuesto]);
    // Misma fila, misma correlación, sin la marca.
    expect(Number(despues.rows[0].id)).toBe(Number(antes.rows[0].id));
    expect(despues.rows[0].correlationId).toBe(antes.rows[0].correlationId);
    expect(despues.rows[0].quoteOnly).toBe(false);

    const sobre = await db.query(
      `SELECT "payloadSnapshot" FROM external_dispatches WHERE id = $1`, [antes.rows[0].id]);
    expect(JSON.parse(sobre.rows[0].payloadSnapshot).metadata.quote_only).toBeUndefined();
  });

  it("un presupuesto aceptado ya no se puede descartar", async () => {
    const q = await db.query(
      `SELECT id FROM connect_quotes WHERE "assistanceId" = $1`, [asistencia]);
    const r = await api(`/acuerdos/presupuestos/${q.rows[0].id}/decidir`, {
      method: "POST", body: { aceptar: false },
    });
    expect(r.status).toBe(409);
  });

  /*
   * Si el precio quedó aceptado pero el envío falló, la decisión sigue siendo
   * buena: lo que queda pendiente es el envío, y la pantalla lo dice.
   */
  it("la respuesta trae el resultado de la confirmación, no solo el del precio", async () => {
    const cor = `COR-pre2-${sufijo}`;
    const q = await svc.pedirPresupuesto({
      centro, assistanceId: asistencia2, authorizationId: null, correlationId: cor,
    });
    await svc.registrarOferta(cor, { importe: 99 });
    const r = await api(`/acuerdos/presupuestos/${q.id}/decidir`, {
      method: "POST", body: { aceptar: true },
    });
    expect(r.status).toBe(200);
    // Sin envío asociado no hay nada que confirmar, y se dice con null.
    expect(r.body.confirmacion).toBeNull();
  });
});
