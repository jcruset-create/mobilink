/**
 * Diario de asistencias contra PostgreSQL real.
 *
 * Lo que se fija:
 *   · la tabla es INMUTABLE de verdad, también para el servidor, que se conecta
 *     con `pg` y se salta las políticas RLS
 *   · cada fila lleva su huella y cambia si cambia el contenido
 *   · el mismo hecho recibido dos veces deja UNA línea (webhooks at-least-once)
 *   · la timeline sale ordenada por cuándo OCURRIÓ, no por cuándo se anotó
 *   · el correlation_id hila la cadena aunque cada sistema tenga su id local
 *   · el histórico que ya existía se incorpora en la migración
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let registrarEvento: typeof import("./servicio.ts").registrarEvento;
let timelineDe: typeof import("./servicio.ts").timelineDe;
let timelineDeCorrelacion: typeof import("./servicio.ts").timelineDeCorrelacion;
let hitosDe: typeof import("./servicio.ts").hitosDe;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const ASIST = `9${sufijo.slice(0, 5)}`;
const CORR = `COR-test-${sufijo}`;
const T0 = 1_700_000_000_000;

describe.skipIf(!RUN)("Diario de asistencias", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("../dispatch/schema.ts");
    const { initEventLog } = await import("./schema.ts");
    await initDb();
    await initConnect();
    await initDispatch();
    await initEventLog();

    const s = await import("./servicio.ts");
    registrarEvento = s.registrarEvento;
    timelineDe = s.timelineDe;
    timelineDeCorrelacion = s.timelineDeCorrelacion;
    hitosDe = s.hitosDe;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    // La tabla es inmutable: hay que quitar el candado para limpiar.
    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_events WHERE "assistanceId" = $1 OR "correlationId" = $2`,
      [ASIST, CORR]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
  }, 30_000);

  it("anota un evento con su huella", async () => {
    const ok = await registrarEvento({
      system: "assist", tenantId: "77", assistanceId: ASIST, correlationId: CORR,
      eventType: "ASSISTANCE_CREATED", actorType: "user", actorName: "Marta",
      occurredAtMs: T0, payload: { matricula: "1234ABC" },
      dedupeKey: `t-creada-${sufijo}`,
    });
    expect(ok).toBe(true);

    const r = await db.query(
      `SELECT * FROM assistance_events WHERE "dedupeKey" = $1`, [`t-creada-${sufijo}`]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].huella).toHaveLength(64);      // SHA-256 en hexadecimal
    expect(JSON.parse(r.rows[0].payload).matricula).toBe("1234ABC");
  });

  /*
   * El motivo de que la huella exista: poder demostrar que la línea no ha
   * cambiado. Dos contenidos distintos tienen que dar huellas distintas.
   */
  it("la huella depende del contenido", async () => {
    await registrarEvento({
      system: "assist", assistanceId: ASIST, eventType: "EN_ROUTE",
      occurredAtMs: T0 + 1000, payload: { a: 1 }, dedupeKey: `t-h1-${sufijo}`,
    });
    await registrarEvento({
      system: "assist", assistanceId: ASIST, eventType: "EN_ROUTE",
      occurredAtMs: T0 + 1000, payload: { a: 2 }, dedupeKey: `t-h2-${sufijo}`,
    });
    const r = await db.query(
      `SELECT huella FROM assistance_events WHERE "dedupeKey" IN ($1,$2)`,
      [`t-h1-${sufijo}`, `t-h2-${sufijo}`]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].huella).not.toBe(r.rows[1].huella);
  });

  /*
   * LA prueba del candado. Las políticas RLS no alcanzan al servidor, que se
   * conecta con `pg`; un disparador sí. Sin esto, un UPDATE sobre el diario
   * era perfectamente posible.
   */
  it("no se puede modificar un evento, ni siquiera desde el servidor", async () => {
    await expect(
      db.query(`UPDATE assistance_events SET "eventType" = 'SERVICE_COMPLETED'
                 WHERE "dedupeKey" = $1`, [`t-creada-${sufijo}`]),
    ).rejects.toThrow(/inmutable/i);
  });

  it("tampoco se puede borrar", async () => {
    await expect(
      db.query(`DELETE FROM assistance_events WHERE "dedupeKey" = $1`, [`t-creada-${sufijo}`]),
    ).rejects.toThrow(/inmutable/i);

    const sigue = await db.query(
      `SELECT COUNT(*)::int AS n FROM assistance_events WHERE "dedupeKey" = $1`,
      [`t-creada-${sufijo}`]);
    expect(sigue.rows[0].n).toBe(1);
  });

  /*
   * Los webhooks se entregan AL MENOS una vez: el mismo hecho llega dos o tres
   * veces. Sin esto la timeline enseñaría «En camino» tres veces seguidas.
   */
  it("el mismo hecho recibido dos veces deja UNA línea", async () => {
    const evento = {
      system: "assist" as const, assistanceId: ASIST, correlationId: CORR,
      eventType: "PROVIDER_ASSIGNED" as const, occurredAtMs: T0 + 2000,
      dedupeKey: `t-dedupe-${sufijo}`,
    };
    expect(await registrarEvento(evento)).toBe(true);
    expect(await registrarEvento(evento)).toBe(false);   // repetido: no se anota
    expect(await registrarEvento({ ...evento, occurredAtMs: T0 + 9999 })).toBe(false);

    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM assistance_events WHERE "dedupeKey" = $1`,
      [`t-dedupe-${sufijo}`]);
    expect(n.rows[0].n).toBe(1);
  });

  it("sin clave de deduplicación sí se anotan los repetidos: son hechos distintos", async () => {
    // Un ida y vuelta entre dos estados tiene que dejar las dos líneas.
    await registrarEvento({
      system: "assist", assistanceId: ASIST, eventType: "ON_SITE", occurredAtMs: T0 + 3000 });
    await registrarEvento({
      system: "assist", assistanceId: ASIST, eventType: "ON_SITE", occurredAtMs: T0 + 4000 });
    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM assistance_events
        WHERE "assistanceId" = $1 AND "eventType" = 'ON_SITE'`, [ASIST]);
    expect(n.rows[0].n).toBe(2);
  });

  it("un tipo de evento inventado no se anota, y no rompe nada", async () => {
    expect(await registrarEvento({
      system: "assist", assistanceId: ASIST, eventType: "INVENTADO" as any,
    })).toBe(false);
  });

  /*
   * Ordenada por cuándo OCURRIÓ, no por cuándo se anotó: un aviso que llega
   * con diez minutos de retraso tiene que salir en su sitio.
   */
  it("la timeline sale en orden de lo ocurrido, no de lo anotado", async () => {
    const tarde = `${ASIST}-orden`;
    // Se anota primero el posterior, a propósito.
    await registrarEvento({
      system: "assist", assistanceId: tarde, eventType: "SERVICE_COMPLETED",
      occurredAtMs: T0 + 5000, dedupeKey: `t-ord-2-${sufijo}` });
    await registrarEvento({
      system: "assist", assistanceId: tarde, eventType: "EN_ROUTE",
      occurredAtMs: T0 + 1000, dedupeKey: `t-ord-1-${sufijo}` });

    const t = await timelineDe("assist", tarde);
    expect(t.map((e) => e.tipo)).toEqual(["EN_ROUTE", "SERVICE_COMPLETED"]);
    expect(t[0].etiqueta).toBe("En camino");

    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`);
    await db.query(`DELETE FROM assistance_events WHERE "assistanceId" = $1`, [tarde]);
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`);
  });

  it("los eventos técnicos no salen por defecto, y sí si se piden", async () => {
    await registrarEvento({
      system: "assist", assistanceId: ASIST, correlationId: CORR,
      eventType: "SYNC_FAILED", occurredAtMs: T0 + 6000,
      payload: { motivo: "sin respuesta" }, dedupeKey: `t-sync-${sufijo}` });

    const normal = await timelineDe("assist", ASIST);
    expect(normal.map((e) => e.tipo)).not.toContain("SYNC_FAILED");

    const conTecnicos = await timelineDe("assist", ASIST, { incluirTecnicos: true });
    expect(conTecnicos.map((e) => e.tipo)).toContain("SYNC_FAILED");
    expect(conTecnicos.find((e) => e.tipo === "SYNC_FAILED")!.tecnico).toBe(true);
  });

  /*
   * La cadena completa: cada sistema conserva SU id local y lo que los ata es
   * el correlation_id. Es el requisito de «nunca sustituir el ID local».
   */
  it("el correlation_id hila las dos mitades sin mezclar los ids locales", async () => {
    await registrarEvento({
      system: "central", tenantId: "3", assistanceId: "55501", correlationId: CORR,
      eventType: "ASSISTANCE_ACCEPTED", occurredAtMs: T0 + 7000,
      dedupeKey: `t-central-${sufijo}` });

    // La timeline de Assist, por defecto, solo enseña lo de Assist.
    const soloAssist = await timelineDe("assist", ASIST);
    expect(soloAssist.every((e) => e.sistema === "assist")).toBe(true);

    // Pidiendo la cadena, aparecen los dos lados.
    const cadena = await timelineDe("assist", ASIST, { cadenaCompleta: true });
    expect(cadena.some((e) => e.sistema === "central")).toBe(true);

    // Y por correlación se ven todos, cada uno con su id local intacto.
    const porCorrelacion = await timelineDeCorrelacion(CORR);
    const ids = await db.query(
      `SELECT DISTINCT "sourceSystem", "assistanceId" FROM assistance_events
        WHERE "correlationId" = $1 ORDER BY "sourceSystem"`, [CORR]);
    expect(porCorrelacion.length).toBeGreaterThan(1);
    expect(ids.rows).toEqual([
      { sourceSystem: "assist", assistanceId: ASIST },
      { sourceSystem: "central", assistanceId: "55501" },
    ]);
  });

  it("los hitos dan la PRIMERA vez de cada tipo", async () => {
    const h = await hitosDe("assist", ASIST);
    expect(h.ASSISTANCE_CREATED).toBe(T0);
    // ON_SITE se anotó dos veces (T0+3000 y T0+4000): manda la primera, que es
    // la que cuenta para un SLA.
    expect(h.ON_SITE).toBe(T0 + 3000);
  });

  it("una credencial en el payload no llega a la base", async () => {
    await registrarEvento({
      system: "assist", assistanceId: ASIST, eventType: "EXTERNAL_DISPATCH_SENT",
      occurredAtMs: T0 + 8000,
      payload: { destino: "Plataforma A", apiKey: "mkc_live_nodeberiaestar" },
      dedupeKey: `t-secreto-${sufijo}` });

    const r = await db.query(
      `SELECT payload FROM assistance_events WHERE "dedupeKey" = $1`, [`t-secreto-${sufijo}`]);
    expect(r.rows[0].payload).not.toContain("nodeberiaestar");
    expect(r.rows[0].payload).toContain("Plataforma A");
  });
});
