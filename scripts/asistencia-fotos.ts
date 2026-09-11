/**
 * `npm run fotos:asistencia -- <id>` — dónde están las fotos de una asistencia.
 *
 * Solo lectura: ni un UPDATE ni un borrado. Se puede lanzar contra producción.
 *
 * Nació de un «me faltan fotos en el informe». Las fotos de una asistencia
 * pueden estar en TRES sitios que no siempre coinciden, y el informe solo mira
 * uno. Esto los cruza y dice cuáles bailan:
 *
 *   1. roadside_assistance_files — la tabla que leen el informe PDF y la
 *      galería. Si aquí no está, no sale en el informe aunque exista.
 *   2. assistance_documents — el catálogo de documentos, que se rellena en una
 *      segunda escritura y a propósito NO tumba la subida si falla. O sea que
 *      puede haber fichero sin ficha.
 *   3. El bucket de Supabase (roadside/<id>/…) — el fichero de verdad. Si la
 *      subida al bucket fue bien pero el INSERT falló, la foto está ahí y no
 *      la ve nadie: se recupera desde aquí.
 *
 * Lo que este script NO puede ver es lo que nunca salió del móvil. Ver abajo.
 */

import pool from "../server/db.ts";

/*
 * Supabase se carga a demanda, no arriba del todo: «server/supabase.ts» lanza
 * al importarse si falta SUPABASE_URL, y eso mataba el script entero antes de
 * enseñar las dos consultas a la base de datos, que son las que responden a la
 * pregunta el 90 % de las veces. El bucket es el paso 3; si no se puede mirar,
 * se dice y se sigue.
 */
async function cargarSupabase() {
  try {
    const m = await import("../server/supabase.ts");
    return { supabase: m.supabase, bucket: m.SUPABASE_ROADSIDE_BUCKET };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

const id = Number(process.argv[2]);

if (!Number.isFinite(id)) {
  console.error("Uso: npm run fotos:asistencia -- <id de la asistencia>");
  process.exit(1);
}

const fecha = (ms: number | string | null) =>
  ms ? new Date(Number(ms)).toISOString().slice(0, 19).replace("T", " ") : "—";

async function main() {
  const asistencia = await pool.query(
    `SELECT id, plate, "plateRemolque", status, "createdAtMs"
       FROM roadside_assistances WHERE id = $1`,
    [id]
  );

  if (asistencia.rows.length === 0) {
    console.error(`No existe la asistencia #${id}.`);
    process.exit(1);
  }

  const a = asistencia.rows[0];
  console.log(`\n── Asistencia #${a.id} ────────────────────────────────────`);
  console.log(`  Estado ......... ${a.status}`);
  console.log(`  Matrículas ..... ${a.plate || "—"}${a.plateRemolque ? ` · remolque ${a.plateRemolque}` : ""}`);
  console.log(`  Alta ........... ${fecha(a.createdAtMs)}`);

  // ── 1. Lo que ve el informe ────────────────────────────────────────
  const ficheros = await pool.query(
    `SELECT id, kind, url, "fileName", "createdAtMs"
       FROM roadside_assistance_files
      WHERE "assistanceId" = $1
      ORDER BY "createdAtMs" ASC`,
    [id]
  );

  const fotos = ficheros.rows.filter((f) => f.kind !== "firma");
  console.log(`\n── En el informe: roadside_assistance_files (${fotos.length} fotos) ──`);

  // Las URL repetidas no son un error: cuando la detección encuentra la
  // matrícula roja en la foto del camión, el servidor crea una segunda fila
  // «matricula_remolque» apuntando A LA MISMA IMAGEN. En el informe se ven dos
  // recuadros con la misma foto, y parece que falta una que nunca existió.
  const porUrl = new Map<string, string[]>();
  for (const f of ficheros.rows) {
    porUrl.set(f.url, [...(porUrl.get(f.url) ?? []), f.kind]);
  }

  for (const f of ficheros.rows) {
    const compartida = (porUrl.get(f.url) ?? []).length > 1;
    console.log(
      `  #${String(f.id).padEnd(6)} ${String(f.kind).padEnd(20)} ${fecha(f.createdAtMs)}` +
        (compartida ? "   ⟵ misma imagen que otra fila" : "")
    );
  }
  if (ficheros.rows.length === 0) console.log("  (ninguno)");

  const repetidas = [...porUrl.values()].filter((k) => k.length > 1).length;
  if (repetidas > 0) {
    console.log(
      `\n  ⚠ ${repetidas} imagen(es) aparecen con más de un tipo. El informe las` +
        `\n    cuenta por separado, así que «Fotografías (N)» puede ser mayor que` +
        `\n    el número de fotos distintas que se hicieron.`
    );
  }

  // ── 2. El catálogo de documentos ───────────────────────────────────
  const documentos = await pool.query(
    `SELECT id, tipo, origen, url, "fileName", "createdAtMs"
       FROM assistance_documents
      WHERE "sourceSystem" = 'assist' AND "assistanceId" = $1
      ORDER BY "createdAtMs" ASC`,
    [String(id)]
  );

  console.log(`\n── En el catálogo: assistance_documents (${documentos.rows.length}) ──`);
  for (const d of documentos.rows) {
    console.log(`  #${String(d.id).padEnd(6)} ${String(d.tipo).padEnd(20)} ${d.origen}`);
  }
  if (documentos.rows.length === 0) console.log("  (ninguno)");

  // ── 3. El bucket, que es donde está el fichero de verdad ───────────
  const prefijo = `roadside/${id}`;
  const sb = await cargarSupabase();

  if (!sb.supabase) {
    console.log(`\n── En el bucket ──`);
    console.log(`  No se ha podido mirar: ${sb.error}`);
    console.log("  (las dos listas de arriba siguen siendo válidas)");
    avisoFinal();
    await pool.end();
    return;
  }

  const { supabase, bucket: SUPABASE_ROADSIDE_BUCKET } = sb;
  const { data: enBucket, error } = await supabase.storage
    .from(SUPABASE_ROADSIDE_BUCKET)
    .list(prefijo, { limit: 1000 });

  console.log(`\n── En el bucket: ${SUPABASE_ROADSIDE_BUCKET}/${prefijo}/ ──`);
  if (error) {
    console.log(`  No se ha podido listar: ${error.message}`);
  } else if (!enBucket || enBucket.length === 0) {
    console.log("  (vacío)");
  } else {
    const urls = new Set(ficheros.rows.map((f) => String(f.url)));
    let huerfanos = 0;
    for (const o of enBucket) {
      // Un objeto sin fila en la tabla existe pero no lo ve nadie: subida al
      // bucket correcta e INSERT fallido. Estos son los recuperables.
      const referenciado = [...urls].some((u) => u.includes(`${prefijo}/${o.name}`));
      if (!referenciado) huerfanos++;
      console.log(`  ${o.name.padEnd(46)} ${referenciado ? "" : "⟵ SIN FILA EN LA TABLA"}`);
    }
    if (huerfanos > 0) {
      const { data } = supabase.storage
        .from(SUPABASE_ROADSIDE_BUCKET)
        .getPublicUrl(`${prefijo}/`);
      console.log(
        `\n  ⚠ ${huerfanos} fichero(s) en el bucket sin fila en la tabla: existen pero` +
          `\n    no salen ni en el informe ni en la galería. Se descargan de:` +
          `\n    ${data.publicUrl}<nombre del fichero>`
      );
    }
  }

  // ── 4. Lo que este script no puede ver ─────────────────────────────
  avisoFinal();

  await pool.end();
}

function avisoFinal() {
  console.log(`
── Y si aun así faltan ───────────────────────────────────────
  Puede que nunca salieran del móvil. La app copia cada foto a
  <Documentos>/offline_uploads/ del dispositivo y la encola en el outbox
  (Hive, caja «sea_outbox») antes de subirla. Sin cobertura se queda ahí y
  se sube sola en el siguiente refresco de la lista con conexión.

  El técnico ve cuántas tiene pendientes en la propia app. Si el móvil se
  perdió o se reinstaló la app sin llegar a subirlas, esas fotos no están en
  ningún sitio del servidor.
`);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
