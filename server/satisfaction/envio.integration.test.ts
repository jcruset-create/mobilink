/**
 * El envío por WhatsApp, contra PostgreSQL real y con un Twilio de mentira.
 *
 * Aquí NO se manda ni un mensaje: el adaptador se sustituye por uno que cuenta
 * las llamadas y devuelve lo que le pidamos —éxito, rechazo permanente, fallo
 * pasajero, o la respuesta que nunca llega—. Lo que se prueba es la barrera de
 * la base de datos, que es la que de verdad impide el mensaje duplicado.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");
let envio: typeof import("./envio.ts");
let recordatorio: typeof import("./recordatorio.ts");
let reconcil: typeof import("./reconciliacion.ts");
let cfg: typeof import("./config.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let n = 0;
const BASE_TALLER = 8_100_000;
let secuencia = 0;
let TALLER = BASE_TALLER;

const ENTORNO = { ...process.env };

/* ── El Twilio de mentira ────────────────────────────────────────────────── */

type Guion = import("./adaptadorWhatsApp.ts").ResultadoEnvio;

function adaptadorFalso(guion: Guion | Guion[]) {
  const cola = Array.isArray(guion) ? [...guion] : null;
  const llamadas: import("./adaptadorWhatsApp.ts").PeticionEnvio[] = [];
  return {
    llamadas,
    adaptador: {
      async enviar(p: import("./adaptadorWhatsApp.ts").PeticionEnvio) {
        llamadas.push(p);
        if (cola) return cola.shift() ?? { estado: "aceptado" as const, sid: `SM${llamadas.length}` };
        return guion as Guion;
      },
    },
  };
}

const OK = (sid: string): Guion => ({ estado: "aceptado", sid });
const PERMANENTE: Guion =
  { estado: "rechazado", codigo: "21211", mensaje: "número inválido", permanente: true };
const PASAJERO: Guion =
  { estado: "rechazado", codigo: "50000", mensaje: "se cayó", permanente: false };
const SIN_RESPUESTA: Guion = { estado: "desconocido", mensaje: "socket hang up" };

/* ── Fixtures ────────────────────────────────────────────────────────────── */

async function crearAsistencia(o: { finishedAtMs?: number } = {}) {
  const ahora = o.finishedAtMs ?? Date.now();
  const r = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", address, plate, "trackingToken",
        "tallerId", "createdAtMs", "finishedAtMs", "updatedAtMs")
     VALUES ('finalizada','normal','Contacto','AP-7','1234ABC',$1,$2,$3,$3,$3) RETURNING id`,
    [`tok-env-${sufijo}-${++n}`, TALLER, ahora],
  );
  return Number(r.rows[0].id);
}

/** Una encuesta ya encolada, lista para que el worker la mande. */
async function encolada(o: {
  rol?: "DRIVER" | "CUSTOMER"; telefono?: string | null; caducaEnMs?: number;
} = {}) {
  const assistanceId = await crearAsistencia();
  const ambito = {
    sourceSystem: "assist" as const, tenantId: String(TALLER), assistanceId: String(assistanceId),
  };
  const c = await svc.crearSurveyInstance({
    ambito, recipientRole: o.rol ?? "DRIVER",
    recipientPhone: o.telefono === undefined ? "+34600111222" : o.telefono,
    caducidadMs: o.caducaEnMs ?? 14 * 24 * 3_600_000,
  });
  if (c.estado !== "created") throw new Error("no creada");
  await db.query(
    `UPDATE survey_instances SET status = 'QUEUED', "queuedAtMs" = $2 WHERE id = $1`,
    [c.instancia.id, Date.now()]);
  return { id: c.instancia.id, assistanceId, ambito };
}

const instancia = async (id: number) =>
  (await db.query(`SELECT * FROM survey_instances WHERE id = $1`, [id])).rows[0];
const entregas = async (id: number) =>
  (await db.query(
    `SELECT * FROM survey_deliveries WHERE "surveyInstanceId" = $1 ORDER BY id`, [id])).rows;

async function limpiar() {
  const ids = await db.query(
    `SELECT id FROM roadside_assistances WHERE "tallerId" BETWEEN $1 AND $2`,
    [BASE_TALLER, BASE_TALLER + 100_000]);
  const lista = ids.rows.map((r) => String(r.id));
  if (lista.length) {
    await db.query(`DELETE FROM survey_instances WHERE "assistanceId" = ANY($1)`, [lista]);
    await db.query(`DELETE FROM quality_cases WHERE "assistanceId" = ANY($1)`, [lista]);
  }
  await db.query(`DELETE FROM roadside_assistances WHERE "tallerId" BETWEEN $1 AND $2`,
                 [BASE_TALLER, BASE_TALLER + 100_000]);
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  svc = await import("./servicio.ts");
  envio = await import("./envio.ts");
  recordatorio = await import("./recordatorio.ts");
  reconcil = await import("./reconciliacion.ts");
  cfg = await import("./config.ts");
  await limpiar();
});

beforeEach(async () => {
  if (!RUN) return;
  /*
   * Se limpia entre pruebas, no solo al final. La reconciliación mira TODAS las
   * entregas en duda de la base, así que una que dejara una prueba anterior se
   * colaría en la siguiente y el resultado dependería del orden.
   */
  await limpiar();
  TALLER = BASE_TALLER + ++secuencia * 10;
  // Encendido para las pruebas: el estado de fábrica es apagado, y con él no se
  // mandaría nada. Se apaga otra vez al terminar cada una.
  await cfg.guardarConfigGlobal({
    activo: true, conductor: true, cliente: true, recordatorio: false, recordatorioHoras: 24,
  });
  process.env.TWILIO_TEMPLATE_SATISFACTION_DRIVER = "HXdriver";
  process.env.TWILIO_TEMPLATE_SATISFACTION_CUSTOMER = "HXcustomer";
  process.env.TWILIO_TEMPLATE_SATISFACTION_REMINDER_DRIVER = "HXrecdriver";
  process.env.PUBLIC_APP_URL = "https://pruebas.mobilink-solutions.com";
});

afterEach(async () => {
  if (!RUN) return;
  process.env = { ...ENTORNO };
  await cfg.guardarConfigGlobal({ activo: false, conductor: false, cliente: false });
});

afterAll(async () => {
  if (!RUN) return;
  await limpiar();
  await db.end().catch(() => {});
});

/* ── El camino bueno ─────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("envío inicial", () => {
  it("manda una vez, guarda el SID y deja la encuesta en SENT", async () => {
    const e = await encolada();
    const { adaptador, llamadas } = adaptadorFalso(OK("SMuno"));

    const reclamadas = await envio.reclamarParaEnvio();
    expect(reclamadas.map((r) => r.id)).toContain(e.id);

    const r = await envio.enviarInicial(reclamadas.find((x) => x.id === e.id)!, adaptador);
    expect(r).toMatchObject({ estado: "enviado", sid: "SMuno" });

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].telefono).toBe("+34600111222");
    expect(llamadas[0].tipo).toBe("INITIAL");
    expect(llamadas[0].rol).toBe("DRIVER");
    // La URL es la pública de 1D, con el token dentro.
    expect(llamadas[0].url).toMatch(/^https:\/\/pruebas\.mobilink-solutions\.com\/valoracion\/[A-Za-z0-9_-]{43}$/);
    expect(llamadas[0].referencia).toBe("1234ABC");

    const i = await instancia(e.id);
    expect(i.status).toBe("SENT");
    expect(Number(i.initialSentAtMs)).toBeGreaterThan(0);
    expect(i.sendClaimedAtMs).toBeNull();

    const d = await entregas(e.id);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      channel: "WHATSAPP", messageType: "INITIAL", attempt: 1,
      status: "SENT", providerMessageId: "SMuno", recipient: "+34600111222",
    });
  });

  it("la URL del mensaje es la que abre la miniweb", async () => {
    const e = await encolada();
    const { adaptador, llamadas } = adaptadorFalso(OK("SMdos"));
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!, adaptador);

    const token = llamadas[0].url.split("/").pop()!;
    const publico = await import("./publico.ts");
    const resuelta = await publico.resolverSurveyPublica(token);
    // Se abre y se puede contestar: ni caducada, ni desconocida, ni cerrada.
    expect(resuelta.estado).toBe("ACTIVE");
  });
});

/* ── Nada de duplicados ──────────────────────────────────────────────────── */

describe.skipIf(!RUN)("no se manda dos veces", () => {
  it("dos workers a la vez: UNA sola llamada", async () => {
    const e = await encolada();
    /*
     * Los dos reclaman antes de que ninguno haya enviado. Es exactamente la
     * carrera que puede darse con dos instancias en Render.
     */
    const a = (await envio.reclamarParaEnvio(Date.now())).find((x) => x.id === e.id);
    // El segundo no la ve porque el primero ya tiene el lease…
    const b = (await envio.reclamarParaEnvio(Date.now())).find((x) => x.id === e.id);
    expect(a).toBeTruthy();
    expect(b).toBeUndefined();

    // …y aunque se saltara el lease —lease caducado, reloj raro—, el índice
    // único de la tabla de entregas para el segundo antes de llamar a Twilio.
    const uno = adaptadorFalso(OK("SMa"));
    const dos = adaptadorFalso(OK("SMb"));
    const [r1, r2] = await Promise.all([
      envio.enviarInicial(a!, uno.adaptador),
      envio.enviarInicial({ ...a! }, dos.adaptador),
    ]);

    const llamadas = uno.llamadas.length + dos.llamadas.length;
    expect(llamadas).toBe(1);
    const estados = [r1.estado, r2.estado].sort();
    expect(estados).toEqual(["descartado", "enviado"]);

    const d = await entregas(e.id);
    expect(d.filter((x) => x.messageType === "INITIAL")).toHaveLength(1);
  });

  /*
   * El caso que el índice de (encuesta, tipo, INTENTO) NO cubre.
   *
   * Dos workers escalonados calculan números de intento distintos —uno lee el
   * contador antes de que el otro lo suba— y las dos filas caben en aquel
   * índice. El número de intento sirve para contar, no para excluir. Lo que
   * excluye es el índice parcial sobre (encuesta, tipo) mientras hay algo en
   * vuelo o en duda.
   */
  it("con un intento en vuelo, otro con distinto número NO cabe", async () => {
    const e = await encolada();
    const primero = await envio.reservarIntento({
      instanceId: e.id, tipo: "INITIAL", intento: 1,
      telefono: "+34600111222", ahoraMs: Date.now(),
    });
    expect(primero).toBeTruthy();

    const segundo = await envio.reservarIntento({
      instanceId: e.id, tipo: "INITIAL", intento: 2,
      telefono: "+34600111222", ahoraMs: Date.now(),
    });
    expect(segundo).toBeNull();
    expect(await entregas(e.id)).toHaveLength(1);
  });

  it("de un intento FALLIDO sí se puede reintentar", async () => {
    const e = await encolada();
    const primero = await envio.reservarIntento({
      instanceId: e.id, tipo: "INITIAL", intento: 1,
      telefono: "+34600111222", ahoraMs: Date.now(),
    });
    await envio.cambiarEstadoEntrega({
      deliveryId: primero!, hasta: "FAILED", errorCode: "50000", ahoraMs: Date.now() });

    // Un fallo confirmado no bloquea: es justo lo que hay que poder reintentar.
    const segundo = await envio.reservarIntento({
      instanceId: e.id, tipo: "INITIAL", intento: 2,
      telefono: "+34600111222", ahoraMs: Date.now(),
    });
    expect(segundo).toBeTruthy();
  });

  it("volver a pasar después de enviar no reenvía", async () => {
    const e = await encolada();
    const primera = adaptadorFalso(OK("SMx"));
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              primera.adaptador);

    // La encuesta ya está en SENT: la reclamación ni la mira.
    const otra = await envio.reclamarParaEnvio();
    expect(otra.map((x) => x.id)).not.toContain(e.id);
    expect((await entregas(e.id))).toHaveLength(1);
  });

  it("no manda si ya la han contestado entre reclamar y enviar", async () => {
    const e = await encolada();
    const reclamada = (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!;
    // Contesta justo ahora, con el worker ya en marcha.
    await db.query(
      `UPDATE survey_instances SET status = 'COMPLETED', "completedAtMs" = $2 WHERE id = $1`,
      [e.id, Date.now()]);

    const { adaptador, llamadas } = adaptadorFalso(OK("SMno"));
    const r = await envio.enviarInicial(reclamada, adaptador);
    expect(r).toMatchObject({ estado: "descartado", motivo: "estado_COMPLETED" });
    expect(llamadas).toHaveLength(0);
  });

  it("no manda una caducada, y la marca EXPIRED", async () => {
    const e = await encolada();
    const reclamada = (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!;
    await db.query(`UPDATE survey_instances SET "expiresAtMs" = $2 WHERE id = $1`,
                   [e.id, Date.now() - 1000]);

    const { adaptador, llamadas } = adaptadorFalso(OK("SMno"));
    const r = await envio.enviarInicial(reclamada, adaptador);
    expect(r).toMatchObject({ estado: "descartado", motivo: "caducada" });
    expect(llamadas).toHaveLength(0);
    expect((await instancia(e.id)).status).toBe("EXPIRED");
  });

  it("una cancelada tampoco se manda", async () => {
    const e = await encolada();
    const reclamada = (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!;
    await db.query(`UPDATE survey_instances SET status = 'CANCELLED' WHERE id = $1`, [e.id]);
    const { adaptador, llamadas } = adaptadorFalso(OK("SMno"));
    expect((await envio.enviarInicial(reclamada, adaptador)).estado).toBe("descartado");
    expect(llamadas).toHaveLength(0);
  });
});

/* ── El token y la ventana de caída ──────────────────────────────────────── */

describe.skipIf(!RUN)("el token sobrevive a una caída", () => {
  it("si el proceso muere entre emitir y enviar, el reintento usa el MISMO enlace", async () => {
    const e = await encolada();
    const reclamada = (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!;

    // Se emite el token y ahí se «muere» el proceso: nunca se llama a Twilio.
    const emision = await svc.emitirToken(e.id, e.ambito);
    expect(emision.estado).toBe("emitido");
    const tokenOriginal = (emision as { token: string }).token;

    // Arranca de nuevo, con la fila tal y como quedó.
    await db.query(`UPDATE survey_instances SET "sendClaimedAtMs" = NULL WHERE id = $1`, [e.id]);
    const { adaptador, llamadas } = adaptadorFalso(OK("SMtras-caida"));
    const r = await envio.enviarInicial(reclamada, adaptador);

    expect(r.estado).toBe("enviado");
    // EXACTAMENTE el mismo enlace. Antes de 1G esto era imposible: solo quedaba
    // el sha256 y el enlace se perdía para siempre.
    expect(llamadas[0].url).toContain(tokenOriginal);
  });

  it("el recordatorio manda el mismo enlace que el inicial, no uno nuevo", async () => {
    const e = await encolada();
    const inicial = adaptadorFalso(OK("SMini"));
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              inicial.adaptador);

    await cfg.guardarConfigGlobal({ recordatorio: true });
    await db.query(`UPDATE survey_instances SET "reminderAfterMs" = $2 WHERE id = $1`,
                   [e.id, Date.now() - 1000]);

    const rec = adaptadorFalso(OK("SMrec"));
    const pendientes = await recordatorio.pendientesDeRecordatorio();
    expect(pendientes.map((x) => x.id)).toContain(e.id);
    const r = await recordatorio.enviarRecordatorio(
      pendientes.find((x) => x.id === e.id)!, rec.adaptador);

    expect(r.estado).toBe("enviado");
    expect(rec.llamadas[0].url).toBe(inicial.llamadas[0].url);
    expect(rec.llamadas[0].tipo).toBe("REMINDER");
  });

  it("el token no sale por la API interna de la ficha", async () => {
    const e = await encolada();
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              adaptadorFalso(OK("SMt")).adaptador);
    const cal = await import("./calidad.ts");
    const ficha = await cal.obtenerSatisfactionDeAsistencia(e.assistanceId, TALLER);
    const token = await svc.tokenDe(e.id);
    expect(token).toBeTruthy();
    expect(JSON.stringify(ficha)).not.toContain(token!);
  });
});

/* ── Sin plantilla ───────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("falta la plantilla", () => {
  it("ni llama a Twilio ni marca SENT, y no llena la tabla de intentos", async () => {
    delete process.env.TWILIO_TEMPLATE_SATISFACTION_DRIVER;
    const e = await encolada();
    const { adaptador, llamadas } = adaptadorFalso({
      estado: "sin_configurar", motivo: "no_template_satisfaction_driver",
    });

    const reclamada = (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!;
    const r = await envio.enviarInicial(reclamada, adaptador);
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "no_template_satisfaction_driver" });

    const i = await instancia(e.id);
    expect(i.status).toBe("QUEUED");             // no se pierde: sigue en cola
    expect(i.blockedReason).toBe("no_template_satisfaction_driver");
    // El siguiente intento se aplaza una hora: nada de reintentar cada 5 min.
    expect(Number(i.nextAttemptAtMs)).toBeGreaterThan(Date.now() + 3_000_000);

    // Se llamó al adaptador (que es quien sabe si hay SID) pero no se mandó nada
    // y quedó UN registro, no uno por pasada.
    expect(llamadas).toHaveLength(1);
    expect(await entregas(e.id)).toHaveLength(1);
    expect((await entregas(e.id))[0].status).toBe("SKIPPED");

    // Otra pasada del worker: no la vuelve a coger, así que no crea otra fila.
    const otra = await envio.reclamarParaEnvio();
    expect(otra.map((x) => x.id)).not.toContain(e.id);
    expect(await entregas(e.id)).toHaveLength(1);
  });

  it("cuando aparece la plantilla, sale sola", async () => {
    delete process.env.TWILIO_TEMPLATE_SATISFACTION_DRIVER;
    const e = await encolada();
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
      adaptadorFalso({ estado: "sin_configurar", motivo: "no_template_satisfaction_driver" }).adaptador);

    // Se configura la plantilla y pasa la hora de espera.
    process.env.TWILIO_TEMPLATE_SATISFACTION_DRIVER = "HXya";
    const luego = Date.now() + 3_700_000;
    const reclamada = (await envio.reclamarParaEnvio(luego)).find((x) => x.id === e.id);
    expect(reclamada).toBeTruthy();

    const ok = adaptadorFalso(OK("SMporfin"));
    expect((await envio.enviarInicial(reclamada!, ok.adaptador, luego)).estado).toBe("enviado");
    expect((await instancia(e.id)).status).toBe("SENT");
    expect((await instancia(e.id)).blockedReason).toBeNull();
  });
});

/* ── Errores ─────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("errores del proveedor", () => {
  it("un error pasajero reintenta con espera, sin marcar SENT", async () => {
    const e = await encolada();
    const { adaptador } = adaptadorFalso(PASAJERO);
    const r = await envio.enviarInicial(
      (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!, adaptador);

    expect(r.estado).toBe("reintentar");
    const i = await instancia(e.id);
    expect(i.status).toBe("QUEUED");
    expect(Number(i.sendAttempts)).toBe(1);
    expect(Number(i.nextAttemptAtMs)).toBeGreaterThan(Date.now());
    expect((await entregas(e.id))[0].status).toBe("FAILED");
    // Y hasta que no llegue su hora, la reclamación no la coge.
    expect((await envio.reclamarParaEnvio()).map((x) => x.id)).not.toContain(e.id);
  });

  it("se agotan los intentos y la encuesta acaba en FAILED, sin bucle", async () => {
    const e = await encolada();
    const { adaptador, llamadas } = adaptadorFalso(PASAJERO);
    let ahora = Date.now();
    for (let i = 0; i < 8; i++) {
      const reclamada = (await envio.reclamarParaEnvio(ahora)).find((x) => x.id === e.id);
      if (!reclamada) break;
      await envio.enviarInicial(reclamada, adaptador, ahora);
      ahora += 5 * 3_600_000;
    }
    const i = await instancia(e.id);
    expect(i.status).toBe("FAILED");
    // Cuatro intentos como máximo: no se insiste indefinidamente.
    expect(llamadas.length).toBeLessThanOrEqual(4);
    expect((await entregas(e.id)).every((d) => d.status === "FAILED")).toBe(true);
  });

  it("un error permanente no se reintenta ni una vez", async () => {
    const e = await encolada();
    const { adaptador, llamadas } = adaptadorFalso(PERMANENTE);
    const r = await envio.enviarInicial(
      (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!, adaptador);

    expect(r).toMatchObject({ estado: "fallido", motivo: "error_permanente" });
    expect((await instancia(e.id)).status).toBe("FAILED");
    expect((await envio.reclamarParaEnvio()).map((x) => x.id)).not.toContain(e.id);
    expect(llamadas).toHaveLength(1);
    expect((await entregas(e.id))[0].errorCode).toBe("21211");
  });

  it("no programa un reintento que caería después de caducar", async () => {
    // Caduca dentro de cinco minutos: la primera espera es de quince.
    const e = await encolada({ caducaEnMs: 5 * 60_000 });
    const { adaptador } = adaptadorFalso(PASAJERO);
    const r = await envio.enviarInicial(
      (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!, adaptador);
    expect(r).toMatchObject({ estado: "fallido", motivo: "sin_plazo" });
    expect((await instancia(e.id)).status).toBe("FAILED");
  });
});

/* ── El intento del que no se sabe nada ──────────────────────────────────── */

describe.skipIf(!RUN)("intento ambiguo", () => {
  it("no reenvía: se queda pendiente de reconciliar", async () => {
    const e = await encolada();
    const { adaptador, llamadas } = adaptadorFalso(SIN_RESPUESTA);
    const r = await envio.enviarInicial(
      (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!, adaptador);

    expect(r.estado).toBe("ambiguo");
    expect((await entregas(e.id))[0].status).toBe("UNKNOWN");
    const i = await instancia(e.id);
    expect(i.status).toBe("QUEUED");
    expect(i.blockedReason).toBe("reconcile_required");
    // LO IMPORTANTE: la siguiente pasada NO manda un segundo WhatsApp.
    const otra = await envio.reclamarParaEnvio();
    for (const a of otra.filter((x) => x.id === e.id)) {
      await envio.enviarInicial(a, adaptador);
    }
    expect(llamadas).toHaveLength(1);
  });

  it("si el proveedor dice que SÍ salió, se adopta su SID y queda enviada", async () => {
    const e = await encolada();
    await envio.enviarInicial(
      (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
      adaptadorFalso(SIN_RESPUESTA).adaptador);

    const luego = Date.now() + 120_000;
    process.env.TWILIO_ACCOUNT_SID = "ACpruebas";
    process.env.TWILIO_AUTH_TOKEN = "token-de-pruebas";
    const r = await reconcil.reconciliarAmbiguos(
      async () => [{ sid: "SMencontrado", status: "delivered" }], luego);

    expect(r.map((x) => x.estado)).toContain("confirmado");
    expect((await entregas(e.id))[0]).toMatchObject({
      status: "SENT", providerMessageId: "SMencontrado",
    });
    expect((await instancia(e.id)).status).toBe("SENT");
  });

  it("si el proveedor dice que NO salió, se puede reintentar sin duplicar", async () => {
    const e = await encolada();
    await envio.enviarInicial(
      (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
      adaptadorFalso(SIN_RESPUESTA).adaptador);

    const luego = Date.now() + 120_000;
    process.env.TWILIO_ACCOUNT_SID = "ACpruebas";
    process.env.TWILIO_AUTH_TOKEN = "token-de-pruebas";
    const r = await reconcil.reconciliarAmbiguos(async () => [], luego);
    expect(r.map((x) => x.estado)).toContain("no_se_mando");

    expect((await entregas(e.id))[0].status).toBe("FAILED");
    const reclamada = (await envio.reclamarParaEnvio(luego)).find((x) => x.id === e.id);
    expect(reclamada).toBeTruthy();
    const ok = adaptadorFalso(OK("SMsegundo"));
    expect((await envio.enviarInicial(reclamada!, ok.adaptador, luego)).estado).toBe("enviado");
    // Dos intentos registrados, un solo mensaje que llegó a existir.
    expect(await entregas(e.id)).toHaveLength(2);
  });

  it("sin poder preguntar al proveedor, sigue en duda y no se reenvía", async () => {
    const e = await encolada();
    await envio.enviarInicial(
      (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
      adaptadorFalso(SIN_RESPUESTA).adaptador);

    const luego = Date.now() + 120_000;
    process.env.TWILIO_ACCOUNT_SID = "ACpruebas";
    process.env.TWILIO_AUTH_TOKEN = "token-de-pruebas";
    const r = await reconcil.reconciliarAmbiguos(async () => { throw new Error("sin red"); }, luego);
    expect(r[0].estado).toBe("sigue_en_duda");
    expect((await entregas(e.id))[0].status).toBe("UNKNOWN");
    expect((await envio.reclamarParaEnvio(luego)).map((x) => x.id)).not.toContain(e.id);
  });
});

/* ── El lease ────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("lease", () => {
  it("un worker muerto no deja la encuesta bloqueada para siempre", async () => {
    const e = await encolada();
    await envio.reclamarParaEnvio();                    // alguien la reclama…
    expect((await envio.reclamarParaEnvio()).map((x) => x.id)).not.toContain(e.id);

    // …y no vuelve. Pasados los diez minutos, otro la recoge.
    const luego = Date.now() + 11 * 60_000;
    expect((await envio.reclamarParaEnvio(luego)).map((x) => x.id)).toContain(e.id);
  });
});

/* ── El callback ─────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("estados del proveedor", () => {
  async function enviada() {
    const e = await encolada();
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              adaptadorFalso(OK(`SM${e.id}`)).adaptador);
    return { ...e, sid: `SM${e.id}` };
  }

  it("delivered mueve la entrega y la encuesta", async () => {
    const e = await enviada();
    expect(await envio.aplicarEstadoProveedor({ sid: e.sid, estadoTwilio: "delivered" }))
      .toEqual({ aplicado: true });
    expect((await entregas(e.id))[0].status).toBe("DELIVERED");
    expect((await instancia(e.id)).status).toBe("DELIVERED");
  });

  it("repetirlo es inocuo", async () => {
    const e = await enviada();
    await envio.aplicarEstadoProveedor({ sid: e.sid, estadoTwilio: "delivered" });
    await envio.aplicarEstadoProveedor({ sid: e.sid, estadoTwilio: "delivered" });
    expect((await entregas(e.id))).toHaveLength(1);
    expect((await entregas(e.id))[0].status).toBe("DELIVERED");
  });

  it("un «sent» que llega tarde NO rebaja un «delivered»", async () => {
    const e = await enviada();
    await envio.aplicarEstadoProveedor({ sid: e.sid, estadoTwilio: "delivered" });
    const r = await envio.aplicarEstadoProveedor({ sid: e.sid, estadoTwilio: "sent" });
    expect(r).toMatchObject({ aplicado: false, motivo: "transicion_invalida" });
    expect((await entregas(e.id))[0].status).toBe("DELIVERED");
  });

  it("no pisa una encuesta que ya está abierta o contestada", async () => {
    const e = await enviada();
    await db.query(`UPDATE survey_instances SET status = 'STARTED' WHERE id = $1`, [e.id]);
    await envio.aplicarEstadoProveedor({ sid: e.sid, estadoTwilio: "delivered" });
    // La entrega sí avanza —llegó al teléfono— pero la encuesta se queda en
    // STARTED: alguien la abrió, y eso manda sobre un aviso de entrega tardío.
    expect((await entregas(e.id))[0].status).toBe("DELIVERED");
    expect((await instancia(e.id)).status).toBe("STARTED");
  });

  it("un SID que no es nuestro no hace nada", async () => {
    expect(await envio.aplicarEstadoProveedor({ sid: "SMdeotro", estadoTwilio: "delivered" }))
      .toMatchObject({ aplicado: false, motivo: "sid_desconocido" });
  });

  it("un estado que Twilio no manda no se traduce a nada", async () => {
    const e = await enviada();
    expect(await envio.aplicarEstadoProveedor({ sid: e.sid, estadoTwilio: "inventado" }))
      .toMatchObject({ aplicado: false, motivo: "estado_desconocido" });
    expect((await entregas(e.id))[0].status).toBe("SENT");
  });
});

/* ── Recordatorio ────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("recordatorio", () => {
  async function enviadaYVencida(o: { recordatorio?: boolean } = {}) {
    const e = await encolada();
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              adaptadorFalso(OK(`SM${e.id}`)).adaptador);
    await cfg.guardarConfigGlobal({ recordatorio: o.recordatorio ?? true });
    await db.query(`UPDATE survey_instances SET "reminderAfterMs" = $2 WHERE id = $1`,
                   [e.id, Date.now() - 1000]);
    return e;
  }

  it("uno como máximo", async () => {
    const e = await enviadaYVencida();
    const rec = adaptadorFalso(OK("SMr1"));
    const pend = await recordatorio.pendientesDeRecordatorio();
    await recordatorio.enviarRecordatorio(pend.find((x) => x.id === e.id)!, rec.adaptador);

    // Segunda pasada: ya no está pendiente, y si se forzara tampoco saldría.
    expect((await recordatorio.pendientesDeRecordatorio()).map((x) => x.id)).not.toContain(e.id);
    const otro = await recordatorio.enviarRecordatorio(pend.find((x) => x.id === e.id)!, rec.adaptador);
    expect(otro).toMatchObject({ estado: "omitido", motivo: "ya_recordado" });
    expect(rec.llamadas).toHaveLength(1);
    expect((await entregas(e.id)).filter((d) => d.messageType === "REMINDER")).toHaveLength(1);
  });

  it("no se manda con el recordatorio apagado", async () => {
    const e = await enviadaYVencida({ recordatorio: false });
    const rec = adaptadorFalso(OK("SMno"));
    const pend = await recordatorio.pendientesDeRecordatorio();
    const r = await recordatorio.enviarRecordatorio(pend.find((x) => x.id === e.id)!, rec.adaptador);
    expect(r).toMatchObject({ estado: "omitido", motivo: "reminder_disabled" });
    expect(rec.llamadas).toHaveLength(0);
  });

  it("no se manda si ya contestó", async () => {
    const e = await enviadaYVencida();
    const pend = await recordatorio.pendientesDeRecordatorio();
    await db.query(
      `UPDATE survey_instances SET status = 'COMPLETED', "completedAtMs" = $2 WHERE id = $1`,
      [e.id, Date.now()]);
    const rec = adaptadorFalso(OK("SMno"));
    const r = await recordatorio.enviarRecordatorio(pend.find((x) => x.id === e.id)!, rec.adaptador);
    expect(r).toMatchObject({ estado: "omitido", motivo: "estado_COMPLETED" });
    expect(rec.llamadas).toHaveLength(0);
  });

  it("no se manda si el enlace caduca enseguida", async () => {
    const e = await enviadaYVencida();
    const pend = await recordatorio.pendientesDeRecordatorio();
    await db.query(`UPDATE survey_instances SET "expiresAtMs" = $2 WHERE id = $1`,
                   [e.id, Date.now() + 60_000]);
    const rec = adaptadorFalso(OK("SMno"));
    const r = await recordatorio.enviarRecordatorio(pend.find((x) => x.id === e.id)!, rec.adaptador);
    expect(r).toMatchObject({ estado: "omitido", motivo: "sin_margen" });
    expect(rec.llamadas).toHaveLength(0);
  });

  it("no se manda si el inicial nunca llegó a aceptarse", async () => {
    const e = await encolada();
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              adaptadorFalso(PERMANENTE).adaptador);
    await cfg.guardarConfigGlobal({ recordatorio: true });
    // Aunque alguien pusiera la fecha a mano, la encuesta está en FAILED.
    await db.query(`UPDATE survey_instances SET "reminderAfterMs" = $2 WHERE id = $1`,
                   [e.id, Date.now() - 1000]);
    expect((await recordatorio.pendientesDeRecordatorio()).map((x) => x.id)).not.toContain(e.id);
  });

  it("la hora del recordatorio se congela al aceptarse el envío", async () => {
    const e = await encolada();
    await cfg.guardarConfigGlobal({ recordatorioHoras: 24 });
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              adaptadorFalso(OK("SMc")).adaptador);
    const antes = Number((await instancia(e.id)).reminderAfterMs);

    // Cambiar la configuración después NO mueve de hora lo ya mandado.
    await cfg.guardarConfigGlobal({ recordatorioHoras: 200 });
    expect(Number((await instancia(e.id)).reminderAfterMs)).toBe(antes);
  });
});

/* ── Teléfono congelado ──────────────────────────────────────────────────── */

describe.skipIf(!RUN)("destinatario", () => {
  it("se manda al número con el que se creó, aunque cambie la ficha", async () => {
    const e = await encolada({ telefono: "+34600111222" });
    // Alguien edita el teléfono del cliente entre medias.
    await db.query(
      `UPDATE roadside_assistances SET "customerPhone" = '+34699999999' WHERE id = $1`,
      [e.assistanceId]);

    const { adaptador, llamadas } = adaptadorFalso(OK("SMcongelado"));
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              adaptador);
    expect(llamadas[0].telefono).toBe("+34600111222");
  });

  it("sin destinatario no se manda nada", async () => {
    const e = await encolada({ telefono: null });
    const { adaptador, llamadas } = adaptadorFalso(OK("SMno"));
    const r = await envio.enviarInicial(
      (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!, adaptador);
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "no_recipient" });
    expect(llamadas).toHaveLength(0);
    expect(await entregas(e.id)).toHaveLength(0);
  });
});

/* ── El ciclo entero del worker ──────────────────────────────────────────── */

describe.skipIf(!RUN)("una pasada del worker", () => {
  it("caduca, encola, manda y recuerda, en ese orden", async () => {
    const worker = await import("./worker.ts");

    // Una que ya venció su espera y está lista para salir.
    const lista = await encolada();
    await db.query(`UPDATE survey_instances SET status = 'CREATED', "sendAfterMs" = $2
                     WHERE id = $1`, [lista.id, Date.now() - 1000]);
    // Y una pasada de fecha, que tiene que caducar y no salir.
    const vieja = await encolada();
    await db.query(`UPDATE survey_instances SET "expiresAtMs" = $2 WHERE id = $1`,
                   [vieja.id, Date.now() - 1000]);

    /*
     * El worker usa el adaptador de verdad, que sin credenciales devuelve
     * «sin_configurar» y no sale a la red. Es exactamente lo que pasa hoy en
     * producción: el worker corre y no manda nada.
     */
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    const r = await worker.cicloSatisfaction();

    expect(r.caducadas).toBeGreaterThanOrEqual(1);
    expect(r.encoladas).toBeGreaterThanOrEqual(1);
    // Sin credenciales no se manda: queda registrado el bloqueo, nada más.
    expect(r.enviadas).toBe(0);
    expect(r.bloqueadas).toBeGreaterThanOrEqual(1);

    expect((await instancia(vieja.id)).status).toBe("EXPIRED");
    const i = await instancia(lista.id);
    expect(i.status).toBe("QUEUED");
    expect(i.blockedReason).toBe("no_twilio_credentials");
  });
});

/* ── Override por cliente ────────────────────────────────────────────────── */

describe.skipIf(!RUN)("un cliente apagado a mano", () => {
  it("con Satisfaction global encendido, el override impide el envío", async () => {
    // Un cliente al que NO se le quiere preguntar todavía.
    const c = await db.query(
      `INSERT INTO connect_clients (name, "contactPhone", "createdAtMs", "updatedAtMs")
       VALUES ($1,'900111222',$2,$2) RETURNING id`,
      [`Cliente apagado ${sufijo}-${++n}`, Date.now()]);
    const clienteId = Number(c.rows[0].id);

    const assistanceId = await crearAsistencia();
    await db.query(`UPDATE roadside_assistances SET "clienteFacturacionId" = $2 WHERE id = $1`,
                   [assistanceId, clienteId]);
    const ambito = {
      sourceSystem: "assist" as const, tenantId: String(TALLER), assistanceId: String(assistanceId),
    };
    const inst = await svc.crearSurveyInstance({
      ambito, recipientRole: "DRIVER", recipientPhone: "+34600111222",
    });
    await db.query(`UPDATE survey_instances SET status = 'QUEUED' WHERE id = $1`,
                   [inst.instancia.id]);

    await cfg.guardarOverrideCliente({
      sourceSystem: "assist", tenantId: String(TALLER), clientId: clienteId,
      valores: { activo: false },
      notas: "apagado para la prueba del override",
    });

    const { adaptador, llamadas } = adaptadorFalso(OK("SMno"));
    const reclamada = (await envio.reclamarParaEnvio()).find((x) => x.id === inst.instancia.id)!;
    const r = await envio.enviarInicial(reclamada, adaptador);

    // El global sigue encendido —lo pone el beforeEach— y aun así no sale nada.
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "satisfaction_disabled" });
    expect(llamadas).toHaveLength(0);
    expect(await entregas(inst.instancia.id)).toHaveLength(0);
  });
});

/* ── El interruptor de emergencia ────────────────────────────────────────── */

describe.skipIf(!RUN)("kill switch", () => {
  it("apagado, el worker NO reclama ni manda nada", async () => {
    const worker = await import("./worker.ts");
    const e = await encolada();
    await cfg.guardarConfigGlobal({ activo: false });

    const r = await worker.cicloSatisfaction();
    expect(r.enviadas).toBe(0);
    expect(r.recordatorios).toBe(0);
    // Ni siquiera se reclama: la encuesta se queda intacta, sin lease puesto y
    // sin fila de intento. Apagar es apagar, no dar vueltas sin llegar a mandar.
    const i = await instancia(e.id);
    expect(i.status).toBe("QUEUED");
    expect(i.sendClaimedAtMs).toBeNull();
    expect(await entregas(e.id)).toHaveLength(0);
  });

  it("apagado, tampoco sale ningún recordatorio pendiente", async () => {
    const worker = await import("./worker.ts");
    const e = await encolada();
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              adaptadorFalso(OK("SMks")).adaptador);
    await cfg.guardarConfigGlobal({ recordatorio: true });
    await db.query(`UPDATE survey_instances SET "reminderAfterMs" = $2 WHERE id = $1`,
                   [e.id, Date.now() - 1000]);

    await cfg.guardarConfigGlobal({ activo: false });
    const r = await worker.cicloSatisfaction();
    expect(r.recordatorios).toBe(0);
    expect((await instancia(e.id)).reminderSentAtMs).toBeNull();
    expect((await entregas(e.id)).filter((d) => d.messageType === "REMINDER")).toHaveLength(0);
  });

  it("apagado, quien ya recibió su enlace SÍ puede contestar", async () => {
    const e = await encolada();
    const { adaptador, llamadas } = adaptadorFalso(OK("SMabierta"));
    await envio.enviarInicial((await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!,
                              adaptador);
    const token = llamadas[0].url.split("/").pop()!;

    // Se cierra el grifo DESPUÉS de que el WhatsApp saliera.
    await cfg.guardarConfigGlobal({ activo: false });

    const publico = await import("./publico.ts");
    const abierta = await publico.resolverSurveyPublica(token);
    expect(abierta.estado).toBe("ACTIVE");

    const r = await svc.completarSurvey({
      instanceId: e.id, ambito: e.ambito,
      respuestas: [
        { code: "overall_rating", value: 5 },
        { code: "professional_rating", value: 5 },
        { code: "resolution", value: "YES" },
      ] as never,
    });
    expect(r.responseId).toBeTruthy();
    expect((await instancia(e.id)).status).toBe("COMPLETED");
  });

  it("apagado, seguir caducando sí (no escribe a nadie)", async () => {
    const worker = await import("./worker.ts");
    const e = await encolada();
    await db.query(`UPDATE survey_instances SET "expiresAtMs" = $2 WHERE id = $1`,
                   [e.id, Date.now() - 1000]);
    await cfg.guardarConfigGlobal({ activo: false });

    await worker.cicloSatisfaction();
    expect((await instancia(e.id)).status).toBe("EXPIRED");
  });
});

/* ── Apagado ─────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("con Satisfaction apagado", () => {
  it("no se manda nada aunque haya encuestas encoladas", async () => {
    const e = await encolada();
    await cfg.guardarConfigGlobal({ activo: false });
    const { adaptador, llamadas } = adaptadorFalso(OK("SMno"));
    const r = await envio.enviarInicial(
      (await envio.reclamarParaEnvio()).find((x) => x.id === e.id)!, adaptador);
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "satisfaction_disabled" });
    expect(llamadas).toHaveLength(0);
  });
});
