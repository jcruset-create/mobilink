/**
 * La decisión de a quién se le manda encuesta, contra PostgreSQL real.
 *
 * Esta fase NO crea encuestas ni manda nada: solo decide. Lo que se fija aquí
 * es que la decisión sea completa y honesta — que diga TODOS los motivos por
 * los que algo no sale, y que el caso incómodo (conductor y cliente con el
 * mismo número) se marque como conflicto en vez de resolverse a ojo.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let cfg: typeof import("./config.ts");
let eleg: typeof import("./elegibilidad.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let n = 0;

const TALLER = 4242;
const OTRO_TALLER = 9999;

type Alta = {
  finalizada?: boolean;
  telConductor?: string | null;
  telCliente?: string | null;
  tallerId?: number | null;
};

/** Una asistencia con su back-office y su cliente de facturación. */
async function crear(o: Alta = {}): Promise<{ id: number; clienteId: number | null }> {
  const ahora = Date.now();
  const finalizada = o.finalizada !== false;

  let clienteId: number | null = null;
  if (o.telCliente !== undefined) {
    const c = await db.query(
      `INSERT INTO connect_clients (name, "contactPhone", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`Cliente ${sufijo}-${++n}`, o.telCliente, ahora],
    );
    clienteId = Number(c.rows[0].id);
  }

  const a = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", "customerPhone", address, plate,
        "descripcionAveria", "trackingToken", "clienteFacturacionId", "tallerId",
        "finishedAtMs", "createdAtMs", "updatedAtMs")
     VALUES ($1,'normal','Contacto','600999888','AP-7','1234ABC','Rueda',$2,$3,$4,$5,$6,$6)
     RETURNING id`,
    [finalizada ? "en_camino_base" : "en_punto", `tok-el-${sufijo}-${++n}`,
     clienteId, o.tallerId === undefined ? TALLER : o.tallerId,
     finalizada ? ahora : null, ahora],
  );
  const id = Number(a.rows[0].id);

  if (o.telConductor !== undefined) {
    await db.query(
      `INSERT INTO roadside_backoffice ("assistanceId", "conductorTelefono",
                                        "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3)`,
      [id, o.telConductor, ahora],
    );
  }
  return { id, clienteId };
}

/** Enciende Satisfaction del todo, que por defecto está apagado. */
async function encender(extra: Partial<import("./config.ts").ConfigSatisfaction> = {}) {
  await cfg.guardarConfigGlobal({ activo: true, conductor: true, cliente: true, ...extra });
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  cfg = await import("./config.ts");
  eleg = await import("./elegibilidad.ts");
  await cfg.initSatisfactionConfig();
});

afterAll(async () => { if (RUN) await db.end().catch(() => {}); });

describe.skipIf(!RUN)("configuración", () => {
  it("por defecto está APAGADO: nadie recibe nada por sorpresa", async () => {
    await db.query(`DELETE FROM workshop_config WHERE key LIKE 'satisfaction.%'`);
    const c = await cfg.configGlobal();
    expect(c.activo).toBe(false);
    expect(c.conductor).toBe(false);
    expect(c.cliente).toBe(false);
  });

  it("se guarda y se vuelve a leer", async () => {
    await cfg.guardarConfigGlobal({ activo: true, conductor: true, cliente: false, caducidadHoras: 72 });
    const c = await cfg.configGlobal();
    expect(c).toMatchObject({ activo: true, conductor: true, cliente: false, caducidadHoras: 72 });
  });

  /*
   * El override solo puede restringir. El interruptor general tiene que poder
   * parar el sistema entero de una vez: si un cliente pudiera encenderlo por
   * su cuenta, apagar Satisfaction no serviría de nada.
   */
  it("un cliente no puede encender lo que la global tiene apagado", () => {
    const global = { ...cfg.POR_DEFECTO, activo: false, conductor: false, cliente: false };
    const r = cfg.combinar(global, { activo: true, conductor: true, cliente: true });
    expect(r).toMatchObject({ activo: false, conductor: false, cliente: false });
  });

  it("un cliente sí puede apagar lo suyo", () => {
    const global = { ...cfg.POR_DEFECTO, activo: true, conductor: true, cliente: true };
    expect(cfg.combinar(global, { activo: null, conductor: false, cliente: null }))
      .toMatchObject({ activo: true, conductor: false, cliente: true });
  });

  it("null es «hereda», no «apagado»", () => {
    const global = { ...cfg.POR_DEFECTO, activo: true, conductor: true, cliente: true };
    expect(cfg.combinar(global, { activo: null, conductor: null, cliente: null }))
      .toMatchObject({ activo: true, conductor: true, cliente: true });
  });
});

describe.skipIf(!RUN)("elegibilidad", () => {
  it("una asistencia finalizada en en_camino_base es elegible", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: "600222222" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.eligibleDriver).toBe(true);
    expect(r.eligibleCustomer).toBe(true);
    expect(r.blockingReasons).toEqual([]);
  });

  it("sin finishedAtMs no es elegible", async () => {
    await encender();
    const { id } = await crear({ finalizada: false, telConductor: "600111111", telCliente: "600222222" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.blockingReasons).toEqual(["not_finished"]);
    expect(r.eligibleDriver).toBe(false);
  });

  it("una asistencia que no existe se distingue de una que no ha terminado", async () => {
    const r = await eleg.evaluarElegibilidad({ assistanceId: 98_000_000, tenantId: TALLER });
    expect(r.blockingReasons).toEqual(["assistance_not_found"]);
  });

  it("con Satisfaction apagado no se mira ni el teléfono", async () => {
    await cfg.guardarConfigGlobal({ activo: false, conductor: true, cliente: true });
    const { id } = await crear({ telConductor: "600111111", telCliente: "600222222" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.blockingReasons).toEqual(["satisfaction_disabled"]);
  });

  it("con la encuesta de conductor apagada solo sale la de cliente", async () => {
    await encender({ conductor: false });
    const { id } = await crear({ telConductor: "600111111", telCliente: "600222222" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.eligibleDriver).toBe(false);
    expect(r.eligibleCustomer).toBe(true);
    expect(r.blockingReasons).toContain("driver_survey_disabled");
  });

  it("con la de cliente apagada solo sale la de conductor", async () => {
    await encender({ cliente: false });
    const { id } = await crear({ telConductor: "600111111", telCliente: "600222222" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.eligibleDriver).toBe(true);
    expect(r.eligibleCustomer).toBe(false);
    expect(r.blockingReasons).toContain("customer_survey_disabled");
  });

  it("el override del cliente apaga solo lo suyo", async () => {
    await encender();
    const { id, clienteId } = await crear({ telConductor: "600111111", telCliente: "600222222" });
    await cfg.guardarOverrideCliente({
      sourceSystem: "assist", tenantId: String(TALLER), clientId: clienteId!,
      valores: { conductor: false },
      notas: "Este cliente no permite contactar a sus conductores",
    });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.effectiveConfig.conductor).toBe(false);
    expect(r.eligibleDriver).toBe(false);
    expect(r.eligibleCustomer).toBe(true);
  });

  it("un override que lo apaga todo bloquea la asistencia entera", async () => {
    await encender();
    const { id, clienteId } = await crear({ telConductor: "600111111", telCliente: "600222222" });
    await cfg.guardarOverrideCliente({
      sourceSystem: "assist", tenantId: String(TALLER), clientId: clienteId!,
      valores: { activo: false },
    });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.blockingReasons).toEqual(["satisfaction_disabled"]);
  });
});

describe.skipIf(!RUN)("destinatarios", () => {
  it("el conductor sale del back-office", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600 11 11 11", telCliente: "600222222" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.driverRecipient).toMatchObject({
      hay: true, normalizado: "600111111", fuente: "roadside_backoffice.conductorTelefono",
    });
  });

  /*
   * LA regla que evita el peor error: customerPhone NO vale como conductor.
   * En carretera ese número es casi siempre el del que está en el arcén, pero
   * usarlo significaría, la otra mitad de las veces, mandarle al gestor de
   * flota una encuesta preguntándole qué tal le trataron.
   */
  it("sin teléfono de conductor NO se usa customerPhone como respaldo", async () => {
    await encender();
    const { id } = await crear({ telCliente: "600222222" });   // sin back-office
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.eligibleDriver).toBe(false);
    expect(r.driverRecipient).toMatchObject({ hay: false, motivo: "missing_recipient" });
    expect(r.blockingReasons).toContain("driver_missing_recipient");
  });

  it("el cliente sale de connect_clients, no de customerPhone", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: "+34 900 12 34 56" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.customerRecipient).toMatchObject({
      hay: true, normalizado: "900123456", fuente: "connect_clients.contactPhone",
    });
  });

  it("sin cliente de facturación no hay destinatario de cliente", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111" });   // sin cliente
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.eligibleCustomer).toBe(false);
    expect(r.blockingReasons).toContain("customer_missing_recipient");
  });

  it("un cliente sin contactPhone tampoco", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: null });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.eligibleCustomer).toBe(false);
  });

  it("sin ningún teléfono se dicen LOS DOS motivos, no solo el primero", async () => {
    await encender();
    const { id } = await crear({});
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.blockingReasons).toContain("driver_missing_recipient");
    expect(r.blockingReasons).toContain("customer_missing_recipient");
  });
});

describe.skipIf(!RUN)("cuando son el mismo número", () => {
  it("números distintos: los dos elegibles", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: "600222222" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.sameRecipient).toBe(false);
    expect(r.eligibleDriver && r.eligibleCustomer).toBe(true);
  });

  /*
   * Escritos distinto pero la misma línea. Aquí NO se decide cuál mandar: se
   * marca el conflicto y se dejan los dos candidatos, porque elegir sin haber
   * mirado cuántas asistencias reales caen en este caso sería inventarse la
   * política.
   */
  it("el mismo número escrito distinto se detecta y NO se manda ninguna", async () => {
    await encender();
    const { id } = await crear({ telConductor: "+34 600 11 22 33", telCliente: "0034600112233" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.sameRecipient).toBe(true);
    expect(r.eligibleDriver).toBe(false);
    expect(r.eligibleCustomer).toBe(false);
    expect(r.blockingReasons).toContain("same_recipient_conflict");
    // Y los dos candidatos siguen ahí, para que 1C.2 decida con todo delante.
    expect(r.driverRecipient.hay).toBe(true);
    expect(r.customerRecipient.hay).toBe(true);
  });

  it("si solo hay uno de los dos, no hay conflicto que resolver", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600112233" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.sameRecipient).toBe(false);
    expect(r.eligibleDriver).toBe(true);
  });
});

describe.skipIf(!RUN)("aislamiento entre talleres", () => {
  it("otro taller no resuelve la asistencia", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: "600222222" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: OTRO_TALLER });
    // No se filtra que exista: la misma respuesta que si no existiera.
    expect(r.blockingReasons).toEqual(["assistance_not_found"]);
    expect(r.driverRecipient.hay).toBe(false);
    expect(r.customerRecipient.hay).toBe(false);
  });

  it("otro taller tampoco saca los teléfonos por la puerta de atrás", async () => {
    const dest = await import("./destinatarios.ts");
    const { id } = await crear({ telConductor: "600111111", telCliente: "600222222" });
    expect(await dest.resolverDestinatarioConductor(id, OTRO_TALLER))
      .toMatchObject({ hay: false, motivo: "otro_tenant" });
    expect(await dest.resolverDestinatarioCliente(id, OTRO_TALLER))
      .toMatchObject({ hay: false, motivo: "otro_tenant" });
  });

  it("una asistencia sin taller la ve cualquiera: es histórico anterior al multi-taller", async () => {
    await encender();
    const { id } = await crear({ tallerId: null, telConductor: "600111111", telCliente: "600222222" });
    const r = await eleg.evaluarElegibilidad({ assistanceId: id, tenantId: TALLER });
    expect(r.eligibleDriver).toBe(true);
  });
});
