/**
 * Acuerdos comerciales y presupuestos, contra PostgreSQL y por HTTP.
 *
 * Lo que se fija:
 *   · la Plataforma A no lee ni toca el acuerdo de la B cambiando el id
 *   · el motor de evaluación filtra por centro, así que B no sale en A
 *   · el flujo del presupuesto va REQUEST → QUOTE → QUOTE_ACCEPTED y no vuelve
 *   · una oferta caducada no se puede aceptar
 *   · un acuerdo antiguo, sin campos nuevos, sigue cubriendo todo
 *
 * Se llama al router real por HTTP: el aislamiento vive en las consultas, y
 * probarlo llamando a funciones internas no demostraría nada de lo que importa.
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

interface Plataforma { id: number; email: string; empresaId: number; acuerdoId: number }
let A: Plataforma;
let B: Plataforma;
let asistenciaA = 0;

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

async function crearPlataforma(nombre: string, acuerdo: Record<string, unknown>): Promise<Plataforma> {
  const cc = await db.query(
    `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$3) RETURNING id`,
    [`cc-acu-${nombre}-${sufijo}`, `Plataforma ${nombre}`, now],
  );
  const id = Number(cc.rows[0].id);
  const email = `admin-acu-${nombre}-${sufijo}@example.com`;
  await db.query(
    `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,'cc_admin',$4,$4)`,
    [id, email, `Admin ${nombre}`, now],
  );
  const emp = await db.query(
    `INSERT INTO connect_provider_companies
       (uuid, name, "taxId", "taxIdNormalized", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$3,$4,$4) RETURNING id`,
    [`emp-acu-${nombre}-${sufijo}`, `Grúas ${nombre}`, `A${nombre.toUpperCase()}${sufijo}`, now],
  );
  const empresaId = Number(emp.rows[0].id);
  const a = await db.query(
    `INSERT INTO connect_provider_authorizations
       ("controlCenterId", "providerCompanyId", status, "serviceTypes", coverage, schedule,
        currency, "quoteThreshold", "maxAmount", "quoteRequired", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,'active',$3,$4,$5,'EUR',$6,$7,$8,$9,$9) RETURNING id`,
    [id, empresaId,
     JSON.stringify(acuerdo.servicios ?? []), JSON.stringify(acuerdo.cobertura ?? {}),
     JSON.stringify(acuerdo.horario ?? { veinticuatroHoras: true }),
     acuerdo.umbral ?? null, acuerdo.tope ?? null, acuerdo.presupuestoObligatorio === true, now],
  );
  return { id, email, empresaId, acuerdoId: Number(a.rows[0].id) };
}

describe.skipIf(!RUN)("Acuerdos comerciales y presupuestos", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { createAcuerdosRouter } = await import("./router.ts");
    await initDb();
    await initConnect();
    svc = await import("./servicio.ts");

    A = await crearPlataforma("alfa", {
      servicios: ["tow_truck"],
      cobertura: { provincias: ["Tarragona"], codigosPostales: ["43"] },
      umbral: 200, tope: 1000,
    });
    B = await crearPlataforma("beta", {});

    const asi = await db.query(
      `INSERT INTO connect_assistances
         ("controlCenterId", uuid, "expedientNumber", status, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,'pending',$4,$4) RETURNING id`,
      [A.id, `asi-acu-${sufijo}`, `AS-ACU-${sufijo}`, now],
    );
    asistenciaA = Number(asi.rows[0].id);

    const app = express();
    app.use("/acuerdos", createAcuerdosRouter());
    await new Promise<void>((ok) => { servidor = app.listen(0, () => ok()); });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/acuerdos`;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidor?.closeAllConnections?.();
    servidor?.close();
    for (const p of [A, B]) {
      if (!p) continue;
      await db.query(`DELETE FROM connect_quotes WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM connect_assistances WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM connect_provider_authorizations WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [p.empresaId]).catch(() => {});
      await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [p.id]).catch(() => {});
    }
  }, 30_000);

  /* ── Aislamiento ───────────────────────────────────────────────────────── */

  it("cada plataforma ve su acuerdo y no el de la otra", async () => {
    const a = await api("/", A.email);
    expect(a.status).toBe(200);
    const ids = a.body.data.map((x: any) => x.id);
    expect(ids).toContain(A.acuerdoId);
    expect(ids).not.toContain(B.acuerdoId);
  });

  /* Cambiar el número en la URL no puede servir de nada. */
  it("A no puede leer el acuerdo de B por su id", async () => {
    const r = await api(`/${B.acuerdoId}`, A.email);
    expect(r.status).toBe(404);
  });

  it("A tampoco puede modificarlo", async () => {
    const r = await api(`/${B.acuerdoId}`, A.email, { method: "PATCH", body: { maxAmount: 1 } });
    expect(r.status).toBe(404);
    const enBase = await db.query(
      `SELECT "maxAmount" FROM connect_provider_authorizations WHERE id = $1`, [B.acuerdoId]);
    expect(enBase.rows[0].maxAmount).toBeNull();
  });

  /* Un id que no existe y uno que es de otro contestan igual. */
  it("un acuerdo inexistente da el mismo 404 que uno ajeno", async () => {
    const r = await api(`/99999999`, A.email);
    expect(r.status).toBe(404);
  });

  /* ── Condiciones ───────────────────────────────────────────────────────── */

  it("guarda zonas, horarios y condiciones y las devuelve leídas", async () => {
    const r = await api(`/${A.acuerdoId}`, A.email, {
      method: "PATCH",
      body: {
        schedule: { franjas: [{ dia: 1, inicio: "08:00", fin: "18:00" }] },
        requiredDocuments: ["parte_firmado", "fotos"],
        cancelFreeMin: 30, cancelFee: 25, cancelFeeIsPercent: false,
        slaAcceptMin: 5, slaArrivalMin: 45,
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.horario.veinticuatroHoras).toBe(false);
    expect(r.body.condiciones.documentacionExigida).toEqual(["parte_firmado", "fotos"]);
    expect(r.body.condiciones.cancelacionSinCosteMin).toBe(30);
    expect(r.body.slaArrivalMin).toBe(45);
  });

  it("rechaza una vigencia que termina antes de empezar", async () => {
    const r = await api(`/${A.acuerdoId}`, A.email, {
      method: "PATCH", body: { validFromMs: now + 10_000, validToMs: now },
    });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain("antes de empezar");
  });

  /* Un umbral por encima del tope no se alcanzaría nunca: es un error, no un matiz. */
  it("rechaza un umbral de presupuesto por encima del tope", async () => {
    const r = await api(`/${A.acuerdoId}`, A.email, {
      method: "PATCH", body: { quoteThreshold: 5000, maxAmount: 1000 },
    });
    expect(r.status).toBe(422);
  });

  it("no deja escribir columnas que no están en la lista blanca", async () => {
    const r = await api(`/${A.acuerdoId}`, A.email, {
      method: "PATCH", body: { controlCenterId: B.id, providerCompanyId: B.empresaId, notes: "ok" },
    });
    expect(r.status).toBe(200);
    const enBase = await db.query(
      `SELECT "controlCenterId", "providerCompanyId" FROM connect_provider_authorizations WHERE id = $1`,
      [A.acuerdoId]);
    expect(Number(enBase.rows[0].controlCenterId)).toBe(A.id);
    expect(Number(enBase.rows[0].providerCompanyId)).toBe(A.empresaId);
  });

  /* ── Evaluación ────────────────────────────────────────────────────────── */

  it("evalúa dentro de la zona y del horario pactados", async () => {
    // Lunes a las 10:00, dentro de la franja que se acaba de guardar.
    const lunes10 = new Date(2026, 0, 5, 10, 0).getTime();
    const r = await api("/evaluar", A.email, {
      method: "POST",
      body: { servicio: "tow_truck", provincia: "Tarragona", codigoPostal: "43201", cuandoMs: lunes10 },
    });
    expect(r.status).toBe(200);
    expect(r.body.aptos.map((c: any) => c.acuerdo.id)).toContain(A.acuerdoId);
  });

  it("descarta fuera de zona y dice por qué", async () => {
    const lunes10 = new Date(2026, 0, 5, 10, 0).getTime();
    const r = await api("/evaluar", A.email, {
      method: "POST", body: { servicio: "tow_truck", provincia: "Teruel", cuandoMs: lunes10 },
    });
    const d = r.body.descartados.find((c: any) => c.acuerdo.id === A.acuerdoId);
    expect(d).toBeTruthy();
    expect(d.evaluacion.motivos.join(" ")).toContain("Teruel");
  });

  /* La evaluación no puede sacar partners de otra plataforma. */
  it("la evaluación de A nunca devuelve el acuerdo de B", async () => {
    const r = await api("/evaluar", A.email, { method: "POST", body: {} });
    const todos = [...r.body.aptos, ...r.body.descartados].map((c: any) => c.acuerdo.id);
    expect(todos).not.toContain(B.acuerdoId);
  });

  it("por encima del umbral marca que hace falta presupuesto, sin descartar", async () => {
    const lunes10 = new Date(2026, 0, 5, 10, 0).getTime();
    const r = await api("/evaluar", A.email, {
      method: "POST",
      body: { servicio: "tow_truck", provincia: "Tarragona", importeEstimado: 600, cuandoMs: lunes10 },
    });
    const c = r.body.aptos.find((x: any) => x.acuerdo.id === A.acuerdoId);
    expect(c.evaluacion.requierePresupuesto).toBe(true);
  });

  /* ── Presupuestos ──────────────────────────────────────────────────────── */

  it("el flujo va REQUEST → QUOTE → QUOTE_ACCEPTED", async () => {
    const pedido = await api("/presupuestos", A.email, {
      method: "POST", body: { assistanceId: asistenciaA, authorizationId: A.acuerdoId, correlationId: `COR-acu-${sufijo}` },
    });
    expect(pedido.status).toBe(201);
    expect(pedido.body.status).toBe("REQUESTED");

    const oferta = await svc.registrarOferta(`COR-acu-${sufijo}`, {
      importe: 245, moneda: "EUR", concepto: "Grúa hasta taller", etaMin: 40,
    });
    expect(oferta.aplicado).toBe(true);

    const decidido = await api(`/presupuestos/${pedido.body.id}/decidir`, A.email, {
      method: "POST", body: { aceptar: true },
    });
    expect(decidido.status).toBe(200);
    expect(decidido.body.status).toBe("ACCEPTED");
    expect(Number(decidido.body.amount)).toBe(245);
  });

  /* Desaceptar dejaría un servicio en marcha sin precio. */
  it("un presupuesto aceptado no vuelve atrás", async () => {
    const q = await db.query(
      `SELECT id FROM connect_quotes WHERE "assistanceId" = $1 AND status = 'ACCEPTED'`, [asistenciaA]);
    const r = await api(`/presupuestos/${q.rows[0].id}/decidir`, A.email, {
      method: "POST", body: { aceptar: false, motivo: "me arrepiento" },
    });
    expect(r.status).toBe(409);
  });

  it("pedir dos veces al mismo partner no crea dos presupuestos", async () => {
    const primero = await svc.pedirPresupuesto({
      centro: A.id, assistanceId: asistenciaA, authorizationId: A.acuerdoId,
    });
    const segundo = await svc.pedirPresupuesto({
      centro: A.id, assistanceId: asistenciaA, authorizationId: A.acuerdoId,
    });
    expect(Number(segundo.id)).toBe(Number(primero.id));
  });

  it("una oferta con un correlation_id desconocido no aplica nada", async () => {
    const r = await svc.registrarOferta("COR-no-existe", { importe: 100 });
    expect(r.aplicado).toBe(false);
    expect(r.motivo).toContain("desconocido");
  });

  it("un importe que no es un número se rechaza", async () => {
    const r = await svc.registrarOferta(`COR-acu-${sufijo}`, { importe: "mucho" });
    expect(r.aplicado).toBe(false);
  });

  it("una oferta caducada no se puede aceptar", async () => {
    const cor = `COR-cad-${sufijo}`;
    const asi = await db.query(
      `INSERT INTO connect_assistances ("controlCenterId", uuid, status, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'pending',$3,$3) RETURNING id`,
      [A.id, `asi-cad-${sufijo}`, now]);
    const otra = Number(asi.rows[0].id);
    const q = await svc.pedirPresupuesto({
      centro: A.id, assistanceId: otra, authorizationId: null, correlationId: cor,
    });
    await svc.registrarOferta(cor, { importe: 100, validoHastaMs: Date.now() - 1000 });
    await expect(svc.decidirPresupuesto(Number(q.id), A.id, true, null))
      .rejects.toThrow(/caducado/i);
  });

  /* El centro va en el WHERE, no en la confianza. */
  it("A no puede decidir un presupuesto de B", async () => {
    const q = await svc.pedirPresupuesto({
      centro: B.id, assistanceId: 1, authorizationId: B.acuerdoId, correlationId: `COR-b-${sufijo}`,
    });
    await expect(svc.decidirPresupuesto(Number(q.id), A.id, true, null))
      .rejects.toThrow(/no encontrado/i);
  });

  /* ── Compatibilidad ────────────────────────────────────────────────────── */

  /*
   * Nadie acordó una restricción que nadie escribió: el acuerdo de B se creó
   * sin zonas, sin horario y sin límites, y tiene que seguir valiendo para
   * todo.
   */
  it("un acuerdo sin campos nuevos cubre todo, a cualquier hora", async () => {
    const r = await api("/evaluar", B.email, {
      method: "POST",
      body: { servicio: "tyres", provincia: "Teruel", codigoPostal: "44001",
              importeEstimado: 9999, cuandoMs: new Date(2026, 0, 4, 4, 0).getTime() },
    });
    const c = r.body.aptos.find((x: any) => x.acuerdo.id === B.acuerdoId);
    expect(c).toBeTruthy();
    expect(c.evaluacion.requierePresupuesto).toBe(false);
  });
});
