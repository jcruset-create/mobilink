/**
 * Central A → Central B, contra PostgreSQL real.
 *
 * Los dos tenants viven en la MISMA aplicación y la MISMA base. Sería trivial
 * que A escribiera directamente en las asistencias de B. Esta prueba fija que
 * no se hace: A llama a la API pública de B por HTTP con su credencial, igual
 * que si B estuviera en otra empresa y otro servidor.
 *
 * Lo que se comprueba:
 *   · dos expedientes independientes, atados por el correlation_id
 *   · B no ve nada de A salvo lo que viaja en el sobre
 *   · ningún importe cruza en ninguna dirección
 *   · A no puede usar los destinos de B ni al revés
 *   · el estado que comunica B mueve el de A por su propio `transition`
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

let db: typeof import("../db.ts").default;
let servidor: Server;
let base = "";

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const ENV_CLAVE = `CENTRAL_B_KEY_${sufijo}`;

let centroA = 0, centroB = 0;
let adminA = "", adminB = "";
let partnerEnB = 0, partnerPropioA = 0;
let claveDeA = "";
let destinoDeA = 0;
let asistenciaA = 0;

/** Llama al panel de una central, como su administrador. */
async function bo(ruta: string, usuario: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${base}/bo${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", "x-test-user": usuario },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
  const texto = await res.text();
  const body = (() => { try { return JSON.parse(texto); } catch { return {}; } })();
  return { status: res.status, body, texto };
}

describe.skipIf(!RUN)("Central A → Central B por la capa de integración", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("./schema.ts");
    const { createConnectRouter } = await import("../connect/router.ts");
    const { createIntegracionesRouter } = await import("../connect/integraciones.ts");
    const { createDispatchRouter } = await import("./router.ts");
    const { requireConnectRole } = await import("../connect/rbac.ts");

    await initDb();
    await initConnect();
    await initDispatch();

    for (const ref of ["A", "B"] as const) {
      const cc = await db.query(
        `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$3) RETURNING id`,
        [`cc-cc-${ref}-${sufijo}`, `Plataforma ${ref} ${sufijo}`, now],
      );
      const id = Number(cc.rows[0].id);
      const email = `admin-cc-${ref}-${sufijo}@example.com`;
      await db.query(
        `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,'cc_admin',$4,$4)`,
        [id, email, `Admin ${ref}`, now],
      );
      if (ref === "A") { centroA = id; adminA = email; } else { centroB = id; adminB = email; }
    }

    const app = express();
    app.use("/api/connect/v1", createConnectRouter());
    app.use("/bo/integraciones", createIntegracionesRouter());
    app.use("/bo/envios", createDispatchRouter(requireConnectRole("supervisor"), "central"));
    await new Promise<void>((ok) => { servidor = app.listen(0, () => ok()); });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

    /*
     * La Plataforma B da de alta a la A como partner suyo y le genera una
     * credencial. Es exactamente lo que haría con una empresa de fuera.
     */
    const p = await bo("/integraciones/partners", adminB, {
      method: "POST", body: { name: `Plataforma A ${sufijo}` },
    });
    partnerEnB = p.body.id;
    const k = await bo(`/integraciones/partners/${partnerEnB}/claves`, adminB, {
      method: "POST", body: { environment: "test", scopes: ["assistances:create", "assistances:read"] },
    });
    claveDeA = k.body.api_key;
    process.env[ENV_CLAVE] = claveDeA;

    // La A necesita un partner propio para poder tener asistencias.
    const pa = await bo("/integraciones/partners", adminA, {
      method: "POST", body: { name: `Origen A ${sufijo}` },
    });
    partnerPropioA = pa.body.id;

    const a = await db.query(
      `INSERT INTO connect_assistances
         (uuid, "partnerId", "controlCenterId", status, "expedientNumber", "customerName",
          "customerPhone", address, description, vehicle, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,'searching',$4,'Cliente de A','600111222','AP-7 km 245',
               'Rueda reventada','{"plate":"1234ABC"}',$5,$5) RETURNING id`,
      [`a-cc-${sufijo}`, partnerPropioA, centroA, `AS-A-${sufijo}`, now],
    );
    asistenciaA = Number(a.rows[0].id);

    // Y la A da de alta a la B como destino, apuntando a la misma app por HTTP.
    const d = await bo("/envios/destinos", adminA, {
      method: "POST",
      body: {
        name: `Plataforma B ${sufijo}`, system: "CENTRAL", baseUrl: base,
        apiKeyEnvName: ENV_CLAVE, remoteTenant: "Plataforma B",
      },
    });
    destinoDeA = d.body.id;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidor?.closeAllConnections?.();
    servidor?.close();
    delete process.env[ENV_CLAVE];
    await db.query(`DELETE FROM external_dispatch_events WHERE "dispatchId" IN
      (SELECT id FROM external_dispatches WHERE "destinationId" = $1)`, [destinoDeA]).catch(() => {});
    await db.query(`DELETE FROM external_dispatches WHERE "destinationId" = $1`, [destinoDeA]).catch(() => {});
    await db.query(`DELETE FROM external_destination_checks WHERE "destinationId" = $1`, [destinoDeA]).catch(() => {});
    await db.query(`DELETE FROM external_destinations WHERE id = $1`, [destinoDeA]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_events WHERE "tenantId" = ANY($1::text[])`,
      [[String(centroA), String(centroB)]]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    for (const p of [partnerEnB, partnerPropioA]) {
      await db.query(`DELETE FROM connect_status_history WHERE "assistanceId" IN
        (SELECT id FROM connect_assistances WHERE "partnerId" = $1)`, [p]).catch(() => {});
      await db.query(`DELETE FROM connect_webhook_deliveries WHERE "endpointId" IN
        (SELECT id FROM connect_webhook_endpoints WHERE "partnerId" = $1)`, [p]).catch(() => {});
      await db.query(`DELETE FROM connect_webhook_endpoints WHERE "partnerId" = $1`, [p]).catch(() => {});
      await db.query(`DELETE FROM connect_assistances WHERE "partnerId" = $1`, [p]).catch(() => {});
      await db.query(`DELETE FROM connect_api_keys WHERE "partnerId" = $1`, [p]).catch(() => {});
      await db.query(`DELETE FROM connect_partners WHERE id = $1`, [p]).catch(() => {});
    }
    for (const c of [centroA, centroB]) {
      await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [c]).catch(() => {});
      await db.query(`DELETE FROM connect_tenant_companies WHERE "controlCenterId" = $1`, [c]).catch(() => {});
      await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [c]).catch(() => {});
    }
  }, 30_000);

  it("A subcontrata a B y cada una conserva SU expediente", async () => {
    const r = await bo(`/envios/asistencias/${asistenciaA}/subcontratar`, adminA, {
      method: "POST", body: { destinationId: destinoDeA },
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("RECEIVED");

    // Dos expedientes distintos, no una fila compartida.
    expect(r.body.referenciaOrigen).toBe(`AS-A-${sufijo}`);
    expect(r.body.referenciaDestino).toMatch(/^AS-\d{4}-\d+$/);
    expect(r.body.referenciaDestino).not.toBe(r.body.referenciaOrigen);

    // La asistencia creada en B es de B, no de A.
    const enB = await db.query(
      `SELECT "controlCenterId", "sourceSystem", "sourceReference", "partnerId"
         FROM connect_assistances WHERE "correlationId" = $1`, [r.body.correlationId]);
    expect(enB.rows).toHaveLength(1);
    expect(Number(enB.rows[0].controlCenterId)).toBe(centroB);
    expect(Number(enB.rows[0].partnerId)).toBe(partnerEnB);
    expect(enB.rows[0].sourceSystem).toBe("central");
    expect(enB.rows[0].sourceReference).toBe(`AS-A-${sufijo}`);
  });

  /*
   * LA prueba de aislamiento: la asistencia de A sigue siendo de A. B tiene la
   * suya, con su id, y ninguna de las dos filas se comparte.
   */
  it("son dos filas distintas: B no toca la de A", async () => {
    const deA = await db.query(
      `SELECT id, "controlCenterId", "expedienteDestino" FROM connect_assistances WHERE id = $1`,
      [asistenciaA]);
    expect(Number(deA.rows[0].controlCenterId)).toBe(centroA);
    // A guarda la referencia de B, que es lo único que necesita de ella.
    expect(deA.rows[0].expedienteDestino).toMatch(/^AS-\d{4}-\d+$/);

    const total = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances
        WHERE "controlCenterId" = ANY($1::int[])`, [[centroA, centroB]]);
    expect(total.rows[0].n).toBe(2);      // una de cada, no una compartida
  });

  /*
   * Privacidad económica. A le pone precio a su servicio y eso NO puede llegar
   * a B: lo que B ve es lo que viaja en el sobre, y el sobre no lleva importes.
   */
  it("ningún importe cruza de A a B", async () => {
    await db.query(
      `UPDATE connect_assistances SET "finalCost" = 195 WHERE id = $1`, [asistenciaA]);

    const d = await db.query(
      `SELECT "payloadSnapshot" FROM external_dispatches
        WHERE "sourceAssistanceId" = $1 AND "sourceSystem" = 'central'`,
      [String(asistenciaA)]);
    const sobre = String(d.rows[0].payloadSnapshot).toLowerCase();
    for (const prohibido of ["cost", "coste", "precio", "margen", "195"]) {
      expect(sobre).not.toContain(prohibido);
    }
  });

  /*
   * A no puede usar los destinos de B. Cambiar el id en la URL da 404, el mismo
   * que si no existiera: confirmar que existe ya sería contar algo.
   */
  it("una central no puede usar los destinos de otra", async () => {
    const desdeB = await bo("/envios/destinos", adminB);
    expect(desdeB.body.data.map((x: any) => x.id)).not.toContain(destinoDeA);
    expect((await bo(`/envios/destinos/${destinoDeA}`, adminB)).status).toBe(404);

    const envio = await bo(`/envios/asistencias/${asistenciaA}/subcontratar`, adminB, {
      method: "POST", body: { destinationId: destinoDeA },
    });
    expect(envio.status).toBe(404);
  });

  /*
   * Y el destino de una central no se confunde con el de un taller de Assist
   * que tuviera el mismo número de tenant.
   */
  it("los destinos de Central no se mezclan con los de Assist", async () => {
    await db.query(
      `INSERT INTO external_destinations
         (uuid, name, kind, "baseUrl", "secretName", "ownerTenantId", "ownerSystem",
          "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'central','https://x.example.com','X_KEY',$3,'assist',$4,$4)`,
      [`dest-assist-${sufijo}`, `De un taller ${sufijo}`, String(centroA), now],
    );
    const deA = await bo("/envios/destinos", adminA);
    expect(deA.body.data.map((x: any) => x.name)).not.toContain(`De un taller ${sufijo}`);
    await db.query(`DELETE FROM external_destinations WHERE uuid = $1`, [`dest-assist-${sufijo}`]);
  });

  it("reenviar no crea un segundo expediente en B", async () => {
    const antes = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances WHERE "partnerId" = $1`, [partnerEnB]);
    const r = await bo(`/envios/asistencias/${asistenciaA}/subcontratar`, adminA, {
      method: "POST", body: { destinationId: destinoDeA },
    });
    expect(r.status).toBe(409);
    const despues = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances WHERE "partnerId" = $1`, [partnerEnB]);
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  /*
   * La vuelta: lo que B comunica mueve el estado de A por SU propio
   * `transition`, con su historial y su diario. No se toca la fila a mano.
   */
  it("lo que comunica B mueve el estado de A por su propio flujo", async () => {
    const { aplicarAvisoDeCentral } = await import("./servicio.ts");
    const d = await db.query(
      `SELECT "correlationId" FROM external_dispatches
        WHERE "sourceAssistanceId" = $1 AND "sourceSystem" = 'central'`,
      [String(asistenciaA)]);
    const correlationId = d.rows[0].correlationId;

    await aplicarAvisoDeCentral(correlationId, "assistance.assigned", {});
    // El estado se aplica fuera de la transacción del despacho: se espera a que
    // el `transition` de A termine.
    await new Promise((r) => setTimeout(r, 200));

    const a = await db.query(`SELECT status FROM connect_assistances WHERE id = $1`, [asistenciaA]);
    expect(a.rows[0].status).toBe("assigned");

    // Y ha dejado historial propio, no un UPDATE a pelo.
    const h = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_status_history WHERE "assistanceId" = $1`,
      [asistenciaA]);
    expect(h.rows[0].n).toBeGreaterThan(0);
  });

  it("el diario distingue de quién es cada evento", async () => {
    const ev = await db.query(
      `SELECT DISTINCT "tenantId", "sourceSystem" FROM assistance_events
        WHERE "tenantId" = ANY($1::text[]) ORDER BY "tenantId"`,
      [[String(centroA), String(centroB)]]);
    expect(ev.rows.length).toBeGreaterThan(0);
    expect(ev.rows.every((r: any) => r.sourceSystem === "central")).toBe(true);
  });
});
