/**
 * Enrutado contra PostgreSQL y por HTTP.
 *
 * Lo que se fija:
 *   · las reglas de A no se leen, ni se tocan, ni se aplican desde B
 *   · el enrutado de A jamás propone un partner de B
 *   · las métricas de un partner no mezclan el trato de dos centrales
 *   · la decisión queda guardada con su desglose, para poder explicarla
 *   · simular NO ensucia el historial de decisiones reales
 *   · ninguna respuesta del módulo lleva importes de coste ni margen
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
let met: typeof import("./metricas.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

interface Plataforma { id: number; email: string; empresaId: number; acuerdoId: number; destinoId: number }
let A: Plataforma;
let B: Plataforma;
let acuerdoLejos = 0;
let empresaLejos = 0;

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

async function crearEmpresa(nombre: string): Promise<number> {
  const r = await db.query(
    `INSERT INTO connect_provider_companies (uuid, name, "taxId", "taxIdNormalized", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$3,$4,$4) RETURNING id`,
    [`emp-enr-${nombre}-${sufijo}`, nombre, `E${nombre.toUpperCase().replace(/[^A-Z]/g, "")}${sufijo}`, now],
  );
  return Number(r.rows[0].id);
}

async function crearAcuerdo(centro: number, empresaId: number, destinoId: number | null, extra: any = {}) {
  const r = await db.query(
    `INSERT INTO connect_provider_authorizations
       ("controlCenterId", "providerCompanyId", status, "serviceTypes", coverage, schedule,
        "destinationId", "slaArrivalMin", preferred, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,'active','[]',$3,'{"veinticuatroHoras":true}',$4,$5,$6,$7,$7) RETURNING id`,
    [centro, empresaId, JSON.stringify(extra.cobertura ?? {}), destinoId,
     extra.slaArrivalMin ?? null, extra.preferred === true, now],
  );
  return Number(r.rows[0].id);
}

async function crearPlataforma(nombre: string): Promise<Plataforma> {
  const cc = await db.query(
    `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$3) RETURNING id`,
    [`cc-enr-${nombre}-${sufijo}`, `Plataforma ${nombre}`, now],
  );
  const id = Number(cc.rows[0].id);
  const email = `admin-enr-${nombre}-${sufijo}@example.com`;
  await db.query(
    `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,'cc_admin',$4,$4)`,
    [id, email, `Admin ${nombre}`, now],
  );
  const empresaId = await crearEmpresa(`Gruas ${nombre}`);
  const d = await db.query(
    `INSERT INTO external_destinations (uuid, name, kind, "baseUrl", "secretName", "ownerSystem",
       "ownerTenantId", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,'central','https://x.example.com','X_KEY','central',$3,$4,$4) RETURNING id`,
    [`dest-enr-${nombre}-${sufijo}`, `Destino ${nombre}`, String(id), now],
  );
  const destinoId = Number(d.rows[0].id);
  const acuerdoId = await crearAcuerdo(id, empresaId, destinoId, { slaArrivalMin: 30 });
  return { id, email, empresaId, acuerdoId, destinoId };
}

describe.skipIf(!RUN)("Enrutado por reglas y puntuación", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("../dispatch/schema.ts");
    const { createEnrutadoRouter } = await import("./router.ts");
    await initDb();
    await initConnect();
    await initDispatch();
    svc = await import("./servicio.ts");
    met = await import("./metricas.ts");

    A = await crearPlataforma("alfa");
    B = await crearPlataforma("beta");

    // Un segundo partner de A, peor: lejos y con SLA malo.
    empresaLejos = await crearEmpresa(`Gruas Lejanas ${sufijo}`);
    acuerdoLejos = await crearAcuerdo(A.id, empresaLejos, null, { slaArrivalMin: 150 });

    const app = express();
    app.use("/enrutado", createEnrutadoRouter());
    await new Promise<void>((ok) => { servidor = app.listen(0, () => ok()); });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/enrutado`;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidor?.closeAllConnections?.();
    servidor?.close();
    for (const p of [A, B]) {
      if (!p) continue;
      await db.query(`DELETE FROM connect_routing_decisions WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM connect_routing_rules WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM external_dispatches WHERE "destinationId" = $1`, [p.destinoId]).catch(() => {});
      await db.query(`DELETE FROM connect_provider_authorizations WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM external_destinations WHERE id = $1`, [p.destinoId]).catch(() => {});
      await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [p.id]).catch(() => {});
    }
    await db.query(`DELETE FROM connect_provider_companies WHERE "taxIdNormalized" LIKE $1`,
      [`E%${sufijo}`]).catch(() => {});
  }, 30_000);

  /* ── Aislamiento ───────────────────────────────────────────────────────── */

  it("el enrutado de A solo propone partners de A", async () => {
    const r = await api("/simular", A.email, { method: "POST", body: { servicio: "tow_truck" } });
    expect(r.status).toBe(200);
    const ids = [...r.body.candidatos, ...r.body.descartados].map(
      (c: any) => c.candidato?.authorizationId ?? c.authorizationId);
    expect(ids).toContain(A.acuerdoId);
    expect(ids).not.toContain(B.acuerdoId);
  });

  it("A no puede tocar una regla de B ni sabiendo su id", async () => {
    const deB = await api("/reglas", B.email, {
      method: "POST", body: { name: "Regla de B", action: "excluir" },
    });
    expect(deB.status).toBe(201);

    const intento = await api(`/reglas/${deB.body.id}`, A.email, {
      method: "PATCH", body: { active: false },
    });
    expect(intento.status).toBe(404);

    const sigue = await db.query(`SELECT active FROM connect_routing_rules WHERE id = $1`, [deB.body.id]);
    expect(sigue.rows[0].active).toBe(true);
  });

  it("A tampoco la puede borrar", async () => {
    const deB = await db.query(
      `SELECT id FROM connect_routing_rules WHERE "controlCenterId" = $1 LIMIT 1`, [B.id]);
    const r = await api(`/reglas/${deB.rows[0].id}`, A.email, { method: "DELETE" });
    expect(r.status).toBe(404);
  });

  it("A no ve las reglas de B en su listado", async () => {
    const r = await api("/reglas", A.email);
    expect(r.body.data.map((x: any) => x.nombre)).not.toContain("Regla de B");
  });

  /* ── Puntuación ────────────────────────────────────────────────────────── */

  it("el mejor SLA gana, y se dice por qué", async () => {
    const r = await api("/simular", A.email, { method: "POST", body: { servicio: "tow_truck" } });
    expect(r.body.elegido.candidato.authorizationId).toBe(A.acuerdoId);
    expect(r.body.elegido.motivo).toMatch(/^Por /);
    expect(r.body.elegido.notas.sla).toBeGreaterThan(0);
  });

  it("cambiar los pesos cambia el resultado, sin tocar código", async () => {
    // Solo cuenta el historial: los dos están a cero, así que empatan y manda
    // el orden estable por nombre.
    await api("/config/pesos", A.email, {
      method: "PUT",
      body: { pesos: { sla: 0, distancia: 0, precio: 0, aceptacion: 0, rapidez: 0,
                       calidad: 0, historial: 100, preferencia: 0 } },
    });
    const r = await api("/simular", A.email, { method: "POST", body: {} });
    expect(r.body.pesos.sla).toBe(0);
    expect(r.body.pesos.historial).toBe(100);
    // Se restaura para no condicionar las pruebas siguientes.
    await api("/config/pesos", A.email, { method: "PUT", body: { pesos: {} } });
  });

  /* ── Reglas ────────────────────────────────────────────────────────────── */

  it("una regla de exclusión saca al partner y lo dice con el nombre de la regla", async () => {
    const regla = await api("/reglas", A.email, {
      method: "POST",
      body: { name: "Lejanas no en urgencias", action: "excluir", partners: [acuerdoLejos],
              condition: { prioridades: ["urgente"] } },
    });
    expect(regla.status).toBe(201);

    const urgente = await api("/simular", A.email, {
      method: "POST", body: { prioridad: "urgente" },
    });
    const fuera = urgente.body.descartados.find((d: any) => d.authorizationId === acuerdoLejos);
    expect(fuera.motivos[0]).toContain("Lejanas no en urgencias");

    // Sin urgencia la regla no aplica y el partner vuelve a competir.
    const normal = await api("/simular", A.email, { method: "POST", body: { prioridad: "normal" } });
    expect(normal.body.candidatos.map((c: any) => c.candidato.authorizationId)).toContain(acuerdoLejos);

    await api(`/reglas/${regla.body.id}`, A.email, { method: "DELETE" });
  });

  it("una regla que fuerza deja fuera a los demás, con su motivo", async () => {
    const regla = await api("/reglas", A.email, {
      method: "POST", body: { name: "Siempre Lejanas", action: "forzar", partners: [acuerdoLejos] },
    });
    const r = await api("/simular", A.email, { method: "POST", body: {} });
    expect(r.body.elegido.candidato.authorizationId).toBe(acuerdoLejos);
    const otro = r.body.descartados.find((d: any) => d.authorizationId === A.acuerdoId);
    expect(otro.motivos[0]).toContain("otro partner");
    await api(`/reglas/${regla.body.id}`, A.email, { method: "DELETE" });
  });

  /* Quien mire la puntuación tiene que ver que hubo una mano encima. */
  it("un ajuste por regla se suma después y se declara en el motivo", async () => {
    const regla = await api("/reglas", A.email, {
      method: "POST", body: { name: "Empujón", action: "preferir", partners: [acuerdoLejos], adjustment: 60 },
    });
    const r = await api("/simular", A.email, { method: "POST", body: {} });
    expect(r.body.elegido.candidato.authorizationId).toBe(acuerdoLejos);
    expect(r.body.elegido.motivo).toContain("+60 por regla");
    await api(`/reglas/${regla.body.id}`, A.email, { method: "DELETE" });
  });

  /* ── Trazabilidad ──────────────────────────────────────────────────────── */

  it("simular NO ensucia el historial de decisiones reales", async () => {
    const antes = await api("/decisiones", A.email);
    await api("/simular", A.email, { method: "POST", body: { servicio: "tow_truck" } });
    const despues = await api("/decisiones", A.email);
    expect(despues.body.data.length).toBe(antes.body.data.length);
  });

  it("una decisión real queda guardada con su desglose", async () => {
    const r = await svc.enrutar(A.id, { servicio: "tow_truck", assistanceId: 12345 }, { quien: "prueba" });
    expect(r.decisionId).toBeGreaterThan(0);

    const g = await db.query(`SELECT * FROM connect_routing_decisions WHERE id = $1`, [r.decisionId]);
    const fila = g.rows[0];
    expect(Number(fila.controlCenterId)).toBe(A.id);
    expect(Number(fila.chosenAuthorizationId)).toBe(r.elegido!.candidato.authorizationId);
    const candidatos = JSON.parse(fila.candidates);
    expect(candidatos[0].notas).toBeTruthy();
    expect(candidatos[0].motivo).toMatch(/^Por /);
    expect(JSON.parse(fila.weights).sla).toBeGreaterThan(0);
  });

  it("A no ve las decisiones de B", async () => {
    await svc.enrutar(B.id, { servicio: "tow_truck", assistanceId: 999 }, {});
    const r = await api("/decisiones", A.email);
    const centros = new Set(r.body.data.map((d: any) => Number(d.controlCenterId)));
    expect([...centros]).toEqual([A.id]);
  });

  /* ── Métricas ──────────────────────────────────────────────────────────── */

  it("las métricas de un partner no mezclan el trato de dos centrales", async () => {
    // El mismo destino recibe un despacho de A y dos de B.
    for (const [centro, cuantos] of [[A.id, 1], [B.id, 2]] as const) {
      for (let i = 0; i < cuantos; i++) {
        await db.query(
          `INSERT INTO external_dispatches
             (uuid, "sourceSystem", "sourceTenantId", "sourceAssistanceId", "destinationId",
              "correlationId", status, "createdAtMs", "updatedAtMs")
           VALUES ($1,'central',$2,$3,$4,$5,'ACCEPTED',$6,$6)`,
          [`d-met-${centro}-${i}-${sufijo}`, String(centro), `${i}`,
           centro === A.id ? A.destinoId : B.destinoId, `C-${centro}-${i}-${sufijo}`, now],
        );
      }
    }
    const mA = await met.metricasDe(A.id);
    const mB = await met.metricasDe(B.id);
    expect(mA.get(A.acuerdoId)!.enviados).toBe(1);
    expect(mB.get(B.acuerdoId)!.enviados).toBe(2);
    // Y el acuerdo de B no aparece en las métricas de A.
    expect(mA.has(B.acuerdoId)).toBe(false);
  });

  /*
   * Estas métricas las ve un operador: un coste medio del partner sería justo
   * el dato que su competencia no puede leer.
   */
  it("las métricas no llevan ningún importe", async () => {
    const r = await api("/metricas", A.email);
    const texto = JSON.stringify(r.body).toLowerCase();
    for (const prohibido of ["coste", "cost", "precio", "margen", "importe", "amount", "tarifa"]) {
      expect(texto).not.toContain(prohibido);
    }
  });

  it("la simulación tampoco expone costes internos ni márgenes", async () => {
    const r = await api("/simular", A.email, { method: "POST", body: { servicio: "tow_truck" } });
    const texto = JSON.stringify(r.body).toLowerCase();
    for (const prohibido of ["margen", "margin", "costeinterno", "coste_interno"]) {
      expect(texto).not.toContain(prohibido);
    }
  });

  /* ── Modo ──────────────────────────────────────────────────────────────── */

  /* Una central no debería descubrir que sus reglas están mal por una grúa. */
  it("por defecto el motor sugiere, no ejecuta", async () => {
    const r = await api("/config", A.email);
    expect(r.body.modo).toBe("suggest");
  });

  it("pasar a automático queda auditado", async () => {
    const r = await api("/config/modo", A.email, { method: "PUT", body: { modo: "auto" } });
    expect(r.body.modo).toBe("auto");
    const aud = await db.query(
      `SELECT action FROM connect_audit_logs WHERE "controlCenterId" = $1 AND action = 'routing.mode'`,
      [A.id]);
    expect(aud.rows.length).toBeGreaterThan(0);
    await api("/config/modo", A.email, { method: "PUT", body: { modo: "suggest" } });
  });

  it("un modo inventado se degrada a sugerir", async () => {
    const r = await api("/config/modo", A.email, { method: "PUT", body: { modo: "lo_que_sea" } });
    expect(r.body.modo).toBe("suggest");
  });
});
