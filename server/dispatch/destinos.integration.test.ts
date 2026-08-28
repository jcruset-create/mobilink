/**
 * Configuración de destinos y credenciales: seguridad, contra PostgreSQL real.
 *
 * Cubre una por una las comprobaciones exigidas:
 *
 *   1. una API key nunca llega al frontend
 *   2. una API key nunca se devuelve desde endpoints
 *   3. el valor secreto no se persiste en la base
 *   4. un destino sin variable de entorno se marca MISCONFIGURED
 *   5. un destino sin credenciales no puede enviar asistencias
 *   6. un tenant no puede usar destinos de otro tenant
 *   7. las credenciales de un partner no dan acceso a otro tenant
 *   8. un destino bien configurado aparece disponible
 *   9. cero destinos da «No hay plataformas configuradas», no un error
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/* La identidad de Connect llega por cabecera; el resto es producción. */
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
let servidorCentral: Server;
let servidorAssist: Server;
let baseCentral = "";
let baseAssist = "";

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

const ENV_BUENA = `DEST_OK_${sufijo}`;
const ENV_VACIA = `DEST_VACIA_${sufijo}`;

let centroA = 0, centroB = 0;
let partnerA = 0, partnerB = 0;
let claveA = "", claveB = "";
let adminA = "", adminB = "";
let destinoOk = 0, destinoSinVar = 0, destinoOtroTaller = 0;
let asistenciaId = 0;

const TALLER = "77";
const OTRO_TALLER = "88";

/** Llama a la API de Assist haciéndose pasar por un taller concreto. */
async function assist(ruta: string, init?: { method?: string; body?: unknown; taller?: string }) {
  const sep = ruta.includes("?") ? "&" : "?";
  const t = init?.taller ?? TALLER;
  const res = await fetch(`${baseAssist}${ruta}${sep}tallerId=${t}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify({ ...(init.body as object), tallerId: t }) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any, texto: "" };
}

async function central(ruta: string, usuario: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${baseCentral}/bo/integraciones${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", "x-test-user": usuario },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
  const texto = await res.text();
  return { status: res.status, body: safe(texto), texto };
}

function safe(t: string): any { try { return JSON.parse(t); } catch { return {}; } }

describe.skipIf(!RUN)("Destinos externos y credenciales", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("./schema.ts");
    const { createConnectRouter } = await import("../connect/router.ts");
    const { createIntegracionesRouter } = await import("../connect/integraciones.ts");
    const { createDispatchRouter } = await import("./router.ts");

    await initDb();
    await initConnect();
    await initDispatch();

    for (const [nombre, ref] of [["a", "A"], ["b", "B"]] as const) {
      const cc = await db.query(
        `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$3) RETURNING id`,
        [`cc-dst-${nombre}-${sufijo}`, `Plataforma ${ref} ${sufijo}`, now],
      );
      const id = Number(cc.rows[0].id);
      const email = `admin-dst-${nombre}-${sufijo}@example.com`;
      await db.query(
        `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,'cc_admin',$4,$4)`,
        [id, email, `Admin ${ref}`, now],
      );
      if (ref === "A") { centroA = id; adminA = email; } else { centroB = id; adminB = email; }
    }

    // Central: su propio servidor, con la API pública y la de integraciones.
    const appCentral = express();
    appCentral.use("/api/connect/v1", createConnectRouter());
    appCentral.use("/bo/integraciones", createIntegracionesRouter());
    await new Promise<void>((ok) => { servidorCentral = appCentral.listen(0, () => ok()); });
    baseCentral = `http://127.0.0.1:${(servidorCentral.address() as AddressInfo).port}`;

    // Assist: la API de despacho, con un guarda de supervisor que aquí pasa.
    const appAssist = express();
    appAssist.use("/api/dispatch", createDispatchRouter((_r, _s, n) => n()));
    await new Promise<void>((ok) => { servidorAssist = appAssist.listen(0, () => ok()); });
    baseAssist = `http://127.0.0.1:${(servidorAssist.address() as AddressInfo).port}/api/dispatch`;

    // Partners y credenciales, por la API real de Central.
    const pA = await central("/partners", adminA, { method: "POST", body: { name: `Assist A ${sufijo}` } });
    partnerA = pA.body.id;
    const kA = await central(`/partners/${partnerA}/claves`, adminA, {
      method: "POST", body: { name: "para pruebas", environment: "test", scopes: ["assistances:create", "assistances:read"] },
    });
    claveA = kA.body.api_key;

    const pB = await central("/partners", adminB, { method: "POST", body: { name: `Assist B ${sufijo}` } });
    partnerB = pB.body.id;
    const kB = await central(`/partners/${partnerB}/claves`, adminB, {
      method: "POST", body: { environment: "test", scopes: ["assistances:create"] },
    });
    claveB = kB.body.api_key;

    process.env[ENV_BUENA] = claveA;
    process.env[ENV_VACIA] = "   ";

    const r = await db.query(
      `INSERT INTO roadside_assistances
         (status, priority, "customerName", "customerPhone", address, latitude, longitude,
          plate, "descripcionAveria", "trackingToken", "createdAtMs", "updatedAtMs")
       VALUES ('pendiente','normal','Cliente','600111222','Calle 1',41.1,1.2,'1234ABC',
               'Avería', $1, $2,$2) RETURNING id`,
      [`tok-dst-${sufijo}`, now],
    );
    asistenciaId = Number(r.rows[0].id);
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidorCentral?.closeAllConnections?.(); servidorCentral?.close();
    servidorAssist?.closeAllConnections?.(); servidorAssist?.close();
    delete process.env[ENV_BUENA]; delete process.env[ENV_VACIA];
    await db.query(`DELETE FROM external_dispatch_events WHERE "dispatchId" IN
      (SELECT id FROM external_dispatches WHERE "sourceAssistanceId" = $1)`, [String(asistenciaId)]).catch(() => {});
    await db.query(`DELETE FROM external_dispatches WHERE "sourceAssistanceId" = $1`, [String(asistenciaId)]).catch(() => {});
    await db.query(`DELETE FROM external_destination_checks WHERE "destinationId" = ANY($1::int[])`,
      [[destinoOk, destinoSinVar, destinoOtroTaller].filter(Boolean)]).catch(() => {});
    await db.query(`DELETE FROM external_destinations WHERE "ownerTenantId" = ANY($1::text[])`,
      [[TALLER, OTRO_TALLER]]).catch(() => {});
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [asistenciaId]).catch(() => {});
    for (const p of [partnerA, partnerB]) {
      await db.query(`DELETE FROM connect_api_keys WHERE "partnerId" = $1`, [p]).catch(() => {});
      await db.query(`DELETE FROM connect_partners WHERE id = $1`, [p]).catch(() => {});
    }
    for (const c of [centroA, centroB]) {
      await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [c]).catch(() => {});
      await db.query(`DELETE FROM connect_tenant_companies WHERE "controlCenterId" = $1`, [c]).catch(() => {});
      await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [c]).catch(() => {});
    }
  }, 30_000);

  /* ── 9. Cero destinos NO es un error ─────────────────────────────────── */
  it("sin ningún destino responde NO_DESTINATIONS, no un error", async () => {
    const r = await assist("/destinos");
    expect(r.status).toBe(200);              // 200, no 4xx ni 5xx
    expect(r.body.estadoGlobal).toBe("NO_DESTINATIONS");
    expect(r.body.data).toEqual([]);
    expect(r.body.disponibles).toBe(0);
  });

  /* ── El alta rechaza credenciales en la ficha ─────────────────────────── */
  it("no se admite una credencial en el cuerpo del alta", async () => {
    const r = await assist("/destinos", {
      method: "POST",
      body: {
        name: "Con clave", baseUrl: "https://x.example.com",
        apiKeyEnvName: "X_KEY", apiKey: "mkc_live_estonopuedeentrar",
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("secret_not_allowed");

    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM external_destinations WHERE name = 'Con clave'`);
    expect(n.rows[0].n).toBe(0);
  });

  it("pegar la clave en el campo del NOMBRE se rechaza", async () => {
    const r = await assist("/destinos", {
      method: "POST",
      body: { name: "Mal", baseUrl: "https://x.example.com", apiKeyEnvName: "mkc_live_abc123" },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("env_name_looks_like_secret");
  });

  /* ── 4 y 8. Estados de configuración ──────────────────────────────────── */
  it("un destino con su variable aparece AVAILABLE; sin ella, MISCONFIGURED", async () => {
    const ok = await assist("/destinos", {
      method: "POST",
      body: {
        name: `Plataforma A ${sufijo}`, system: "CENTRAL", baseUrl: baseCentral,
        apiKeyEnvName: ENV_BUENA, remoteTenant: "Plataforma A",
      },
    });
    expect(ok.status).toBe(201);
    destinoOk = ok.body.id;
    expect(ok.body.estado).toBe("AVAILABLE");

    const sinVar = await assist("/destinos", {
      method: "POST",
      body: { name: `Sin variable ${sufijo}`, baseUrl: baseCentral, apiKeyEnvName: `NO_EXISTE_${sufijo}` },
    });
    destinoSinVar = sinVar.body.id;
    expect(sinVar.body.estado).toBe("MISCONFIGURED");
    expect(sinVar.body.mensaje).toBe("Plataforma no disponible por configuración.");
    expect(sinVar.body.motivos.join(" ")).toContain("no existe");

    // Y el conjunto: hay uno disponible, así que la cartera está disponible —
    // pero NO_DESTINATIONS ya no aplica, que es lo que se quería distinguir.
    const lista = await assist("/destinos");
    expect(lista.body.estadoGlobal).toBe("AVAILABLE");
    expect(lista.body.disponibles).toBe(1);
    expect(lista.body.data).toHaveLength(2);
  });

  it("una variable vacía cuenta como mal configurado", async () => {
    const r = await assist("/destinos", {
      method: "POST",
      body: { name: `Vacía ${sufijo}`, baseUrl: baseCentral, apiKeyEnvName: ENV_VACIA },
    });
    expect(r.body.estado).toBe("MISCONFIGURED");
    expect(r.body.motivos.join(" ")).toContain("vacía");
    await db.query(`DELETE FROM external_destinations WHERE id = $1`, [r.body.id]);
  });

  /* ── 1 y 2. La credencial no sale por ningún endpoint ─────────────────── */
  it("ningún endpoint de destinos devuelve la credencial", async () => {
    const rutas = ["/destinos", `/destinos/${destinoOk}`, `/destinos/${destinoOk}/comprobaciones`];
    for (const ruta of rutas) {
      const res = await fetch(`${baseAssist}${ruta}?tallerId=${TALLER}`);
      const texto = await res.text();
      expect(texto).not.toContain(claveA);
      expect(texto).not.toContain("mkc_test_");
      expect(texto).not.toContain("keyHash");
    }
    // El NOMBRE de la variable sí sale: hace falta para saber cuál crear.
    const uno = await assist(`/destinos/${destinoOk}`);
    expect(uno.body.apiKeyEnvName).toBe(ENV_BUENA);
  });

  it("la respuesta de crear una credencial es la ÚNICA que la contiene", async () => {
    const creada = await central(`/partners/${partnerA}/claves`, adminA, {
      method: "POST", body: { name: "efímera", environment: "test", scopes: ["assistances:read"] },
    });
    expect(creada.status).toBe(201);
    const clave = creada.body.api_key;
    expect(clave).toMatch(/^mkc_test_/);

    // Y al listarlas ya no aparece: solo el prefijo.
    const lista = await central(`/partners/${partnerA}/claves`, adminA);
    expect(lista.texto).not.toContain(clave);
    const suya = lista.body.data.find((k: any) => k.id === creada.body.id);
    expect(suya.prefix).toBe(clave.slice(0, 13));
    expect(suya).not.toHaveProperty("keyHash");

    await db.query(`DELETE FROM connect_api_keys WHERE id = $1`, [creada.body.id]);
  });

  /* ── 3. El secreto no se persiste ─────────────────────────────────────── */
  it("el valor de la credencial no está en la base en ninguna columna", async () => {
    const d = await db.query(`SELECT * FROM external_destinations WHERE id = $1`, [destinoOk]);
    expect(JSON.stringify(d.rows[0])).not.toContain(claveA);

    // En Central solo vive el hash, nunca la clave.
    const k = await db.query(`SELECT * FROM connect_api_keys WHERE "partnerId" = $1`, [partnerA]);
    const texto = JSON.stringify(k.rows);
    expect(texto).not.toContain(claveA);
    expect(k.rows[0].keyHash).toHaveLength(64);   // SHA-256 en hexadecimal
  });

  /* ── 5. Sin credencial no se puede enviar ─────────────────────────────── */
  it("un destino mal configurado NO puede recibir asistencias", async () => {
    const r = await assist(`/asistencias/${asistenciaId}/subcontratar`, {
      method: "POST", body: { destinationId: destinoSinVar },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("destination_misconfigured");

    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM external_dispatches WHERE "destinationId" = $1`, [destinoSinVar]);
    expect(n.rows[0].n).toBe(0);
  });

  it("un destino desactivado tampoco, aunque tenga credencial", async () => {
    await assist(`/destinos/${destinoOk}`, { method: "PATCH", body: { active: false } });
    const r = await assist(`/asistencias/${asistenciaId}/subcontratar`, {
      method: "POST", body: { destinationId: destinoOk },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("destination_disabled");
    await assist(`/destinos/${destinoOk}`, { method: "PATCH", body: { active: true } });
  });

  /* ── 6. Aislamiento entre talleres de Assist ──────────────────────────── */
  it("un taller no puede ver ni usar los destinos de otro", async () => {
    const ajeno = await assist("/destinos", {
      method: "POST", taller: OTRO_TALLER,
      body: { name: `De otro ${sufijo}`, baseUrl: baseCentral, apiKeyEnvName: ENV_BUENA },
    });
    destinoOtroTaller = ajeno.body.id;

    const mios = await assist("/destinos");
    expect(mios.body.data.map((d: any) => d.id)).not.toContain(destinoOtroTaller);

    // Cambiar el id en la URL no vale: 404, el mismo que si no existiera.
    expect((await assist(`/destinos/${destinoOtroTaller}`)).status).toBe(404);

    const envio = await assist(`/asistencias/${asistenciaId}/subcontratar`, {
      method: "POST", body: { destinationId: destinoOtroTaller },
    });
    expect(envio.status).toBe(404);
  });

  /* ── 7. Las credenciales no cruzan de tenant ──────────────────────────── */
  it("un administrador no ve ni toca los partners de otra central", async () => {
    const desdeB = await central("/partners", adminB);
    expect(desdeB.body.data.map((p: any) => p.id)).not.toContain(partnerA);

    // Ni sus credenciales, ni cambiando el id.
    expect((await central(`/partners/${partnerA}/claves`, adminB)).status).toBe(404);
    expect((await central(`/partners/${partnerA}/claves`, adminB, {
      method: "POST", body: { scopes: ["assistances:create"] },
    })).status).toBe(404);
  });

  it("la credencial de un partner solo crea asistencias en SU central", async () => {
    const crear = (clave: string) =>
      fetch(`${baseCentral}/api/connect/v1/assistances`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
        body: JSON.stringify({
          customer: { name: "X", phone: "600000000" }, address: "Calle 2",
          metadata: { correlation_id: `COR-tenant-${clave.slice(-6)}` },
        }),
      });

    const rA = await crear(claveA);
    const rB = await crear(claveB);
    expect(rA.status).toBe(201);
    expect(rB.status).toBe(201);

    const idA = ((await rA.json()) as any).id;
    const idB = ((await rB.json()) as any).id;
    const filas = await db.query(
      `SELECT uuid, "controlCenterId" FROM connect_assistances WHERE uuid = ANY($1::text[])`,
      [[idA, idB]]);
    const porUuid = Object.fromEntries(filas.rows.map((f: any) => [f.uuid, Number(f.controlCenterId)]));
    expect(porUuid[idA]).toBe(centroA);
    expect(porUuid[idB]).toBe(centroB);
    expect(porUuid[idA]).not.toBe(porUuid[idB]);

    await db.query(`DELETE FROM connect_status_history WHERE "assistanceId" IN
      (SELECT id FROM connect_assistances WHERE uuid = ANY($1::text[]))`, [[idA, idB]]);
    await db.query(`DELETE FROM connect_assistances WHERE uuid = ANY($1::text[])`, [[idA, idB]]);
  });

  /* ── Prueba de conexión ───────────────────────────────────────────────── */
  it("«probar conexión» distingue credencial válida de inválida", async () => {
    const ok = await assist(`/destinos/${destinoOk}/probar`, { method: "POST" });
    expect(ok.body.ok).toBe(true);
    expect(ok.body.estado).toBe("AVAILABLE");
    expect(ok.body.mensaje).toContain("correcta");

    // Con una clave que no existe en Central: AUTH_ERROR, no «no se puede contactar».
    process.env[ENV_BUENA] = "mkc_test_clavequenoexisteenningunsitio00";
    const mal = await assist(`/destinos/${destinoOk}/probar`, { method: "POST" });
    expect(mal.body.ok).toBe(false);
    expect(mal.body.estado).toBe("AUTH_ERROR");
    // Y el mensaje no lleva la clave dentro.
    expect(mal.body.mensaje).not.toContain("clavequenoexiste");
    process.env[ENV_BUENA] = claveA;
  });

  it("un destino sin variable no llega a llamar: se queda en MISCONFIGURED", async () => {
    const r = await assist(`/destinos/${destinoSinVar}/probar`, { method: "POST" });
    expect(r.body.estado).toBe("MISCONFIGURED");
    expect(r.body.durationMs).toBe(0);       // ni se ha intentado la llamada
  });

  it("la prueba queda registrada con su resultado y sin secretos", async () => {
    const r = await assist(`/destinos/${destinoOk}/comprobaciones`);
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body.data)).not.toContain(claveA);
  });

  /* ── Rotación y revocación ────────────────────────────────────────────── */
  it("rotar genera una nueva y deja de valer la vieja", async () => {
    const creada = await central(`/partners/${partnerA}/claves`, adminA, {
      method: "POST", body: { environment: "test", scopes: ["assistances:read"] },
    });
    const vieja = creada.body.api_key;

    const rotada = await central(`/claves/${creada.body.id}/rotar`, adminA, { method: "POST" });
    expect(rotada.status).toBe(201);
    const nueva = rotada.body.api_key;
    expect(nueva).not.toBe(vieja);

    const conVieja = await fetch(`${baseCentral}/api/connect/v1/assistances?limit=1`, {
      headers: { Authorization: `Bearer ${vieja}` } });
    expect(conVieja.status).toBe(401);

    const conNueva = await fetch(`${baseCentral}/api/connect/v1/assistances?limit=1`, {
      headers: { Authorization: `Bearer ${nueva}` } });
    expect(conNueva.status).toBe(200);

    await db.query(`DELETE FROM connect_api_keys WHERE id IN ($1,$2)`,
      [creada.body.id, rotada.body.id]);
  });

  it("revocar corta el acceso inmediatamente", async () => {
    const creada = await central(`/partners/${partnerA}/claves`, adminA, {
      method: "POST", body: { environment: "test", scopes: ["assistances:read"] },
    });
    const clave = creada.body.api_key;
    expect((await fetch(`${baseCentral}/api/connect/v1/assistances?limit=1`,
      { headers: { Authorization: `Bearer ${clave}` } })).status).toBe(200);

    await central(`/claves/${creada.body.id}`, adminA, { method: "DELETE" });
    expect((await fetch(`${baseCentral}/api/connect/v1/assistances?limit=1`,
      { headers: { Authorization: `Bearer ${clave}` } })).status).toBe(401);

    await db.query(`DELETE FROM connect_api_keys WHERE id = $1`, [creada.body.id]);
  });

  it("una credencial sin el permiso necesario no puede crear asistencias", async () => {
    const soloLectura = await central(`/partners/${partnerA}/claves`, adminA, {
      method: "POST", body: { environment: "test", scopes: ["assistances:read"] },
    });
    const res = await fetch(`${baseCentral}/api/connect/v1/assistances`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${soloLectura.body.api_key}` },
      body: JSON.stringify({ customer: { name: "X", phone: "600" }, address: "Calle" }),
    });
    expect(res.status).toBe(403);
    await db.query(`DELETE FROM connect_api_keys WHERE id = $1`, [soloLectura.body.id]);
  });
});
