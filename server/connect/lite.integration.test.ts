/**
 * Pruebas de integración de Mobilink Assist Lite contra una base de datos real.
 *
 * Hasta ahora solo había pruebas de las reglas puras (`liteRules.test.ts`): el
 * ciclo completo —Central asigna, el operario acepta, recorre los estados,
 * manda posiciones, cierra y vuelve al taller— no se probaba nunca contra
 * PostgreSQL, que es donde de verdad viven la máquina de estados, la
 * idempotencia y el aislamiento entre talleres.
 *
 * Se ejecutan solo con `RUN_DB_TESTS=1` y `DATABASE_URL` apuntando a una base
 * de datos DESECHABLE: el esquema se crea entero y se escriben datos. La CI
 * levanta un contenedor de PostgreSQL para esto; en local, `npm test` las salta
 * y no molesta a nadie.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/** Datos de la sesión que va usando el operario a lo largo del ciclo. */
let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;
let tallerId = 0;
let tallerAjenoId = 0;
let asistenciaId = 0;
let asistenciaAjenaId = 0;
let token = "";
const PIN = "4721";

/** Llamada a la API de la APK, con la sesión si ya se ha hecho login. */
async function api(
  ruta: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; body: any }> {
  const t = opts.token ?? token;
  const res = await fetch(`${base}${ruta}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Identificador único por ejecución: la base puede reutilizarse entre runs. */
const sufijo = String(process.hrtime.bigint()).slice(-9);

/** Instante de referencia de las posiciones, compartido entre pruebas. */
const tsPrimerPunto = Date.now();

describe.skipIf(!RUN)("Mobilink Assist Lite · ciclo completo contra PostgreSQL", () => {
  beforeAll(async () => {
    const { initDb } = await import("../db.ts");
    db = (await import("../db.ts")).default;
    const { initConnect } = await import("./schema.ts");
    const { mountConnect } = await import("./index.ts");

    await initDb();
    await initConnect();

    const app = express();
    app.use(express.json());
    mountConnect(app, (_req, _res, next) => next());
    await new Promise<void>((resolve) => {
      servidor = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/connect/lite`;

    const now = Date.now();
    const empresa = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "coreInstance", "createdAtMs", "updatedAtMs")
       VALUES ($1, $2, 'external', $3, $3) RETURNING id`,
      [`it-${sufijo}`, `Empresa de pruebas ${sufijo}`, now],
    );

    // Dos talleres Lite: el segundo existe solo para comprobar que no puede
    // ver lo del primero.
    const crearTaller = async (nombre: string, code: string) => {
      const r = await db.query(
        `INSERT INTO connect_workshops
           ("providerCompanyId", name, latitude, longitude, "radiusKm", services,
            "integrationType", "liteCode", "connectStatus", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,41.1189,1.2445,60,'["tyres","mechanical"]','lite',$3,'active',$4,$4)
         RETURNING id`,
        [empresa.rows[0].id, nombre, code, now],
      );
      return Number(r.rows[0].id);
    };
    tallerId = await crearTaller(`Taller Lite ${sufijo}`, `IT${sufijo}`);
    tallerAjenoId = await crearTaller(`Taller ajeno ${sufijo}`, `AJ${sufijo}`);

    const { hashPin, newPinSalt } = await import("./lite.ts");
    const crearOperario = async (workshopId: number, username: string) => {
      const salt = newPinSalt();
      const r = await db.query(
        `INSERT INTO connect_lite_users
           (uuid, "workshopId", name, username, "pinHash", "pinSalt", role, active, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,'operator',true,$7,$7) RETURNING id`,
        [`itu-${username}`, workshopId, `Operario ${username}`, username, hashPin(PIN, salt), salt, now],
      );
      return Number(r.rows[0].id);
    };
    await crearOperario(tallerId, `op${sufijo}`);
    await crearOperario(tallerAjenoId, `aj${sufijo}`);

    const crearAsistencia = async (workshopId: number) => {
      const r = await db.query(
        `INSERT INTO connect_assistances
           (uuid, status, "serviceType", address, latitude, longitude, "customerName",
            "customerPhone", "workshopId", "expedientNumber", origin, "createdAtMs", "updatedAtMs")
         VALUES ($1,'assigned','tyres','Ctra. N-340 km 1170, Tarragona',41.12,1.25,
                 'Cliente de pruebas','600000000',$2,$3,'manual',$4,$4)
         RETURNING id`,
        [`ita-${workshopId}-${sufijo}`, workshopId, `IT-${workshopId}-${sufijo}`, now],
      );
      return Number(r.rows[0].id);
    };
    asistenciaId = await crearAsistencia(tallerId);
    asistenciaAjenaId = await crearAsistencia(tallerAjenoId);
  }, 120_000);

  afterAll(async () => {
    // Se limpia lo creado por la prueba; el esquema se queda para el siguiente run
    if (db && tallerId) {
      await db.query(`DELETE FROM connect_assistances WHERE "workshopId" = ANY($1::int[])`, [[tallerId, tallerAjenoId]]).catch(() => {});
      await db.query(`DELETE FROM connect_lite_users WHERE "workshopId" = ANY($1::int[])`, [[tallerId, tallerAjenoId]]).catch(() => {});
      await db.query(`DELETE FROM connect_workshops WHERE id = ANY($1::int[])`, [[tallerId, tallerAjenoId]]).catch(() => {});
    }
    servidor?.close();
  });

  it("rechaza el login con PIN incorrecto", async () => {
    const r = await api("/login", {
      method: "POST",
      body: { workshopCode: `IT${sufijo}`, username: `op${sufijo}`, pin: "0000" },
    });
    expect(r.status).toBe(401);
  });

  it("el operario entra con código de taller, usuario y PIN", async () => {
    const r = await api("/login", {
      method: "POST",
      body: {
        workshopCode: `IT${sufijo}`,
        username: `op${sufijo}`,
        pin: PIN,
        device: { deviceId: `dev-it-${sufijo}`, platform: "android", appVersion: "test" },
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.token).toMatch(/^lite_/);
    token = r.body.token;
  });

  it("la asistencia que Central le ha asignado está en pendientes", async () => {
    const r = await api("/assistances?scope=pending");
    expect(r.status).toBe(200);
    const ids = (r.body.data as any[]).map((a) => a.id);
    expect(ids).toContain(asistenciaId);
  });

  it("sin token no se puede leer nada", async () => {
    const r = await api(`/assistances/${asistenciaId}`, { token: "" });
    expect(r.status).toBe(401);
  });

  it("un taller no puede ver la asistencia de otro", async () => {
    const r = await api(`/assistances/${asistenciaAjenaId}`);
    expect(r.status).toBe(404);
  });

  it("aceptar la asistencia la pasa a técnico asignado", async () => {
    const r = await api(`/assistances/${asistenciaId}/accept`, {
      method: "POST",
      body: { clientActionId: `acc-${sufijo}` },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("technician_assigned");
  });

  it("aceptar dos veces con el mismo clientActionId no duplica nada", async () => {
    const r = await api(`/assistances/${asistenciaId}/accept`, {
      method: "POST",
      body: { clientActionId: `acc-${sufijo}` },
    });
    expect(r.status).toBe(200);
    const hist = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_status_history
        WHERE "assistanceId" = $1 AND "toStatus" = 'technician_assigned'`,
      [asistenciaId],
    );
    expect(hist.rows[0].n).toBe(1);
  });

  it("no se puede saltar de técnico asignado a en punto", async () => {
    const r = await api(`/assistances/${asistenciaId}/status`, {
      method: "POST",
      body: { status: "arrived", clientActionId: `salto-${sufijo}` },
    });
    expect(r.status).toBe(409);
  });

  it("recorre en camino, en punto y trabajando", async () => {
    for (const estado of ["en_route", "arrived", "in_progress"]) {
      const r = await api(`/assistances/${asistenciaId}/status`, {
        method: "POST",
        body: { status: estado, clientActionId: `st-${estado}-${sufijo}` },
      });
      expect(r.status, `estado ${estado}`).toBe(200);
    }
    const a = await db.query(`SELECT status FROM connect_assistances WHERE id = $1`, [asistenciaId]);
    expect(a.rows[0].status).toBe("in_progress");
  });

  it("las posiciones se guardan con hora de servidor, no solo la del móvil", async () => {
    const ahora = tsPrimerPunto;
    const r = await api(`/assistances/${asistenciaId}/locations-batch`, {
      method: "POST",
      body: {
        clientActionId: `loc-${sufijo}`,
        points: [
          { lat: 41.121, lng: 1.251, accuracyM: 8, speedKmh: 40, ts: ahora - 60_000 },
          { lat: 41.122, lng: 1.252, accuracyM: 7, speedKmh: 45, ts: ahora - 30_000 },
        ],
      },
    });
    expect(r.status).toBe(200);
    const t = await db.query(
      `SELECT "deviceTsMs", "serverTsMs" FROM connect_assistance_tracks
        WHERE "assistanceId" = $1 ORDER BY "deviceTsMs"`,
      [asistenciaId],
    );
    expect(t.rows.length).toBeGreaterThanOrEqual(2);
    for (const fila of t.rows) {
      expect(Number(fila.serverTsMs)).toBeGreaterThan(0);
      expect(Number(fila.serverTsMs)).not.toBe(Number(fila.deviceTsMs));
    }
  });

  it("reenviar el mismo lote de posiciones no las duplica", async () => {
    const antes = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistance_tracks WHERE "assistanceId" = $1`,
      [asistenciaId],
    );
    // El MISMO instante que la primera vez: es lo que hace la cola offline al
    // reintentar. Con un Date.now() nuevo serían posiciones legítimamente
    // distintas y la prueba no probaría nada.
    const ahora = tsPrimerPunto;
    await api(`/assistances/${asistenciaId}/locations-batch`, {
      method: "POST",
      body: {
        clientActionId: `loc-${sufijo}`,
        points: [{ lat: 41.121, lng: 1.251, accuracyM: 8, speedKmh: 40, ts: ahora - 60_000 }],
      },
    });
    const despues = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistance_tracks WHERE "assistanceId" = $1`,
      [asistenciaId],
    );
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  it("una observación queda registrada en la asistencia", async () => {
    const r = await api(`/assistances/${asistenciaId}/notes`, {
      method: "POST",
      body: { body: "Rueda delantera izquierda reventada", clientActionId: `nota-${sufijo}` },
    });
    expect(r.status).toBeLessThan(300);
  });

  it("el cierre se rechaza si no hay ninguna fotografía", async () => {
    const r = await api(`/assistances/${asistenciaId}/finish`, {
      method: "POST",
      body: {
        result: "repaired_on_site",
        resolutionNotes: "Sustituida por la de repuesto",
        clientActionId: `fin-sin-fotos-${sufijo}`,
      },
    });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/fotograf/i);
  });

  it("el cierre exige la observación de resolución", async () => {
    const r = await api(`/assistances/${asistenciaId}/finish`, {
      method: "POST",
      body: { result: "repaired_on_site", clientActionId: `fin-malo-${sufijo}` },
    });
    expect(r.status).toBe(422);
  });

  it("cierra el servicio con los requisitos cumplidos", async () => {
    // La evidencia se registra directamente: la subida real sube el binario a
    // Supabase Storage, que en CI no existe. Lo que se prueba aquí es la
    // validación de cierre, no el almacenamiento.
    await db.query(
      `INSERT INTO connect_assistance_files
         ("assistanceId", "workshopId", category, url, "fileName", "mimeType", "createdAtMs")
       VALUES ($1,$2,'work','http://ficticio/foto.jpg','foto.jpg','image/jpeg',$3)`,
      [asistenciaId, tallerId, Date.now()],
    );
    const r = await api(`/assistances/${asistenciaId}/finish`, {
      method: "POST",
      body: {
        result: "repaired_on_site",
        resolutionNotes: "Sustituida por la de repuesto",
        odometerKm: 154320,
        workedMinutes: 35,
        clientActionId: `fin-${sufijo}`,
      },
    });
    expect(r.status).toBe(200);
    const a = await db.query(`SELECT status FROM connect_assistances WHERE id = $1`, [asistenciaId]);
    expect(a.rows[0].status).toBe("finished");
  });

  it("cierra el ciclo con vuelta al taller y en taller", async () => {
    for (const estado of ["returning_to_workshop", "at_workshop"]) {
      const r = await api(`/assistances/${asistenciaId}/status`, {
        method: "POST",
        body: { status: estado, clientActionId: `ret-${estado}-${sufijo}` },
      });
      expect(r.status, `estado ${estado}`).toBe(200);
    }
    const a = await db.query(`SELECT status FROM connect_assistances WHERE id = $1`, [asistenciaId]);
    expect(a.rows[0].status).toBe("at_workshop");
  });

  it("el historial reconstruye el ciclo entero en orden", async () => {
    const h = await db.query(
      `SELECT "toStatus" FROM connect_status_history
        WHERE "assistanceId" = $1 ORDER BY "occurredAtMs", id`,
      [asistenciaId],
    );
    const recorrido = h.rows.map((r: any) => r.toStatus);
    expect(recorrido).toEqual([
      "technician_assigned", "en_route", "arrived", "in_progress",
      "finished", "returning_to_workshop", "at_workshop",
    ]);
  });

  it("los KPIs salen de las marcas de tiempo del servidor", async () => {
    const { computeLiteKpis } = await import("./liteRules.ts");
    const h = await db.query(
      `SELECT "toStatus", "occurredAtMs" FROM connect_status_history
        WHERE "assistanceId" = $1 ORDER BY "occurredAtMs", id`,
      [asistenciaId],
    );
    const kpis = computeLiteKpis(
      h.rows.map((r: any) => ({ toStatus: r.toStatus, occurredAtMs: Number(r.occurredAtMs) })),
    );
    expect(kpis.cycleMin).not.toBeNull();
    expect(kpis.totalMin).not.toBeNull();
  });

  it("la sesión revocada deja de servir", async () => {
    await db.query(
      `UPDATE connect_lite_devices SET "revokedAtMs" = $1
        WHERE "workshopId" = $2`,
      [Date.now(), tallerId],
    );
    const r = await api("/assistances?scope=pending");
    expect(r.status).toBe(401);
  });
});
