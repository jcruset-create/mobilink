/**
 * Dónde viven los documentos emitidos.
 *
 * Bucket **privado** con enlaces firmados que caducan, no el bucket público que
 * el proyecto usa para logotipos. La diferencia importa: estos PDF llevan el
 * NIF de personas físicas y la matrícula del vehículo de un cliente. Con un
 * bucket público, una URL reenviada por WhatsApp los abre a quien la reciba,
 * sin sesión y para siempre.
 *
 * Sin Supabase configurado —desarrollo y pruebas— se guarda en disco bajo
 * `server/uploads/tacografos`. No es para producción: el contenedor de Render
 * es efímero y ahí los documentos se perderían.
 *
 * Mismo criterio y mismo patrón que `server/cash/storage.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import { ErrorTacografos } from "./repository.ts";

const BUCKET = process.env.TACOGRAFOS_DOCUMENTS_BUCKET || "tacografos-documents";
const CADUCIDAD_ENLACE_S = 60 * 15;
const DIR_LOCAL = path.join(process.cwd(), "server", "uploads", "tacografos");

/**
 * Se decide en cada llamada y no una vez al cargar el módulo.
 * `TACOGRAFOS_STORAGE_LOCAL` fuerza el disco aunque haya credenciales, que es
 * lo que necesitan las pruebas: la CI define un Supabase ficticio.
 */
function haySupabase(): boolean {
  if (process.env.TACOGRAFOS_STORAGE_LOCAL === "1") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let bucketListo = false;

/**
 * El cliente se importa tarde: `server/supabase.ts` revienta al importarse sin
 * credenciales, y eso dejaría sin arrancar hasta a las pruebas que no tocan
 * almacenamiento.
 */
async function cliente() {
  const { supabase } = await import("../supabase.ts");
  return supabase;
}

async function asegurarBucket(): Promise<void> {
  if (bucketListo || !haySupabase()) return;
  try {
    const sb = await cliente();
    const { data } = await sb.storage.getBucket(BUCKET);
    if (!data) {
      await sb.storage.createBucket(BUCKET, { public: false });
      console.log(`Tacógrafos: creado el bucket privado ${BUCKET}`);
    }
  } catch (e) {
    console.warn("Tacógrafos: no se ha podido comprobar el bucket:", e);
  }
  bucketListo = true;
}

/**
 * Ruta dentro del bucket. Lleva empresa y expediente por delante para que un
 * vistazo al almacenamiento diga de quién es cada cosa, y el instante de
 * emisión para que un documento reemitido tras anular el anterior no lo pise:
 * el anulado tiene que seguir ahí.
 */
export function rutaDocumento(
  empresaId: string,
  expedienteId: string,
  tipo: string,
  emitidoAtMs: number
): string {
  return `${empresaId}/${expedienteId}/${tipo}-${emitidoAtMs}.pdf`;
}

export async function guardarDocumento(ruta: string, contenido: Buffer): Promise<number> {
  if (!haySupabase()) {
    const destino = path.join(DIR_LOCAL, ruta);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
    return contenido.length;
  }

  await asegurarBucket();
  const sb = await cliente();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(ruta, contenido, { contentType: "application/pdf", upsert: false });

  if (error) {
    console.error("Tacógrafos: error subiendo el documento:", error);
    throw new ErrorTacografos(
      "No se ha podido guardar el documento. El expediente sí está registrado: vuelve a emitirlo.",
      "SUBIDA_FALLIDA",
      502
    );
  }
  return contenido.length;
}

/** Enlace temporal para abrir el documento desde la interfaz. */
export async function urlFirmada(ruta: string): Promise<string | null> {
  if (!haySupabase()) return `/uploads/tacografos/${ruta}`;

  const sb = await cliente();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(ruta, CADUCIDAD_ENLACE_S);
  if (error || !data) {
    console.warn("Tacógrafos: no se ha podido firmar el enlace:", error);
    return null;
  }
  return data.signedUrl;
}

export async function leerDocumento(ruta: string): Promise<Buffer | null> {
  if (!haySupabase()) {
    const origen = path.join(DIR_LOCAL, ruta);
    return fs.existsSync(origen) ? fs.readFileSync(origen) : null;
  }
  const sb = await cliente();
  const { data, error } = await sb.storage.from(BUCKET).download(ruta);
  if (error || !data) {
    console.warn("Tacógrafos: no se ha podido leer el documento:", ruta, error);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}
