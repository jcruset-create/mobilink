/**
 * La gestión interna de calidad, contra PostgreSQL real.
 *
 * Lo que se fija: que un taller no vea lo de otro por ninguna vía, que las
 * transiciones inválidas se rechacen, que cerrar exija decir en qué quedó, y
 * que cada acción deje sus DOS rastros —la cronología que se lee y la
 * auditoría de seguridad.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");
let cal: typeof import("./calidad.ts");
let mut: typeof import("./calidadServicio.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let n = 0;
const TALLER = 3131;
const OTRO = 4242;

/** `app_auditoria` guarda empresa y usuario como UUID, así que aquí van UUID. */
const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  nombre: "Supervisora",
  empresaId: "22222222-2222-4222-8222-222222222222",
  ip: "10.0.0.1",
};

const MALA_DRIVER = [
  { code: "overall_rating", value: 1 },
  { code: "professional_rating", value: 2 },
  { code: "resolution", value: "NO" },
  { code: "negative_reasons", value: ["LONG_WAIT", "VEHICLE_DAMAGE"] },
  { code: "comment", value: "Tardaron tres horas\ny rayaron el lateral" },
];
const BUENA_CUSTOMER = [
  { code: "overall_rating", value: 5 },
  { code: "speed_rating", value: 4 },
  { code: "tracking_rating", value: 5 },
  { code: "resolution", value: "YES" },
];

/** Una asistencia finalizada con cliente y proveedor, para el contexto. */
async function crearAsistencia(tallerId = TALLER) {
  const ahora = Date.now();
  const c = await db.query(
    `INSERT INTO connect_clients (name, "contactPhone", "createdAtMs", "updatedAtMs")
     VALUES ($1,'900111222',$2,$2) RETURNING id`,
    [`Cliente ${sufijo}-${++n}`, ahora],
  );
  const a = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", "customerPhone", address, plate,
        "descripcionAveria", "trackingToken", "clienteFacturacionId", "tallerId",
        "createdAtMs","assignedAtMs","departedAtMs","arrivedAtPointMs","finishedAtMs","updatedAtMs")
     VALUES ('en_camino_base','normal','Contacto','600999888','AP-7','1234ABC','Rueda',
             $1,$2,$3,$4,$5,$6,$7,$8,$4)
     RETURNING id`,
    [`tok-cal-${sufijo}-${++n}`, Number(c.rows[0].id), tallerId,
     ahora - 4_000_000, ahora - 3_600_000, ahora - 3_500_000, ahora - 2_000_000, ahora - 100_000],
  );
  return Number(a.rows[0].id);
}

/** Crea la encuesta, la contesta y devuelve el caso que salga. */
async function conCaso(respuestas: unknown[], rol: "DRIVER" | "CUSTOMER" = "DRIVER",
                       tallerId = TALLER) {
  const assistanceId = await crearAsistencia(tallerId);
  const ambito = {
    sourceSystem: "assist" as const, tenantId: String(tallerId),
    assistanceId: String(assistanceId),
  };
  const r = await svc.crearSurveyInstance({ ambito, recipientRole: rol });
  if (r.estado !== "created") throw new Error("no creada");
  const c = await svc.completarSurvey({
    instanceId: r.instancia.id, ambito, respuestas: respuestas as never,
  });
  return { assistanceId, instanceId: r.instancia.id, casoId: c.qualityCaseId, ambito };
}

const eventos = async (casoId: number) =>
  (await db.query(
    `SELECT "eventType","fromValue","toValue",note,"actorName"
       FROM quality_case_events WHERE "qualityCaseId" = $1 ORDER BY id`, [casoId])).rows;

const auditoria = async (casoId: number) =>
  (await db.query(
    `SELECT accion, user_id FROM app_auditoria
      WHERE entidad = 'quality_cases' AND entidad_id = $1 ORDER BY id`, [String(casoId)])).rows;

const esperar = () => new Promise((r) => setTimeout(r, 150));

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  svc = await import("./servicio.ts");
  cal = await import("./calidad.ts");
  mut = await import("./calidadServicio.ts");
  const { initAuditoria } = await import("../core/auditoriaSchema.ts");
  await initAuditoria();
});

afterAll(async () => { if (RUN) await db.end().catch(() => {}); });

/* ── Satisfaction de una asistencia ──────────────────────────────────────── */

describe.skipIf(!RUN)("Satisfaction en la ficha", () => {
  it("devuelve la respuesta del conductor desglosada", async () => {
    const { assistanceId, casoId } = await conCaso(MALA_DRIVER);
    const s = await cal.obtenerSatisfactionDeAsistencia(assistanceId, TALLER);

    expect(s.driver?.estado).toBe("COMPLETED");
    expect(s.driver?.respuesta).toMatchObject({
      overallRating: 1, professionalRating: 2, resolution: "NO",
      negativeReasons: ["LONG_WAIT", "VEHICLE_DAMAGE"],
    });
    expect(s.driver?.respuesta?.comment).toContain("rayaron el lateral");
    expect(s.driver?.qualityCaseId).toBe(casoId);
    expect(s.customer).toBeNull();     // solo hay una, y se dice
  });

  it("las del cliente traen sus tres valoraciones", async () => {
    const { assistanceId } = await conCaso(BUENA_CUSTOMER, "CUSTOMER");
    const s = await cal.obtenerSatisfactionDeAsistencia(assistanceId, TALLER);
    expect(s.customer?.respuesta).toMatchObject({
      overallRating: 5, speedRating: 4, trackingRating: 5, resolution: "YES",
    });
    expect(s.customer?.qualityCaseId).toBeNull();   // un 5 no abre nada
    expect(s.driver).toBeNull();
  });

  it("una asistencia sin encuestas devuelve los dos a null", async () => {
    const id = await crearAsistencia();
    const s = await cal.obtenerSatisfactionDeAsistencia(id, TALLER);
    expect(s.driver).toBeNull();
    expect(s.customer).toBeNull();
    expect(s.qualityCases).toEqual([]);
  });

  it("no saca nada del canal: ni token ni hash", async () => {
    const { assistanceId } = await conCaso(MALA_DRIVER);
    const s = await cal.obtenerSatisfactionDeAsistencia(assistanceId, TALLER);
    expect(JSON.stringify(s)).not.toContain("tokenHash");
    expect(JSON.stringify(s)).not.toContain("token");
  });

  it("otro taller no ve nada", async () => {
    const { assistanceId } = await conCaso(MALA_DRIVER);
    const s = await cal.obtenerSatisfactionDeAsistencia(assistanceId, OTRO);
    expect(s.driver).toBeNull();
    expect(s.qualityCases).toEqual([]);
  });
});

/* ── Bandeja ─────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("bandeja", () => {
  it("trae el caso con su contexto en una sola consulta", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    const b = await cal.listarCasos(TALLER, { porPagina: 100 });
    const fila = b.data.find((x) => x.id === casoId);
    expect(fila).toMatchObject({
      motivo: "VEHICLE_DAMAGE", prioridad: "CRITICAL", estado: "NEW",
      matricula: "1234ABC", valoracion: 1, originRecipientRole: "DRIVER",
    });
    expect(fila?.clienteNombre).toContain("Cliente");
  });

  /*
   * El orden es el que quiere ver un supervisor: unos daños de hace tres días
   * pesan más que una valoración baja de esta mañana.
   */
  it("lo crítico va primero", async () => {
    const criticos = await conCaso(MALA_DRIVER);
    await conCaso([
      { code: "overall_rating", value: 2 },
      { code: "professional_rating", value: 3 },
      { code: "resolution", value: "YES" },
    ]);
    const b = await cal.listarCasos(TALLER, { porPagina: 100 });
    expect(b.data[0].prioridad).toBe("CRITICAL");
    expect(b.data[0].id).toBe(criticos.casoId);
  });

  it("filtra por prioridad, estado y motivo", async () => {
    await conCaso(MALA_DRIVER);
    const solo = await cal.listarCasos(TALLER, { prioridad: "CRITICAL", porPagina: 100 });
    expect(solo.data.every((x) => x.prioridad === "CRITICAL")).toBe(true);
    const motivo = await cal.listarCasos(TALLER, { motivo: "VEHICLE_DAMAGE", porPagina: 100 });
    expect(motivo.data.every((x) => x.motivo === "VEHICLE_DAMAGE")).toBe(true);
    const cerrados = await cal.listarCasos(TALLER, { estado: "CLOSED", porPagina: 100 });
    expect(cerrados.data.every((x) => x.estado === "CLOSED")).toBe(true);
  });

  it("pagina de verdad, sin traérselo todo", async () => {
    for (let i = 0; i < 3; i++) await conCaso(MALA_DRIVER);
    const p1 = await cal.listarCasos(TALLER, { porPagina: 2, pagina: 1 });
    const p2 = await cal.listarCasos(TALLER, { porPagina: 2, pagina: 2 });
    expect(p1.data).toHaveLength(2);
    expect(p1.total).toBeGreaterThan(2);
    expect(p1.data.map((x) => x.id)).not.toEqual(p2.data.map((x) => x.id));
  });

  it("los contadores cuentan lo abierto y lo crítico", async () => {
    await conCaso(MALA_DRIVER);
    const b = await cal.listarCasos(TALLER, { porPagina: 1 });
    expect(b.contadores.abiertos).toBeGreaterThanOrEqual(1);
    expect(b.contadores.criticos).toBeGreaterThanOrEqual(1);
    expect(b.contadores.sinResponsable).toBeGreaterThanOrEqual(1);
  });

  it("otro taller no ve los casos ajenos", async () => {
    const { casoId } = await conCaso(MALA_DRIVER, "DRIVER", TALLER);
    const b = await cal.listarCasos(OTRO, { porPagina: 100 });
    expect(b.data.find((x) => x.id === casoId)).toBeUndefined();
  });
});

/* ── Detalle ─────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("detalle", () => {
  it("trae contexto, tiempos reales, encuesta y cronología", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    const d = await cal.detalleCaso(casoId!, TALLER);
    expect(d?.motivo).toBe("VEHICLE_DAMAGE");
    expect(d?.contexto.matricula).toBe("1234ABC");
    // Los instantes que existen; los que no, a null. Nada calculado a ojo.
    expect(d?.contexto.tiempos.solicitada).toBeGreaterThan(0);
    expect(d?.contexto.tiempos.finalizada).toBeGreaterThan(0);
    expect(d?.satisfaction.driver?.respuesta?.overallRating).toBe(1);
    expect(d?.cronologia[0].eventType).toBe("CREATED");
  });

  it("un caso de otro taller no existe", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    expect(await cal.detalleCaso(casoId!, OTRO)).toBeNull();
  });
});

/* ── Mutaciones ──────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("acciones sobre el caso", () => {
  it("asignar deja cronología y auditoría", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    await mut.asignarCaso({ casoId: casoId!, tenantId: String(TALLER),
                            responsable: "u-7", actor: ACTOR });
    await esperar();
    expect((await cal.detalleCaso(casoId!, TALLER))?.responsable).toBe("u-7");
    expect((await eventos(casoId!)).map((e) => e.eventType)).toContain("ASSIGNED");
    expect((await auditoria(casoId!)).map((a) => a.accion))
      .toContain("satisfaction.calidad.asignar");
  });

  it("asignar lo mismo dos veces no ensucia la cronología", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    await mut.asignarCaso({ casoId: casoId!, tenantId: String(TALLER), responsable: "u-7", actor: ACTOR });
    await mut.asignarCaso({ casoId: casoId!, tenantId: String(TALLER), responsable: "u-7", actor: ACTOR });
    expect((await eventos(casoId!)).filter((e) => e.eventType === "ASSIGNED")).toHaveLength(1);
  });

  it("cambiar prioridad anota de dónde a dónde", async () => {
    const { casoId } = await conCaso([
      { code: "overall_rating", value: 2 },
      { code: "professional_rating", value: 2 },
      { code: "resolution", value: "YES" },
    ]);
    await mut.cambiarPrioridad({ casoId: casoId!, tenantId: String(TALLER),
                                 prioridad: "CRITICAL", actor: ACTOR });
    const ev = (await eventos(casoId!)).find((e) => e.eventType === "PRIORITY_CHANGED");
    expect(ev).toMatchObject({ fromValue: "HIGH", toValue: "CRITICAL" });
  });

  it("el camino normal del expediente funciona", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    const t = String(TALLER);
    await mut.cambiarEstadoCaso({ casoId: casoId!, tenantId: t, estado: "IN_REVIEW", actor: ACTOR });
    await mut.cambiarEstadoCaso({ casoId: casoId!, tenantId: t, estado: "PENDING_PROVIDER", actor: ACTOR });
    await mut.cambiarEstadoCaso({
      casoId: casoId!, tenantId: t, estado: "RESOLVED",
      resolution: "DAMAGE_NOT_CONFIRMED", actionTaken: "PROVIDER_REVIEW",
      nota: "Revisadas las fotos: el arañazo ya estaba", actor: ACTOR,
    });
    const d = await cal.detalleCaso(casoId!, TALLER);
    expect(d?.estado).toBe("RESOLVED");
    expect(d?.resolution).toBe("DAMAGE_NOT_CONFIRMED");
    expect(d?.actionTaken).toBe("PROVIDER_REVIEW");
    expect(d?.resueltoEnMs).toBeGreaterThan(0);
    expect((await eventos(casoId!)).map((e) => e.eventType))
      .toEqual(expect.arrayContaining(["STATUS_CHANGED", "RESOLUTION_SET", "RESOLVED"]));
  });

  /*
   * Cerrar sin decir en qué quedó convierte el expediente en una fila que nadie
   * sabe interpretar seis meses después, que es justo cuando se consulta.
   */
  it("resolver sin conclusión se rechaza", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    await expect(mut.cambiarEstadoCaso({
      casoId: casoId!, tenantId: String(TALLER), estado: "RESOLVED", actor: ACTOR,
    })).rejects.toMatchObject({ codigo: "respuesta_invalida" });
  });

  it("de RESOLVED se puede reabrir; de CLOSED no", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    const t = String(TALLER);
    await mut.cambiarEstadoCaso({
      casoId: casoId!, tenantId: t, estado: "RESOLVED",
      resolution: "SERVICE_OK_PERCEPTION", actor: ACTOR,
    });
    await mut.cambiarEstadoCaso({ casoId: casoId!, tenantId: t, estado: "IN_REVIEW", actor: ACTOR });
    expect((await eventos(casoId!)).map((e) => e.eventType)).toContain("REOPENED");

    await mut.cambiarEstadoCaso({ casoId: casoId!, tenantId: t, estado: "CLOSED", actor: ACTOR });
    await expect(mut.cambiarEstadoCaso({
      casoId: casoId!, tenantId: t, estado: "IN_REVIEW", actor: ACTOR,
    })).rejects.toMatchObject({ codigo: "transicion_invalida" });
  });

  it("una nota queda en la cronología, y su texto NO en la auditoría", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    await mut.anadirNota({
      casoId: casoId!, tenantId: String(TALLER),
      nota: "Hablado con el cliente, matrícula 1234ABC", actor: ACTOR,
    });
    await esperar();
    const ev = (await eventos(casoId!)).find((e) => e.eventType === "NOTE_ADDED");
    expect(ev?.note).toContain("Hablado con el cliente");
    expect(ev?.actorName).toBe("Supervisora");
    // La nota puede llevar datos del cliente: en la auditoría solo consta que
    // alguien anotó, no lo que escribió.
    const aud = await db.query(
      `SELECT detalle FROM app_auditoria
        WHERE entidad='quality_cases' AND entidad_id=$1 AND accion LIKE '%nota'`,
      [String(casoId)]);
    expect(JSON.stringify(aud.rows)).not.toContain("1234ABC");
  });

  it("una nota vacía o desmesurada se rechaza", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    const t = String(TALLER);
    await expect(mut.anadirNota({ casoId: casoId!, tenantId: t, nota: "   ", actor: ACTOR }))
      .rejects.toMatchObject({ codigo: "respuesta_invalida" });
    await expect(mut.anadirNota({
      casoId: casoId!, tenantId: t, nota: "a".repeat(mut.MAX_NOTA + 1), actor: ACTOR,
    })).rejects.toMatchObject({ codigo: "respuesta_invalida" });
  });

  it("otro taller no toca nada", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    const ajeno = String(OTRO);
    await expect(mut.asignarCaso({ casoId: casoId!, tenantId: ajeno, responsable: "x", actor: ACTOR }))
      .rejects.toMatchObject({ codigo: "instancia_no_encontrada" });
    await expect(mut.cambiarEstadoCaso({ casoId: casoId!, tenantId: ajeno, estado: "IN_REVIEW", actor: ACTOR }))
      .rejects.toMatchObject({ codigo: "instancia_no_encontrada" });
    await expect(mut.anadirNota({ casoId: casoId!, tenantId: ajeno, nota: "hola", actor: ACTOR }))
      .rejects.toMatchObject({ codigo: "instancia_no_encontrada" });
  });

  /*
   * Dos supervisores con el mismo caso abierto. El segundo ve el estado que
   * dejó el primero: no se sobrescribe en silencio.
   */
  it("dos cambios incompatibles a la vez: uno gana y el otro se entera", async () => {
    const { casoId } = await conCaso(MALA_DRIVER);
    const t = String(TALLER);
    const rs = await Promise.allSettled([
      mut.cambiarEstadoCaso({ casoId: casoId!, tenantId: t, estado: "CLOSED",
                              resolution: "OTHER", actor: ACTOR }),
      mut.cambiarEstadoCaso({ casoId: casoId!, tenantId: t, estado: "IN_REVIEW", actor: ACTOR }),
    ]);
    const bien = rs.filter((r) => r.status === "fulfilled").length;
    // O gana uno y el otro choca con una transición ya imposible, o el orden
    // les permite encadenarse; lo que NO puede pasar es que se pierda uno.
    expect(bien).toBeGreaterThanOrEqual(1);
    const d = await cal.detalleCaso(casoId!, TALLER);
    expect(["CLOSED", "IN_REVIEW"]).toContain(d!.estado);
  });
});
