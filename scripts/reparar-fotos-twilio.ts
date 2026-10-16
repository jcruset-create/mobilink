/**
 * Repara las fotos que quedaron apuntando a Twilio.
 *
 * ── Qué arregla ─────────────────────────────────────────────────────────────
 *
 * Hasta el arreglo de hoy, al cerrar una captura de WhatsApp los adjuntos se
 * guardaban como foto de la asistencia con «la copia nuestra, y si no hay, la
 * de Twilio». La de Twilio exige usuario y contraseña —las del servidor— así
 * que esas filas son fotos que ningún navegador puede abrir: salen rotas, y al
 * pulsarlas el panel pide credenciales de Twilio a quien esté delante.
 *
 * Aquel arreglo impide que se creen nuevas. Éste repara las que ya están: baja
 * cada una con las credenciales del servidor, la sube a nuestro almacén y
 * cambia la dirección guardada.
 *
 * ── Cómo se usa ─────────────────────────────────────────────────────────────
 *
 *   # Primero MIRAR, que no toca nada:
 *   DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… \
 *   npx tsx scripts/reparar-fotos-twilio.ts
 *
 *   # Y cuando el recuento cuadre, aplicar:
 *   … npx tsx scripts/reparar-fotos-twilio.ts --aplicar
 *
 * Sin `--aplicar` no escribe nada: dice cuántas hay y qué pasaría con cada
 * una. Es a propósito —esto toca datos de producción— y porque el primer
 * recuento ya responde a la pregunta de cuánto se había perdido.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 *
 * No borra nada. Una foto que Twilio ya no sirva —los adjuntos no viven allí
 * para siempre— se deja como está y se cuenta aparte: la fila es el único
 * rastro de que esa foto existió, y borrarla sería perder también eso.
 */

import db from "../server/db.ts";
import { descargarMedioTwilio } from "../server/core/medioTwilio.ts";
import { supabase, SUPABASE_ROADSIDE_BUCKET } from "../server/supabase.ts";

const APLICAR = process.argv.includes("--aplicar");

/** Lo que hay que saber de una fila para poder repararla. */
type FilaRota = {
  tabla: "roadside_assistance_files" | "whatsapp_capture_messages";
  id: number;
  asistenciaId: number | null;
  url: string;
};

/** Las direcciones de Twilio, que son las que no se pueden abrir. */
function esDeTwilio(url: unknown): boolean {
  return /^https?:\/\/[^/]*\btwilio\.com\//i.test(String(url ?? ""));
}

/**
 * Las dos poblaciones afectadas.
 *
 * Las FOTOS de la asistencia son lo que se ve roto en la ficha. Los MENSAJES
 * de la captura son el origen: si se les devuelve su copia, la captura vuelve
 * a enseñar sus miniaturas y además se puede volver a guardar desde ahí.
 */
async function buscarRotas(): Promise<FilaRota[]> {
  const fotos = await db.query(
    `SELECT id, "assistanceId", url
       FROM roadside_assistance_files
      WHERE url ILIKE '%twilio.com/%'
      ORDER BY id`
  );
  const mensajes = await db.query(
    `SELECT id, job_id, media_url
       FROM whatsapp_capture_messages
      WHERE media_stored_url IS NULL
        AND media_url ILIKE '%twilio.com/%'
      ORDER BY id`
  );

  return [
    ...fotos.rows.map((r: any) => ({
      tabla: "roadside_assistance_files" as const,
      id: Number(r.id),
      asistenciaId: r.assistanceId != null ? Number(r.assistanceId) : null,
      url: String(r.url),
    })),
    ...mensajes.rows.map((r: any) => ({
      tabla: "whatsapp_capture_messages" as const,
      id: Number(r.id),
      asistenciaId: r.job_id != null ? Number(r.job_id) : null,
      url: String(r.media_url),
    })),
  ].filter((f) => esDeTwilio(f.url));
}

/** Baja una y la deja en el almacén. Devuelve la dirección nueva, o el motivo. */
async function rescatar(fila: FilaRota): Promise<{ url: string } | { motivo: string }> {
  const medio = await descargarMedioTwilio(fila.url).catch((e: any) => ({
    ok: false as const,
    status: 0,
    contentType: "",
    cuerpo: Buffer.alloc(0),
    motivo: String(e?.message ?? e),
  }));

  if (!medio.ok) {
    const detalle = (medio as any).motivo ?? `Twilio contesta ${medio.status}`;
    return { motivo: detalle };
  }

  const contentType = medio.contentType || "application/octet-stream";
  const ext = contentType.split("/")[1]?.split(";")[0] ?? "bin";
  const carpeta = fila.asistenciaId ?? "sin-asistencia";
  const ruta = `roadside/${carpeta}/rescatada_${fila.tabla}_${fila.id}.${ext}`;

  const { error } = await supabase.storage
    .from(SUPABASE_ROADSIDE_BUCKET)
    .upload(ruta, medio.cuerpo, { contentType, upsert: true });
  if (error) return { motivo: `no se ha podido guardar: ${error.message}` };

  const { data } = supabase.storage.from(SUPABASE_ROADSIDE_BUCKET).getPublicUrl(ruta);
  if (!data?.publicUrl) return { motivo: "el almacén no ha devuelto dirección" };
  return { url: data.publicUrl };
}

async function guardar(fila: FilaRota, url: string): Promise<void> {
  if (fila.tabla === "roadside_assistance_files") {
    await db.query(`UPDATE roadside_assistance_files SET url = $2 WHERE id = $1`, [fila.id, url]);
  } else {
    await db.query(
      `UPDATE whatsapp_capture_messages SET media_stored_url = $2 WHERE id = $1`,
      [fila.id, url]
    );
  }
}

async function main(): Promise<void> {
  const rotas = await buscarRotas();

  const fotos = rotas.filter((f) => f.tabla === "roadside_assistance_files").length;
  const mensajes = rotas.length - fotos;
  console.log(
    `Apuntando a Twilio: ${rotas.length} (${fotos} fotos de asistencia, ${mensajes} mensajes de captura)`
  );
  if (rotas.length === 0) return;

  if (!APLICAR) {
    console.log("\nEn seco: no se escribe nada. Repite con --aplicar para repararlas.\n");
    for (const f of rotas.slice(0, 20)) {
      console.log(`  ${f.tabla} #${f.id} · asistencia ${f.asistenciaId ?? "?"}`);
    }
    if (rotas.length > 20) console.log(`  … y ${rotas.length - 20} más`);
    return;
  }

  let reparadas = 0;
  const perdidas: string[] = [];

  for (const fila of rotas) {
    const r = await rescatar(fila);
    if ("url" in r) {
      await guardar(fila, r.url);
      reparadas++;
      console.log(`✔ ${fila.tabla} #${fila.id} (asistencia ${fila.asistenciaId ?? "?"})`);
    } else {
      /*
       * No se borra la fila. Los adjuntos no viven en Twilio para siempre, así
       * que esto será sobre todo «ya no está»: la fila es el único rastro de
       * que esa foto existió, y borrarla sería perder también eso.
       */
      perdidas.push(`${fila.tabla} #${fila.id} · asistencia ${fila.asistenciaId ?? "?"} · ${r.motivo}`);
      console.log(`✖ ${fila.tabla} #${fila.id}: ${r.motivo}`);
    }
  }

  console.log(`\nReparadas ${reparadas} de ${rotas.length}.`);
  if (perdidas.length) {
    console.log(`\nNo recuperables (${perdidas.length}), se dejan como estaban:`);
    for (const p of perdidas) console.log(`  ${p}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Error reparando las fotos:", e?.message ?? e);
    process.exit(1);
  });
