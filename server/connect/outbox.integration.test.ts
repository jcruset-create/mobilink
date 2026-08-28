/**
 * Outbox transaccional: o cambia el estado y sale el aviso, o no cambia nada.
 *
 * El agujero que esto cierra era real y estaba a la vista: `transition()` hacía
 * cuatro escrituras sueltas —estado, historial, diario y aviso— y entre la
 * primera y la última cabía un reinicio del proceso. El resultado era el peor
 * posible: Central con la asistencia «finalizada» y Assist esperando
 * indefinidamente un aviso que nunca llegó a entrar en ninguna cola.
 *
 * Aquí se provoca ese fallo a propósito, rompiendo la última escritura, y se
 * comprueba que NO queda nada a medias.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let transition: typeof import("./service.ts").transition;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let centroId = 0;
let partnerId = 0;
let endpointId = 0;
let asistenciaId = 0;

/** Nace en 'searching', que es desde donde se puede pasar a 'assigned'. */
async function crearAsistencia(estado = "searching"): Promise<number> {
  const r = await db.query(
    `INSERT INTO connect_assistances
       (uuid, "partnerId", "controlCenterId", status, "expedientNumber", "correlationId",
        "customerName", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,'Cliente',$7,$7) RETURNING id`,
    [`a-outbox-${sufijo}-${Math.random().toString(36).slice(2, 8)}`, partnerId, centroId,
     estado, `EXP-${sufijo}`, `COR-outbox-${sufijo}`, now],
  );
  return Number(r.rows[0].id);
}

describe.skipIf(!RUN)("Outbox transaccional de Central", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("./schema.ts");
    const { initDispatch } = await import("../dispatch/schema.ts");
    const { initEventLog } = await import("../eventlog/schema.ts");
    await initDb();
    await initConnect();
    await initDispatch();
    await initEventLog();
    transition = (await import("./service.ts")).transition;

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`cc-outbox-${sufijo}`, `Central outbox ${sufijo}`, now],
    );
    centroId = Number(cc.rows[0].id);

    const p = await db.query(
      `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`,
      [`p-outbox-${sufijo}`, `Partner outbox ${sufijo}`, centroId, now],
    );
    partnerId = Number(p.rows[0].id);

    // Un endpoint activo: sin él no hay a quién avisar y la prueba no probaría nada.
    const e = await db.query(
      `INSERT INTO connect_webhook_endpoints
         ("partnerId", url, secret, "eventTypes", "createdAtMs")
       VALUES ($1,'https://assist.example.com/api/dispatch/webhook','sec','["*"]',$2)
       RETURNING id`,
      [partnerId, now],
    );
    endpointId = Number(e.rows[0].id);
  }, 60_000);

  afterEach(async () => {
    await db.query(`DELETE FROM connect_webhook_deliveries WHERE "endpointId" = $1`, [endpointId]).catch(() => {});
  });

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_events WHERE "tenantId" = $1`, [String(centroId)]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM connect_webhook_deliveries WHERE "endpointId" = $1`, [endpointId]).catch(() => {});
    await db.query(`DELETE FROM connect_webhook_endpoints WHERE id = $1`, [endpointId]).catch(() => {});
    await db.query(`DELETE FROM connect_status_history WHERE "assistanceId" IN
      (SELECT id FROM connect_assistances WHERE "partnerId" = $1)`, [partnerId]).catch(() => {});
    await db.query(`DELETE FROM connect_assistances WHERE "partnerId" = $1`, [partnerId]).catch(() => {});
    await db.query(`DELETE FROM connect_partners WHERE id = $1`, [partnerId]).catch(() => {});
    await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [centroId]).catch(() => {});
  }, 30_000);

  it("un cambio de estado deja las cuatro cosas: estado, historial, diario y aviso en cola", async () => {
    asistenciaId = await crearAsistencia();
    await transition(asistenciaId, "assigned", "user");

    const a = await db.query(`SELECT status FROM connect_assistances WHERE id = $1`, [asistenciaId]);
    expect(a.rows[0].status).toBe("assigned");

    const h = await db.query(
      `SELECT * FROM connect_status_history WHERE "assistanceId" = $1`, [asistenciaId]);
    expect(h.rows).toHaveLength(1);

    const ev = await db.query(
      `SELECT * FROM assistance_events WHERE "sourceSystem" = 'central' AND "assistanceId" = $1`,
      [String(asistenciaId)]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].eventType).toBe("PROVIDER_ASSIGNED");

    const d = await db.query(
      `SELECT * FROM connect_webhook_deliveries WHERE "endpointId" = $1`, [endpointId]);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].status).toBe("pending");
    // El aviso lleva el correlation_id: sin él, Assist no sabe de qué le hablan.
    expect(JSON.parse(d.rows[0].payload).data.correlation_id).toBe(`COR-outbox-${sufijo}`);
  });

  /*
   * LA prueba. Se rompe la última escritura de la transacción —la del aviso—
   * quitando la columna que necesita, y se comprueba que el cambio de estado
   * se deshace con ella. Antes de esto, el estado quedaba cambiado y el aviso
   * no salía nunca.
   */
  it("si el aviso no se puede encolar, el cambio de estado se deshace entero", async () => {
    const id = await crearAsistencia();

    // Se fuerza el fallo del INSERT del aviso con una restricción imposible.
    await db.query(
      `ALTER TABLE connect_webhook_deliveries
         ADD CONSTRAINT outbox_prueba_falla CHECK ("eventType" = 'nunca')`);
    try {
      await expect(transition(id, "assigned", "user")).rejects.toThrow();

      // Nada se ha quedado a medias:
      const a = await db.query(`SELECT status FROM connect_assistances WHERE id = $1`, [id]);
      expect(a.rows[0].status).toBe("searching");        // el estado NO cambió

      const h = await db.query(
        `SELECT COUNT(*)::int AS n FROM connect_status_history WHERE "assistanceId" = $1`, [id]);
      expect(h.rows[0].n).toBe(0);                        // ni historial

      const ev = await db.query(
        `SELECT COUNT(*)::int AS n FROM assistance_events
          WHERE "sourceSystem" = 'central' AND "assistanceId" = $1`, [String(id)]);
      expect(ev.rows[0].n).toBe(0);                       // ni diario

      const d = await db.query(
        `SELECT COUNT(*)::int AS n FROM connect_webhook_deliveries WHERE "endpointId" = $1`,
        [endpointId]);
      expect(d.rows[0].n).toBe(0);                        // ni aviso
    } finally {
      await db.query(
        `ALTER TABLE connect_webhook_deliveries DROP CONSTRAINT outbox_prueba_falla`);
    }

    // Y después de quitar el fallo, el mismo cambio funciona: no ha quedado
    // nada bloqueado ni a medio escribir.
    await transition(id, "assigned", "user");
    const despues = await db.query(`SELECT status FROM connect_assistances WHERE id = $1`, [id]);
    expect(despues.rows[0].status).toBe("assigned");
  });

  /*
   * El aviso se escribe en la cola, NO se entrega en la petición. Es lo que
   * hace que una plataforma caída no bloquee a quien está operando.
   */
  it("encolar no intenta entregar: el aviso queda pendiente para el worker", async () => {
    const id = await crearAsistencia();
    const t0 = Date.now();
    await transition(id, "assigned", "user");
    // Si intentara entregar, la URL de ejemplo tardaría en fallar o en resolver.
    expect(Date.now() - t0).toBeLessThan(2000);

    const d = await db.query(
      `SELECT status, attempt FROM connect_webhook_deliveries WHERE "endpointId" = $1`,
      [endpointId]);
    expect(d.rows[0].status).toBe("pending");
    expect(Number(d.rows[0].attempt)).toBe(0);
  });

  it("una transición no permitida no toca nada", async () => {
    const id = await crearAsistencia("finished");
    await expect(transition(id, "assigned", "user")).rejects.toThrow();

    const d = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_webhook_deliveries WHERE "endpointId" = $1`,
      [endpointId]);
    expect(d.rows[0].n).toBe(0);
  });

  it("los estados de trámite no ensucian el diario pero sí avisan al partner", async () => {
    const id = await crearAsistencia("pending");
    await transition(id, "searching", "system");

    const ev = await db.query(
      `SELECT COUNT(*)::int AS n FROM assistance_events
        WHERE "sourceSystem" = 'central' AND "assistanceId" = $1`, [String(id)]);
    expect(ev.rows[0].n).toBe(0);      // 'searching' no es noticia para la timeline

    const d = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_webhook_deliveries WHERE "endpointId" = $1`,
      [endpointId]);
    expect(d.rows[0].n).toBe(1);       // pero el partner sí quiere saberlo
  });
});
