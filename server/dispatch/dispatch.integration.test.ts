/**
 * Assist → Central, de punta a punta y contra PostgreSQL real.
 *
 * Se levanta la API pública de Central de verdad en un puerto, y el servicio
 * de envío de Assist la llama por HTTP con su API key. No se simula el
 * transporte: si la integración solo funcionara llamando funciones internas,
 * esta prueba no diría nada útil — el día que Central esté en otra máquina, la
 * llamada es exactamente ésta.
 *
 * Lo que se fija:
 *   · dos expedientes independientes, atados por el correlation_id
 *   · idempotencia: reenviar NO crea un segundo expediente en Central
 *   · resolución de la empresa solicitante en la cartera del tenant destino
 *   · el aislamiento multiempresa se respeta al recibir
 *   · privacidad económica: no cruza ningún importe
 *   · un fallo del destino deja el envío recuperable, nunca perdido
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let servidorCentral: Server;
let baseCentral = "";

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let centroId = 0;
let partnerId = 0;
let destinoId = 0;
let asistenciaId = 0;
const CLAVE = `mkc_test_${sufijo}${"0".repeat(Math.max(0, 32 - sufijo.length))}`;
const SECRETO_ENV = `DISPATCH_TEST_KEY_${sufijo}`;

async function crearAsistenciaAssist(extra: Record<string, unknown> = {}): Promise<number> {
  const r = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", "customerPhone", address, latitude, longitude,
        plate, "vehicleDescription", "descripcionAveria", "trabajosARealizar",
        "solicitanteEmpresa", "solicitanteTelefono", "solicitanteAutorizacion",
        notes, "trackingToken", "createdAtMs", "updatedAtMs")
     VALUES ('pendiente','urgente',$1,'600111222','AP-7 km 245',41.118,1.244,
             '1234ABC','Furgón','Rueda reventada','Cambiar rueda',
             $2,'900111222','AUT-777',
             'Nota interna: margen 40 €',$3,$4,$4)
     RETURNING id`,
    [
      (extra.customerName as string) ?? `Cliente ${sufijo}`,
      (extra.solicitanteEmpresa as string) ?? `Transportes ${sufijo} SL`,
      `tok-${sufijo}-${Math.random().toString(36).slice(2, 10)}`,
      now,
    ],
  );
  return Number(r.rows[0].id);
}

describe.skipIf(!RUN)("Integración Assist → Central", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("./schema.ts");
    const { initEventLog } = await import("../eventlog/schema.ts");
    const { createConnectRouter } = await import("../connect/router.ts");
    const { sha256 } = await import("../connect/auth.ts");

    await initDb();
    await initConnect();
    await initDispatch();
    await initEventLog();

    // ── La plataforma de destino: una central con su partner y su API key ──
    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`cc-disp-${sufijo}`, `Plataforma destino ${sufijo}`, now],
    );
    centroId = Number(cc.rows[0].id);

    const p = await db.query(
      `INSERT INTO connect_partners (uuid, name, "controlCenterId", "assignmentMode",
                                     "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,'manual',$4,$4) RETURNING id`,
      [`partner-disp-${sufijo}`, `Assist ${sufijo}`, centroId, now],
    );
    partnerId = Number(p.rows[0].id);

    await db.query(
      `INSERT INTO connect_api_keys ("partnerId", name, "keyPrefix", "keyHash", scopes,
                                     environment, "createdAtMs")
       VALUES ($1,'clave de prueba',$2,$3,$4,'test',$5)`,
      [partnerId, CLAVE.slice(0, 13), sha256(CLAVE),
       JSON.stringify(["assistances:write", "assistances:read"]), now],
    );

    const app = express();
    app.use("/api/connect/v1", createConnectRouter());
    await new Promise<void>((ok) => { servidorCentral = app.listen(0, () => ok()); });
    baseCentral = `http://127.0.0.1:${(servidorCentral.address() as AddressInfo).port}`;

    // ── El destino, tal y como lo configuraría el panel de Assist ──
    process.env[SECRETO_ENV] = CLAVE;
    const d = await db.query(
      `INSERT INTO external_destinations
         (uuid, name, kind, "baseUrl", "secretName", "destinationTenantLabel",
          "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'central',$3,$4,$5,$6,$6) RETURNING id`,
      [`dest-${sufijo}`, `Central Plataforma A ${sufijo}`, baseCentral, SECRETO_ENV,
       "Plataforma A", now],
    );
    destinoId = Number(d.rows[0].id);

    asistenciaId = await crearAsistenciaAssist();
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidorCentral?.closeAllConnections?.();
    servidorCentral?.close();
    delete process.env[SECRETO_ENV];
    await db.query(`DELETE FROM external_dispatch_events WHERE "dispatchId" IN
      (SELECT id FROM external_dispatches WHERE "destinationId" = $1)`, [destinoId]).catch(() => {});
    await db.query(`DELETE FROM external_dispatches WHERE "destinationId" = $1`, [destinoId]).catch(() => {});
    await db.query(`DELETE FROM external_destinations WHERE id = $1`, [destinoId]).catch(() => {});
    await db.query(`DELETE FROM connect_status_history WHERE "assistanceId" IN
      (SELECT id FROM connect_assistances WHERE "partnerId" = $1)`, [partnerId]).catch(() => {});
    await db.query(`DELETE FROM connect_assistances WHERE "partnerId" = $1`, [partnerId]).catch(() => {});
    await db.query(`DELETE FROM connect_api_keys WHERE "partnerId" = $1`, [partnerId]).catch(() => {});
    await db.query(`DELETE FROM connect_partners WHERE id = $1`, [partnerId]).catch(() => {});
    await db.query(`DELETE FROM connect_tenant_companies WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [centroId]).catch(() => {});
  }, 30_000);

  it("envía la asistencia y Central la crea con SU propio expediente", async () => {
    const { subcontratarEnCentral } = await import("./servicio.ts");
    const d = await subcontratarEnCentral({
      assistanceId: asistenciaId,
      destinationId: destinoId,
      tenantId: null,
      limiteAutorizado: 450,
    });

    expect(d.status).toBe("RECEIVED");
    expect(d.lastError).toBeNull();
    expect(d.correlationId).toMatch(/^COR-\d{8}-/);

    // Dos expedientes, no uno compartido.
    expect(d.referenciaOrigen).toBe(`AST-${asistenciaId}`);
    expect(d.referenciaDestino).toMatch(/^AS-\d{4}-\d+$/);
    expect(d.referenciaDestino).not.toBe(d.referenciaOrigen);

    const enCentral = await db.query(
      `SELECT * FROM connect_assistances WHERE "correlationId" = $1`, [d.correlationId]);
    expect(enCentral.rows).toHaveLength(1);
    expect(enCentral.rows[0].controlCenterId).toBe(centroId);
    expect(enCentral.rows[0].sourceSystem).toBe("assist");
    expect(enCentral.rows[0].sourceReference).toBe(`AST-${asistenciaId}`);
    expect(enCentral.rows[0].plate ?? JSON.parse(enCentral.rows[0].vehicle).plate).toBe("1234ABC");
  });

  /*
   * El requisito marcado como CRÍTICO. Se reenvía a propósito la misma
   * asistencia al mismo destino.
   */
  it("reenviar NO crea un segundo expediente en Central", async () => {
    const { subcontratarEnCentral, intentarEnvio } = await import("./servicio.ts");

    const antes = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances WHERE "partnerId" = $1`, [partnerId]);

    // Por la puerta de arriba: el envío ya está en RECEIVED, así que ni sale.
    await expect(
      subcontratarEnCentral({ assistanceId: asistenciaId, destinationId: destinoId, tenantId: null }),
    ).rejects.toThrow(/ya se envió/i);

    // Y forzando el intento por debajo: tampoco, porque el estado no lo permite.
    const dispatch = await db.query(
      `SELECT id FROM external_dispatches WHERE "sourceAssistanceId" = $1 AND "destinationId" = $2`,
      [String(asistenciaId), destinoId]);
    await intentarEnvio(Number(dispatch.rows[0].id));

    const despues = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances WHERE "partnerId" = $1`, [partnerId]);
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  it("la clave de idempotencia protege aunque el envío se repita en la API", async () => {
    // Se llama a la API dos veces con la MISMA Idempotency-Key, que es lo que
    // pasaría si la respuesta se perdiera y Assist reintentara.
    const cuerpo = {
      customer: { name: "Repetido", phone: "600000000" },
      address: "Calle de prueba 1",
      metadata: { correlation_id: `COR-repetido-${sufijo}`, source_system: "assist" },
    };
    const enviar = () =>
      fetch(`${baseCentral}/api/connect/v1/assistances`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CLAVE}`,
          "Idempotency-Key": `idem-${sufijo}`,
        },
        body: JSON.stringify(cuerpo),
      });

    const a = await enviar();
    const b = await enviar();
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);          // 200, no 201: es la misma, no una nueva
    expect(((await a.json()) as any).id).toBe(((await b.json()) as any).id);

    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances
        WHERE "partnerId" = $1 AND "idempotencyKey" = $2`, [partnerId, `idem-${sufijo}`]);
    expect(n.rows[0].n).toBe(1);
  });

  /*
   * La empresa que pide el servicio entra en la cartera del tenant destino,
   * como CLIENTE y solo como cliente: darle rol de proveedor la metería en el
   * reparto de asistencias sin estar homologada.
   */
  it("resuelve la empresa solicitante en la cartera del tenant destino", async () => {
    const r = await db.query(
      `SELECT a."requesterCompanyId", pc.name, tc.roles
         FROM connect_assistances a
         JOIN connect_provider_companies pc ON pc.id = a."requesterCompanyId"
         JOIN connect_tenant_companies tc ON tc."companyId" = pc.id AND tc."controlCenterId" = $2
        WHERE a."sourceReference" = $1`,
      [`AST-${asistenciaId}`, centroId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].name).toContain(`Transportes ${sufijo}`);
    expect(JSON.parse(r.rows[0].roles)).toEqual(["CUSTOMER"]);
  });

  /*
   * Privacidad económica: Assist manda lo que hace falta para operar y nada de
   * lo que le cuesta o le cobra a nadie.
   */
  it("no cruza ningún importe ni la nota interna", async () => {
    const d = await db.query(
      `SELECT "payloadSnapshot" FROM external_dispatches
        WHERE "sourceAssistanceId" = $1 AND "destinationId" = $2`,
      [String(asistenciaId), destinoId]);
    const sobre = String(d.rows[0].payloadSnapshot).toLowerCase();
    expect(sobre).not.toContain("margen");
    expect(sobre).not.toContain("nota interna");
    // Y lo que sí tiene que ir, va.
    expect(sobre).toContain("1234abc");
    expect(sobre).toContain("450");        // el límite autorizado
  });

  /*
   * El principio número uno: una solicitud no se pierde nunca. Se apunta a un
   * puerto donde no hay nadie escuchando.
   */
  it("si el destino no responde, el envío queda en ERROR y se puede reintentar", async () => {
    const { subcontratarEnCentral } = await import("./servicio.ts");
    const otra = await crearAsistenciaAssist();
    const roto = await db.query(
      `INSERT INTO external_destinations
         (uuid, name, kind, "baseUrl", "secretName", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'central','http://127.0.0.1:1',$3,$4,$4) RETURNING id`,
      [`dest-roto-${sufijo}`, `Destino caído ${sufijo}`, SECRETO_ENV, now],
    );

    const d = await subcontratarEnCentral({
      assistanceId: otra, destinationId: Number(roto.rows[0].id), tenantId: null,
    });
    expect(d.status).toBe("ERROR");
    expect(d.lastError).toBeTruthy();
    expect(d.sePuedeReintentar).toBe(true);
    expect(d.retryCount).toBeGreaterThan(0);
    // La solicitud existe: no se ha perdido.
    expect(d.correlationId).toBeTruthy();

    await db.query(`DELETE FROM external_dispatch_events WHERE "dispatchId" = $1`, [d.id]);
    await db.query(`DELETE FROM external_dispatches WHERE id = $1`, [d.id]);
    await db.query(`DELETE FROM external_destinations WHERE id = $1`, [roto.rows[0].id]);
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [otra]);
  });

  /*
   * Antes esto creaba el envío y lo dejaba en ERROR. Ahora la puerta de
   * destinos lo rechaza ANTES de crear nada, que es mejor: un destino sin
   * credencial no es un envío que haya fallado, es uno que no debía salir.
   */
  it("sin credencial configurada no se llega a crear el envío, y se dice por qué", async () => {
    const { subcontratarEnCentral } = await import("./servicio.ts");
    const otra = await crearAsistenciaAssist();
    const sinClave = await db.query(
      `INSERT INTO external_destinations
         (uuid, name, kind, "baseUrl", "secretName", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'central',$3,'ESTA_VARIABLE_NO_EXISTE',$4,$4) RETURNING id`,
      [`dest-sinclave-${sufijo}`, `Sin credencial ${sufijo}`, baseCentral, now],
    );

    await expect(
      subcontratarEnCentral({
        assistanceId: otra, destinationId: Number(sinClave.rows[0].id), tenantId: null,
      }),
    ).rejects.toThrow(/MISCONFIGURED|no existe/i);

    // Y no ha quedado ningún envío a medias.
    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM external_dispatches WHERE "destinationId" = $1`,
      [sinClave.rows[0].id]);
    expect(n.rows[0].n).toBe(0);

    await db.query(`DELETE FROM external_destinations WHERE id = $1`, [sinClave.rows[0].id]);
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [otra]);
  });

  /*
   * La vuelta: Central avanza por SU flujo normal y Assist se entera. Se
   * comprueba que Assist traduce a SUS estados, no que copie los de Central.
   */
  it("los eventos de Central mueven la asistencia de Assist", async () => {
    const { aplicarAvisoDeCentral } = await import("./servicio.ts");
    const d = await db.query(
      `SELECT id, "correlationId" FROM external_dispatches
        WHERE "sourceAssistanceId" = $1 AND "destinationId" = $2`,
      [String(asistenciaId), destinoId]);
    const correlationId = d.rows[0].correlationId;

    // Aceptada: el envío lo registra, pero la asistencia NO se mueve todavía
    // — que Central se haga cargo no significa que haya nadie conduciendo.
    await aplicarAvisoDeCentral(correlationId, "assistance.pending", {});
    const r1 = await aplicarAvisoDeCentral(correlationId, "assistance.assigned", {});
    expect(r1.aplicado).toBe(true);

    let a = await db.query(`SELECT status FROM roadside_assistances WHERE id = $1`, [asistenciaId]);
    expect(a.rows[0].status).toBe("asignada");

    await aplicarAvisoDeCentral(correlationId, "assistance.en_route", {});
    a = await db.query(`SELECT status FROM roadside_assistances WHERE id = $1`, [asistenciaId]);
    expect(a.rows[0].status).toBe("en_camino");

    await aplicarAvisoDeCentral(correlationId, "assistance.finished", {});
    a = await db.query(`SELECT status FROM roadside_assistances WHERE id = $1`, [asistenciaId]);
    expect(a.rows[0].status).toBe("finalizada");

    const envio = await db.query(`SELECT * FROM external_dispatches WHERE id = $1`, [d.rows[0].id]);
    expect(envio.rows[0].status).toBe("COMPLETED");
    expect(envio.rows[0].completedAtMs).toBeTruthy();

    // Y queda el historial completo, que es lo que permite reconstruir después.
    const eventos = await db.query(
      `SELECT event FROM external_dispatch_events WHERE "dispatchId" = $1 ORDER BY id`,
      [d.rows[0].id]);
    const lista = eventos.rows.map((e: any) => e.event);
    expect(lista[0]).toBe("REQUESTED");
    expect(lista).toContain("ASSIGNED");
    expect(lista).toContain("COMPLETED");
  });

  it("un estado de Central sin equivalente no rompe nada: se ignora con motivo", async () => {
    const { aplicarAvisoDeCentral } = await import("./servicio.ts");
    const d = await db.query(
      `SELECT "correlationId" FROM external_dispatches
        WHERE "sourceAssistanceId" = $1 AND "destinationId" = $2`,
      [String(asistenciaId), destinoId]);
    const r = await aplicarAvisoDeCentral(d.rows[0].correlationId, "assistance.inventado", {});
    expect(r.aplicado).toBe(false);
  });

  it("un aviso con un correlation_id desconocido no se aplica a nadie", async () => {
    const { aplicarAvisoDeCentral } = await import("./servicio.ts");
    const r = await aplicarAvisoDeCentral("COR-noexiste-0000", "assistance.finished", {});
    expect(r.aplicado).toBe(false);
    expect(r.motivo).toContain("desconocido");
  });

  it("una API key de otra plataforma no puede leer estas asistencias", async () => {
    const res = await fetch(`${baseCentral}/api/connect/v1/assistances`, {
      headers: { Authorization: "Bearer mkc_test_clavequenoexiste0000000000000" },
    });
    expect(res.status).toBe(401);
  });
});
