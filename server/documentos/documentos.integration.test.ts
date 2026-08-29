/**
 * Documentos y estado administrativo, contra PostgreSQL real.
 *
 * Lo que se fija:
 *   · la factura de un proveedor NO sale hacia la contraparte, y la restricción
 *     está en la CONSULTA, no en la pantalla
 *   · el estado administrativo se deduce de hechos y es independiente del
 *     operativo: FINALIZADA + PENDIENTE_ALBARAN conviven
 *   · subir un albarán mueve el expediente solo, sin que nadie toque un campo
 *   · los ficheros que Assist ya tenía se incorporan al registro
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const CORR = `COR-doc-${sufijo}`;

let asistenciaPropia = 0;
let asistenciaSubcontratada = 0;
let ficheroAntiguoId = 0;

async function crearAsistencia(extra: { estado?: string; despacho?: number | null } = {}) {
  const r = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", "customerPhone", address, plate,
        "descripcionAveria", "trackingToken", "despachoExternoId", "createdAtMs", "updatedAtMs")
     VALUES ($1,'normal','Cliente','600111222','Calle 1','1234ABC','Avería',$2,$3,$4,$4)
     RETURNING id`,
    [extra.estado ?? "en_curso", `tok-doc-${sufijo}-${Math.random().toString(36).slice(2, 8)}`,
     extra.despacho ?? null, now],
  );
  return Number(r.rows[0].id);
}

describe.skipIf(!RUN)("Documentos y estado administrativo", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDispatch } = await import("../dispatch/schema.ts");
    const { initDocumentos } = await import("./schema.ts");
    await initDb();
    await initConnect();
    await initDispatch();

    // Un fichero de los de antes, ANTES de que exista el registro: así la
    // migración tiene algo real que importar.
    const previa = await crearAsistencia();
    const f = await db.query(
      `INSERT INTO roadside_assistance_files ("assistanceId", kind, url, "fileName", "createdAtMs")
       VALUES ($1,'matricula','https://x/f.jpg','f.jpg',$2) RETURNING id`,
      [previa, now],
    );
    ficheroAntiguoId = Number(f.rows[0].id);

    await initDocumentos();
    svc = await import("./servicio.ts");

    asistenciaPropia = await crearAsistencia({ estado: "finalizada" });
    asistenciaSubcontratada = await crearAsistencia({ estado: "finalizada", despacho: 999999 });
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`ALTER TABLE assistance_events DISABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_events WHERE "assistanceId" = ANY($1::text[]) OR "correlationId" = $2`,
      [[String(asistenciaPropia), String(asistenciaSubcontratada)], CORR]).catch(() => {});
    await db.query(`ALTER TABLE assistance_events ENABLE TRIGGER assistance_events_inmutable_trg`).catch(() => {});
    await db.query(`DELETE FROM assistance_documents WHERE "correlationId" = $1
      OR "assistanceId" = ANY($2::text[])`,
      [CORR, [String(asistenciaPropia), String(asistenciaSubcontratada)]]).catch(() => {});
    await db.query(`DELETE FROM roadside_assistance_files WHERE "fileName" = 'f.jpg'`).catch(() => {});
    await db.query(`DELETE FROM roadside_assistances WHERE "trackingToken" LIKE $1`,
      [`tok-doc-${sufijo}%`]).catch(() => {});
  }, 30_000);

  it("importa al registro los ficheros que Assist ya tenía", async () => {
    const r = await db.query(
      `SELECT * FROM assistance_documents WHERE "legacyFileId" = $1`, [ficheroAntiguoId]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].tipo).toBe("fotografia");        // 'matricula' → fotografía
    expect(r.rows[0].visibilidad).toBe("compartido");
    expect(r.rows[0].url).toBe("https://x/f.jpg");
  });

  it("la importación no duplica al repetirse", async () => {
    const { initDocumentos } = await import("./schema.ts");
    await initDocumentos();
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM assistance_documents WHERE "legacyFileId" = $1`,
      [ficheroAntiguoId]);
    expect(r.rows[0].n).toBe(1);
  });

  /*
   * El caso del enunciado: el servicio terminó hace días y el papel no ha
   * llegado. Las dos verdades a la vez.
   */
  it("operativo FINALIZADA y administrativo PENDIENTE_ALBARAN conviven", async () => {
    const estado = await svc.recalcularEstadoAdmin("assist", asistenciaPropia);
    expect(estado).toBe("PENDIENTE_ALBARAN");

    const a = await db.query(
      `SELECT status, "estadoAdmin" FROM roadside_assistances WHERE id = $1`, [asistenciaPropia]);
    expect(a.rows[0].status).toBe("finalizada");
    expect(a.rows[0].estadoAdmin).toBe("PENDIENTE_ALBARAN");
  });

  it("subir el albarán mueve el expediente solo, sin tocar ningún campo a mano", async () => {
    await svc.registrarDocumento({
      system: "assist", assistanceId: asistenciaPropia, tipo: "albaran",
      documentNumber: `ALB-${sufijo}`, uploadedBy: "Marta",
    });
    const a = await db.query(
      `SELECT "estadoAdmin" FROM roadside_assistances WHERE id = $1`, [asistenciaPropia]);
    expect(a.rows[0].estadoAdmin).toBe("DOCUMENTACION_COMPLETA");
  });

  it("validar el coste la deja lista para facturar, y queda en la timeline", async () => {
    const estado = await svc.validarCoste("assist", asistenciaPropia, "Jordi");
    expect(estado).toBe("LISTA_PARA_FACTURAR");

    const ev = await db.query(
      `SELECT "eventType" FROM assistance_events
        WHERE "sourceSystem" = 'assist' AND "assistanceId" = $1 ORDER BY id`,
      [String(asistenciaPropia)]);
    const tipos = ev.rows.map((e: any) => e.eventType);
    expect(tipos).toContain("DELIVERY_NOTE_RECEIVED");
    expect(tipos).toContain("COST_CONFIRMED");
    expect(tipos).toContain("READY_TO_BILL");
  });

  it("facturarla la cierra", async () => {
    const estado = await svc.marcarFacturada("assist", asistenciaPropia, "Jordi", `FAC-${sufijo}`);
    expect(estado).toBe("FACTURADA");
  });

  /*
   * Subcontratada: además del albarán hace falta la factura de quien lo hizo.
   * Sin ella no se puede cerrar el coste, y sin coste no hay margen conocido.
   */
  it("una subcontratada exige además la factura del proveedor", async () => {
    let s = await svc.situacionAdministrativa("assist", asistenciaSubcontratada);
    expect(s.estado).toBe("PENDIENTE_ALBARAN");
    expect(s.faltan).toEqual(["albaran", "factura"]);

    await svc.registrarDocumento({
      system: "assist", assistanceId: asistenciaSubcontratada, tipo: "albaran",
      correlationId: CORR,
    });
    s = await svc.situacionAdministrativa("assist", asistenciaSubcontratada);
    expect(s.estado).toBe("PENDIENTE_FACTURA");
    expect(s.faltan).toEqual(["factura"]);

    await svc.registrarDocumento({
      system: "assist", assistanceId: asistenciaSubcontratada, tipo: "factura",
      origen: "proveedor", correlationId: CORR, amount: 120,
    });
    s = await svc.situacionAdministrativa("assist", asistenciaSubcontratada);
    expect(s.estado).toBe("DOCUMENTACION_COMPLETA");
    expect(s.faltan).toEqual([]);
  });

  /* ── LA prueba de privacidad ─────────────────────────────────────────── */

  /*
   * La factura del proveedor lleva dentro lo que cuesta el servicio. Si cruza,
   * la otra plataforma calcula el margen y tarifa en consecuencia.
   */
  it("la factura de un proveedor NO sale hacia la contraparte", async () => {
    const propios = await svc.listarDocumentos("assist", asistenciaSubcontratada, "propio");
    expect(propios.map((d) => d.tipo)).toContain("factura");

    const deLaContraparte = await svc.listarDocumentos(
      "assist", asistenciaSubcontratada, "contraparte", CORR);
    expect(deLaContraparte.map((d) => d.tipo)).not.toContain("factura");
    expect(deLaContraparte.map((d) => d.tipo)).toContain("albaran");

    // Y el importe no viaja por ningún lado.
    expect(JSON.stringify(deLaContraparte)).not.toContain("120");
  });

  it("el cliente final solo ve lo suyo: albarán y parte", async () => {
    await svc.registrarDocumento({
      system: "assist", assistanceId: asistenciaSubcontratada, tipo: "fotografia",
      correlationId: CORR,
    });
    const delCliente = await svc.listarDocumentos(
      "assist", asistenciaSubcontratada, "cliente", CORR);
    const tipos = delCliente.map((d) => d.tipo);
    expect(tipos).toContain("albaran");
    expect(tipos).not.toContain("factura");
    expect(tipos).not.toContain("fotografia");   // compartida, pero no del cliente
  });

  it("un documento interno no se puede cargar por su uuid desde fuera", async () => {
    const factura = (await svc.listarDocumentos("assist", asistenciaSubcontratada, "propio"))
      .find((d) => d.tipo === "factura")!;

    expect(await svc.cargarDocumento(factura.uuid, "propio")).not.toBeNull();
    // Adivinar el uuid no basta: la política se comprueba al cargar.
    expect(await svc.cargarDocumento(factura.uuid, "contraparte")).toBeNull();
    expect(await svc.cargarDocumento(factura.uuid, "cliente")).toBeNull();
  });

  it("se puede compartir a mano lo que la regla dejó interno, y queda anotado", async () => {
    const factura = (await svc.listarDocumentos("assist", asistenciaSubcontratada, "propio"))
      .find((d) => d.tipo === "factura")!;

    await svc.cambiarVisibilidad(factura.uuid, "compartido", "Jordi");
    expect(await svc.cargarDocumento(factura.uuid, "contraparte")).not.toBeNull();

    // Y se puede retirar.
    await svc.cambiarVisibilidad(factura.uuid, "interno", "Jordi");
    expect(await svc.cargarDocumento(factura.uuid, "contraparte")).toBeNull();
  });

  it("mientras el servicio no ha terminado no se reclama papeleo", async () => {
    const enCurso = await crearAsistencia({ estado: "en_curso" });
    const s = await svc.situacionAdministrativa("assist", enCurso);
    expect(s.estado).toBe("SIN_DOCUMENTACION");   // no PENDIENTE_ALBARAN
  });

  it("un tipo de documento inventado se rechaza", async () => {
    await expect(svc.registrarDocumento({
      system: "assist", assistanceId: asistenciaPropia, tipo: "inventado" as any,
    })).rejects.toThrow(/desconocido/i);
  });
});
