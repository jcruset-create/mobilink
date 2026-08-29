/**
 * Convergencia de la galería de Assist con el catálogo de documentos.
 *
 * Antes de esto la galería y el catálogo iban por su cuenta: la foto se
 * guardaba en `roadside_assistance_files` y el catálogo no se enteraba hasta
 * el siguiente reinicio. Mientras tanto la foto no existía para nada de lo
 * nuevo —ni contaba para el estado administrativo, ni se podía compartir con
 * quien subcontrató el servicio—.
 *
 * Lo que se fija:
 *   · una foto recién subida entra en el catálogo con su tipo y su visibilidad
 *   · borrarla la quita de los DOS sitios
 *   · la traducción de `kind` es la MISMA en la migración y en el alta
 *   · una foto sin catalogar sigue viéndose en la galería
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let asistencia = 0;

async function subirFichero(kind: string, url: string): Promise<number> {
  const r = await db.query(
    `INSERT INTO roadside_assistance_files ("assistanceId", kind, url, "fileName", "createdAtMs")
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [asistencia, kind, url, `${kind}.jpg`, now],
  );
  return Number(r.rows[0].id);
}

async function documentoDe(fileId: number) {
  const r = await db.query(
    `SELECT * FROM assistance_documents WHERE "legacyFileId" = $1`, [fileId]);
  return r.rows[0] ?? null;
}

describe.skipIf(!RUN)("Galería de Assist y catálogo de documentos", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initDocumentos } = await import("./schema.ts");
    await initDb(); await initConnect(); await initDocumentos();
    svc = await import("./servicio.ts");

    const a = await db.query(
      `INSERT INTO roadside_assistances
         (status, priority, "customerName", "customerPhone", address, plate,
          "descripcionAveria", "trackingToken", "createdAtMs", "updatedAtMs")
       VALUES ('finalizada','normal','Cliente','600111222','Calle 1','1234ABC',
               'Avería',$1,$2,$2) RETURNING id`,
      [`tok-gal-${sufijo}`, now]);
    asistencia = Number(a.rows[0].id);
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`DELETE FROM assistance_documents WHERE "assistanceId" = $1`,
      [String(asistencia)]).catch(() => {});
    await db.query(`DELETE FROM roadside_assistance_files WHERE "assistanceId" = $1`,
      [asistencia]).catch(() => {});
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [asistencia]).catch(() => {});
  }, 30_000);

  /* ── Alta ──────────────────────────────────────────────────────────────── */

  it("una foto recién subida entra en el catálogo con su tipo", async () => {
    const id = await subirFichero("averia", `https://x/av-${sufijo}.jpg`);
    expect(await svc.registrarFicheroDeAssist({
      fileId: id, assistanceId: asistencia, kind: "averia",
      url: `https://x/av-${sufijo}.jpg`, fileName: "averia.jpg", createdAtMs: now,
    })).toBe(true);

    const d = await documentoDe(id);
    expect(d.tipo).toBe("fotografia");
    expect(d.visibilidad).toBe("compartido");
    expect(d.sourceSystem).toBe("assist");
    expect(d.origen).toBe("propio");
  });

  /* Un `kind` que nadie ha clasificado no puede salir de casa por defecto. */
  it("un adjunto de WhatsApp entra como «otro» e interno", async () => {
    const id = await subirFichero("whatsapp_image", `https://x/wa-${sufijo}.jpg`);
    await svc.registrarFicheroDeAssist({
      fileId: id, assistanceId: asistencia, kind: "whatsapp_image",
      url: `https://x/wa-${sufijo}.jpg`, createdAtMs: now,
    });
    const d = await documentoDe(id);
    expect(d.tipo).toBe("otro");
    expect(d.visibilidad).toBe("interno");
  });

  it("una firma entra como firma y compartida", async () => {
    const id = await subirFichero("firma", `https://x/fi-${sufijo}.png`);
    await svc.registrarFicheroDeAssist({
      fileId: id, assistanceId: asistencia, kind: "firma",
      url: `https://x/fi-${sufijo}.png`, createdAtMs: now,
    });
    const d = await documentoDe(id);
    expect(d.tipo).toBe("firma");
    expect(d.visibilidad).toBe("compartido");
  });

  /* Subir dos veces la misma foto no puede duplicar la ficha. */
  it("catalogar dos veces el mismo fichero no lo duplica", async () => {
    const id = await subirFichero("albaran", `https://x/al-${sufijo}.pdf`);
    await svc.registrarFicheroDeAssist({
      fileId: id, assistanceId: asistencia, kind: "albaran", url: "https://x/al.pdf", createdAtMs: now,
    });
    await svc.registrarFicheroDeAssist({
      fileId: id, assistanceId: asistencia, kind: "albaran", url: "https://x/al.pdf", createdAtMs: now,
    });
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM assistance_documents WHERE "legacyFileId" = $1`, [id]);
    expect(r.rows[0].n).toBe(1);
  });

  /* Guardar la foto es lo que importa a quien está en la carretera. */
  it("catalogar un fichero de una asistencia que no existe no revienta", async () => {
    const ok = await svc.registrarFicheroDeAssist({
      fileId: 999999999, assistanceId: 999999999, kind: "foto", url: "https://x/no.jpg",
    });
    expect(ok).toBe(true);          // no lanza
    expect(await documentoDe(999999999)).toBeNull();   // y no inventa nada
  });

  /* ── Baja ──────────────────────────────────────────────────────────────── */

  /*
   * Sin esto la foto se borraba de la pantalla y de ningún sitio más: seguía
   * contando para el estado administrativo y seguía compartida.
   */
  it("borrar una foto la quita también del catálogo", async () => {
    const id = await subirFichero("parte", `https://x/pa-${sufijo}.pdf`);
    await svc.registrarFicheroDeAssist({
      fileId: id, assistanceId: asistencia, kind: "parte", url: "https://x/pa.pdf", createdAtMs: now,
    });
    expect(await documentoDe(id)).toBeTruthy();

    await db.query(`DELETE FROM roadside_assistance_files WHERE id = $1`, [id]);
    await svc.olvidarFicheroDeAssist(id);
    expect(await documentoDe(id)).toBeNull();
  });

  it("olvidar un fichero que no estaba catalogado no falla", async () => {
    await expect(svc.olvidarFicheroDeAssist(888888888)).resolves.toBeUndefined();
  });

  /* ── Una sola traducción ───────────────────────────────────────────────── */

  /*
   * La migración de arranque y el alta tienen que clasificar igual. Escritas
   * por separado ya habían divergido: una factura migrada quedaba «interno» y
   * una recién subida «compartido».
   */
  it("la migración de arranque clasifica igual que el alta", async () => {
    const { initDocumentos } = await import("./schema.ts");
    // Un fichero SIN catalogar, como los que hay de antes.
    const id = await subirFichero("factura", `https://x/fa-${sufijo}.pdf`);
    expect(await documentoDe(id)).toBeNull();

    await initDocumentos();          // la migración lo recoge
    const migrado = await documentoDe(id);
    expect(migrado).toBeTruthy();

    // Y ahora el mismo kind por la vía del alta.
    const id2 = await subirFichero("factura", `https://x/fa2-${sufijo}.pdf`);
    await svc.registrarFicheroDeAssist({
      fileId: id2, assistanceId: asistencia, kind: "factura",
      url: `https://x/fa2-${sufijo}.pdf`, createdAtMs: now,
    });
    const alta = await documentoDe(id2);

    expect(migrado.tipo).toBe(alta.tipo);
    expect(migrado.visibilidad).toBe(alta.visibilidad);
  });

  /* ── La galería no pierde nada ─────────────────────────────────────────── */

  /*
   * Es el motivo de que la consulta de la galería use LEFT JOIN: una foto que
   * por lo que sea no esté catalogada tiene que seguir viéndose. Una foto que
   * no se ve es una foto perdida, y encima nadie la echa de menos.
   */
  it("una foto sin catalogar sigue saliendo en la galería, sin etiqueta", async () => {
    const id = await subirFichero("foto_extra", `https://x/hu-${sufijo}.jpg`);
    // A propósito: NO se cataloga.
    const r = await db.query(
      `SELECT f.id, f.kind, d.tipo AS "tipoDocumento", d.visibilidad
         FROM roadside_assistance_files f
         LEFT JOIN assistance_documents d
           ON d."legacyFileId" = f.id AND d."sourceSystem" = 'assist'
        WHERE f."assistanceId" = $1
        ORDER BY f."createdAtMs" ASC`,
      [asistencia]);
    const huerfana = r.rows.find((x: any) => Number(x.id) === id);
    expect(huerfana).toBeTruthy();
    expect(huerfana.tipoDocumento).toBeNull();
  });

  it("la galería devuelve el tipo y la visibilidad de lo que sí está catalogado", async () => {
    const r = await db.query(
      `SELECT f.id, f.kind, d.tipo AS "tipoDocumento", d.visibilidad
         FROM roadside_assistance_files f
         LEFT JOIN assistance_documents d
           ON d."legacyFileId" = f.id AND d."sourceSystem" = 'assist'
        WHERE f."assistanceId" = $1 AND f.kind = 'averia'`,
      [asistencia]);
    expect(r.rows[0].tipoDocumento).toBe("fotografia");
    expect(r.rows[0].visibilidad).toBe("compartido");
  });

  /* Y una vez catalogadas, cuentan para el expediente. */
  it("las fotos catalogadas cuentan para la situación administrativa", async () => {
    const docs = await svc.listarDocumentos("assist", asistencia, "propio");
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.some((d: any) => d.tipo === "firma")).toBe(true);
  });

  /* La factura de proveedor no puede salir por compartir fotos. */
  it("lo interno no se enseña a la contraparte", async () => {
    const propios = await svc.listarDocumentos("assist", asistencia, "propio");
    const fuera = await svc.listarDocumentos("assist", asistencia, "contraparte");
    expect(fuera.length).toBeLessThan(propios.length);
    expect(fuera.every((d: any) => d.visibilidad !== "interno")).toBe(true);
  });
});
