/**
 * Sugerencia de subcontratación para una asistencia concreta.
 *
 * Además del enrutado, fija el CONTRATO que consume la pantalla. Los nombres
 * de campo ya divergieron una vez —`destinoNombre` contra `destino.nombre`—, y
 * eso no da error: la pantalla se queda en blanco y nadie se entera. Aquí se
 * comprueban los nombres exactos.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/*
 * Lo único que se sustituye es Supabase, que aquí no se puede levantar. El
 * rbac, los roles y las consultas son los de producción: envolver los routers
 * con un guarda falso no valdría, porque cada uno aplica el suyo por dentro y
 * resolvería el usuario de verdad igualmente.
 */
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

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let centroA = 0, centroB = 0;
let asistenciaA = 0, asistenciaB = 0;
let empresaCerca = 0, empresaLejos = 0;
let acuerdoCerca = 0, acuerdoLejos = 0;
let destinoA = 0;

let emailA = "";
let emailB = "";

async function api(
  ruta: string, usuario: string, init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "x-test-user": usuario, "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe.skipIf(!RUN)("Sugerencia y subcontratación desde Central", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("../dispatch/schema.ts");
    const { createEnrutadoRouter } = await import("./router.ts");
    const { createDispatchRouter } = await import("../dispatch/router.ts");
    await initDb(); await initConnect(); await initDispatch();

    for (const nombre of ["alfa", "beta"]) {
      const cc = await db.query(
        `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$3) RETURNING id`,
        [`cc-sug-${nombre}-${sufijo}`, `Plataforma ${nombre}`, now]);
      const id = Number(cc.rows[0].id);
      // Dirección con CP de Tarragona: es de donde tiene que salir la zona.
      const asi = await db.query(
        `INSERT INTO connect_assistances
           ("controlCenterId", uuid, status, address, priority, "serviceType",
            vehicle, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,'pending','Carrer Major 12, 43201 Reus, Tarragona','normal',
                 'tow_truck','{"type":"turismo","plate":"1234ABC"}',$3,$3) RETURNING id`,
        [id, `asi-sug-${nombre}-${sufijo}`, now]);
      const email = `admin-sug-${nombre}-${sufijo}@example.com`;
      await db.query(
        `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,'cc_admin',$4,$4)`,
        [id, email, `Admin ${nombre}`, now]);
      if (nombre === "alfa") { centroA = id; asistenciaA = Number(asi.rows[0].id); emailA = email; }
      else { centroB = id; asistenciaB = Number(asi.rows[0].id); emailB = email; }
    }

    const d = await db.query(
      `INSERT INTO external_destinations (uuid, name, kind, "baseUrl", "secretName",
         "ownerSystem", "ownerTenantId", "createdAtMs", "updatedAtMs")
       VALUES ($1,'Central Vecina','central','https://vecina.example.com','X_KEY',
               'central',$2,$3,$3) RETURNING id`,
      [`dest-sug-${sufijo}`, String(centroA), now]);
    destinoA = Number(d.rows[0].id);

    // Dos partners de A: uno cubre el 43, el otro solo el 08.
    for (const [nombre, cp] of [["Cerca", "43"], ["Lejos", "08"]] as const) {
      const e = await db.query(
        `INSERT INTO connect_provider_companies (uuid, name, "taxId", "taxIdNormalized",
           "createdAtMs", "updatedAtMs") VALUES ($1,$2,$3,$3,$4,$4) RETURNING id`,
        [`emp-sug-${nombre}-${sufijo}`, `Grúas ${nombre}`, `S${nombre.toUpperCase()}${sufijo}`, now]);
      const empresaId = Number(e.rows[0].id);
      const a = await db.query(
        `INSERT INTO connect_provider_authorizations
           ("controlCenterId", "providerCompanyId", status, "serviceTypes", coverage,
            schedule, "destinationId", "slaArrivalMin", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,'active','["tow_truck"]',$3,'{"veinticuatroHoras":true}',$4,30,$5,$5)
         RETURNING id`,
        [centroA, empresaId, JSON.stringify({ codigosPostales: [cp] }),
         nombre === "Cerca" ? destinoA : null, now]);
      if (nombre === "Cerca") { empresaCerca = empresaId; acuerdoCerca = Number(a.rows[0].id); }
      else { empresaLejos = empresaId; acuerdoLejos = Number(a.rows[0].id); }
    }

    const { requireConnectRole } = await import("../connect/rbac.ts");
    const app = express();
    app.use("/enrutado", createEnrutadoRouter());
    app.use("/envios", createDispatchRouter(requireConnectRole("supervisor"), "central"));
    servidor = app.listen(0);
    await new Promise<void>((ok) => servidor.once("listening", () => ok()));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidor?.closeAllConnections?.();
    servidor?.close();
    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_events WHERE "tenantId" = ANY($1::text[])`,
      [[String(centroA), String(centroB)]]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    for (const c of [centroA, centroB]) {
      await db.query(`DELETE FROM connect_routing_decisions WHERE "controlCenterId" = $1`, [c]).catch(() => {});
      await db.query(`DELETE FROM connect_provider_authorizations WHERE "controlCenterId" = $1`, [c]).catch(() => {});
      await db.query(`DELETE FROM connect_assistances WHERE "controlCenterId" = $1`, [c]).catch(() => {});
      await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [c]).catch(() => {});
    }
    await db.query(`DELETE FROM external_dispatches WHERE "destinationId" = $1`, [destinoA]).catch(() => {});
    await db.query(`DELETE FROM external_destinations WHERE id = $1`, [destinoA]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_companies WHERE id = ANY($1::int[])`,
      [[empresaCerca, empresaLejos]]).catch(() => {});
    await db.query(`DELETE FROM connect_control_centers WHERE id = ANY($1::int[])`,
      [[centroA, centroB]]).catch(() => {});
  }, 30_000);

  /* ── La sugerencia sale de la propia asistencia ────────────────────────── */

  /*
   * Sin esto habría que pedirle al operador que teclee la zona de algo que ya
   * está escrito en la ficha.
   */
  it("saca la zona del código postal de la dirección, sin preguntar nada", async () => {
    const r = await api(`/enrutado/asistencias/${asistenciaA}/sugerencia`, emailA, {
      method: "POST", body: {},
    });
    expect(r.status).toBe(200);
    expect(r.body.elegido.candidato.authorizationId).toBe(acuerdoCerca);
    const fuera = r.body.descartados.find((d: any) => d.authorizationId === acuerdoLejos);
    expect(fuera.motivos.join(" ")).toContain("zona");
  });

  it("saca también el servicio y el tipo de vehículo de la asistencia", async () => {
    const r = await api(`/enrutado/asistencias/${asistenciaA}/sugerencia`, emailA, {
      method: "POST", body: {},
    });
    const g = await db.query(
      `SELECT context FROM connect_routing_decisions WHERE "assistanceId" = $1 ORDER BY id DESC LIMIT 1`,
      [asistenciaA]);
    const ctx = JSON.parse(g.rows[0].context);
    expect(ctx.servicio).toBe("tow_truck");
    expect(ctx.tipoVehiculo).toBe("turismo");
    expect(ctx.codigoPostal).toBe("43201");
    expect(r.body.elegido).toBeTruthy();
  });

  /* El operador está mirando el mapa; la expresión regular no. */
  it("lo que manda el operador pisa lo deducido", async () => {
    const r = await api(`/enrutado/asistencias/${asistenciaA}/sugerencia`, emailA, {
      method: "POST", body: { codigoPostal: "08001" },
    });
    expect(r.body.elegido.candidato.authorizationId).toBe(acuerdoLejos);
  });

  /* Es una decisión real sobre un expediente real: hay que poder explicarla. */
  it("la sugerencia SÍ queda guardada, al revés que el simulador", async () => {
    const antes = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_routing_decisions WHERE "assistanceId" = $1`,
      [asistenciaA]);
    await api(`/enrutado/asistencias/${asistenciaA}/sugerencia`, emailA, { method: "POST", body: {} });
    const despues = await db.query(
      `SELECT COUNT(*)::int AS n, MAX("decidedBy") AS quien FROM connect_routing_decisions
        WHERE "assistanceId" = $1`, [asistenciaA]);
    expect(despues.rows[0].n).toBe(antes.rows[0].n + 1);
    // Queda con el nombre de quien la pidió, no con «system».
    expect(despues.rows[0].quien).toBe("Admin alfa");
  });

  it("A no puede pedir sugerencia para una asistencia de B", async () => {
    const r = await api(`/enrutado/asistencias/${asistenciaB}/sugerencia`, emailA, {
      method: "POST", body: {},
    });
    expect(r.status).toBe(404);
  });

  it("B sí puede pedir sugerencia para la suya", async () => {
    const r = await api(`/enrutado/asistencias/${asistenciaB}/sugerencia`, emailB, {
      method: "POST", body: {},
    });
    expect(r.status).toBe(200);
    // B no tiene partners dados de alta: ninguno, pero la llamada es legítima.
    expect(r.body.candidatos).toEqual([]);
  });

  it("una asistencia inexistente da el mismo 404", async () => {
    const r = await api(`/enrutado/asistencias/99999999/sugerencia`, emailA, {
      method: "POST", body: {},
    });
    expect(r.status).toBe(404);
  });

  /* ── El contrato que consume la pantalla ───────────────────────────────── */

  /*
   * Estos nombres ya divergieron una vez. Un desajuste aquí no da error: la
   * pantalla se queda en blanco y nadie se entera.
   */
  it("la cartera de destinos trae `estadoGlobal` y `data[].estado`", async () => {
    const r = await api("/envios/destinos", emailA);
    expect(r.status).toBe(200);
    expect(typeof r.body.estadoGlobal).toBe("string");
    expect(Array.isArray(r.body.data)).toBe(true);
    const d = r.body.data.find((x: any) => x.id === destinoA);
    expect(d.name).toBe("Central Vecina");
    expect(typeof d.estado).toBe("string");
    // El NOMBRE de la variable, nunca su contenido.
    expect(d.apiKeyEnvName).toBe("X_KEY");
    expect(JSON.stringify(d)).not.toContain("secretName");
  });

  it("un envío trae `destino.nombre`, `referenciaDestino` y `sePuedeReintentar`", async () => {
    await db.query(
      `INSERT INTO external_dispatches
         (uuid, "sourceSystem", "sourceTenantId", "sourceAssistanceId", "destinationId",
          "correlationId", status, "externalReference", "sentAtMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,'central',$2,$3,$4,$5,'ERROR','AS-VECINA-9',$6,$6,$6)`,
      [`disp-sug-${sufijo}`, String(centroA), String(asistenciaA), destinoA,
       `COR-sug-${sufijo}`, now]);

    const r = await api(`/envios/asistencias/${asistenciaA}/despachos`, emailA);
    expect(r.status).toBe(200);
    const d = r.body.data[0];
    expect(d.destino.nombre).toBe("Central Vecina");
    expect(d.referenciaDestino).toBe("AS-VECINA-9");
    expect(d.sePuedeReintentar).toBe(true);      // está en ERROR
    expect(typeof d.sentAtMs).toBe("number");
    expect(Array.isArray(d.eventos)).toBe(true);
  });

  /*
   * La pantalla enseña un TOPE autorizado, que es nuestro. Lo que al destino
   * le cueste no cabe en esta pantalla ni sale por esta API.
   */
  it("nada de lo que consume la pantalla lleva costes ni márgenes", async () => {
    const destinos = await api("/envios/destinos", emailA);
    const despachos = await api(`/envios/asistencias/${asistenciaA}/despachos`, emailA);
    const sugerencia = await api(`/enrutado/asistencias/${asistenciaA}/sugerencia`, emailA,
      { method: "POST", body: {} });
    const texto = JSON.stringify([destinos.body, despachos.body, sugerencia.body]).toLowerCase();
    for (const prohibido of ["margen", "margin", "costeinterno", "coste_interno", "costeproveedor"]) {
      expect(texto).not.toContain(prohibido);
    }
  });
});
