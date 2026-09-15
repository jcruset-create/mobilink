/**
 * Dónde viven los PDF: el albarán original del proveedor y el recepcionado.
 *
 * Copia de `server/therefore/storage.ts`, por los mismos motivos: bucket
 * **privado** con enlaces firmados, porque un albarán de proveedor lleva
 * referencias y precios de compra. Y la ruta ES el hash del contenido, así que
 * el mismo fichero subido dos veces se guarda una.
 *
 * Sin Supabase configurado —desarrollo y pruebas— se guarda en disco bajo
 * `server/uploads/recepciones`. `RECEPCIONES_STORAGE_LOCAL=1` fuerza el disco
 * aunque haya credenciales: lo necesita la CI, que define un Supabase ficticio.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BUCKET = process.env.RECEPCIONES_DOCUMENTS_BUCKET || "recepciones-documentos";
const CADUCIDAD_ENLACE_S = 60 * 15;
const DIR_LOCAL = path.join(process.cwd(), "server", "uploads", "recepciones");

function haySupabase(): boolean {
  if (process.env.RECEPCIONES_STORAGE_LOCAL === "1") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let bucketListo = false;

/** El cliente se carga tarde: `server/supabase.ts` revienta al importarse sin credenciales. */
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
      console.log(`Recepciones: creado el bucket privado ${BUCKET}`);
    }
  } catch (e) {
    console.warn("Recepciones: no se ha podido comprobar el bucket:", e);
  }
  bucketListo = true;
}

/** El hash del contenido. Es la identidad del fichero en todo el módulo. */
export function hashDeFichero(contenido: Buffer): string {
  return crypto.createHash("sha256").update(contenido).digest("hex");
}

/** `<empresa>/<hash[0:2]>/<hash>.pdf`. */
export function rutaDocumento(empresaId: string, hash: string, extension = ".pdf"): string {
  return `${empresaId}/${hash.slice(0, 2)}/${hash}${extension}`;
}

export async function guardarDocumento(
  ruta: string,
  contenido: Buffer,
  mime = "application/pdf"
): Promise<{ ruta: string; tamanoBytes: number }> {
  if (!haySupabase()) {
    const destino = path.join(DIR_LOCAL, ruta);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
    return { ruta, tamanoBytes: contenido.length };
  }

  await asegurarBucket();
  const sb = await cliente();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(ruta, contenido, { contentType: mime, upsert: true });
  if (error) {
    console.error("Recepciones: error subiendo el documento:", error.message);
    throw new Error("No se ha podido guardar el documento.");
  }
  return { ruta, tamanoBytes: contenido.length };
}

export async function leerDocumento(ruta: string): Promise<Buffer | null> {
  if (!haySupabase()) {
    const origen = path.join(DIR_LOCAL, ruta);
    return fs.existsSync(origen) ? fs.readFileSync(origen) : null;
  }
  const sb = await cliente();
  const { data, error } = await sb.storage.from(BUCKET).download(ruta);
  if (error || !data) {
    console.warn("Recepciones: no se ha podido leer el documento:", ruta, error?.message);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Enlace temporal para abrir el PDF desde el visor del sistema. */
export async function urlFirmada(ruta: string): Promise<string | null> {
  if (!haySupabase()) return `/uploads/recepciones/${ruta}`;
  const sb = await cliente();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(ruta, CADUCIDAD_ENLACE_S);
  if (error || !data) {
    console.warn("Recepciones: no se ha podido firmar el enlace:", error?.message);
    return null;
  }
  return data.signedUrl;
}
