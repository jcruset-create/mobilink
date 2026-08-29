/**
 * Aislamiento entre plataformas en envíos y documentos, contra PostgreSQL.
 *
 * Este fichero existe por tres agujeros REALES encontrados en la revisión de
 * seguridad, no por completar una lista:
 *
 *   1. `POST /despachos/:id/reintentar` no miraba de quién era el envío. Con
 *      un id ajeno se reenviaba la asistencia de otro a un destino de otro
 *      **con la credencial de otro**.
 *   2. `GET /asistencias/:id/despachos` filtraba por sistema pero no por
 *      plataforma: dos Centrales veían los envíos de la otra.
 *   3. Los documentos se listaban y se republicaban por id de asistencia sin
 *      comprobar de quién era esa asistencia.
 *
 * Cada prueba de aquí es la que falla si alguien deshace uno de los tres.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let centroA = 0, centroB = 0;
let asistenciaA = 0, asistenciaB = 0;
let destinoA = 0, destinoB = 0;
let despachoA = 0, despachoB = 0;
let docB = "";

/** El guarda de verdad se sustituye por uno que fija la central que llama. */
function servidorDePrueba(crearDispatch: any, crearDocs: any) {
  const app = express();
  const comoCentro: express.RequestHandler = (req: any, _res, next) => {
    req.connectUser = {
      id: 1, controlCenterId: Number(req.headers["x-centro"]), role: "cc_admin", name: "Prueba",
    };
    next();
  };
  app.use("/envios", crearDispatch([comoCentro], "central"));
  app.use("/docs", crearDocs("central", [comoCentro]));
  return app;
}

async function api(
  ruta: string, centro: number, init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "x-centro": String(centro), "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe.skipIf(!RUN)("Aislamiento de envíos y documentos entre plataformas", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("./schema.ts");
    const { initDocumentos } = await import("../documentos/schema.ts");
    const { createDispatchRouter } = await import("./router.ts");
    const { createDocumentosRouter } = await import("../documentos/router.ts");
    await initDb(); await initConnect(); await initDispatch(); await initDocumentos();

    for (const nombre of ["alfa", "beta"]) {
      const cc = await db.query(
        `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$3) RETURNING id`,
        [`cc-ais-${nombre}-${sufijo}`, `Plataforma ${nombre}`, now]);
      const id = Number(cc.rows[0].id);
      const asi = await db.query(
        `INSERT INTO connect_assistances ("controlCenterId", uuid, status, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,'pending',$3,$3) RETURNING id`,
        [id, `asi-ais-${nombre}-${sufijo}`, now]);
      const d = await db.query(
        `INSERT INTO external_destinations (uuid, name, kind, "baseUrl", "secretName",
           "ownerSystem", "ownerTenantId", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,'central','https://x.example.com','X_KEY','central',$3,$4,$4) RETURNING id`,
        [`dest-ais-${nombre}-${sufijo}`, `Destino ${nombre}`, String(id), now]);
      const desp = await db.query(
        `INSERT INTO external_dispatches
           (uuid, "sourceSystem", "sourceTenantId", "sourceAssistanceId", "destinationId",
            "correlationId", status, "createdAtMs", "updatedAtMs")
         VALUES ($1,'central',$2,$3,$4,$5,'ERROR',$6,$6) RETURNING id`,
        [`disp-ais-${nombre}-${sufijo}`, String(id), String(asi.rows[0].id),
         Number(d.rows[0].id), `COR-ais-${nombre}-${sufijo}`, now]);

      if (nombre === "alfa") {
        centroA = id; asistenciaA = Number(asi.rows[0].id);
        destinoA = Number(d.rows[0].id); despachoA = Number(desp.rows[0].id);
      } else {
        centroB = id; asistenciaB = Number(asi.rows[0].id);
        destinoB = Number(d.rows[0].id); despachoB = Number(desp.rows[0].id);
      }
    }

    // Un documento interno de la Plataforma B.
    const doc = await db.query(
      `INSERT INTO assistance_documents
         (uuid, "sourceSystem", "tenantId", "assistanceId", tipo, origen, visibilidad,
          url, "createdAtMs", "updatedAtMs")
       VALUES ($1,'central',$2,$3,'factura_proveedor','manual','interno',
               'https://x/factura.pdf',$4,$4) RETURNING uuid`,
      [`doc-ais-${sufijo}`, String(centroB), String(asistenciaB), now]);
    docB = String(doc.rows[0].uuid);

    servidor = servidorDePrueba(createDispatchRouter, createDocumentosRouter)
      .listen(0);
    await new Promise<void>((ok) => servidor.once("listening", () => ok()));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidor?.closeAllConnections?.();
    servidor?.close();
    await db.query(`DELETE FROM assistance_documents WHERE uuid = $1`, [docB]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_events WHERE "tenantId" = ANY($1::text[])`,
      [[String(centroA), String(centroB)]]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    for (const [c, d] of [[centroA, destinoA], [centroB, destinoB]]) {
      await db.query(`DELETE FROM external_dispatches WHERE "destinationId" = $1`, [d]).catch(() => {});
      await db.query(`DELETE FROM external_destinations WHERE id = $1`, [d]).catch(() => {});
      await db.query(`DELETE FROM connect_assistances WHERE "controlCenterId" = $1`, [c]).catch(() => {});
      await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [c]).catch(() => {});
    }
  }, 30_000);

  /* ── 1. Reintento ──────────────────────────────────────────────────────── */

  /*
   * El agujero más caro de los tres: no es leer de más, es MANDAR la
   * asistencia de otro con la credencial de otro.
   */
  it("A no puede reintentar el envío de B", async () => {
    const antes = await db.query(
      `SELECT "retryCount", status FROM external_dispatches WHERE id = $1`, [despachoB]);

    const r = await api(`/envios/despachos/${despachoB}/reintentar`, centroA, { method: "POST" });
    expect(r.status).toBe(404);

    const despues = await db.query(
      `SELECT "retryCount", status FROM external_dispatches WHERE id = $1`, [despachoB]);
    // Ni siquiera se ha intentado: el contador y el estado están intactos.
    expect(Number(despues.rows[0].retryCount)).toBe(Number(antes.rows[0].retryCount));
    expect(despues.rows[0].status).toBe(antes.rows[0].status);
  });

  it("un despacho inexistente da el mismo 404 que uno ajeno", async () => {
    const r = await api(`/envios/despachos/99999999/reintentar`, centroA, { method: "POST" });
    expect(r.status).toBe(404);
  });

  /* ── 2. Historial de envíos ────────────────────────────────────────────── */

  it("A no ve los envíos de una asistencia de B", async () => {
    const r = await api(`/envios/asistencias/${asistenciaB}/despachos`, centroA);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it("cada una sí ve los suyos", async () => {
    const a = await api(`/envios/asistencias/${asistenciaA}/despachos`, centroA);
    expect(a.body.data.map((x: any) => x.id)).toContain(despachoA);
    const b = await api(`/envios/asistencias/${asistenciaB}/despachos`, centroB);
    expect(b.body.data.map((x: any) => x.id)).toContain(despachoB);
  });

  /* ── 3. Destinos ───────────────────────────────────────────────────────── */

  it("A no puede leer ni activar el destino de B", async () => {
    expect((await api(`/envios/destinos/${destinoB}`, centroA)).status).toBe(404);
    const patch = await api(`/envios/destinos/${destinoB}`, centroA,
      { method: "PATCH", body: { active: false } });
    expect(patch.status).toBe(404);
    const sigue = await db.query(`SELECT active FROM external_destinations WHERE id = $1`, [destinoB]);
    expect(sigue.rows[0].active).toBe(true);
  });

  it("A no puede subcontratar usando el destino de B", async () => {
    const r = await api(`/envios/asistencias/${asistenciaA}/subcontratar`, centroA,
      { method: "POST", body: { destinationId: destinoB } });
    expect(r.status).toBe(404);
  });

  /* ── 4. Documentos ─────────────────────────────────────────────────────── */

  it("A no ve los documentos de una asistencia de B", async () => {
    const r = await api(`/docs/asistencias/${asistenciaB}/documentos`, centroA);
    expect(r.status).toBe(404);
  });

  it("A no ve la situación administrativa de una asistencia de B", async () => {
    expect((await api(`/docs/asistencias/${asistenciaB}/situacion`, centroA)).status).toBe(404);
  });

  it("A no puede marcar como facturada una asistencia de B", async () => {
    const r = await api(`/docs/asistencias/${asistenciaB}/facturada`, centroA, { method: "POST" });
    expect(r.status).toBe(404);
  });

  /*
   * Publicar la factura interna del proveedor de otro sería el peor caso de
   * todos: es el documento que lleva su coste.
   */
  it("A no puede cambiar la visibilidad de un documento de B", async () => {
    const r = await api(`/docs/documentos/${docB}/visibilidad`, centroA,
      { method: "PATCH", body: { visibilidad: "compartido" } });
    expect(r.status).toBe(404);

    // Y sobre todo: NO se ha escrito. El rechazo va antes del UPDATE.
    const sigue = await db.query(
      `SELECT visibilidad FROM assistance_documents WHERE uuid = $1`, [docB]);
    expect(sigue.rows[0].visibilidad).toBe("interno");
  });

  it("B sí puede con lo suyo", async () => {
    const r = await api(`/docs/asistencias/${asistenciaB}/documentos`, centroB);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
  });
});
