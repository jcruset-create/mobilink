/**
 * Lo que el taller no comparte no sale de la base, contra PostgreSQL real.
 *
 * La posición, la matrícula y el técnico de una furgoneta son de la empresa
 * propietaria. El taller decide qué unidades pone a disposición de Central; el
 * resto no es información que Central pueda manejar, ni siquiera de refilón en
 * un recuento.
 *
 * El filtro va en el SQL a propósito y estas pruebas lo comprueban por HTTP:
 * ocultar en el navegador dejaría el dato viajando en la respuesta, donde lo
 * lee cualquiera que abra las herramientas del navegador.
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

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let centroId = 0;
let empresaId = 0;
let tallerId = 0;
let idCompartida = 0;
let idReservada = 0;
const admin = `admin-uni-${sufijo}@example.com`;
const operador = `oper-uni-${sufijo}@example.com`;

async function api(ruta: string, usuario: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, { headers: { "x-test-user": usuario } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function unidad(nombre: string, compartida: boolean): Promise<number> {
  const r = await db.query(
    `INSERT INTO connect_mobile_units
       (name, plate, status, "providerCompanyId", "workshopId", "technicianRef",
        latitude, longitude, "positionText", "sharedWithCentral", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,'available',$3,$4,'Tecnico Secreto',
             41.1189, 1.2445, 'Calle del Estany, Tarragona', $5,$6,$6)
     RETURNING id`,
    [nombre, `PLACA-${nombre}`, empresaId, tallerId, compartida, now],
  );
  return Number(r.rows[0].id);
}

describe.skipIf(!RUN)("Unidades móviles: solo se ve lo compartido", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("./schema.ts");
    const { createConnectBackofficeRouter } = await import("./backoffice.ts");
    await initDb();
    await initConnect();

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`cc-uni-${sufijo}`, `Central unidades ${sufijo}`, now]);
    centroId = Number(cc.rows[0].id);

    for (const [email, rol] of [[admin, "cc_admin"], [operador, "operator"]] as const) {
      await db.query(
        `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$5)`, [centroId, email, `Usuario ${rol}`, rol, now]);
    }

    const e = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`emp-${sufijo}`, `Empresa ${sufijo}`, now]);
    empresaId = Number(e.rows[0].id);

    const t = await db.query(
      `INSERT INTO connect_workshops
         ("providerCompanyId", name, latitude, longitude, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,41.1189,1.2445,$3,$3) RETURNING id`,
      [empresaId, `Taller ${sufijo}`, now]);
    tallerId = Number(t.rows[0].id);

    idCompartida = await unidad(`Compartida-${sufijo}`, true);
    idReservada = await unidad(`Reservada-${sufijo}`, false);

    const app = express();
    app.use("/bo", createConnectBackofficeRouter());
    await new Promise<void>((ok) => { servidor = app.listen(0, () => ok()); });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/bo`;
  }, 60_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    servidor?.closeAllConnections?.();
    servidor?.close();
    for (const sql of [
      `DELETE FROM connect_mobile_units WHERE "providerCompanyId" = $1`,
      `DELETE FROM connect_workshops WHERE "providerCompanyId" = $1`,
      `DELETE FROM connect_provider_companies WHERE id = $1`,
    ]) await db.query(sql, [empresaId]).catch(() => {});
    await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [centroId]).catch(() => {});
  }, 30_000);

  it("la ficha del taller no devuelve la unidad que no se comparte", async () => {
    const r = await api(`/workshops/${tallerId}/mobile-units`, operador);
    expect(r.status).toBe(200);
    const ids = r.body.data.map((u: any) => Number(u.id));
    expect(ids).toContain(idCompartida);
    expect(ids).not.toContain(idReservada);
  });

  it("la vista transversal tampoco, y el dato no viaja en la respuesta", async () => {
    const r = await api("/mobile-units", operador);
    expect(r.status).toBe(200);
    // Ni la matrícula, ni la posición, ni el técnico: nada de la reservada
    expect(JSON.stringify(r.body)).not.toContain(`Reservada-${sufijo}`);
    expect(r.body.data.some((u: any) => Number(u.id) === idCompartida)).toBe(true);
  });

  it("el recuento de la empresa cuenta solo lo compartido", async () => {
    const r = await api(`/providers/${empresaId}`, operador);
    expect(r.status).toBe(200);
    const taller = (r.body.workshops ?? []).find((w: any) => Number(w.id) === tallerId);
    expect(Number(taller?.units)).toBe(1);
    expect(Number(r.body.summary?.units?.total)).toBe(1);
  });

  it("el cuadro de lo compartido lista las dos, con el nombre y nada más", async () => {
    const r = await api(`/mobile-units/sharing?workshopId=${tallerId}`, admin);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(2);
    const reservada = r.body.data.find((u: any) => Number(u.id) === idReservada);
    expect(reservada.sharedWithCentral).toBe(false);
    // Lo confidencial no está ni aquí
    expect(reservada.plate).toBeUndefined();
    expect(reservada.latitude).toBeUndefined();
    expect(reservada.technicianRef).toBeUndefined();
  });

  it("la furgoneta se da de alta a mano con su matrícula, marca y modelo", async () => {
    const res = await fetch(`${base}/workshops/${tallerId}/mobile-units`, {
      method: "POST",
      headers: { "x-test-user": admin, "content-type": "application/json" },
      body: JSON.stringify({
        name: `Manual-${sufijo}`, plate: "1234ABC", make: "Ford", model: "Transit",
        workshopVan: true, truckTyreMachine: true,
      }),
    });
    expect(res.status).toBe(201);
    const creada = await res.json() as any;
    expect(creada.origin).toBe("manual");
    expect(creada.make).toBe("Ford");
    // El equipamiento es lo que decide a que furgoneta se manda el servicio
    expect(creada.workshopVan).toBe(true);
    expect(creada.truckTyreMachine).toBe(true);

    // Y aparece en la tabla con su vehículo
    const r = await api(`/workshops/${tallerId}/mobile-units`, operador);
    const fila = r.body.data.find((u: any) => Number(u.id) === Number(creada.id));
    expect(fila.model).toBe("Transit");

    // Guardar la ficha sin mandar el taller NO la deja sin taller
    const patch = await fetch(`${base}/mobile-units/${creada.id}`, {
      method: "PATCH",
      headers: { "x-test-user": admin, "content-type": "application/json" },
      body: JSON.stringify({ plate: "4321CBA", truckTyreMachine: false }),
    });
    expect(patch.status).toBe(200);
    const tras = await patch.json() as any;
    expect(tras.workshopId).toBe(tallerId);
    // Quitar un equipamiento tiene que poder hacerse: false no es "no lo toques"
    expect(tras.truckTyreMachine).toBe(false);
    expect(tras.workshopVan).toBe(true);

    // La manual se puede dar de baja
    const del = await fetch(`${base}/mobile-units/${creada.id}`, {
      method: "DELETE", headers: { "x-test-user": admin },
    });
    expect(del.status).toBe(200);
  });

  it("una furgoneta del sincronismo no se borra desde el panel", async () => {
    const res = await fetch(`${base}/mobile-units/${idCompartida}`, {
      method: "DELETE", headers: { "x-test-user": admin },
    });
    // Volvería a aparecer en la siguiente pasada: se da de baja en Assist
    expect(res.status).toBe(409);
  });

  it("el operador no puede abrir el cuadro: es de quien administra", async () => {
    const r = await api("/mobile-units/sharing", operador);
    expect(r.status).toBe(403);
  });

  it("devuelto el permiso, la unidad vuelve a verse", async () => {
    const res = await fetch(`${base}/mobile-units/${idReservada}/share`, {
      method: "PATCH",
      headers: { "x-test-user": admin, "content-type": "application/json" },
      body: JSON.stringify({ shared: true }),
    });
    expect(res.status).toBe(200);
    const r = await api(`/workshops/${tallerId}/mobile-units`, operador);
    expect(r.body.data.map((u: any) => Number(u.id))).toContain(idReservada);
    // y se deja como estaba para no depender del orden de las pruebas
    await fetch(`${base}/mobile-units/${idReservada}/share`, {
      method: "PATCH",
      headers: { "x-test-user": admin, "content-type": "application/json" },
      body: JSON.stringify({ shared: false }),
    });
  });
});
